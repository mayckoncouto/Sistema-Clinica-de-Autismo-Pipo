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


-- =====================================================================
-- Agenda Pipo — um só tratamento Ativo por paciente, conferido no banco
-- (2026-10-03, Etapa 0)
--
--   * O app já não deixa salvar dois tratamentos Ativos do mesmo paciente,
--     mas duas pessoas salvando ao mesmo tempo poderiam escapar disso.
--     Agora o próprio banco recusa qualquer gravação de treatments/all que
--     deixe um paciente com mais de um tratamento Ativo.
--   * Vale para todos (inclusive Administrador, scripts e restauração da
--     cópia de segurança).
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatments_one_active()
returns trigger language plpgsql as $$
declare
  v_dup text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  select x.pid into v_dup
  from (
    select e ->> 'patientId' as pid, count(*) as n
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e
    where e ->> 'status' = 'ativo'
    group by 1
  ) x
  where x.n > 1
  limit 1;
  if v_dup is not null then
    raise exception 'Cada paciente só pode ter um tratamento ativo (paciente %). Recarregue a página e tente de novo.', v_dup;
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_one_active on public.documents;
create trigger treatments_one_active
  before insert or update on public.documents
  for each row execute function public.treatments_one_active();

-- conferência: deve mostrar 0 (nenhum paciente com mais de um ativo hoje)
select count(*) as pacientes_com_mais_de_um_ativo
from (
  select e ->> 'patientId', count(*)
  from public.documents d, jsonb_array_elements(d.data -> 'list') e
  where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
  group by 1 having count(*) > 1
) x;


-- =====================================================================
-- Agenda Pipo — valores dos tratamentos protegidos (2026-10-03, Etapa 1)
--
--   * Valor e despesas saem do documento treatments/all (que todo usuário
--     ativo consegue ler) e vão para a tabela treatment_finance, que só
--     libera para quem tem a permissão "Tratamentos – valores"
--     (tratamentos_valores: ver / editar) no nível.
--   * Nenhum nível (além do Administrador) começa com essa permissão:
--     marque em Usuários → Níveis de permissão quem pode ver/editar.
--   * Os valores que já existem são copiados para a tabela nova e depois
--     tirados do documento. Nada é perdido.
--
-- ANTES DE RODAR: baixe uma cópia de segurança (menu Acesso).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabela dos valores (um registro por tratamento).
create table if not exists public.treatment_finance (
  treatment_id  text primary key,
  valor         numeric(12,2) not null default 0,
  despesas      numeric(12,2) not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
alter table public.treatment_finance enable row level security;
grant select, insert, update, delete on public.treatment_finance to authenticated;

create or replace function public.treatment_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists treatment_finance_stamp on public.treatment_finance;
create trigger treatment_finance_stamp
  before insert or update on public.treatment_finance
  for each row execute function public.treatment_finance_stamp();

-- 2. Quem vê / grava (o Administrador sempre; os outros pela permissão do nível).
drop policy if exists treatment_finance_select on public.treatment_finance;
create policy treatment_finance_select on public.treatment_finance
  for select to authenticated using (public.has_perm('tratamentos_valores', 'view'));
drop policy if exists treatment_finance_insert on public.treatment_finance;
create policy treatment_finance_insert on public.treatment_finance
  for insert to authenticated with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists treatment_finance_update on public.treatment_finance;
create policy treatment_finance_update on public.treatment_finance
  for update to authenticated
  using (public.has_perm('tratamentos_valores', 'edit'))
  with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists treatment_finance_delete on public.treatment_finance;
create policy treatment_finance_delete on public.treatment_finance
  for delete to authenticated
  using (public.has_perm('tratamentos_valores', 'edit') or public.has_perm('tratamentos', 'delete'));

-- 3. Copia os valores atuais para a tabela nova.
insert into public.treatment_finance (treatment_id, valor, despesas)
select e ->> 'id',
       coalesce(nullif(e ->> 'valor', '')::numeric, 0),
       coalesce(nullif(e ->> 'despesas', '')::numeric, 0)
from public.documents d, jsonb_array_elements(d.data -> 'list') e
where d.path = 'treatments/all' and coalesce(e ->> 'id', '') <> ''
on conflict (treatment_id) do nothing;

-- 4. Tira valor e despesas do documento (que todos leem), mantendo a ordem.
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg((x.e - 'valor' - 'despesas') order by x.i), '[]'::jsonb)
  from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, i)
))
where d.path = 'treatments/all';

-- 5. Níveis existentes: começam SEM ver os valores (o Administrador escolhe).
update public.roles set permissions = permissions
  || '{"tratamentos_valores": {"view": false, "edit": false}}'::jsonb
  where not is_admin and not (permissions ? 'tratamentos_valores');

-- conferência: quantos tratamentos têm valores guardados e se o documento ficou sem valores
select (select count(*) from public.treatment_finance) as tratamentos_com_valores,
       (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
         where d.path = 'treatments/all' and (e ? 'valor' or e ? 'despesas')) as valores_ainda_no_documento;

-- ---------------------------------------------------------------------
-- 2026-10-03e — motivos de cancelamento (ver supabase/2026-10-03e-motivos-de-cancelamento.sql)
-- ---------------------------------------------------------------------
-- 1. Aceitar o caminho config/cancel_reasons.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento (+ motivos de cancelamento).
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm em Tratamentos.
update public.roles set permissions = permissions
  || jsonb_build_object('motivos_cancelamento', coalesce(permissions -> 'tratamentos', '{}'::jsonb))
  where not is_admin and not (permissions ? 'motivos_cancelamento');

-- 4. Motivos iniciais.
insert into public.documents (path, data) values ('config/cancel_reasons', '{"list": [
  {"id": "financeiro",        "name": "Financeiro"},
  {"id": "mudanca-de-cidade", "name": "Mudança de cidade"},
  {"id": "alta-terapeutica",  "name": "Alta terapêutica"},
  {"id": "insatisfacao",      "name": "Insatisfação"},
  {"id": "outro",             "name": "Outro"}
]}'::jsonb)
on conflict (path) do nothing;

-- 5. Cancelado é definitivo e precisa de motivo.
create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status.
  if tg_op = 'UPDATE' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo.
  select n ->> 'id' into v_bad
  from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
  where n ->> 'status' = 'cancelado'
    and coalesce(n ->> 'motivoCancel', '') = ''
    and (tg_op = 'INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
      where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
  limit 1;
  if v_bad is not null then
    raise exception 'Informe o motivo do cancelamento do tratamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_cancel_rules on public.documents;
create trigger treatments_cancel_rules
  before insert or update on public.documents
  for each row execute function public.treatments_cancel_rules();



-- =====================================================================
-- Agenda Pipo — valor por sessão de cada especialidade nos convênios (2026-10-04)
--
--   * O convênio (documento config/convenios) guarda só QUAIS especialidades
--     cobre. O valor por sessão de cada uma fica nesta tabela protegida, com a
--     mesma permissão dos valores dos tratamentos ("Tratamentos – valores":
--     ver / editar). O Administrador sempre vê.
--   * "Especialidade que libera outras" fica no cadastro de Especialidades
--     (config/specialties, campo libera) e não precisa de banco novo.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create table if not exists public.convenio_finance (
  id           text primary key,              -- "<convenio_id>|<spec_id>"
  convenio_id  text not null,
  spec_id      text not null,
  valor        numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  unique (convenio_id, spec_id)
);
alter table public.convenio_finance enable row level security;
grant select, insert, update, delete on public.convenio_finance to authenticated;

create or replace function public.convenio_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := new.convenio_id || '|' || new.spec_id;
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists convenio_finance_stamp on public.convenio_finance;
create trigger convenio_finance_stamp
  before insert or update on public.convenio_finance
  for each row execute function public.convenio_finance_stamp();

drop policy if exists convenio_finance_select on public.convenio_finance;
create policy convenio_finance_select on public.convenio_finance
  for select to authenticated using (public.has_perm('tratamentos_valores', 'view'));
drop policy if exists convenio_finance_insert on public.convenio_finance;
create policy convenio_finance_insert on public.convenio_finance
  for insert to authenticated with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists convenio_finance_update on public.convenio_finance;
create policy convenio_finance_update on public.convenio_finance
  for update to authenticated
  using (public.has_perm('tratamentos_valores', 'edit'))
  with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists convenio_finance_delete on public.convenio_finance;
create policy convenio_finance_delete on public.convenio_finance
  for delete to authenticated
  using (public.has_perm('tratamentos_valores', 'edit') or public.has_perm('convenios', 'delete'));



-- =====================================================================
-- Agenda Pipo — itens do menu Acesso nos Níveis de permissão (2026-10-04)
--
--   Novos itens em roles.permissions:
--     usuarios {view, create, edit, delete}  — tela Usuários
--     backup   {view}                        — baixar o backup (restaurar: só Administrador)
--     ajuda    {view}                        — Guia de ajuda
--     senha    {view}                        — Trocar senha
--   (Status = cadastro_status e Clínica = clinica já existiam.)
--
--   * Níveis existentes: Ajuda e Trocar senha começam MARCADOS; Usuários e
--     Backup começam desmarcados (o Administrador marca quem pode).
--   * Quem tem "Usuários" vê e altera as contas, mas:
--       - Níveis de permissão continuam só com o Administrador;
--       - conta de administrador só o Administrador altera;
--       - ninguém dá o nível Administrador a alguém (só o Administrador);
--       - ninguém muda o próprio nível.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Valores iniciais nos níveis que ainda não têm os itens.
update public.roles set permissions = permissions || '{"ajuda": {"view": true}}'::jsonb
  where not is_admin and not (permissions ? 'ajuda');
update public.roles set permissions = permissions || '{"senha": {"view": true}}'::jsonb
  where not is_admin and not (permissions ? 'senha');
update public.roles set permissions = permissions || '{"usuarios": {"view": false, "create": false, "edit": false, "delete": false}}'::jsonb
  where not is_admin and not (permissions ? 'usuarios');
update public.roles set permissions = permissions || '{"backup": {"view": false}}'::jsonb
  where not is_admin and not (permissions ? 'backup');

-- 2. Perfis: quem tem "Usuários" vê todos e altera (com as travas do item 3).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.has_perm('usuarios', 'view'));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin() or public.has_perm('usuarios', 'edit'))
  with check (public.is_admin() or public.has_perm('usuarios', 'edit'));

-- 3. Travas para quem não é Administrador.
create or replace function public.profiles_nonadmin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_admin boolean;
  v_new_admin boolean;
begin
  if auth.uid() is null or public.is_admin() then
    return new;   -- Administrador, service role (API) e scripts
  end if;
  select is_admin into v_old_admin from public.roles where id = old.role_id;
  select is_admin into v_new_admin from public.roles where id = new.role_id;
  if coalesce(v_old_admin, false) then
    raise exception 'Só o Administrador altera uma conta de administrador.';
  end if;
  if coalesce(v_new_admin, false) then
    raise exception 'Só o Administrador dá o nível Administrador.';
  end if;
  if new.id = auth.uid() and new.role_id is distinct from old.role_id then
    raise exception 'Você não pode mudar o seu próprio nível.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_nonadmin_guard on public.profiles;
create trigger profiles_nonadmin_guard
  before update on public.profiles
  for each row execute function public.profiles_nonadmin_guard();



-- =====================================================================
-- Agenda Pipo — Relatório financeiro (Etapa 6, 2026-10-04)
--
--   O relatório "Relatório financeiro" (Relatórios → permissão própria em
--   Níveis de permissão → Relatórios) soma o valor mensal dos tratamentos.
--   Os valores ficam em treatment_finance, que só "Tratamentos – valores: ver"
--   podia ler. Aqui a leitura passa a valer também para quem tem esse relatório.
--   (Gravar valores continua só com "Tratamentos – valores: editar".)
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

