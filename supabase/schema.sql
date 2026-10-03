-- =====================================================================
-- Agenda Pipo — esquema do banco (Supabase / Postgres)
--
-- Rode este arquivo UMA vez no SQL Editor do Supabase, num projeto novo.
-- Ele é idempotente o suficiente para ser rodado de novo sem perder dados
-- (usa "if not exists" / "or replace" / "drop ... if exists").
--
-- Modelo:
--   documents  — o mesmo armazenamento "documento por caminho" que o app já
--                usava no Claude Artifact: 6 tipos de caminho fixos
--                (config/rooms, config/specialties, config/convenios,
--                 config/professionals, patients/all, schedule/<dia>-<semana>).
--   roles      — níveis de permissão (Administrador, Financeiro, Profissional,
--                Secretária), cada um com a grade módulo × ação.
--   profiles   — um por usuário do Supabase Auth: nome, ativo e o nível.
--
-- Segurança: RLS em tudo. A leitura exige usuário logado e ativo; a escrita
-- é conferida AÇÃO POR AÇÃO por um trigger (incluir / editar / excluir),
-- então esconder botões na tela não é a única barreira.
--
-- Histórico: projetos criados antes de 2026-09-30 tinham permissão por
-- pessoa; a migração está em 2026-09-30-niveis-de-permissao.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- roles (níveis de permissão)
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id          text primary key,
  name        text not null,
  is_admin    boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  sort        int not null default 0,
  updated_at  timestamptz not null default now(),
  constraint roles_id_format check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  constraint roles_name_not_blank check (length(btrim(name)) > 0)
);
alter table public.roles enable row level security;
create unique index if not exists roles_name_unique on public.roles (lower(btrim(name)));