drop policy if exists treatment_finance_select on public.treatment_finance;
create policy treatment_finance_select on public.treatment_finance
  for select to authenticated
  using (public.has_perm('tratamentos_valores', 'view') or public.has_perm('relatorios', 'financeiro'));


-- ===== 2026-10-04d-gravar-so-o-tratamento.sql =====
-- =====================================================================
-- Agenda Pipo — gravar só o tratamento alterado (Etapa 7, 2026-10-04)
--
--   Antes, salvar um tratamento regravava a lista inteira (treatments/all):
--   duas pessoas salvando tratamentos diferentes ao mesmo tempo podiam apagar
--   a alteração uma da outra. A função patch_list aplica só os itens
--   alterados/novos e tira os excluídos, numa transação com trava de linha
--   (igual ao patch_bookings da agenda). Roda com as permissões de quem chama
--   (security invoker): as regras de sempre continuam valendo (documents_enforce,
--   um só tratamento ativo, regras do cancelamento).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.patch_list(p_path text, p_upserts jsonb, p_deletes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_del  text[];
  v_seen text[] := '{}';
  e jsonb;
  u jsonb;
begin
  if p_path like 'schedule/%' then
    raise exception 'patch_list não vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then v_data := '{}'::jsonb; end if;

  select coalesce(array_agg(x), '{}') into v_del
  from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)) as x;

  -- Mantém a ordem: substitui no lugar os alterados e tira os excluídos.
  for e in select value from jsonb_array_elements(coalesce(v_data -> 'list', '[]'::jsonb)) loop
    if (e ->> 'id') = any(v_del) then continue; end if;
    u := null;
    select value into u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb))
      where value ->> 'id' = e ->> 'id' limit 1;
    if u is not null then
      v_out := v_out || jsonb_build_array(u);
      v_seen := v_seen || (e ->> 'id');
    else
      v_out := v_out || jsonb_build_array(e);
    end if;
  end loop;
  -- Novos vão para o fim.
  for u in select value from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    if not ((u ->> 'id') = any(v_seen)) then v_out := v_out || jsonb_build_array(u); end if;
  end loop;

  v_data := jsonb_set(v_data, '{list}', v_out, true);
  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path) do update set data = excluded.data;
  return v_data;
end $$;

grant execute on function public.patch_list(text, jsonb, jsonb) to authenticated;
revoke execute on function public.patch_list(text, jsonb, jsonb) from anon;


-- ===== 2026-10-04e-resumo-atendimentos-tratamentos.sql =====
-- =====================================================================
-- Agenda Pipo — resumo dos atendimentos para os Tratamentos (Etapa 7, 2026-10-04)
--
--   Término, sessões usadas e "Contratado × realizado" dos tratamentos
--   precisam dos atendimentos de cada paciente. Antes o sistema baixava
--   linha por linha toda a Agenda. Esta função devolve o resumo já agrupado
--   (paciente, data, profissional, serviço, status → quantidade), bem menor.
--   Roda com as permissões de quem chama (security invoker): o Profissional
--   continua vendo só os atendimentos dele.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatment_appt_summary(p_until date)
returns table(patient text, d date, prof text, svc text, st text, n int)
language sql stable security invoker set search_path = public as $$
  select a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), count(*)::int
  from public.appointments a
  where not a.blocked and a.date <= p_until and a.patient <> ''
  group by 1, 2, 3, 4, 5
  order by 2, 1, 3, 4, 5
$$;

grant execute on function public.treatment_appt_summary(date) to authenticated;
revoke execute on function public.treatment_appt_summary(date) from anon;


-- ===== 2026-10-05-cadastro-do-paciente.sql =====
-- =====================================================================
-- Agenda Pipo — cadastro completo do paciente, Médicos, Escolas e CBO (2026-10-05)
--
--   * Novos cadastros (documentos):
--       config/doctors        Cadastros → Médicos        (permissão "medicos")
--       config/schools        Cadastros → Escolas        (permissão "escolas")
--       config/cbo            Cadastros → CBO            (permissão "cbo")
--       config/patient_fields Pacientes → botão "Campos" (permissão "campos_paciente":
--                             quais campos do paciente aparecem e quais são obrigatórios)
--   * Níveis que já existem: Médicos e Escolas recebem o mesmo acesso que têm em
--     Pacientes; CBO o mesmo de Profissionais; "Campos do paciente" começa
--     desligado (o Administrador marca em Níveis de permissão; ele sempre pode).
--   * CBO já vem preenchido com as sugestões do sistema + todo CBO que já está
--     gravado no cadastro dos profissionais.
--   * Os campos novos do paciente (responsáveis, endereço, documentos, dados
--     clínicos, médico, escola…) ficam no próprio documento patients/all:
--     não precisam de mudança no banco.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar os caminhos novos.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes.
update public.roles set permissions = permissions
  || jsonb_build_object('medicos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'medicos');
update public.roles set permissions = permissions
  || jsonb_build_object('escolas', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'escolas');
update public.roles set permissions = permissions
  || jsonb_build_object('cbo', coalesce(permissions -> 'profissionais', '{}'::jsonb))
  where not is_admin and not (permissions ? 'cbo');
update public.roles set permissions = permissions
  || '{"campos_paciente": {"view": false, "edit": false}}'::jsonb
  where not is_admin and not (permissions ? 'campos_paciente');

-- 4. CBO: sugestões do sistema + os que já estão nos profissionais.
insert into public.documents (path, data) values ('config/cbo', '{"list": [
  {"id": "251510", "code": "2515-10", "name": "Psicólogo clínico"},
  {"id": "223810", "code": "2238-10", "name": "Fonoaudiólogo"},
  {"id": "223905", "code": "2239-05", "name": "Terapeuta ocupacional"},
  {"id": "223605", "code": "2236-05", "name": "Fisioterapeuta geral"},
  {"id": "223710", "code": "2237-10", "name": "Nutricionista"},
  {"id": "226305", "code": "2263-05", "name": "Musicoterapeuta"},
  {"id": "239425", "code": "2394-25", "name": "Psicopedagogo"}
]}'::jsonb)
on conflict (path) do nothing;

with usados as (
  select distinct on (regexp_replace(p ->> 'cbos', '\D', '', 'g'))
         regexp_replace(p ->> 'cbos', '\D', '', 'g') as id,
         trim(p ->> 'cbos') as code,
         coalesce(nullif(trim(s ->> 'name'), ''), 'Sem descrição') as name
  from public.documents d
  cross join jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  left join public.documents ds on ds.path = 'config/specialties'
  left join lateral (
    select x from jsonb_array_elements(coalesce(ds.data -> 'list', '[]'::jsonb)) x
    where x ->> 'id' = p ->> 'specialtyId' limit 1
  ) sp(s) on true
  where d.path = 'config/professionals'
    and regexp_replace(coalesce(p ->> 'cbos', ''), '\D', '', 'g') <> ''
),
faltam as (
  select u.* from usados u, public.documents c
  where c.path = 'config/cbo'
    and not exists (select 1 from jsonb_array_elements(coalesce(c.data -> 'list', '[]'::jsonb)) e
                    where regexp_replace(coalesce(e ->> 'code', ''), '\D', '', 'g') = u.id)
)
update public.documents c
set data = jsonb_set(c.data, '{list}', coalesce(c.data -> 'list', '[]'::jsonb) ||
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name)) from faltam), '[]'::jsonb))
where c.path = 'config/cbo';


-- ===== 2026-10-05b-conselhos.sql =====
-- =====================================================================
-- Agenda Pipo — cadastro de Conselhos profissionais (2026-10-05)
--
--   * Novo cadastro config/councils (Cadastros → Conselhos), permissão própria
--     "conselhos" em Níveis de permissão. Os níveis que já existem recebem o
--     mesmo acesso que têm em Profissionais.
--   * Já vem com CRP, CRFa, CREFITO, CRN, CRM, CREF, CRESS e ABPp + todo
--     conselho que já está gravado no cadastro dos profissionais.
--   * No cadastro do profissional o campo Conselho vira uma lista desse cadastro
--     (o valor gravado continua sendo a sigla).
--
-- PRECISA da migração 2026-10-05-cadastro-do-paciente.sql já rodada.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar o caminho config/councils.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm em Profissionais.
update public.roles set permissions = permissions
  || jsonb_build_object('conselhos', coalesce(permissions -> 'profissionais', '{}'::jsonb))
  where not is_admin and not (permissions ? 'conselhos');

-- 4. Conselhos iniciais + os que já estão nos profissionais.
insert into public.documents (path, data) values ('config/councils', '{"list": [
  {"id": "crp",     "sigla": "CRP",     "name": "Conselho Regional de Psicologia"},
  {"id": "crfa",    "sigla": "CRFa",    "name": "Conselho Regional de Fonoaudiologia"},
  {"id": "crefito", "sigla": "CREFITO", "name": "Conselho Regional de Fisioterapia e Terapia Ocupacional"},
  {"id": "crn",     "sigla": "CRN",     "name": "Conselho Regional de Nutricionistas"},
  {"id": "crm",     "sigla": "CRM",     "name": "Conselho Regional de Medicina"},
  {"id": "cref",    "sigla": "CREF",    "name": "Conselho Regional de Educação Física"},
  {"id": "cress",   "sigla": "CRESS",   "name": "Conselho Regional de Serviço Social"},
  {"id": "abpp",    "sigla": "ABPp",    "name": "Associação Brasileira de Psicopedagogia"}
]}'::jsonb)
on conflict (path) do nothing;

with usados as (
  select distinct on (lower(regexp_replace(p ->> 'conselho', '[^A-Za-z0-9]', '', 'g')))
         lower(regexp_replace(p ->> 'conselho', '[^A-Za-z0-9]', '', 'g')) as id,
         trim(p ->> 'conselho') as sigla
  from public.documents d
  cross join jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  where d.path = 'config/professionals'
    and regexp_replace(coalesce(p ->> 'conselho', ''), '[^A-Za-z0-9]', '', 'g') <> ''
),
faltam as (
  select u.* from usados u, public.documents c
  where c.path = 'config/councils'
    and not exists (select 1 from jsonb_array_elements(coalesce(c.data -> 'list', '[]'::jsonb)) e
                    where lower(regexp_replace(coalesce(e ->> 'sigla', ''), '[^A-Za-z0-9]', '', 'g')) = u.id)
)
update public.documents c
set data = jsonb_set(c.data, '{list}', coalesce(c.data -> 'list', '[]'::jsonb) ||
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'sigla', sigla, 'name', sigla)) from faltam), '[]'::jsonb))
where c.path = 'config/councils';



-- =====================================================================
-- Agenda Pipo — mesclar cadastros de pacientes e data de entrada (2026-10-05)
--
--   * Pacientes → Outras opções → "Mesclar cadastros" (só Administrador):
--     função merge_patient_records(...) passa os atendimentos da Agenda
--     (appointments.patient) e as evoluções do Prontuário (clinical_records)
--     do paciente que será excluído para o paciente que fica. O Planner, os
--     tratamentos e o cadastro dos pacientes são acertados pelo próprio app.
--   * clinical_records_stamp: o Prontuário não deixa trocar o paciente de uma
--     evolução; só a função de mesclar pode (marca "pipo.merging" na transação).
--   * Data de entrada: pacientes sem data de entrada recebem 01/01/2026 ou,
--     se o primeiro tratamento começou antes, a data de início dele (acerto
--     único; daqui em diante o cadastro novo já nasce com a data do dia).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Prontuário: só a mesclagem pode trocar o paciente de uma evolução.
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
    new.updated_at := now();
  elsif coalesce(current_setting('pipo.merging', true), '') = '1' then
    -- Mesclar cadastros: muda só o paciente; autor, conteúdo e datas ficam.
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    new.updated_at := old.updated_at;
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- 2. Mesclar: Agenda e Prontuário do paciente excluído passam para o que fica.
create or replace function public.merge_patient_records(
  p_drop_id text, p_drop_name text, p_keep_id text, p_keep_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
  n_rec int := 0;
begin
  if not public.is_admin() then
    raise exception 'Só o Administrador pode mesclar cadastros.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drop_id), '') = '' or coalesce(btrim(p_keep_id), '') = ''
     or coalesce(btrim(p_drop_name), '') = '' or coalesce(btrim(p_keep_name), '') = '' then
    raise exception 'Escolha os dois pacientes.';
  end if;
  if p_drop_id = p_keep_id then
    raise exception 'Escolha dois pacientes diferentes.';
  end if;
  perform set_config('pipo.merging', '1', true);
  update public.appointments set patient = p_keep_name
    where lower(btrim(patient)) = lower(btrim(p_drop_name));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_rec = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec);
end;
$$;
revoke all on function public.merge_patient_records(text, text, text, text) from public;
grant execute on function public.merge_patient_records(text, text, text, text) to authenticated;

-- 3. Data de entrada dos pacientes que estão em branco (acerto único).
with primeiro as (
  select t ->> 'patientId' as pid, min(t ->> 'inicio') as inicio
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
  where d.path = 'treatments/all' and coalesce(t ->> 'inicio', '') <> ''
  group by 1
)
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg(
    case when coalesce(p ->> 'entrada', '') = ''
      then p || jsonb_build_object('entrada', least('2026-01-01', coalesce((select inicio from primeiro where pid = p ->> 'id'), '2026-01-01')))
      else p end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, ord)
))
where d.path = 'patients/all';



-- =====================================================================
-- Agenda Pipo — Feriados e recessos (2026-10-05)
--
--   * Novo cadastro config/holidays (Cadastros → Feriados e recessos), com
--     permissão própria "feriados" em Níveis de permissão. Os níveis que já
--     existem recebem o mesmo acesso que têm na Agenda.
--   * Já vem com os feriados nacionais (Sexta-feira Santa e Corpus Christi são
--     calculados pela Páscoa a cada ano) e o Aniversário de Blumenau (2/9).
--   * Na Agenda os horários de feriado ficam cinza e marcar só pede
--     confirmação; o "Gerar mês" do Planner pula esses horários.
--
-- PRECISA das migrações 2026-10-05 e 2026-10-05b já rodadas.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar o caminho config/holidays.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm na Agenda.
update public.roles set permissions = permissions
  || jsonb_build_object('feriados', coalesce(permissions -> 'agendamentos', '{}'::jsonb))
  where not is_admin and not (permissions ? 'feriados');

-- 4. Feriados iniciais.
insert into public.documents (path, data) values ('config/holidays', '{"list": [
  {"id": "confraternizacao", "name": "Confraternização Universal", "tipo": "nacional", "inicio": "2026-01-01", "fim": "2026-01-01", "periodo": "dia", "anual": true},
  {"id": "sexta-santa", "name": "Sexta-feira Santa", "tipo": "nacional", "periodo": "dia", "movel": "sexta-santa"},
  {"id": "tiradentes", "name": "Tiradentes", "tipo": "nacional", "inicio": "2026-04-21", "fim": "2026-04-21", "periodo": "dia", "anual": true},
  {"id": "trabalho", "name": "Dia do Trabalho", "tipo": "nacional", "inicio": "2026-05-01", "fim": "2026-05-01", "periodo": "dia", "anual": true},
  {"id": "corpus-christi", "name": "Corpus Christi", "tipo": "nacional", "periodo": "dia", "movel": "corpus-christi"},
  {"id": "blumenau", "name": "Aniversário de Blumenau", "tipo": "municipal", "inicio": "2026-09-02", "fim": "2026-09-02", "periodo": "dia", "anual": true},
  {"id": "independencia", "name": "Independência do Brasil", "tipo": "nacional", "inicio": "2026-09-07", "fim": "2026-09-07", "periodo": "dia", "anual": true},
  {"id": "aparecida", "name": "Nossa Senhora Aparecida", "tipo": "nacional", "inicio": "2026-10-12", "fim": "2026-10-12", "periodo": "dia", "anual": true},
  {"id": "finados", "name": "Finados", "tipo": "nacional", "inicio": "2026-11-02", "fim": "2026-11-02", "periodo": "dia", "anual": true},
  {"id": "republica", "name": "Proclamação da República", "tipo": "nacional", "inicio": "2026-11-15", "fim": "2026-11-15", "periodo": "dia", "anual": true},
  {"id": "consciencia-negra", "name": "Dia da Consciência Negra", "tipo": "nacional", "inicio": "2026-11-20", "fim": "2026-11-20", "periodo": "dia", "anual": true},
  {"id": "natal", "name": "Natal", "tipo": "nacional", "inicio": "2026-12-25", "fim": "2026-12-25", "periodo": "dia", "anual": true}
]}'::jsonb)
on conflict (path) do nothing;



-- =====================================================================
-- Agenda Pipo — RH: Funcionários e Prestadores (2026-10-05)
--
--   * Tabela protegida public.staff: dados de RH de cada funcionário ou
--     prestador (identificação, tipos, contato, contrato, horário de trabalho,
--     contato de emergência). Só lê/grava quem tem a permissão
--     "RH – Funcionários e Prestadores" (rh_funcionarios).
--   * Tabela protegida public.staff_pay: valor mensal contratado e formas de
--     pagamento (com dados bancários / PIX). Só quem tem
--     "RH – Remuneração" (rh_remuneracao).
--   * config/staff_types: tipos (Profissional, Coordenação, Administrativo…).
--   * profiles.staff_id: usuário ligado a um funcionário que não é profissional
--     (o profissional continua ligado por profiles.professional_id).
--   * Nível novo "Recursos Humanos"; Financeiro e Recursos Humanos recebem as
--     duas permissões de RH (o Administrador sempre tem tudo).
--   * Cada profissional que já existe vira um funcionário do tipo Profissional.
--     O horário de atendimento continua em config/professionals (a Agenda e o
--     Planner leem de lá); para profissionais ele é o próprio horário de trabalho.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabelas protegidas.
create table if not exists public.staff (
  id               text primary key,
  professional_id  text unique,
  data             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);
create table if not exists public.staff_pay (
  staff_id    text primary key references public.staff(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.staff enable row level security;
alter table public.staff_pay enable row level security;
grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.staff_pay to authenticated;

create or replace function public.staff_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists staff_stamp on public.staff;
create trigger staff_stamp before insert or update on public.staff
  for each row execute function public.staff_stamp();
drop trigger if exists staff_pay_stamp on public.staff_pay;
create trigger staff_pay_stamp before insert or update on public.staff_pay
  for each row execute function public.staff_stamp();

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated using (public.has_perm('rh_funcionarios', 'view'));
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated with check (public.has_perm('rh_funcionarios', 'create'));
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated
  using (public.has_perm('rh_funcionarios', 'edit')) with check (public.has_perm('rh_funcionarios', 'edit'));
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated using (public.has_perm('rh_funcionarios', 'delete'));

drop policy if exists staff_pay_select on public.staff_pay;
create policy staff_pay_select on public.staff_pay for select to authenticated using (public.has_perm('rh_remuneracao', 'view'));
drop policy if exists staff_pay_insert on public.staff_pay;
create policy staff_pay_insert on public.staff_pay for insert to authenticated with check (public.has_perm('rh_remuneracao', 'edit'));
drop policy if exists staff_pay_update on public.staff_pay;
create policy staff_pay_update on public.staff_pay for update to authenticated
  using (public.has_perm('rh_remuneracao', 'edit')) with check (public.has_perm('rh_remuneracao', 'edit'));
drop policy if exists staff_pay_delete on public.staff_pay;
create policy staff_pay_delete on public.staff_pay for delete to authenticated
  using (public.has_perm('rh_remuneracao', 'edit') or public.has_perm('rh_funcionarios', 'delete'));

-- 2. Usuário ligado a um funcionário (não profissional).
alter table public.profiles add column if not exists staff_id text;
create unique index if not exists profiles_staff_id_unique on public.profiles (staff_id) where staff_id is not null;

-- 3. Tipos de funcionário (documento config/staff_types).
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;
insert into public.documents (path, data) values ('config/staff_types', '{"list": [
  {"id": "profissional", "name": "Profissional"},
  {"id": "coordenacao", "name": "Coordenação"},
  {"id": "administrativo", "name": "Administrativo"},
  {"id": "recepcao", "name": "Recepção"},
  {"id": "financeiro", "name": "Financeiro"},
  {"id": "contabil", "name": "Contábil"},
  {"id": "juridico", "name": "Jurídico"},
  {"id": "servicos-gerais", "name": "Serviços gerais"},
  {"id": "ti", "name": "TI"},
  {"id": "marketing", "name": "Marketing"}
]}'::jsonb)
on conflict (path) do nothing;

-- 4. Permissões: nível novo "Recursos Humanos" + Financeiro com acesso ao RH.
insert into public.roles (id, name, is_admin, sort, permissions)
select 'recursos-humanos', 'Recursos Humanos', false, 0, '{
  "rh_funcionarios": {"view": true, "create": true, "edit": true, "delete": true},
  "rh_remuneracao":  {"view": true, "edit": true},
  "ajuda": {"view": true}, "senha": {"view": true}
}'::jsonb
where not exists (select 1 from public.roles where id = 'recursos-humanos' or lower(btrim(name)) = 'recursos humanos');

update public.roles set permissions = permissions || '{
  "rh_funcionarios": {"view": true, "create": true, "edit": true, "delete": true},
  "rh_remuneracao":  {"view": true, "edit": true}
}'::jsonb
where (id in ('financeiro', 'recursos-humanos') or lower(btrim(name)) in ('financeiro', 'recursos humanos'))
  and not is_admin and not (permissions ? 'rh_funcionarios');

update public.roles set permissions = permissions || '{
  "rh_funcionarios": {"view": false, "create": false, "edit": false, "delete": false},
  "rh_remuneracao":  {"view": false, "edit": false}
}'::jsonb
where not is_admin and not (permissions ? 'rh_funcionarios');

-- 5. Cada profissional vira funcionário do tipo Profissional.
insert into public.staff (id, professional_id, data)
select 'prof-' || (p ->> 'id'), p ->> 'id', jsonb_strip_nulls(jsonb_build_object(
  'nome', p ->> 'name', 'nomeSocial', p ->> 'nomeSocial', 'cpf', p ->> 'cpf',
  'tipos', '["profissional"]'::jsonb, 'inativo', (p -> 'inativo')))
from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
where d.path = 'config/professionals' and coalesce(p ->> 'id', '') <> ''
on conflict do nothing;
-- usuários dos profissionais também ficam ligados ao funcionário
update public.profiles pr set staff_id = 'prof-' || pr.professional_id
where pr.professional_id is not null and pr.staff_id is null
  and exists (select 1 from public.staff s where s.id = 'prof-' || pr.professional_id);