insert into public.roles (id, name, is_admin, sort, permissions) values
  ('administrador', 'Administrador', true, 1, '{
    "agenda":        {"view": true, "create": true, "edit": true, "delete": true},
    "pacientes":     {"view": true, "create": true, "edit": true, "delete": true},
    "profissionais": {"view": true, "create": true, "edit": true, "delete": true},
    "salas":         {"view": true, "create": true, "edit": true, "delete": true},
    "agendamentos":  {"view": true, "create": true, "edit": true, "delete": true}
  }'),
  ('financeiro', 'Financeiro', false, 2, '{
    "agenda":        {"view": true, "create": false, "edit": false, "delete": false},
    "pacientes":     {"view": true, "create": true,  "edit": true,  "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false},
    "agendamentos":  {"view": true, "create": false, "edit": false, "delete": false}
  }'),
  ('profissional', 'Profissional', false, 3, '{
    "agenda":        {"view": true, "create": false, "edit": false, "delete": false},
    "pacientes":     {"view": true, "create": false, "edit": false, "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false},
    "agendamentos":  {"view": true, "create": false, "edit": false, "delete": false},
    "status":        {"finalizado": true, "nao-compareceu": true}
  }'),
  ('secretaria', 'Secretária', false, 4, '{
    "agenda":        {"view": true, "create": true,  "edit": true,  "delete": true},
    "pacientes":     {"view": true, "create": true,  "edit": true,  "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false},
    "agendamentos":  {"view": true, "create": true,  "edit": true,  "delete": true},
    "status":        {"finalizado": true, "nao-compareceu": true, "falta-justificada": true}
  }')
on conflict (id) do nothing;
-- Permissões: "agenda" = Planner (grade de 4 semanas); "agendamentos" = Agenda por data.
-- "status" = quais status de atendimento (config/statuses) o nível pode usar na Agenda.
-- "prontuario" = evoluções dos atendimentos (tabela clinical_records; ver o fim do arquivo).
-- "relatorios" = quais relatórios (aba Relatórios) o nível pode usar; ver o fim do arquivo.

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  role_id     text not null references public.roles(id),
  active      boolean not null default true,
  professional_id text, -- cadastro de profissional ligado a este usuário (opcional)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  path        text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint documents_path_valid check (
    path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic)|patients/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
  )
);

alter table public.documents enable row level security;

-- ---------------------------------------------------------------------
-- Funções auxiliares (security definer: leem profiles sem esbarrar no RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and r.is_admin
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.has_perm(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (r.is_admin or coalesce((r.permissions -> p_module ->> p_action)::boolean, false))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- Qual módulo de permissão governa cada caminho de documento.
-- Especialidades e convênios são sub-cadastros da aba Pacientes.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'config/specialties'     then 'pacientes'
    when p_path = 'config/convenios'       then 'pacientes'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'profissionais'
    when p_path = 'config/rooms'           then 'salas'
    when p_path = 'config/statuses'        then 'cadastro_status' -- nenhum nível tem: só Administrador
    when p_path = 'config/clinic'          then 'cadastro_clinica' -- só Administrador
  end;
$$;

-- ---------------------------------------------------------------------
-- Perfil criado automaticamente para cada novo usuário do Auth.
-- O PRIMEIRO usuário criado no projeto vira Administrador. Os demais recebem
-- o nível escolhido pelo administrador (a API manda em user_metadata.role_id),
-- com reserva para "Profissional" ou o primeiro nível não-administrador.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles) then
    v_role := (select id from public.roles where is_admin order by sort limit 1);
  else
    select id into v_role from public.roles
      where id = new.raw_user_meta_data ->> 'role_id' and not is_admin;
    if v_role is null then
      select id into v_role from public.roles where id = 'profissional';
    end if;
    if v_role is null then
      select id into v_role from public.roles where not is_admin order by sort limit 1;
    end if;
    if v_role is null then
      raise exception 'Crie um nível de permissão antes de cadastrar usuários.';
    end if;
  end if;
  insert into public.profiles (id, email, full_name, role_id)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nunca deixar o sistema sem nenhum administrador ativo.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_was_admin boolean;
  v_is_admin  boolean;
begin
  new.updated_at := now();
  new.id := old.id;
  new.email := old.email; -- e-mail só muda pelo Auth
  select is_admin into v_was_admin from public.roles where id = old.role_id;
  select is_admin into v_is_admin  from public.roles where id = new.role_id;
  if (coalesce(v_was_admin, false) and old.active) and not (coalesce(v_is_admin, false) and new.active) then
    if not exists (
      select 1 from public.profiles p join public.roles r on r.id = p.role_id
      where r.is_admin and p.active and p.id <> old.id
    ) then
      raise exception 'É preciso manter pelo menos um administrador ativo.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Níveis: o Administrador fica totalmente travado (acesso total, não pode
-- ser alterado nem excluído). Os demais: nome e permissões editáveis, nunca
-- viram administrador; nível com usuários não pode ser excluído.
create or replace function public.roles_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := false;
  new.name := btrim(new.name);
  new.sort := coalesce((select max(sort) from public.roles), 0) + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roles_before_insert on public.roles;
create trigger roles_before_insert
  before insert on public.roles
  for each row execute function public.roles_before_insert();

create or replace function public.roles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_admin then
    return old;
  end if;
  new.id := old.id;
  new.is_admin := false;
  new.sort := old.sort;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roles_guard on public.roles;
create trigger roles_guard
  before update on public.roles
  for each row execute function public.roles_guard();

create or replace function public.roles_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if old.is_admin then
    raise exception 'O nível Administrador não pode ser excluído.' using errcode = '42501';
  end if;
  select count(*) into n from public.profiles where role_id = old.id;
  if n > 0 then
    raise exception 'Este nível ainda tem % usuário(s). Mude-os de nível antes de excluir.', n using errcode = '23503';
  end if;
  return old;
end $$;

drop trigger if exists roles_before_delete on public.roles;
create trigger roles_before_delete
  before delete on public.roles
  for each row execute function public.roles_before_delete();

-- ---------------------------------------------------------------------
-- Conferência de permissão por ação na escrita de documentos.
--
-- Documentos de cadastro ({list:[{id,...}]}): item novo = incluir,
-- item removido = excluir, item alterado ou reordenado = editar.
-- Documentos da agenda ({bookings:{chave:{...}}}): chave nova = incluir,
-- chave removida = excluir, chave alterada = editar. Bloquear/liberar
-- horário (registro com blocked=true) conta como editar.
-- ---------------------------------------------------------------------
create or replace function public.documents_enforce()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_module   text := public.module_for_path(new.path);
  v_old      jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  v_need_create boolean := false;
  v_need_edit   boolean := false;
  v_need_delete boolean := false;
  v_old_ids  text[];
  v_new_ids  text[];
  r record;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  -- Sem usuário logado = SQL Editor ou service role (migração, scripts):
  -- passa direto. Anônimos nem chegam aqui (sem privilégio nem política).
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  -- Num "insert ... on conflict do update" (upsert), o Postgres dispara o
  -- BEFORE INSERT mesmo quando o documento já existe; nesse caso quem confere
  -- é o BEFORE UPDATE que vem em seguida, com o documento antigo de verdade.
  if tg_op = 'INSERT' and exists (select 1 from public.documents where path = new.path) then
    return new;
  end if;

  if v_module = 'agenda' then
    for r in
      select k,
             v_old -> 'bookings' -> k as o,
             new.data -> 'bookings' -> k as n
      from (
        select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
        union
        select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))
      ) keys
    loop
      if r.o is not distinct from r.n then
        continue;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then
        v_need_edit := true;
      elsif r.o is null then
        v_need_create := true;
      elsif r.n is null then
        v_need_delete := true;
      else
        v_need_edit := true;
      end if;
    end loop;
  else
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_old_ids
      from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_new_ids
      from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);

    for r in
      select o.e as o, n.e as n
      from (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) e) o
      full join
           (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e) n
        on o.id = n.id
    loop
      if r.o is not distinct from r.n then
        continue;
      elsif r.o is null then
        v_need_create := true;
      elsif r.n is null then
        v_need_delete := true;
      else
        v_need_edit := true;
      end if;
    end loop;

    -- mesma lista de itens, em outra ordem (ex.: reordenar salas) = editar
    if not v_need_edit and (
      select array_agg(x order by i) from unnest(v_old_ids) with ordinality u(x, i) where x = any(v_new_ids)
    ) is distinct from (
      select array_agg(x order by i) from unnest(v_new_ids) with ordinality u(x, i) where x = any(v_old_ids)
    ) then
      v_need_edit := true;
    end if;
  end if;

  if v_need_create and not public.has_perm(v_module, 'create') then
    raise exception 'Sem permissão para incluir em %', v_module using errcode = '42501';
  end if;
  if v_need_edit and not public.has_perm(v_module, 'edit') then
    raise exception 'Sem permissão para editar em %', v_module using errcode = '42501';
  end if;
  if v_need_delete and not public.has_perm(v_module, 'delete') then
    raise exception 'Sem permissão para excluir em %', v_module using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists documents_enforce on public.documents;