-- =====================================================================
-- Agenda Pipo — Profissionais dentro de Funcionários e Prestadores (2026-10-05)
--
--   * O cadastro dos profissionais (config/professionals) passa a seguir a
--     permissão "Funcionários e Prestadores" (rh_funcionarios), com as mesmas
--     regras de antes: ver / incluir / editar / excluir (em uso = inativar).
--     O item "Profissionais" saiu dos Níveis de permissão e do menu Cadastros.
--   * Ninguém perde acesso: cada nível recebe em "Funcionários e Prestadores"
--     tudo o que já tinha em "Profissionais" (somado ao que já tinha no RH).
--
-- PRECISA da migração 2026-10-05e-rh-funcionarios.sql antes.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Quem grava config/professionals: permissão rh_funcionarios.
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = funcionário (RH)
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 2. Copia o acesso de "Profissionais" para "Funcionários e Prestadores".
update public.roles r set permissions = r.permissions || jsonb_build_object('rh_funcionarios', jsonb_build_object(
  'view',   coalesce((r.permissions #>> '{rh_funcionarios,view}')::boolean, false)   or coalesce((r.permissions #>> '{profissionais,view}')::boolean, false),
  'create', coalesce((r.permissions #>> '{rh_funcionarios,create}')::boolean, false) or coalesce((r.permissions #>> '{profissionais,create}')::boolean, false),
  'edit',   coalesce((r.permissions #>> '{rh_funcionarios,edit}')::boolean, false)   or coalesce((r.permissions #>> '{profissionais,edit}')::boolean, false),
  'delete', coalesce((r.permissions #>> '{rh_funcionarios,delete}')::boolean, false) or coalesce((r.permissions #>> '{profissionais,delete}')::boolean, false)))
where not r.is_admin;

-- conferência: acesso de cada nível em Funcionários e Prestadores
select name as nivel, permissions -> 'rh_funcionarios' as funcionarios_e_prestadores
from public.roles order by sort;

-- =====================================================================
-- Agenda Pipo — Cadastro de funcionário para os usuários ativos (2026-10-05)
--
--   Cada usuário ATIVO que ainda não tem cadastro em RH → Funcionários e
--   Prestadores (nem como profissional) ganha um, com nome e e-mail do usuário,
--   e fica ligado a ele (profiles.staff_id). Tipo inicial pelo nível:
--   Financeiro → Financeiro, Secretária → Recepção, os demais → Administrativo
--   (ajuste depois na janela do funcionário).
--
-- PRECISA da migração 2026-10-05e-rh-funcionarios.sql antes.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

insert into public.staff (id, professional_id, data)
select 'user-' || p.id::text, null, jsonb_build_object(
  'nome', coalesce(nullif(btrim(p.full_name), ''), p.email),
  'email', p.email,
  'tipos', jsonb_build_array(case
    when p.role_id = 'financeiro' then 'financeiro'
    when p.role_id = 'secretaria' then 'recepcao'
    else 'administrativo' end))
from public.profiles p
where p.active and p.staff_id is null
  and (p.professional_id is null
       or not exists (select 1 from public.staff s where s.professional_id = p.professional_id))
on conflict (id) do nothing;

update public.profiles p set staff_id = 'user-' || p.id::text
where p.staff_id is null
  and exists (select 1 from public.staff s where s.id = 'user-' || p.id::text);

-- conferência: usuários ativos e o cadastro de funcionário de cada um
select p.full_name as usuario, p.email, r.name as nivel,
       coalesce(s.data ->> 'nome', '— sem cadastro —') as funcionario
from public.profiles p
left join public.roles r on r.id = p.role_id
left join public.staff s on s.id = p.staff_id or (p.staff_id is null and s.professional_id = p.professional_id)
where p.active
order by p.full_name;

-- =====================================================================
-- Agenda Pipo — tratamento cancelado pode voltar a outro status (2026-10-05)
--
--   Pedido do usuário: tira a regra "tratamento Cancelado não pode mudar de
--   status". Continua valendo: passar a Cancelado (ou nascer Cancelado) exige
--   o motivo do cancelamento. A regra "só um Ativo por paciente" (trigger
--   treatments_one_active) não muda.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo.
  select n ->> 'id' into v_bad
  from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
  where n ->> 'status' = 'cancelado'
    and coalesce(n ->> 'motivoCancel', '') = ''
    and (tg_op = 'INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
      where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
  limit 1;
  if v_bad is not null then
    raise exception 'Informe o motivo do cancelamento do tratamento.';
  end if;
  return new;
end;
$$;

-- =====================================================================
-- Agenda Pipo — volta a regra "tratamento Cancelado é definitivo" (2026-10-05)
--
--   Desfaz a migração 2026-10-05h-cancelado-pode-voltar.sql: o banco volta a
--   recusar que um tratamento Cancelado mude de status, e cancelar continua
--   exigindo o motivo. Só precisa rodar se a 2026-10-05h foi rodada (rodar de
--   novo não estraga nada).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- =====================================================================

create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status.
  if tg_op = 'UPDATE' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo.
  select n ->> 'id' into v_bad
  from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
  where n ->> 'status' = 'cancelado'
    and coalesce(n ->> 'motivoCancel', '') = ''
    and (tg_op = 'INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
      where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
  limit 1;
  if v_bad is not null then
    raise exception 'Informe o motivo do cancelamento do tratamento.';
  end if;
  return new;
end;
$$;

-- =====================================================================
-- Agenda Pipo — Plano terapêutico (2026-10-06)
--
--   * Tabela protegida public.therapy_plans: um plano por paciente, com
--     versões (Revisar cria a nova versão; a anterior fica "encerrado").
--     Resumo do quadro clínico (texto) + quadros por especialidade
--     (sections = [{specId, objectives:[{id, areaId, objetivo, criterio,
--     prazo, scaleId, levelId, status, statusEm, criadoEm}]}]).
--     Dado de saúde: só lê quem tem "Plano terapêutico – ver".
--   * Quem tem "editar" (Coordenador, Administrador) muda tudo. O
--     profissional (usuário ligado a um profissional, sem "editar") usa a
--     função plan_prof_update: só muda situação e status dos objetivos das
--     especialidades em que atende (principal ou complementares) e só
--     inclui objetivos novos na especialidade principal.
--   * Cadastros comuns: Escalas (config/scales, com os níveis e as cores)
--     e Habilidades/áreas (config/skill_areas), já com os valores iniciais.
--   * Permissões novas: plano_terapeutico, escalas, habilidades.
--   * Nível novo "Coordenador": as permissões do Profissional + o plano
--     terapêutico completo.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabela dos planos.
create table if not exists public.therapy_plans (
  id               uuid primary key default gen_random_uuid(),
  patient_id       text not null,
  patient_name     text not null default '',
  version          int  not null default 1,
  status           text not null default 'vigente' check (status in ('vigente', 'encerrado')),
  plan_date        date not null default current_date,
  review_date      date,
  summary          text not null default '',
  sections         jsonb not null default '[]'::jsonb,
  prev_id          uuid references public.therapy_plans(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_by_name  text not null default '',
  updated_at       timestamptz not null default now()
);
create index if not exists therapy_plans_patient on public.therapy_plans (patient_id);
-- um só plano vigente por paciente
create unique index if not exists therapy_plans_one_vigente on public.therapy_plans (patient_id) where status = 'vigente';
alter table public.therapy_plans enable row level security;
grant select, insert, update, delete on public.therapy_plans to authenticated;

create or replace function public.therapy_plans_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then          -- restauração / scripts: mantém o que veio
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), email, '') into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce(v_name, '');
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(v_name, '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists therapy_plans_stamp on public.therapy_plans;
create trigger therapy_plans_stamp before insert or update on public.therapy_plans
  for each row execute function public.therapy_plans_stamp();

drop policy if exists therapy_plans_select on public.therapy_plans;
create policy therapy_plans_select on public.therapy_plans for select to authenticated
  using (public.has_perm('plano_terapeutico', 'view'));
drop policy if exists therapy_plans_insert on public.therapy_plans;
create policy therapy_plans_insert on public.therapy_plans for insert to authenticated
  with check (public.has_perm('plano_terapeutico', 'create'));
drop policy if exists therapy_plans_update on public.therapy_plans;
-- "editar" muda tudo; "incluir" pode encerrar o plano anterior ao revisar
create policy therapy_plans_update on public.therapy_plans for update to authenticated
  using (public.has_perm('plano_terapeutico', 'edit') or public.has_perm('plano_terapeutico', 'create'))
  with check (public.has_perm('plano_terapeutico', 'edit') or public.has_perm('plano_terapeutico', 'create'));
drop policy if exists therapy_plans_delete on public.therapy_plans;
create policy therapy_plans_delete on public.therapy_plans for delete to authenticated
  using (public.has_perm('plano_terapeutico', 'delete'));

-- 2. Alteração feita pelo profissional (sem "editar").
create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  s jsonb; os jsonb; o jsonb; oo jsonb; v_spec text;
begin
  select p.professional_id into v_prof from public.profiles p where p.id = auth.uid() and p.active;
  if v_prof is null or not public.has_perm('plano_terapeutico', 'view') then
    raise exception 'Sem permissão para alterar o plano terapêutico.';
  end if;
  select x ->> 'specialtyId',
         coalesce(array(select jsonb_array_elements_text(coalesce(x -> 'complementares', '[]'::jsonb))), '{}')
    into v_principal, v_allowed
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/professionals' and x ->> 'id' = v_prof;
  v_allowed := coalesce(v_allowed, '{}') || coalesce(v_principal, '');
  select sections into v_old from public.therapy_plans where id = p_id and status = 'vigente' for update;
  if not found then raise exception 'Plano não encontrado ou já encerrado.'; end if;
  if jsonb_typeof(p_sections) <> 'array' then raise exception 'Dados inválidos.'; end if;

  -- o que já existia: só situação/status mudam, e só nas especialidades dele
  for os in select * from jsonb_array_elements(v_old) loop
    v_spec := os ->> 'specId';
    s := (select x from jsonb_array_elements(p_sections) x where x ->> 'specId' = v_spec limit 1);
    if s is null then raise exception 'Quadros do plano não podem ser excluídos.'; end if;
    if not (v_spec = any(v_allowed)) then
      if s <> os then raise exception 'Você só pode alterar as especialidades em que atende.'; end if;
      continue;
    end if;
    for oo in select * from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) loop
      o := (select x from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = oo ->> 'id' limit 1);
      if o is null then raise exception 'Objetivos não podem ser excluídos.'; end if;
      if (o - 'levelId' - 'status' - 'statusEm') <> (oo - 'levelId' - 'status' - 'statusEm') then
        raise exception 'Você só pode alterar a situação e o status dos objetivos.';
      end if;
    end loop;
  end loop;

  -- objetivos novos: só na especialidade principal
  for s in select * from jsonb_array_elements(p_sections) loop
    v_spec := s ->> 'specId';
    os := (select x from jsonb_array_elements(v_old) x where x ->> 'specId' = v_spec limit 1);
    for o in select * from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) loop
      if os is null or not exists (select 1 from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
        if v_spec is distinct from v_principal then
          raise exception 'Você só pode incluir objetivos na sua especialidade principal.';
        end if;
      end if;
    end loop;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;

-- 3. Cadastros comuns: Escalas e Habilidades/áreas.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
  end;
$$;

insert into public.documents (path, data) values ('config/scales', '{"list": [
  {"id": "likert", "name": "Likert", "levels": [
    {"id": "0", "name": "0 – Não realiza", "color": "#E05A4F"},
    {"id": "1", "name": "1 – Realiza com ajuda física", "color": "#EE8A3C"},
    {"id": "2", "name": "2 – Realiza com ajuda visual", "color": "#F2B53A"},
    {"id": "3", "name": "3 – Realiza com ajuda verbal", "color": "#D7C93B"},
    {"id": "4", "name": "4 – Independente parcial (supervisão)", "color": "#8CC152"},
    {"id": "5", "name": "5 – Independente", "color": "#2E9E5B"}]},
  {"id": "aba", "name": "ABA", "levels": [
    {"id": "nao-adquirida", "name": "Não adquirida (< 60%)", "color": "#E05A4F"},
    {"id": "parcial", "name": "Parcial (60%–70%)", "color": "#F2B53A"},
    {"id": "adquirida", "name": "Adquirida (> 70%)", "color": "#2E9E5B"}]}
]}'::jsonb)
on conflict (path) do nothing;

insert into public.documents (path, data) values ('config/skill_areas', '{"list": [
  {"id": "comunicacao", "name": "Comunicação"},
  {"id": "socializacao", "name": "Socialização"},
  {"id": "autonomia", "name": "Autonomia"},
  {"id": "aprendizagem", "name": "Aprendizagem"},
  {"id": "regulacao-emocional", "name": "Regulação Emocional"},
  {"id": "regulacao-sensorial", "name": "Regulação Sensorial"},
  {"id": "desenvolvimento-motor", "name": "Desenvolvimento Motor"},
  {"id": "seletividade-alimentar", "name": "Seletividade Alimentar"}
]}'::jsonb)
on conflict (path) do nothing;

-- 4. Permissões dos níveis existentes (não mexe em quem já tem os itens).
--    Plano terapêutico: Profissional vê; os outros começam sem acesso.
--    Escalas e Habilidades: copiam o acesso de Especialidades.
update public.roles set permissions = permissions || jsonb_build_object('plano_terapeutico',
  case when id = 'profissional' or lower(btrim(name)) = 'profissional'
       then '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
       else '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb end)
where not is_admin and not (permissions ? 'plano_terapeutico');

update public.roles set permissions = permissions
  || jsonb_build_object('escalas', coalesce(permissions -> 'especialidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
  || jsonb_build_object('habilidades', coalesce(permissions -> 'especialidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
where not is_admin and not (permissions ? 'escalas');

-- 5. Nível "Coordenador": cópia do Profissional + plano terapêutico completo
--    (inclusive Escalas e Habilidades).
insert into public.roles (id, name, is_admin, sort, permissions)
select 'coordenador', 'Coordenador', false, coalesce(r.sort, 0),
  r.permissions || '{
    "plano_terapeutico": {"view": true, "create": true, "edit": true, "delete": true},
    "escalas":     {"view": true, "create": true, "edit": true, "delete": true},
    "habilidades": {"view": true, "create": true, "edit": true, "delete": true}
  }'::jsonb
from public.roles r
where r.id = 'profissional'
  and not exists (select 1 from public.roles where id = 'coordenador' or lower(btrim(name)) = 'coordenador');

-- conferência
select name as nivel, permissions -> 'plano_terapeutico' as plano_terapeutico from public.roles order by sort, name;

-- 2026-10-06b — Plano terapêutico: Banco de objetivos.
--   * Documento config/goal_bank {list:[{id, name (texto do objetivo), areaId,
--     criterio, scaleId, specId}]} — objetivos prontos para usar no plano.
--   * Permissão nova "objetivos" (Banco de objetivos): copia o acesso de
--     Habilidades/áreas; o nível Coordenador recebe tudo.
-- Precisa da 2026-10-06-plano-terapeutico.sql antes. Pode rodar mais de uma vez.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
  end;
$$;

insert into public.documents (path, data) values ('config/goal_bank', '{"list": []}'::jsonb)
on conflict (path) do nothing;

update public.roles set permissions = permissions
  || jsonb_build_object('objetivos', coalesce(permissions -> 'habilidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
where not is_admin and not (permissions ? 'objetivos');

update public.roles set permissions = permissions
  || '{"objetivos": {"view": true, "create": true, "edit": true, "delete": true}}'::jsonb
where id = 'coordenador';


-- 2026-10-06c — Plano terapêutico, Parte 2: objetivos trabalhados na evolução.
--   * clinical_records.plan_goals = [{planId, specId, objId, scaleId, levelId}]:
--     objetivos do plano vigente marcados na evolução, com o nível alcançado.
--   * Trigger clinical_records_plan_goals: ao salvar a evolução, a Situação do
--     objetivo no plano vigente passa a ser o nível registrado (levelId) — se a
--     data da evolução não for anterior à do último nível registrado (levelEm).
--     Último nível da escala = status "atingido"; voltar dele = "ativo".
--     Roda como dono da tabela: vale para quem escreve a evolução, mesmo sem
--     permissão de editar o plano.
--   * plan_prof_update aceita também a troca de levelEm (data da Situação).
-- Precisa da 2026-10-06-plano-terapeutico.sql antes. Pode rodar mais de uma vez.

alter table public.clinical_records add column if not exists plan_goals jsonb not null default '[]'::jsonb;

create or replace function public.clinical_records_plan_goals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_date text; v_sections jsonb; v_final text; v_plan uuid;
begin
  if jsonb_typeof(new.plan_goals) <> 'array' or jsonb_array_length(new.plan_goals) = 0 then return new; end if;
  v_date := coalesce(new.appointment_date, (new.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(new.plan_goals) loop
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = new.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      case when s ->> 'specId' = g ->> 'specId' then jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
                    and (o ->> 'levelEm' is null or o ->> 'levelEm' <= v_date) then
            o || jsonb_build_object('levelId', g ->> 'levelId', 'levelEm', v_date)
              || case when g ->> 'levelId' = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                        then jsonb_build_object('status', 'atingido', 'statusEm', v_date)
                      when g ->> 'levelId' is distinct from v_final and o ->> 'status' = 'atingido'
                        then jsonb_build_object('status', 'ativo', 'statusEm', v_date)
                      else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      else s end order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return new;
end $$;

drop trigger if exists clinical_records_plan_goals_ins on public.clinical_records;
create trigger clinical_records_plan_goals_ins after insert on public.clinical_records
  for each row execute function public.clinical_records_plan_goals();
drop trigger if exists clinical_records_plan_goals_upd on public.clinical_records;
create trigger clinical_records_plan_goals_upd after update of plan_goals on public.clinical_records
  for each row when (new.plan_goals is distinct from old.plan_goals)
  execute function public.clinical_records_plan_goals();

create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  s jsonb; os jsonb; o jsonb; oo jsonb; v_spec text;
begin
  select p.professional_id into v_prof from public.profiles p where p.id = auth.uid() and p.active;
  if v_prof is null or not public.has_perm('plano_terapeutico', 'view') then
    raise exception 'Sem permissão para alterar o plano terapêutico.';
  end if;
  select x ->> 'specialtyId',
         coalesce(array(select jsonb_array_elements_text(coalesce(x -> 'complementares', '[]'::jsonb))), '{}')
    into v_principal, v_allowed
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/professionals' and x ->> 'id' = v_prof;
  v_allowed := coalesce(v_allowed, '{}') || coalesce(v_principal, '');
  select sections into v_old from public.therapy_plans where id = p_id and status = 'vigente' for update;
  if not found then raise exception 'Plano não encontrado ou já encerrado.'; end if;
  if jsonb_typeof(p_sections) <> 'array' then raise exception 'Dados inválidos.'; end if;

  -- o que já existia: só situação/status mudam, e só nas especialidades dele
  for os in select * from jsonb_array_elements(v_old) loop
    v_spec := os ->> 'specId';
    s := (select x from jsonb_array_elements(p_sections) x where x ->> 'specId' = v_spec limit 1);
    if s is null then raise exception 'Quadros do plano não podem ser excluídos.'; end if;
    if not (v_spec = any(v_allowed)) then
      if s <> os then raise exception 'Você só pode alterar as especialidades em que atende.'; end if;
      continue;
    end if;
    for oo in select * from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) loop
      o := (select x from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = oo ->> 'id' limit 1);
      if o is null then raise exception 'Objetivos não podem ser excluídos.'; end if;
      if (o - 'levelId' - 'levelEm' - 'status' - 'statusEm') <> (oo - 'levelId' - 'levelEm' - 'status' - 'statusEm') then
        raise exception 'Você só pode alterar a situação e o status dos objetivos.';
      end if;
    end loop;
  end loop;

  -- objetivos novos: só na especialidade principal
  for s in select * from jsonb_array_elements(p_sections) loop
    v_spec := s ->> 'specId';
    os := (select x from jsonb_array_elements(v_old) x where x ->> 'specId' = v_spec limit 1);
    for o in select * from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) loop
      if os is null or not exists (select 1 from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
        if v_spec is distinct from v_principal then
          raise exception 'Você só pode incluir objetivos na sua especialidade principal.';
        end if;
      end if;
    end loop;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;

-- 2026-10-06d — Atendimento finalizado: o terapeuta não altera o status.
--   Usuário ligado a um profissional (profiles.professional_id), que não seja
--   Administrador, não troca o status de um atendimento "finalizado" na Agenda;
--   a evolução continua editável no Prontuário. Os demais níveis seguem as
--   regras de antes. Substitui appointments_status_guard (2026-10-02i).
-- Pode rodar mais de uma vez.

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
    if old.status = 'finalizado' and not public.is_admin()
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id is not null) then
      raise exception 'Atendimento finalizado: o terapeuta não altera o status. A evolução é editada no Prontuário.' using errcode = '42501';
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

-- 2026-10-06e: todos os tratamentos existentes com "Sem vencimento"
-- Os campos duracaoMeses, validoAte e totalSessoes ficam guardados (só não valem).
update public.documents
   set data = jsonb_set(data, '{list}', (
         select coalesce(jsonb_agg(x || '{"vencPor":"sem"}'::jsonb order by ord), '[]'::jsonb)
           from jsonb_array_elements(coalesce(data->'list', '[]'::jsonb)) with ordinality t(x, ord)))
 where path = 'treatments/all';

-- 2026-10-06f: dados de saúde do paciente protegidos por nível
-- 1. Tabela (um registro por paciente).
create table if not exists public.patient_health (
  patient_id  text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.patient_health enable row level security;
grant select, insert, update, delete on public.patient_health to authenticated;

create or replace function public.patient_health_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists patient_health_stamp on public.patient_health;
create trigger patient_health_stamp
  before insert or update on public.patient_health
  for each row execute function public.patient_health_stamp();

-- 2. Quem vê / grava (o Administrador sempre; os outros pela permissão do nível).
drop policy if exists patient_health_select on public.patient_health;
create policy patient_health_select on public.patient_health
  for select to authenticated using (public.has_perm('saude_paciente', 'view'));
drop policy if exists patient_health_insert on public.patient_health;
create policy patient_health_insert on public.patient_health
  for insert to authenticated with check (public.has_perm('saude_paciente', 'edit'));
drop policy if exists patient_health_update on public.patient_health;
create policy patient_health_update on public.patient_health
  for update to authenticated
  using (public.has_perm('saude_paciente', 'edit'))
  with check (public.has_perm('saude_paciente', 'edit'));
drop policy if exists patient_health_delete on public.patient_health;
create policy patient_health_delete on public.patient_health
  for delete to authenticated
  using (public.has_perm('saude_paciente', 'edit') or public.has_perm('pacientes', 'delete'));

-- 3. Copia a saúde que está no cadastro para a tabela (o que já está na tabela vale mais).
insert into public.patient_health (patient_id, data)
select e ->> 'id',
       jsonb_strip_nulls(jsonb_build_object(
         'medicoId', e -> 'medicoId', 'cid', e -> 'cid', 'diagData', e -> 'diagData',
         'suporte', e -> 'suporte', 'comunicacao', e -> 'comunicacao', 'alergias', e -> 'alergias',
         'medicacoes', e -> 'medicacoes', 'restricoes', e -> 'restricoes'))
from public.documents d, jsonb_array_elements(d.data -> 'list') e
where d.path = 'patients/all' and coalesce(e ->> 'id', '') <> ''
  and (e ?| array['medicoId','cid','diagData','suporte','comunicacao','alergias','medicacoes','restricoes'])
on conflict (patient_id) do update set data = excluded.data || public.patient_health.data;

-- 4. Tira esses campos do cadastro (que todos leem), mantendo a ordem.
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg((x.e - 'medicoId' - 'cid' - 'diagData' - 'suporte' - 'comunicacao'
                                 - 'alergias' - 'medicacoes' - 'restricoes') order by x.i), '[]'::jsonb)
  from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, i)
))
where d.path = 'patients/all';

-- 5. Níveis existentes: o mesmo acesso que têm em Pacientes (ver / editar).
update public.roles set permissions = permissions || jsonb_build_object('saude_paciente', jsonb_build_object(
    'view', coalesce((permissions -> 'pacientes' ->> 'view')::boolean, false),
    'edit', coalesce((permissions -> 'pacientes' ->> 'edit')::boolean, false)))
  where not is_admin and not (permissions ? 'saude_paciente');


-- =====================================================================
-- 2026-10-06g — Plano terapêutico por Habilidade (funções; a exclusão dos planos
-- antigos fica só na migração supabase/2026-10-06g-plano-por-habilidade.sql)
-- =====================================================================
-- 2. Evolução atualiza a Situação do objetivo (em qualquer quadro), pela data mais recente.
create or replace function public.clinical_records_plan_goals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_date text; v_sections jsonb; v_final text; v_plan uuid;
begin
  if jsonb_typeof(new.plan_goals) <> 'array' or jsonb_array_length(new.plan_goals) = 0 then return new; end if;
  v_date := coalesce(new.appointment_date, (new.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(new.plan_goals) loop
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = new.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
                    and (o ->> 'levelEm' is null or o ->> 'levelEm' <= v_date) then
            o || jsonb_build_object('levelId', g ->> 'levelId', 'levelEm', v_date)
              || case when g ->> 'levelId' = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                        then jsonb_build_object('status', 'atingido', 'statusEm', v_date)
                      when g ->> 'levelId' is distinct from v_final and o ->> 'status' = 'atingido'
                        then jsonb_build_object('status', 'ativo', 'statusEm', v_date)
                      else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return new;
end $$;

-- 3. Gravação pelo profissional (sem "editar" no Plano terapêutico).
create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  oo jsonb; o jsonb; v_old_area text; v_new_area text; v_old_specs text[]; v_new_specs text[];
begin
  select p.professional_id into v_prof from public.profiles p where p.id = auth.uid() and p.active;
  if v_prof is null or not public.has_perm('plano_terapeutico', 'view') then
    raise exception 'Sem permissão para alterar o plano terapêutico.';
  end if;
  select x ->> 'specialtyId',
         coalesce(array(select jsonb_array_elements_text(coalesce(x -> 'complementares', '[]'::jsonb))), '{}')
    into v_principal, v_allowed
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/professionals' and x ->> 'id' = v_prof;
  v_allowed := coalesce(v_allowed, '{}') || coalesce(v_principal, '');
  select sections into v_old from public.therapy_plans where id = p_id and status = 'vigente' for update;
  if not found then raise exception 'Plano não encontrado ou já encerrado.'; end if;
  if jsonb_typeof(p_sections) <> 'array' then raise exception 'Dados inválidos.'; end if;

  -- objetivos que já existiam
  for v_old_area, oo in
    select s ->> 'areaId', x from jsonb_array_elements(v_old) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
  loop
    o := null; v_new_area := null;
    select s ->> 'areaId', x into v_new_area, o
      from jsonb_array_elements(p_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
      where x ->> 'id' = oo ->> 'id' limit 1;
    if o is null then raise exception 'Objetivos já gravados não podem ser excluídos.'; end if;
    v_old_specs := array(select jsonb_array_elements_text(coalesce(oo -> 'specIds', '[]'::jsonb)));
    v_new_specs := array(select jsonb_array_elements_text(coalesce(o -> 'specIds', '[]'::jsonb)));
    if v_principal is not null and v_principal = any(v_old_specs) then
      if not (v_principal = any(v_new_specs)) then
        raise exception 'A sua especialidade principal não pode sair do objetivo.';
      end if;
    elsif v_old_specs && v_allowed then
      if v_new_area is distinct from v_old_area
         or (o - 'levelId' - 'levelEm' - 'status' - 'statusEm') <> (oo - 'levelId' - 'levelEm' - 'status' - 'statusEm') then
        raise exception 'Neste objetivo você só pode alterar a situação e o status.';
      end if;
    elsif v_new_area is distinct from v_old_area or o <> oo then
      raise exception 'Você não pode alterar objetivos de especialidades em que não atende.';
    end if;
  end loop;

  -- objetivos novos: precisam ter a especialidade principal do profissional
  for o in
    select x from jsonb_array_elements(p_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
  loop
    if not exists (select 1 from jsonb_array_elements(v_old) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
      v_new_specs := array(select jsonb_array_elements_text(coalesce(o -> 'specIds', '[]'::jsonb)));
      if v_principal is null or not (v_principal = any(v_new_specs)) then
        raise exception 'Objetivo novo precisa ter a sua especialidade principal marcada.';
      end if;
    end if;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;

-- 2026-10-06h — trocar o nome do paciente atualiza Agenda, Prontuário e Plano
create or replace function public.rename_patient(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0; n_rec int := 0; n_plan int := 0;
begin
  if not coalesce(public.is_admin() or public.has_perm('pacientes', 'edit'), false) then
    raise exception 'Sem permissão para alterar pacientes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_old), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o cadastro do paciente com o nome novo antes.';
  end if;
  perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
  update public.appointments set patient = btrim(p_new)
    where lower(btrim(patient)) = lower(btrim(p_old));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_plan = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan);
end $$;
grant execute on function public.rename_patient(text, text, text) to authenticated;
-- 2026-10-06i: cancelado importado sem motivo (motivoPendente)
create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status.
  if tg_op = 'UPDATE' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo — a não ser
  -- que tenha vindo da importação de planilha com o motivo pendente.
  select n ->> 'id' into v_bad
  from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
  where n ->> 'status' = 'cancelado'
    and coalesce(n ->> 'motivoCancel', '') = ''
    and coalesce(n ->> 'motivoPendente', '') <> 'true'
    and (tg_op = 'INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
      where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
  limit 1;
  if v_bad is not null then
    raise exception 'Informe o motivo do cancelamento do tratamento.';
  end if;
  return new;
end;
$$;

-- 2026-10-07 — Acesso → Sistema: regras com chave (Bloquear / Avisar / Desligado).
--   * Documento novo config/system {rules: {regra: "block"|"warn"|"off"}, historico: [...]}.
--     Só o Administrador grava (módulo "sistema", que nenhum nível tem).
--   * public.sys_rule(regra, padrão): modo atual da regra (sem documento = padrão).
--   * As regras que o banco também confere passam a ler a chave e só recusam no modo
--     Bloquear (no Avisar o app pergunta antes de gravar):
--       ag_final_evolucao  — Finalizado exige evolução
--       ag_final_terapeuta — Finalizado travado para o terapeuta
--       tr_cancelado_def   — Cancelado é definitivo
--       tr_cancel_motivo   — Cancelar exige motivo
--   * Um só tratamento Ativo e "atendimento com evolução não é apagado" continuam
--     sempre valendo (evitam dados duplicados ou inconsistentes).
-- Pode rodar mais de uma vez.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$$;

insert into public.documents (path, data) values ('config/system', '{"rules": {}, "historico": []}'::jsonb)
on conflict (path) do nothing;

create or replace function public.sys_rule(p_id text, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select d.data -> 'rules' ->> p_id from public.documents d where d.path = 'config/system'), p_default);
$$;
grant execute on function public.sys_rule(text, text) to authenticated;

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
    if old.status = 'finalizado' and not public.is_admin()
       and public.sys_rule('ag_final_terapeuta', 'block') = 'block'
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id is not null) then
      raise exception 'Atendimento finalizado: o terapeuta não altera o status. A evolução é editada no Prontuário.' using errcode = '42501';
    end if;
    if new.status = 'finalizado'
       and public.sys_rule('ag_final_evolucao', 'block') = 'block'
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

create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status (regra tr_cancelado_def).
  if tg_op = 'UPDATE' and public.sys_rule('tr_cancelado_def', 'block') = 'block' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo (regra tr_cancel_motivo) —
  -- a não ser que tenha vindo da importação de planilha com o motivo pendente.
  if public.sys_rule('tr_cancel_motivo', 'block') = 'block' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
    where n ->> 'status' = 'cancelado'
      and coalesce(n ->> 'motivoCancel', '') = ''
      and coalesce(n ->> 'motivoPendente', '') <> 'true'
      and (tg_op = 'INSERT' or not exists (
        select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
        where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
    limit 1;
    if v_bad is not null then
      raise exception 'Informe o motivo do cancelamento do tratamento.';
    end if;
  end if;
  return new;
end;
$$;


-- ===== 2026-10-07b-limpeza-campos-antigos.sql: só dados (sem mudança de estrutura além de
-- apagar profiles.is_admin/permissions, que este arquivo já não cria). =====

-- ===== 2026-10-07c-paciente-por-codigo.sql =====
-- 2026-10-07c — Revisão de nomes e campos, Etapa 2: paciente (e grupo) por código.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   * Agenda (appointments): colunas novas patient_id (código do paciente) e group_id
--     (código do grupo de suporte marcado no lugar do paciente). O nome continua
--     gravado em "patient" (é o que aparece na tela).
--   * Gatilho appointments_refs: toda gravação preenche os códigos sozinha pelo nome
--     (quando só um paciente tem aquele nome). Com homônimos vale o código que o app
--     manda (o paciente escolhido na lista).
--   * Preenche os códigos dos atendimentos que já existem e das marcações do Planner
--     (patientId nas colunas de sala, roomRef = sala marcada nas colunas de grupo).
--   * rename_patient e merge_patient_records passam a usar o código; rename_group
--     (novo) atualiza o nome do grupo nos atendimentos da Agenda.
--   * treatment_appt_summary devolve também o código do paciente.
-- Pode rodar mais de uma vez.


-- 1. Colunas
alter table public.appointments add column if not exists patient_id text;
alter table public.appointments add column if not exists group_id text;
create index if not exists appointments_patient_id_idx on public.appointments (patient_id);
create index if not exists appointments_group_id_idx on public.appointments (group_id);

-- 2. Gatilho: preenche os códigos pelo nome
create or replace function public.appointments_refs()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n   text := lower(btrim(coalesce(new.patient, '')));
  v_cnt int;
  v_id  text;
begin
  if new.blocked or v_n in ('', 'treinamento', 'bloqueado') or new.patient = 'Reunião Clínica' then
    new.patient_id := null; new.group_id := null; return new;
  end if;
  -- Nada mudou no nome nem nos códigos: mantém.
  if tg_op = 'UPDATE' and v_n = lower(btrim(coalesce(old.patient, '')))
     and new.patient_id is not distinct from old.patient_id
     and new.group_id is not distinct from old.group_id then
    return new;
  end if;
  -- Código mandado pelo app e que confere com o nome: mantém.
  if new.patient_id is not null and exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = new.patient_id and lower(btrim(x ->> 'nome')) = v_n
  ) then
    new.group_id := null; return new;
  end if;
  if new.group_id is not null and exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = new.group_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = v_n
  ) then
    new.patient_id := null; return new;
  end if;
  -- Pelo nome.
  select count(*), min(x ->> 'id') into v_cnt, v_id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all' and lower(btrim(x ->> 'nome')) = v_n;
  if v_cnt = 1 then
    new.patient_id := v_id; new.group_id := null; return new;
  end if;
  if v_cnt > 1 then
    -- Homônimos sem código escolhido: fica o que já estava, se for um deles.
    if tg_op = 'UPDATE' and old.patient_id is not null and exists (
      select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'patients/all' and x ->> 'id' = old.patient_id and lower(btrim(x ->> 'nome')) = v_n
    ) then new.patient_id := old.patient_id; else new.patient_id := null; end if;
    new.group_id := null; return new;
  end if;
  new.patient_id := null;
  select x ->> 'id' into v_id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false) and lower(btrim(x ->> 'name')) = v_n
  limit 1;
  new.group_id := v_id;
  return new;
end $$;

drop trigger if exists appointments_refs on public.appointments;
create trigger appointments_refs
  before insert or update on public.appointments
  for each row execute function public.appointments_refs();

-- 3. Códigos dos atendimentos que já existem
with pats as (
  select x ->> 'id' as id, lower(btrim(x ->> 'nome')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all'
), uniq as (select n, min(id) as id from pats group by n having count(*) = 1)
update public.appointments a set patient_id = u.id
  from uniq u
 where a.patient_id is null and not a.blocked and lower(btrim(a.patient)) = u.n;

with grps as (
  select x ->> 'id' as id, lower(btrim(x ->> 'name')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false)
)
update public.appointments a set group_id = g.id
  from grps g
 where a.group_id is null and a.patient_id is null and not a.blocked and lower(btrim(a.patient)) = g.n;

-- 4. Códigos das marcações do Planner
with pats as (
  select x ->> 'id' as id, lower(btrim(x ->> 'nome')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all'
), uniq as (select n, min(id) as id from pats group by n having count(*) = 1),
rooms as (
  select x ->> 'id' as id, lower(btrim(x ->> 'name')) as n, coalesce((x ->> 'group')::boolean, false) as grp
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms'
)
update public.documents d
   set data = jsonb_set(d.data, '{bookings}', (
     select coalesce(jsonb_object_agg(b.key,
       case
         when jsonb_typeof(b.value) <> 'object' or coalesce(b.value ->> 'patient', '') = ''
              or coalesce((b.value ->> 'blocked')::boolean, false) or coalesce((b.value ->> 'training')::boolean, false)
              or b.value ->> 'patient' = 'Reunião Clínica' or lower(btrim(b.value ->> 'patient')) = 'bloqueado'
           then b.value
         when coalesce((select r.grp from rooms r where r.id = split_part(b.key, '|', 2)), false)
           then case when (select r.id from rooms r where not r.grp and r.n = lower(btrim(b.value ->> 'patient')) limit 1) is not null
                     then b.value || jsonb_build_object('roomRef', (select r.id from rooms r where not r.grp and r.n = lower(btrim(b.value ->> 'patient')) limit 1))
                     else b.value end
         when b.value ? 'patientId' then b.value
         when (select u.id from uniq u where u.n = lower(btrim(b.value ->> 'patient'))) is not null
           then b.value || jsonb_build_object('patientId', (select u.id from uniq u where u.n = lower(btrim(b.value ->> 'patient'))))
         else b.value
       end), '{}'::jsonb)
     from jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
   ))
 where d.path like 'schedule/%' and jsonb_typeof(d.data -> 'bookings') = 'object';

-- 5. Renomear paciente: pelo código (sem código, pelo nome antigo se nenhum outro
--    paciente tem esse nome).
create or replace function public.rename_patient(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0; n_rec int := 0; n_plan int := 0; v_homo boolean;
begin
  if not coalesce(public.is_admin() or public.has_perm('pacientes', 'edit'), false) then
    raise exception 'Sem permissão para alterar pacientes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_old), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o cadastro do paciente com o nome novo antes.';
  end if;
  select exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' <> p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_old))
  ) into v_homo;
  perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
  update public.appointments set patient = btrim(p_new), patient_id = p_id
    where not blocked and (patient_id = p_id
       or (patient_id is null and group_id is null and not v_homo and lower(btrim(patient)) = lower(btrim(p_old))));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_plan = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan);
end $$;
grant execute on function public.rename_patient(text, text, text) to authenticated;

-- 6. Mesclar cadastros: os atendimentos do 2º (pelo código ou pelo nome) passam ao 1º.
create or replace function public.merge_patient_records(
  p_drop_id text, p_drop_name text, p_keep_id text, p_keep_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
  n_rec int := 0;
begin
  if not public.is_admin() then
    raise exception 'Só o Administrador pode mesclar cadastros.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drop_id), '') = '' or coalesce(btrim(p_keep_id), '') = ''
     or coalesce(btrim(p_drop_name), '') = '' or coalesce(btrim(p_keep_name), '') = '' then
    raise exception 'Escolha os dois pacientes.';
  end if;
  if p_drop_id = p_keep_id then
    raise exception 'Escolha dois pacientes diferentes.';
  end if;
  perform set_config('pipo.merging', '1', true);
  update public.appointments set patient = p_keep_name, patient_id = p_keep_id
    where not blocked and (patient_id = p_drop_id
       or (patient_id is null and group_id is null and lower(btrim(patient)) = lower(btrim(p_drop_name))));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_rec = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec);
end;
$$;
revoke all on function public.merge_patient_records(text, text, text, text) from public;
grant execute on function public.merge_patient_records(text, text, text, text) to authenticated;

-- 7. Renomear grupo de suporte: atendimentos da Agenda com o grupo no lugar do paciente.
create or replace function public.rename_group(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
begin
  if not coalesce(public.is_admin() or public.has_perm('grupos', 'edit'), false) then
    raise exception 'Sem permissão para alterar grupos de suporte.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = p_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o grupo com o nome novo antes.';
  end if;
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  return jsonb_build_object('agenda', n_appt);
end $$;
revoke all on function public.rename_group(text, text, text) from public;
grant execute on function public.rename_group(text, text, text) to authenticated;

-- 8. Resumo dos atendimentos para os tratamentos, com o código do paciente
drop function if exists public.treatment_appt_summary(date);
create function public.treatment_appt_summary(p_until date)
returns table(patient text, d date, prof text, svc text, st text, n int, pid text)
language sql stable security invoker set search_path = public as $$
  select a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), count(*)::int, a.patient_id
  from public.appointments a
  where not a.blocked and a.date <= p_until and a.patient <> ''
  group by a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), a.patient_id
  order by 2, 1, 3, 4, 5
$$;
grant execute on function public.treatment_appt_summary(date) to authenticated;
revoke execute on function public.treatment_appt_summary(date) from anon;



-- ===== 2026-10-07d-colaborador-unico.sql (só dados) =====
-- 2026-10-07d — Revisão de nomes e campos, Etapa 3: colaborador único.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   1. CPF de quem atende: passa para o cadastro do colaborador (tabela staff, protegida
--      pela permissão Colaboradores) e sai do cadastro de atendimento (config/professionals,
--      que todo usuário ativo lê). Profissional sem colaborador ligado fica como está.
--   2. Uma situação só: colaborador com o tipo Profissional fica com a mesma situação
--      (ativo/inativo) do cadastro de atendimento — o que a grade já mostrava.
-- Pode rodar mais de uma vez.


-- 1a. CPF do profissional → colaborador (só onde o colaborador ainda não tem CPF)
update public.staff s
   set data = s.data || jsonb_build_object('cpf', regexp_replace(p ->> 'cpf', '\D', '', 'g'))
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
 where d.path = 'config/professionals' and p ->> 'id' = s.professional_id
   and coalesce(p ->> 'cpf', '') <> '' and coalesce(s.data ->> 'cpf', '') = '';

-- 1b. Tira o CPF do cadastro de atendimento de quem tem colaborador ligado
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when exists (select 1 from public.staff s where s.professional_id = p ->> 'id')
            then p - 'cpf' else p end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, o)
   ))
 where d.path = 'config/professionals';

-- 2. Situação do colaborador = situação do atendimento (tipo Profissional)
update public.staff s
   set data = case when coalesce((p ->> 'inativo')::boolean, false)
                   then s.data || '{"inativo": true}'::jsonb
                   else s.data - 'inativo' end
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
 where d.path = 'config/professionals' and p ->> 'id' = s.professional_id
   and coalesce(s.data -> 'tipos', '[]'::jsonb) ? 'profissional'
   and coalesce((s.data ->> 'inativo')::boolean, false) is distinct from coalesce((p ->> 'inativo')::boolean, false);



-- ===== 2026-10-07e-nomes-internos.sql =====
-- 2026-10-07e — Revisão de nomes e campos, Etapa 4: nomes internos novos.
-- RODE FORA DO HORÁRIO DE ATENDIMENTO, logo depois da publicação do sistema, e faça
-- uma cópia antes (Acesso → Backup → Baixar). Na tela nada muda.
--   1. Permissões dos níveis: "agenda" (Planner) → "planner"; "agendamentos" (Agenda) →
--      "agenda"; "rh_funcionarios" → "colaboradores"; "rh_remuneracao" → "colaboradores_valores".
--      Funções e regras de acesso do banco passam a usar os nomes novos.
--   2. Tratamentos: "pacoteHoras" → "sessoesMes" e "despesas" → "descontos" (também no
--      cadastro dos pacientes e na tabela de valores treatment_finance).
--   3. Cadastro de atendimento dos profissionais: "name" → "nome".
-- Pode rodar mais de uma vez.


-- 1. Permissões dos níveis (o nível Administrador é travado; o trigger fica desligado só aqui)
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = case
     when r.permissions ? 'planner' then r.permissions - 'agendamentos' - 'rh_funcionarios' - 'rh_remuneracao'
     else (r.permissions - 'agenda' - 'agendamentos' - 'rh_funcionarios' - 'rh_remuneracao')
          || jsonb_build_object('planner', coalesce(r.permissions -> 'agenda', '{}'::jsonb))
          || jsonb_strip_nulls(jsonb_build_object(
               'agenda', r.permissions -> 'agendamentos',
               'colaboradores', r.permissions -> 'rh_funcionarios',
               'colaboradores_valores', r.permissions -> 'rh_remuneracao'))
   end;
alter table public.roles enable trigger roles_guard;

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

create or replace function public.documents_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_module = 'planner' then
    for r in
      select k, v_old -> 'bookings' -> k as o, new.data -> 'bookings' -> k as n
      from (select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
            union select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))) keys
    loop
      if r.o is not distinct from r.n then continue;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, 'planner:edit');
      elsif r.o is null then v_need := array_append(v_need, 'planner:create');
      elsif r.n is null then v_need := array_append(v_need, 'planner:delete');
      else v_need := array_append(v_need, 'planner:edit');
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
end $function$;

create or replace function public.agenda_scope_professional()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.active and not r.is_admin and p.professional_id is not null
         and not coalesce((r.permissions -> 'agenda' ->> 'edit')::boolean, false)
    then p.professional_id
  end
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$function$;

create or replace function public.set_appointment_status(p_id uuid, p_status text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then
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
$function$;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (public.has_perm('agenda', 'view') and (public.agenda_scope_professional() is null or professional_id = public.agenda_scope_professional()));
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_perm('agenda', 'create'));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_perm('agenda', 'edit')) with check (public.has_perm('agenda', 'edit'));
drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments for delete to authenticated
  using (public.has_perm('agenda', 'delete'));

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated using (public.has_perm('colaboradores', 'view'));
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated with check (public.has_perm('colaboradores', 'create'));
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated
  using (public.has_perm('colaboradores', 'edit')) with check (public.has_perm('colaboradores', 'edit'));
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated using (public.has_perm('colaboradores', 'delete'));

drop policy if exists staff_pay_select on public.staff_pay;
create policy staff_pay_select on public.staff_pay for select to authenticated using (public.has_perm('colaboradores_valores', 'view'));
drop policy if exists staff_pay_insert on public.staff_pay;
create policy staff_pay_insert on public.staff_pay for insert to authenticated with check (public.has_perm('colaboradores_valores', 'edit'));
drop policy if exists staff_pay_update on public.staff_pay;
create policy staff_pay_update on public.staff_pay for update to authenticated
  using (public.has_perm('colaboradores_valores', 'edit')) with check (public.has_perm('colaboradores_valores', 'edit'));
drop policy if exists staff_pay_delete on public.staff_pay;
create policy staff_pay_delete on public.staff_pay for delete to authenticated
  using (public.has_perm('colaboradores_valores', 'edit') or public.has_perm('colaboradores', 'delete'));

-- 3 (funções antes dos dados). Nome do profissional: lê "nome" (e "name" dos antigos).
create or replace function public.sync_professional_user_names()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.profiles pr
     set full_name = btrim(coalesce(item ->> 'nome', item ->> 'name'))
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) item
   where pr.professional_id = item ->> 'id'
     and coalesce(btrim(coalesce(item ->> 'nome', item ->> 'name')), '') <> ''
     and pr.full_name is distinct from btrim(coalesce(item ->> 'nome', item ->> 'name'));
  return new;
end;
$function$;

create or replace function public.profiles_professional_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(coalesce(item ->> 'nome', item ->> 'name')) into v_name
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$function$;

-- 2. Tratamentos e pacientes: pacoteHoras → sessoesMes, despesas → descontos
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       (x - 'pacoteHoras' - 'despesas')
       || case when x ? 'pacoteHoras' and not x ? 'sessoesMes' then jsonb_build_object('sessoesMes', x -> 'pacoteHoras') else '{}'::jsonb end
       || case when x ? 'despesas' and not x ? 'descontos' then jsonb_build_object('descontos', x -> 'despesas') else '{}'::jsonb end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(x, o)))
 where d.path in ('treatments/all', 'patients/all');

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treatment_finance' and column_name = 'despesas')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treatment_finance' and column_name = 'descontos') then
    alter table public.treatment_finance rename column despesas to descontos;
  end if;
end $$;

-- 3. Profissionais: name → nome
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when x ? 'name' then (x - 'name') || jsonb_build_object('nome', coalesce(nullif(x ->> 'nome', ''), x ->> 'name')) else x end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(x, o)))
 where d.path = 'config/professionals';


-- 2026-10-08 — Planner: Bloqueio de horário (permissão bloqueio_horario, config/planner_blocks)
create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'  then 'bloqueio_horario'
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 3. Dias do Planner: Planner ou Bloqueio de horário
create or replace function public.can_write_path(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unnest(case when p_path = 'config/rooms' then array['salas', 'grupos']
                              when p_path like 'schedule/%' then array['planner', 'bloqueio_horario']
                              else array[public.module_for_path(p_path)] end) m
    where public.has_perm(m, 'create') or public.has_perm(m, 'edit') or public.has_perm(m, 'delete')
  );
$$;

create or replace function public.documents_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_module = 'planner' then
    for r in
      select k, v_old -> 'bookings' -> k as o, new.data -> 'bookings' -> k as n
      from (select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
            union select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))) keys
    loop
      if r.o is not distinct from r.n then continue;
      -- Bloqueio de horário ({patient:"", lock:true}): permissão própria
      elsif coalesce((r.o ->> 'lock')::boolean, false) or coalesce((r.n ->> 'lock')::boolean, false) then
        if coalesce((r.o ->> 'lock')::boolean, false) and coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, 'bloqueio_horario:edit');
        elsif coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, 'bloqueio_horario:create');
        else
          v_need := array_append(v_need, 'bloqueio_horario:delete');
          if coalesce(btrim(r.n ->> 'patient'), '') <> '' then v_need := array_append(v_need, 'planner:create'); end if;
        end if;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, 'planner:edit');
      elsif r.o is null then v_need := array_append(v_need, 'planner:create');
      elsif r.n is null then v_need := array_append(v_need, 'planner:delete');
      else v_need := array_append(v_need, 'planner:edit');
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
end $function$;


-- 2026-10-08d — config/planner_blocks na lista de caminhos permitidos (faltava na 2026-10-08).
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2026-10-08e — CRM (Fase 1): listas (config/task_lists), tarefas, atividade e leituras


-- 1. Caminho permitido e módulo do cadastro das listas (só Administrador grava)
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'  -- nenhum nível tem: só o Administrador
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

insert into public.documents (path, data)
values ('config/task_lists', jsonb_build_object('list', jsonb_build_array(
  jsonb_build_object('id', 'atendimento', 'name', 'Atendimento', 'color', '#2e7d6b', 'lead', true, 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'triagem', 'name', 'Triagem', 'color', '#e8b100'),
    jsonb_build_object('id', 'avaliacao', 'name', 'Avaliação', 'color', '#5b4bd6'),
    jsonb_build_object('id', 'pos-avaliacao', 'name', 'Pós-avaliação', 'color', '#ea6a0a'),
    jsonb_build_object('id', 'contrato', 'name', 'Contrato assinado', 'color', '#2e9d57', 'done', true),
    jsonb_build_object('id', 'cancelado', 'name', 'Cancelado', 'color', '#d64545', 'done', true, 'lost', true))),
  jsonb_build_object('id', 'agendas', 'name', 'Agendas', 'color', '#e8a400', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true))),
  jsonb_build_object('id', 'fature', 'name', 'Fature', 'color', '#64748b', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true))),
  jsonb_build_object('id', 'gestao', 'name', 'Gestão', 'color', '#2563eb', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true)))
)))
on conflict (path) do nothing;