create trigger documents_enforce
  before insert or update on public.documents
  for each row execute function public.documents_enforce();

-- ---------------------------------------------------------------------
-- Gravação atômica de agendamentos: aplica só as chaves alteradas, dentro
-- de uma transação com trava na linha. Evita que duas pessoas editando o
-- mesmo dia ao mesmo tempo sobrescrevam as alterações uma da outra.
-- p_changes: { "<chave>": {...registro...} | null }  (null = desmarcar)
-- ---------------------------------------------------------------------
create or replace function public.patch_bookings(p_path text, p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
  v_bookings jsonb;
  k text;
  v jsonb;
begin
  if p_path not like 'schedule/%' then
    raise exception 'patch_bookings só vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then
    v_data := '{}'::jsonb;
  end if;

  v_bookings := coalesce(v_data -> 'bookings', '{}'::jsonb);
  for k, v in select * from jsonb_each(coalesce(p_changes, '{}'::jsonb)) loop
    if v is null or v = 'null'::jsonb then
      v_bookings := v_bookings - k;
    else
      v_bookings := v_bookings || jsonb_build_object(k, v);
    end if;
  end loop;
  v_data := jsonb_set(v_data, '{bookings}', v_bookings, true);

  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path) do update set data = excluded.data;

  return v_data;
end $$;

-- ---------------------------------------------------------------------
-- Políticas (RLS)
-- ---------------------------------------------------------------------
-- documents: qualquer usuário ativo lê (a agenda precisa de salas,
-- pacientes e profissionais para montar a grade); escrever exige ter
-- alguma permissão de escrita no módulo — o trigger acima confere a ação
-- exata. Apagar documento inteiro: só admin.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (public.is_active_user());

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.has_perm(public.module_for_path(path), 'create')
    or public.has_perm(public.module_for_path(path), 'edit')
    or public.has_perm(public.module_for_path(path), 'delete')
  );

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    public.has_perm(public.module_for_path(path), 'create')
    or public.has_perm(public.module_for_path(path), 'edit')
    or public.has_perm(public.module_for_path(path), 'delete')
  )
  with check (
    public.has_perm(public.module_for_path(path), 'create')
    or public.has_perm(public.module_for_path(path), 'edit')
    or public.has_perm(public.module_for_path(path), 'delete')
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (public.is_admin());

-- profiles: cada um vê o próprio; admin vê e altera todos.
-- Criar/remover usuário é feito pela função /api/admin-users (service role).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- roles: todo usuário ativo lê (precisa do próprio nível); só admin cria,
-- altera e exclui (os triggers acima protegem o nível Administrador).
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (public.is_active_user());

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (public.is_admin());

-- Privilégios: nada para anônimos.
revoke all on public.documents from anon;
revoke all on public.profiles  from anon;
revoke all on public.roles     from anon;
grant select, insert, update, delete on public.documents to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant execute on function public.patch_bookings(text, jsonb) to authenticated;
revoke execute on function public.patch_bookings(text, jsonb) from anon;

-- ---------------------------------------------------------------------
-- Realtime: alterações chegam ao vivo para toda a equipe.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
  ) then
    alter publication supabase_realtime add table public.documents;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'roles'
  ) then
    alter publication supabase_realtime add table public.roles;
  end if;
end $$;

-- =====================================================================
-- Nova Agenda (por data real) — um registro por atendimento
-- =====================================================================
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  time             text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  professional_id  text not null,
  room_id          text,
  patient          text not null default '',
  note             text not null default '',
  blocked          boolean not null default false,
  service          text,               -- id do serviço (config/services); padrão "sessao"
  source           text,               -- "planner" quando veio do botão Enviar para a Agenda
  status           text,               -- id do status (config/statuses): Finalizado, Não compareceu...
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
  -- Pode haver mais de um atendimento no mesmo horário (aparecem lado a lado).
);
create index if not exists appointments_date_idx on public.appointments (date);
create index if not exists appointments_slot_idx on public.appointments (date, time, professional_id);
alter table public.appointments enable row level security;

create or replace function public.appointments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists appointments_stamp on public.appointments;
create trigger appointments_stamp
  before insert or update on public.appointments
  for each row execute function public.appointments_stamp();

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated using (public.has_perm('agendamentos', 'view'));
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert to authenticated with check (public.has_perm('agendamentos', 'create'));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (public.has_perm('agendamentos', 'edit'))
  with check (public.has_perm('agendamentos', 'edit'));
drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete to authenticated using (public.has_perm('agendamentos', 'delete'));

revoke all on public.appointments from anon;
grant select, insert, update, delete on public.appointments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

create unique index if not exists profiles_professional_unique
  on public.profiles (professional_id) where professional_id is not null;

-- Serviços iniciais (cadastro na tela de Profissionais › Serviços).
insert into public.documents (path, data) values ('config/services', '{"list": [
  {"id": "sessao",                     "name": "Sessão"},
  {"id": "triagem",                    "name": "Triagem"},
  {"id": "avaliacao",                  "name": "Avaliação"},
  {"id": "avaliacao-neuropsicologica", "name": "Avaliação Neuropsicológica"},
  {"id": "orientacao-familiar",        "name": "Orientação Familiar"},
  {"id": "orientacao-escolar",         "name": "Orientação Escolar"}
]}'::jsonb)
on conflict (path) do nothing;

-- ---------------------------------------------------------------------
-- Status dos atendimentos (ver 2026-10-02d-status.sql)
-- ---------------------------------------------------------------------
insert into public.documents (path, data) values ('config/statuses', '{"list": [
  {"id": "finalizado",        "name": "Finalizado",        "color": "#2e7d4f"},
  {"id": "nao-compareceu",    "name": "Não compareceu",    "color": "#b6403a"},
  {"id": "falta-justificada", "name": "Falta Justificada", "color": "#c77d14"}
]}'::jsonb)
on conflict (path) do nothing;