-- 2. Tabelas
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  list_id         text not null,
  status          text not null,
  title           text not null,
  description     text not null default '',
  priority        text not null default 'normal' check (priority in ('urgente', 'alta', 'normal', 'baixa')),
  due_date        date,
  assignees       uuid[] not null default '{}',
  tags            text[] not null default '{}',
  patient_id      text,
  lead            jsonb not null default '{}'::jsonb,
  position        double precision not null default 0,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists tasks_list_idx on public.tasks (list_id, status);
create index if not exists tasks_assignees_idx on public.tasks using gin (assignees);

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  kind        text not null check (kind in ('comment', 'create', 'status', 'field')),
  body        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  mentions    uuid[] not null default '{}',
  author_id   uuid default auth.uid(),
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events (task_id, created_at);
create index if not exists task_events_mentions_idx on public.task_events using gin (mentions);

create table if not exists public.task_reads (
  user_id uuid not null default auth.uid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- nome de quem está logado (para autor e histórico)
create or replace function public.crm_my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), '');
$$;

-- carimbos: autor, nome, datas, fechamento
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tasks_stamp on public.tasks;
create trigger tasks_stamp before insert or update on public.tasks for each row execute function public.tasks_stamp();

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists task_events_stamp on public.task_events;
create trigger task_events_stamp before insert on public.task_events for each row execute function public.task_events_stamp();