create or replace function public.can_set_status(p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_status is null or btrim(p_status) = '' or coalesce((
    select p.active and (r.is_admin or coalesce((r.permissions -> 'status' ->> p_status)::boolean, false))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- 4. Guarda: criar/alterar status só entre status permitidos ao nível.
create or replace function public.appointments_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_status_guard on public.appointments;
create trigger appointments_status_guard
  before insert or update on public.appointments
  for each row execute function public.appointments_status_guard();

-- 5. Trocar só o status (para quem pode ver a Agenda, mesmo sem "editar").
create or replace function public.set_appointment_status(p_id uuid, p_status text)
returns public.appointments language plpgsql security definer set search_path = public as $$
declare
  r public.appointments;
begin
  if not public.has_perm('agendamentos', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update public.appointments set status = nullif(btrim(coalesce(p_status, '')), '')
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'Atendimento não encontrado (talvez já tenha sido apagado).';
  end if;
  return r;
end;
$$;

revoke all on function public.set_appointment_status(uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Prontuário (ver 2026-10-02e-prontuario.sql)
-- ---------------------------------------------------------------------
create table if not exists public.clinical_records (
  id               uuid primary key default gen_random_uuid(),
  patient_id       text not null,                -- id do paciente (patients/all)
  patient_name     text not null default '',     -- nome na hora em que foi escrito
  appointment_id   uuid references public.appointments(id) on delete set null,
  appointment_date date,                         -- data/hora do atendimento (ou da escrita)
  appointment_time text,
  professional_id  text,                         -- profissional (config/professionals)
  author_id        uuid references auth.users(id) on delete set null,
  author_name      text not null default '',
  content          text not null default '',     -- HTML (o app limpa antes de salvar e de mostrar)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists clinical_records_patient_idx on public.clinical_records (patient_id, created_at desc);
create index if not exists clinical_records_appt_idx on public.clinical_records (appointment_id);
alter table public.clinical_records enable row level security;

-- Autor e datas são sempre do banco (ninguém escreve em nome de outro).
create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists clinical_records_stamp on public.clinical_records;
create trigger clinical_records_stamp
  before insert or update on public.clinical_records
  for each row execute function public.clinical_records_stamp();

drop policy if exists clinical_records_select on public.clinical_records;
create policy clinical_records_select on public.clinical_records
  for select to authenticated using (public.has_perm('prontuario', 'view'));
drop policy if exists clinical_records_insert on public.clinical_records;
create policy clinical_records_insert on public.clinical_records
  for insert to authenticated with check (public.has_perm('prontuario', 'create'));
drop policy if exists clinical_records_update on public.clinical_records;
create policy clinical_records_update on public.clinical_records
  for update to authenticated
  using (public.has_perm('prontuario', 'edit') and author_id = auth.uid())
  with check (public.has_perm('prontuario', 'edit') and author_id = auth.uid());
drop policy if exists clinical_records_delete on public.clinical_records;
create policy clinical_records_delete on public.clinical_records
  for delete to authenticated
  using (public.is_admin() or (public.has_perm('prontuario', 'delete') and author_id = auth.uid()));

revoke all on public.clinical_records from anon;
grant select, insert, update, delete on public.clinical_records to authenticated;

-- Permissões iniciais do novo módulo (só se o nível ainda não tiver).
update public.roles set permissions = permissions || '{"prontuario": {"view": true, "create": true, "edit": true, "delete": true}}'::jsonb
  where id = 'administrador' and not (permissions ? 'prontuario');
update public.roles set permissions = permissions || '{"prontuario": {"view": true, "create": true, "edit": true, "delete": false}}'::jsonb
  where id = 'profissional' and not (permissions ? 'prontuario');
update public.roles set permissions = permissions || '{"prontuario": {"view": false, "create": false, "edit": false, "delete": false}}'::jsonb
  where id in ('secretaria', 'financeiro') and not (permissions ? 'prontuario');

-- ---------------------------------------------------------------------
-- Profissional vê só a própria agenda (ver 2026-10-02f-agenda-do-profissional.sql;
-- substitui appointments_select e set_appointment_status acima)
-- ---------------------------------------------------------------------
create or replace function public.agenda_scope_professional()
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.active and not r.is_admin and p.professional_id is not null
         and not coalesce((r.permissions -> 'agendamentos' ->> 'edit')::boolean, false)
    then p.professional_id
  end
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    public.has_perm('agendamentos', 'view')
    and (public.agenda_scope_professional() is null or professional_id = public.agenda_scope_professional())
  );

create or replace function public.set_appointment_status(p_id uuid, p_status text)
returns public.appointments language plpgsql security definer set search_path = public as $$
declare
  r public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agendamentos', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_scope is not null and not exists (
    select 1 from public.appointments a where a.id = p_id and a.professional_id = v_scope
  ) then
    raise exception 'Você só pode mudar o status dos seus atendimentos.' using errcode = '42501';
  end if;
  update public.appointments set status = nullif(btrim(coalesce(p_status, '')), '')
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'Atendimento não encontrado (talvez já tenha sido apagado).';
  end if;
  return r;
end;
$$;

revoke all on function public.set_appointment_status(uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Relatórios (ver 2026-10-02g-relatorios.sql)
-- ---------------------------------------------------------------------
update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "convenios": true, "pacote": true, "pendentes": true, "ocupacao": true, "bloqueios": true, "sem-atendimento": true}}'::jsonb
  where id = 'secretaria' and not (permissions ? 'relatorios');
update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "convenios": true, "pacote": true, "sem-atendimento": true}}'::jsonb
  where id = 'financeiro' and not (permissions ? 'relatorios');
update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "pendentes": true, "bloqueios": true}}'::jsonb
  where id = 'profissional' and not (permissions ? 'relatorios');

create or replace function public.has_report(p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (r.is_admin or coalesce((r.permissions -> 'relatorios' ->> p_type)::boolean, false))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- Ids dos atendimentos do período que já têm evolução no prontuário.
create or replace function public.report_appointments_with_records(p_from date, p_to date)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_report('pendentes') then
    raise exception 'Sem permissão para este relatório.' using errcode = '42501';
  end if;
  return query
    select distinct cr.appointment_id
    from public.clinical_records cr
    join public.appointments a on a.id = cr.appointment_id
    where a.date between p_from and p_to
      and (v_scope is null or a.professional_id = v_scope);
end;
$$;

revoke all on function public.report_appointments_with_records(date, date) from public, anon;
grant execute on function public.report_appointments_with_records(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- "Finalizado" exige evolução (ver 2026-10-02i; substitui appointments_status_guard acima)
-- ---------------------------------------------------------------------
create or replace function public.appointments_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
    if new.status = 'finalizado'
       and exists (
         select 1 from public.documents d, jsonb_array_elements(d.data -> 'list') p
         where d.path = 'patients/all' and lower(btrim(p ->> 'nome')) = lower(btrim(new.patient))
       )
       and not exists (select 1 from public.clinical_records c where c.appointment_id = new.id)
    then
      raise exception 'Para finalizar, registre a evolução deste atendimento no prontuário.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- Agenda Pipo — nome do usuário = nome do profissional (2026-10-02, parte 10)
--
--   * Usuário ligado a um profissional (profiles.professional_id) sempre tem
--     o mesmo nome do cadastro do profissional (config/professionals).
--   * Quem manda é o cadastro do profissional: ao salvar o profissional, o
--     nome do usuário ligado é atualizado sozinho; na tela Usuários o nome
--     desse usuário fica travado. Ligar um usuário a um profissional também
--     copia o nome.
--   * No fim, acerta de uma vez os usuários que já estão diferentes.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Salvou o cadastro de profissionais → atualiza o nome dos usuários ligados.
create or replace function public.sync_professional_user_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles pr
     set full_name = btrim(item ->> 'name')
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) item
   where pr.professional_id = item ->> 'id'
     and coalesce(btrim(item ->> 'name'), '') <> ''
     and pr.full_name is distinct from btrim(item ->> 'name');
  return new;
end;
$$;

drop trigger if exists documents_sync_professional_names on public.documents;
create trigger documents_sync_professional_names
  after insert or update on public.documents
  for each row when (new.path = 'config/professionals')
  execute function public.sync_professional_user_names();

-- 2. Usuário ligado a um profissional: o nome vem sempre do cadastro dele.
create or replace function public.profiles_professional_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(item ->> 'name') into v_name
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_professional_name on public.profiles;
create trigger profiles_professional_name
  before insert or update on public.profiles
  for each row execute function public.profiles_professional_name();

-- 3. Acerta agora os que já estão diferentes.
update public.profiles pr
   set full_name = btrim(item ->> 'name')
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
 where d.path = 'config/professionals'
   and pr.professional_id = item ->> 'id'
   and coalesce(btrim(item ->> 'name'), '') <> ''
   and pr.full_name is distinct from btrim(item ->> 'name');


-- =====================================================================
-- Agenda Pipo — corrige "Sem permissão" ao criar nível (2026-10-02, parte 11)
--
-- Reaplica as regras que deixam o ADMINISTRADOR criar e excluir níveis de
-- permissão (as mesmas da migração 2026-09-30b). Não muda nenhum nível nem
-- usuário. Pode rodar de novo sem estragar.
-- =====================================================================

alter table public.roles enable row level security;

-- quem é administrador (usuário ativo num nível de administrador)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and r.is_admin
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- nível novo: nunca administrador; vai para o fim da lista
create or replace function public.roles_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := false;
  new.name := btrim(new.name);
  new.sort := coalesce((select max(sort) from public.roles), 0) + 1;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roles_before_insert on public.roles;
create trigger roles_before_insert
  before insert on public.roles
  for each row execute function public.roles_before_insert();

-- políticas: usuários ativos leem; administrador cria, altera e exclui
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated using (public.is_active_user());

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated with check (public.is_admin());

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.roles to authenticated;

-- conferência: deve listar as 4 regras (select, insert, update, delete)
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'roles' order by cmd;


-- =====================================================================
-- Agenda Pipo — permissão própria para cada cadastro e para o Resumo
-- (2026-10-02, parte 12)
--
--   Antes: Convênios e Especialidades seguiam "Pacientes"; Serviços seguia
--   "Profissionais"; Grupos de Suporte seguia "Salas"; Clínica e Status eram
--   só do Administrador; o Resumo seguia o "Planner".
--   Agora cada um tem a sua linha em Níveis de permissão:
--     convenios, especialidades, servicos, grupos, clinica (ver/editar),
--     cadastro_status, resumo (ver).
--   Os níveis que já existem recebem o mesmo acesso que tinham antes
--   (nada muda para ninguém até o Administrador alterar).
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Qual permissão governa cada documento.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'config/specialties'     then 'especialidades'
    when p_path = 'config/convenios'       then 'convenios'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'servicos'
    when p_path = 'config/rooms'           then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'        then 'cadastro_status'
    when p_path = 'config/clinic'          then 'clinica'
  end;
$$;

-- Pode gravar o documento (alguma ação no módulo; salas e grupos dividem config/rooms)?
create or replace function public.can_write_path(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unnest(case when p_path = 'config/rooms' then array['salas', 'grupos']
                              else array[public.module_for_path(p_path)] end) m
    where public.has_perm(m, 'create') or public.has_perm(m, 'edit') or public.has_perm(m, 'delete')
  );
$$;

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated with check (public.can_write_path(path));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (public.can_write_path(path)) with check (public.can_write_path(path));

-- 2. Conferência de cada gravação: cada item com a permissão do seu cadastro.
create or replace function public.documents_enforce()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_module   text := public.module_for_path(new.path);
  v_old      jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  v_need     text[] := '{}';  -- 'modulo:acao' exigidos
  v_old_ids  text[];
  v_new_ids  text[];
  v_mod      text;
  v_item     jsonb;
  v_x        text;
  r record;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  -- Sem usuário logado = SQL Editor ou service role (migração, scripts).
  if auth.uid() is null then return new; end if;
  if public.is_admin() then return new; end if;

  -- Num upsert, o BEFORE INSERT dispara mesmo com o documento existente;
  -- quem confere é o BEFORE UPDATE que vem em seguida.
  if tg_op = 'INSERT' and exists (select 1 from public.documents where path = new.path) then
    return new;
  end if;

  if v_module = 'agenda' then
    for r in
      select k, v_old -> 'bookings' -> k as o, new.data -> 'bookings' -> k as n
      from (select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
            union select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))) keys
    loop
      if r.o is not distinct from r.n then continue;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, 'agenda:edit');
      elsif r.o is null then v_need := array_append(v_need, 'agenda:create');
      elsif r.n is null then v_need := array_append(v_need, 'agenda:delete');
      else v_need := array_append(v_need, 'agenda:edit');
      end if;
    end loop;
  elsif not (coalesce(v_old, '{}'::jsonb) ? 'list') and not (new.data ? 'list') then
    -- documento que não é lista (ex.: cadastro da Clínica): mudou = editar
    if v_old is distinct from new.data then v_need := array_append(v_need, v_module || ':edit'); end if;
  else
    for r in
      select o.e as o, n.e as n
      from (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) e) o
      full join
           (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e) n
        on o.id = n.id
    loop
      if r.o is not distinct from r.n then continue; end if;
      v_item := coalesce(r.n, r.o);
      v_mod := case when new.path = 'config/rooms' and coalesce((v_item ->> 'group')::boolean, false) then 'grupos' else v_module end;
      if r.o is null then v_need := array_append(v_need, v_mod || ':create');
      elsif r.n is null then v_need := array_append(v_need, v_mod || ':delete');
      else v_need := array_append(v_need, v_mod || ':edit');
      end if;
    end loop;

    -- mesma lista em outra ordem (ex.: reordenar salas) = editar
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_old_ids
      from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_new_ids
      from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);
    if (select array_agg(x order by i) from unnest(v_old_ids) with ordinality u(x, i) where x = any(v_new_ids))
       is distinct from
       (select array_agg(x order by i) from unnest(v_new_ids) with ordinality u(x, i) where x = any(v_old_ids))
    then
      if new.path = 'config/rooms' then
        if not (public.has_perm('salas', 'edit') or public.has_perm('grupos', 'edit')) then
          raise exception 'Sem permissão para editar em salas' using errcode = '42501';
        end if;
      else
        v_need := array_append(v_need, v_module || ':edit');
      end if;
    end if;
  end if;

  foreach v_x in array v_need loop
    if not public.has_perm(split_part(v_x, ':', 1), split_part(v_x, ':', 2)) then
      raise exception 'Sem permissão para % em %',
        case split_part(v_x, ':', 2) when 'create' then 'incluir' when 'edit' then 'editar' else 'excluir' end,
        split_part(v_x, ':', 1) using errcode = '42501';
    end if;
  end loop;

  return new;