-- 4. Histórico automático
create or replace function public.tasks_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := public.crm_my_name();
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'create', jsonb_build_object('status', new.status), auth.uid(), v_name);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'status', jsonb_build_object('de', old.status, 'para', new.status), auth.uid(), v_name);
  end if;
  if new.list_id is distinct from old.list_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'lista', 'de', old.list_id, 'para', new.list_id), auth.uid(), v_name);
  end if;
  if new.assignees is distinct from old.assignees then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'responsaveis', 'de', to_jsonb(old.assignees), 'para', to_jsonb(new.assignees)), auth.uid(), v_name);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'vencimento', 'de', old.due_date, 'para', new.due_date), auth.uid(), v_name);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'prioridade', 'de', old.priority, 'para', new.priority), auth.uid(), v_name);
  end if;
  if new.title is distinct from old.title then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'titulo', 'de', old.title, 'para', new.title), auth.uid(), v_name);
  end if;
  return new;
end $$;
drop trigger if exists tasks_history on public.tasks;
create trigger tasks_history after insert or update on public.tasks for each row execute function public.tasks_history();

-- 3. Segurança (RLS): cada lista com a sua permissão "crm_<lista>"
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.task_reads enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.has_perm('crm_' || list_id, 'view'));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_perm('crm_' || list_id, 'create'));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_perm('crm_' || list_id, 'edit'))
  with check (public.has_perm('crm_' || list_id, 'edit'));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_perm('crm_' || list_id, 'delete'));