end $$;

-- 3. Níveis existentes: mesmo acesso que tinham antes.
update public.roles set permissions = permissions
  || jsonb_build_object('convenios',      coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'convenios');
update public.roles set permissions = permissions
  || jsonb_build_object('especialidades', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'especialidades');
update public.roles set permissions = permissions
  || jsonb_build_object('servicos',       coalesce(permissions -> 'profissionais', '{}'::jsonb))
  where not is_admin and not (permissions ? 'servicos');
update public.roles set permissions = permissions
  || jsonb_build_object('grupos',         coalesce(permissions -> 'salas', '{}'::jsonb))
  where not is_admin and not (permissions ? 'grupos');
update public.roles set permissions = permissions
  || jsonb_build_object('resumo', jsonb_build_object('view', coalesce((permissions -> 'agenda' ->> 'view')::boolean, false)))
  where not is_admin and not (permissions ? 'resumo');
update public.roles set permissions = permissions
  || '{"clinica": {"view": false, "edit": false}, "cadastro_status": {"view": false, "create": false, "edit": false, "delete": false}}'::jsonb
  where not is_admin and not (permissions ? 'clinica');

-- conferência
select name, permissions -> 'convenios' as convenios, permissions -> 'especialidades' as especialidades,
       permissions -> 'servicos' as servicos, permissions -> 'grupos' as grupos, permissions -> 'resumo' as resumo
from public.roles order by name;