-- comentário: quem vê a tarefa pode comentar; apaga o próprio comentário (ou o Administrador)
drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.has_perm('crm_' || t.list_id, 'view')));
drop policy if exists task_events_insert on public.task_events;
create policy task_events_insert on public.task_events for insert to authenticated
  with check (kind = 'comment' and exists (select 1 from public.tasks t where t.id = task_id and public.has_perm('crm_' || t.list_id, 'view')));
drop policy if exists task_events_delete on public.task_events;
create policy task_events_delete on public.task_events for delete to authenticated
  using (kind = 'comment' and (author_id = auth.uid() or public.is_admin()));

drop policy if exists task_reads_own on public.task_reads;
create policy task_reads_own on public.task_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.tasks, public.task_events, public.task_reads to authenticated;

-- 5. Usuários ativos (para responsável e @menção)
create or replace function public.crm_people()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
   order by p.full_name;
$$;
grant execute on function public.crm_people() to authenticated;
revoke execute on function public.crm_people() from anon;

-- tempo real
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_events') then
    alter publication supabase_realtime add table public.task_events;
  end if;
end $$;

-- permissões iniciais: quem vê a Agenda recebe tudo nas 4 listas
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions
     || jsonb_build_object('crm_atendimento', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_agendas', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_fature', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_gestao', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
 where not r.is_admin
   and coalesce((r.permissions -> 'agenda' ->> 'view')::boolean, false)
   and not (r.permissions ? 'crm_atendimento');
alter table public.roles enable trigger roles_guard;


-- 2026-10-08f — CRM: tarefa finalizada não pode ser excluída


create or replace function public.tasks_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
      from public.documents d,
           jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
     where d.path = 'config/task_lists'
       and l ->> 'id' = old.list_id
       and s ->> 'id' = old.status
       and coalesce((s ->> 'done')::boolean, false)
  ) then
    raise exception 'Tarefa finalizada não pode ser excluída.' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists tasks_delete_guard on public.tasks;
create trigger tasks_delete_guard before delete on public.tasks
  for each row execute function public.tasks_delete_guard();

-- Detalhes de um agendamento de Grupo de Suporte (Coordenador, Aplicador ABA…):
-- lista os atendimentos de PACIENTE na mesma sala, data e horário.
-- Quem só vê a própria agenda (profissional) não lê os atendimentos dos outros
-- profissionais; esta função entrega só esses, e só se a pessoa pode ver o
-- agendamento do grupo. Pode rodar de novo.

create or replace function public.group_slot_appointments(p_id uuid)
 returns setof public.appointments
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  g public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then return; end if;
  select * into g from public.appointments where id = p_id;
  if g.id is null or g.room_id is null then return; end if;
  if v_scope is not null and g.professional_id is distinct from v_scope then return; end if;
  return query
    select a.* from public.appointments a
     where a.room_id = g.room_id and a.date = g.date and a.time = g.time
       and a.id <> g.id and not coalesce(a.blocked, false)
       and a.group_id is null;
end;
$function$;

grant execute on function public.group_slot_appointments(uuid) to authenticated;