-- =====================================================================
-- Agenda Pipo — atendimento com evolução não pode ser apagado
-- (2026-10-02, parte 13)
--
--   * Atendimento da Agenda (appointments) que tem evolução no prontuário
--     (clinical_records.appointment_id) é registro clínico: só o
--     Administrador pode excluí-lo. Os demais precisam apagar a evolução antes.
--   * Quando o Administrador exclui, a evolução continua no prontuário
--     (fica sem a ligação com a agenda — regra "on delete set null" de antes).
--   * SQL Editor / scripts (sem usuário logado) não são bloqueados.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.appointments_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return old; end if;
  if exists (select 1 from public.clinical_records c where c.appointment_id = old.id) then
    raise exception 'Este atendimento tem evolução no prontuário: apague a evolução antes de excluir o atendimento (ou peça ao Administrador).'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists appointments_delete_guard on public.appointments;
create trigger appointments_delete_guard
  before delete on public.appointments
  for each row execute function public.appointments_delete_guard();


-- =====================================================================
-- Agenda Pipo — cópia de segurança (2026-10-03)
--
--   * Restaurar a cópia (menu Acesso → Cópia de segurança) grava pela
--     função /api/admin-backup com a service role key, ou seja, SEM usuário
--     logado (auth.uid() nulo).
--   * Nesse caso os triggers de carimbo passam a MANTER as datas e os autores
--     que vêm da cópia (antes trocavam tudo por "agora" e "ninguém").
--     Para quem usa o app (usuário logado) nada muda.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.appointments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém o que veio, completando o que faltar.
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_by := coalesce(new.created_by, old.created_by);
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém autor e datas da cópia.
    if tg_op = 'UPDATE' then
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;


-- =====================================================================
-- Agenda Pipo — Tratamentos (2026-10-03)
--
--   * Novo documento treatments/all (cadastro de Tratamentos), com permissão
--     própria "tratamentos" (ver/incluir/editar/excluir) em Níveis de permissão.
--     Os níveis que já existem recebem o mesmo acesso que têm em Pacientes.
--   * Convênio, plano, pacote, ABA, especialidades/serviços e horário de
--     atendimento passam do paciente para o tratamento.
--   * Cria UM tratamento Ativo (tipo Novo) para cada paciente, com os dados que
--     estão hoje no cadastro dele. Início = primeiro atendimento dele na Agenda
--     (ou hoje, se ainda não tem). Valor e despesas ficam em 0 para preencher.
--     Os campos antigos continuam guardados no paciente (nada é apagado).
--
-- Rode UMA vez no SQL Editor do Supabase. Pode rodar de novo sem estragar: se
-- treatments/all já existir, os tratamentos NÃO são recriados.
-- =====================================================================

-- 1. Aceitar o caminho treatments/all.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento (+ tratamentos).
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'treatments/all'         then 'tratamentos'
    when p_path = 'config/specialties'     then 'especialidades'
    when p_path = 'config/convenios'       then 'convenios'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'servicos'
    when p_path = 'config/rooms'           then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'        then 'cadastro_status'
    when p_path = 'config/clinic'          then 'clinica'
  end;
$$;

-- 3. Níveis existentes: Tratamentos com o mesmo acesso de Pacientes.
--    O relatório "Tratamentos novos e renegociados" começa liberado só para o
--    Administrador (libere para outros níveis em Níveis de permissão).
update public.roles set permissions = permissions
  || jsonb_build_object('tratamentos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'tratamentos');

-- 4. Um tratamento por paciente, com os dados de hoje do cadastro dele.
insert into public.documents (path, data)
select 'treatments/all', jsonb_build_object('list', coalesce(jsonb_agg(t order by t ->> 'patientId'), '[]'::jsonb))
from (
  select jsonb_strip_nulls(jsonb_build_object(
    'id',          'tr-' || (p ->> 'id'),
    'patientId',   p ->> 'id',
    'inicio',      coalesce(
                     (select to_char(min(a.date), 'YYYY-MM-DD') from public.appointments a
                       where not a.blocked and lower(btrim(a.patient)) = lower(btrim(p ->> 'nome'))),
                     to_char(current_date, 'YYYY-MM-DD')),
    'valor',       0,
    'despesas',    0,
    'tipo',        'novo',
    'status',      'ativo',
    'statusEm',    to_char(current_date, 'YYYY-MM-DD'),
    'obs',         'Criado automaticamente a partir do cadastro do paciente.',
    'convenioId',  p -> 'convenioId',
    'convenio',    p -> 'convenio',
    'plano',       p -> 'plano',
    'pacoteHoras', p -> 'pacoteHoras',
    'aba',         p -> 'aba',
    'specHours',   p -> 'specHours',
    'horarios',    p -> 'horarios',
    'criadoEm',    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )) as t
  from jsonb_array_elements(coalesce((select data -> 'list' from public.documents where path = 'patients/all'), '[]'::jsonb)) p
  where coalesce(p ->> 'id', '') <> ''
) x
on conflict (path) do nothing;

-- conferência: quantos tratamentos foram criados
select jsonb_array_length(data -> 'list') as tratamentos from public.documents where path = 'treatments/all';
