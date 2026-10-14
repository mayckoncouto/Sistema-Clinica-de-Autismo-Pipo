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
  followers       uuid[] not null default '{}',
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
  if new.patient_id is not null and new.patient_id is distinct from old.patient_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'paciente', 'de', nullif(btrim(coalesce(old.lead ->> 'nome', '')), ''), 'para', new.patient_id), auth.uid(), v_name);
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

-- ===== CRM: editar o próprio comentário (2026-10-09c) =====
alter table public.task_events add column if not exists edited_at timestamptz;

create or replace function public.task_events_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.kind <> 'comment' then raise exception 'Só comentários podem ser editados.'; end if;
  new.id := old.id; new.task_id := old.task_id; new.kind := old.kind; new.data := old.data;
  new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then new.edited_at := now();
  else new.edited_at := old.edited_at; end if;
  return new;
end $$;
drop trigger if exists task_events_edit_guard on public.task_events;
create trigger task_events_edit_guard before update on public.task_events for each row execute function public.task_events_edit_guard();

drop policy if exists task_events_update on public.task_events;
create policy task_events_update on public.task_events for update to authenticated
  using (kind = 'comment' and author_id = auth.uid())
  with check (kind = 'comment' and author_id = auth.uid());
-- CRM: só pode ser responsável por uma tarefa quem tem acesso ao CRM e à lista da tarefa (2026-10-09)
--   1. crm_user_can(usuário, lista): usuário ativo, Administrador, ou nível com "ver" em CRM (crm_listas;
--      nível sem o item gravado vale se ele enxerga alguma lista, como no app) E "ver" na lista (crm_<lista>).
--   2. crm_people() passa a devolver também admin, crm e as listas que cada pessoa vê (o app filtra a
--      escolha de responsáveis pela lista da tarefa).
--   3. Gatilho tasks_assignees_guard: recusa gravar responsável novo sem acesso (os que já estavam ficam;
--      mudar a tarefa de lista confere todos).
-- Pode rodar de novo.

create or replace function public.crm_user_can(p_user uuid, p_list text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (
      coalesce(r.is_admin, false) or (
        coalesce((r.permissions -> ('crm_' || p_list) ->> 'view')::boolean, false)
        and case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                 then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                 else true end
      ))
      from public.profiles p left join public.roles r on r.id = p.role_id
     where p.id = p_user
  ), false);
$$;
grant execute on function public.crm_user_can(uuid, text) to authenticated;
revoke execute on function public.crm_user_can(uuid, text) from anon;

drop function if exists public.crm_people();
create function public.crm_people()
returns table (id uuid, full_name text, admin boolean, crm boolean, lists text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name,
         coalesce(r.is_admin, false) as admin,
         coalesce(r.is_admin, false) or (
           case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                else exists (select 1 from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                              where e.key like 'crm\_%' and e.key <> 'crm_listas'
                                and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)) end
         ) as crm,
         coalesce((select array_agg(substr(e.key, 5) order by e.key)
                     from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                    where e.key like 'crm\_%' and e.key <> 'crm_listas'
                      and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)),
                  '{}'::text[]) as lists
    from public.profiles p left join public.roles r on r.id = p.role_id
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
   order by p.full_name;
$$;
grant execute on function public.crm_people() to authenticated;
revoke execute on function public.crm_people() from anon;

create or replace function public.tasks_assignees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; nm text;
begin
  foreach u in array coalesce(new.assignees, '{}'::uuid[]) loop
    if tg_op = 'INSERT' or new.list_id is distinct from old.list_id
       or not (u = any(coalesce(old.assignees, '{}'::uuid[]))) then
      if not public.crm_user_can(u, new.list_id) then
        select full_name into nm from public.profiles where id = u;
        raise exception '% não tem acesso ao CRM ou a esta lista e não pode ser responsável pela tarefa.', coalesce(nm, 'Esta pessoa');
      end if;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists tasks_assignees_guard on public.tasks;
create trigger tasks_assignees_guard before insert or update of assignees, list_id on public.tasks
  for each row execute function public.tasks_assignees_guard();
-- Cadastros de Diagnósticos e Origens (2026-10-09)
--   config/diagnoses  Cadastros → Diagnósticos  (permissão "diagnosticos")  {list:[{id, code, name}]}
--   config/origins    Cadastros → Origens       (permissão "origens")       {list:[{id, name}]}
-- O paciente e o lead do CRM continuam guardando o TEXTO ("F84.0 Autismo infantil", "Indicação médica").
-- 1. caminhos permitidos  2. módulo de cada caminho  3. níveis copiam o acesso de Pacientes
-- 4. listas iniciais (sugestões + o que já está gravado nos pacientes e nos leads). Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
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
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
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

-- 3. Níveis: Diagnósticos e Origens começam com o mesmo acesso de Pacientes
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('diagnosticos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'diagnosticos');
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('origens', coalesce(permissions -> 'pacientes', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'origens');

-- 4a. Diagnósticos iniciais: sugestões + textos já gravados (saúde do paciente, cadastro do paciente e leads)
with txt as (
  select unnest(array['F84.0 Autismo infantil', 'F84.1 Autismo atípico', 'F84.5 Síndrome de Asperger',
    'F84.8 Outros transtornos globais do desenvolvimento', 'F84.9 Transtorno global do desenvolvimento não especificado',
    'F90.0 TDAH', 'F80.1 Transtorno expressivo de linguagem', 'F80.2 Transtorno receptivo de linguagem',
    'F82 Transtorno do desenvolvimento motor', 'F70 Retardo mental leve', 'F81.9 Transtorno do desenvolvimento das habilidades escolares']) as t, 0 as ord
  union all
  select trim(h.data ->> 'cid'), 1 from public.patient_health h where coalesce(trim(h.data ->> 'cid'), '') <> ''
  union all
  select trim(p ->> 'cid'), 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and coalesce(trim(p ->> 'cid'), '') <> ''
  union all
  select trim(t.lead ->> 'diagnostico'), 1 from public.tasks t where coalesce(trim(t.lead ->> 'diagnostico'), '') <> ''
), uniq as (
  select distinct on (lower(t)) t, ord from txt order by lower(t), ord
), parsed as (
  select t, ord,
         case when t ~* '^[A-Z][0-9]{2}(\.[0-9]{1,2})?\s+' then upper(substring(t from '^([A-Za-z][0-9]{2}(?:\.[0-9]{1,2})?)')) else '' end as code,
         case when t ~* '^[A-Z][0-9]{2}(\.[0-9]{1,2})?\s+' then trim(regexp_replace(t, '^[A-Za-z][0-9]{2}(\.[0-9]{1,2})?\s+', '')) else t end as name
    from uniq
)
insert into public.documents (path, data)
select 'config/diagnoses', jsonb_build_object('list', coalesce(jsonb_agg(jsonb_build_object(
         'id', 'dg-' || md5(lower(t)), 'code', code, 'name', name) order by ord, code, name), '[]'::jsonb))
  from parsed
on conflict (path) do nothing;

-- 4b. Origens iniciais: as de sempre + as já gravadas nos pacientes e nos leads
with txt as (
  select unnest(array['Indicação médica', 'Indicação de outro paciente', 'Escola', 'Convênio', 'Internet / redes sociais', 'Outro']) as t,
         generate_series(1, 6) as ord
  union all
  select trim(p ->> 'comoConheceu'), 100 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and coalesce(trim(p ->> 'comoConheceu'), '') <> ''
  union all
  select trim(t.lead ->> 'origem'), 100 from public.tasks t where coalesce(trim(t.lead ->> 'origem'), '') <> ''
), uniq as (
  select distinct on (lower(t)) t, ord from txt order by lower(t), ord
)
insert into public.documents (path, data)
select 'config/origins', jsonb_build_object('list', coalesce(jsonb_agg(jsonb_build_object(
         'id', 'or-' || md5(lower(t)), 'name', t) order by ord, t), '[]'::jsonb))
  from uniq
on conflict (path) do nothing;


-- =====================================================================
-- 2026-10-10b-gravar-so-o-item.sql
-- =====================================================================
-- =====================================================================
-- Agenda Pipo — cadastros em lista gravam só o item alterado (2026-10-10)
--   * patch_list2: troca só os itens alterados/novos e tira os excluídos, numa transação
--     com trava da linha (duas pessoas mexendo em itens diferentes não se apagam mais).
--   * Confere o carimbo _upd {por, em} de cada item alterado: se mudou depois que a pessoa
--     abriu o cadastro (p_expect), ou se o item foi excluído por outra pessoa, recusa com
--     'PIPO_CONFLITO:[...]' e o app pergunta "Salvar assim mesmo" / "Recarregar"
--     (p_force = true grava mesmo assim).
--   * p_order (opcional): ordem dos itens (reordenar salas, status…); itens que a pessoa
--     ainda não via (incluídos por outra pessoa) vão para o fim, nunca se perdem.
--   * Roda com a permissão de quem chama (RLS e documents_enforce continuam valendo).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.patch_list2(
  p_path text, p_upserts jsonb, p_deletes jsonb,
  p_expect jsonb default '{}'::jsonb, p_order jsonb default null, p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
  v_list jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_ord  jsonb := '[]'::jsonb;
  v_del  text[];
  v_seen text[] := '{}';
  v_used text[] := '{}';
  v_conf jsonb := '[]'::jsonb;
  v_cur  jsonb;
  e jsonb;
  u jsonb;
  k text;
begin
  if p_path like 'schedule/%' then
    raise exception 'patch_list2 não vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then v_data := '{}'::jsonb; end if;
  v_list := coalesce(v_data -> 'list', '[]'::jsonb);

  -- Conflitos: item que a pessoa alterou mudou (ou sumiu) depois que ela o abriu.
  if not coalesce(p_force, false) then
    for k in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
      v_cur := null;
      select value into v_cur from jsonb_array_elements(v_list) where value ->> 'id' = k limit 1;
      if v_cur is null then
        select value into u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) where value ->> 'id' = k limit 1;
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k, 'excluido', true,
          'nome', coalesce(u ->> 'nome', u ->> 'name', '')));
      elsif coalesce(v_cur -> '_upd' ->> 'em', '') <> coalesce(p_expect ->> k, '') then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k,
          'nome', coalesce(v_cur ->> 'nome', v_cur ->> 'name', ''),
          'por', v_cur -> '_upd' ->> 'por', 'em', v_cur -> '_upd' ->> 'em'));
      end if;
    end loop;
    if jsonb_array_length(v_conf) > 0 then
      raise exception 'PIPO_CONFLITO:%', v_conf::text using errcode = 'P0001';
    end if;
  end if;

  select coalesce(array_agg(x), '{}') into v_del
  from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)) as x;

  -- Mantém a ordem: substitui no lugar os alterados e tira os excluídos.
  for e in select value from jsonb_array_elements(v_list) loop
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

  -- Ordem pedida: primeiro os da lista, na ordem dela; depois os que a pessoa não via.
  if p_order is not null and jsonb_typeof(p_order) = 'array' then
    for k in select value from jsonb_array_elements_text(p_order) loop
      select value into e from jsonb_array_elements(v_out) where value ->> 'id' = k limit 1;
      if found and not (k = any(v_used)) then
        v_ord := v_ord || jsonb_build_array(e);
        v_used := v_used || k;
      end if;
    end loop;
    for e in select value from jsonb_array_elements(v_out) loop
      if not ((e ->> 'id') = any(v_used)) then v_ord := v_ord || jsonb_build_array(e); end if;
    end loop;
    v_out := v_ord;
  end if;

  v_data := jsonb_set(v_data, '{list}', v_out, true);
  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path) do update set data = excluded.data;
  return v_data;
end $$;

grant execute on function public.patch_list2(text, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;
revoke execute on function public.patch_list2(text, jsonb, jsonb, jsonb, jsonb, boolean) from anon;


-- =====================================================================
-- 2026-10-10c-atendimento-realizado-protegido.sql
-- =====================================================================
-- =====================================================================
-- Agenda Pipo — atendimento com status ou evolução fica protegido (2026-10-10)
-- Decisões do usuário (vale para QUALQUER status):
--   * Excluir: só o Administrador (com evolução já era assim).
--   * Mudar data, horário ou profissional: só o Administrador; a evolução ligada acompanha.
--   * Trocar o paciente: ninguém (renomear e mesclar paciente/grupo continuam funcionando).
--   * SQL Editor / scripts (sem usuário logado) não são bloqueados.
-- Pode rodar de novo sem estragar.
-- =====================================================================

-- 1. Excluir
create or replace function public.appointments_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return old; end if;
  if coalesce(old.status, '') <> '' then
    raise exception 'Este atendimento tem status: só o Administrador pode excluir (ou tire o status antes).'
      using errcode = '42501';
  end if;
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

-- 2. Alterar
create or replace function public.appointments_done_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('pipo.merging', true), '') = '1' then return new; end if;
  if coalesce(old.status, '') = ''
     and not exists (select 1 from public.clinical_records c where c.appointment_id = old.id) then
    return new;
  end if;
  if lower(btrim(coalesce(new.patient, ''))) is distinct from lower(btrim(coalesce(old.patient, '')))
     or coalesce(new.blocked, false) is distinct from coalesce(old.blocked, false)
     or (old.patient_id is not null and new.patient_id is distinct from old.patient_id)
     or (old.group_id is not null and new.group_id is distinct from old.group_id) then
    raise exception 'Este atendimento tem status ou evolução: o paciente não pode ser trocado.' using errcode = '42501';
  end if;
  if (new.date, new.time, new.professional_id) is distinct from (old.date, old.time, old.professional_id)
     and not public.is_admin() then
    raise exception 'Este atendimento tem status ou evolução: só o Administrador muda a data, o horário ou o profissional.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_done_guard on public.appointments;
create trigger appointments_done_guard
  before update on public.appointments
  for each row execute function public.appointments_done_guard();

-- 3. A evolução acompanha a data, o horário e o profissional do atendimento (Administrador)
create or replace function public.appointments_sync_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.date, new.time, new.professional_id) is distinct from (old.date, old.time, old.professional_id) then
    perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
    update public.clinical_records
       set appointment_date = new.date, appointment_time = new.time, professional_id = new.professional_id
     where appointment_id = new.id;
    perform set_config('pipo.merging', '', true);
  end if;
  return null;
end;
$$;

drop trigger if exists appointments_sync_record on public.appointments;
create trigger appointments_sync_record
  after update on public.appointments
  for each row execute function public.appointments_sync_record();

-- 4. Renomear grupo de suporte continua funcionando em atendimentos com status
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
  perform set_config('pipo.merging', '1', true);   -- mesmo grupo, nome novo
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt);
end $$;
revoke all on function public.rename_group(text, text, text) from public;
grant execute on function public.rename_group(text, text, text) to authenticated;


-- =====================================================================
-- Agenda Pipo — excluir ou editar evolução sem deixar dados soltos (2026-10-10)
--   1. Evolução que é a ÚNICA ligada a um atendimento Finalizado não pode ser excluída
--      (tire o status Finalizado primeiro). Segue a regra "Finalizado exige evolução"
--      (Acesso → Sistema): só vale no modo Bloquear.
--   2. Objetivo do Plano Terapêutico avaliado na evolução excluída (ou desmarcado ao
--      editar a evolução) volta à situação da ÚLTIMA evolução que sobrou; sem nenhuma,
--      fica sem situação. Só mexe se a situação do objetivo ainda é a que essa evolução
--      gravou (mudança feita depois, à mão ou por outra evolução, fica).
-- Pode rodar de novo sem estragar.
-- =====================================================================

-- 1. Trava de exclusão ---------------------------------------------------------
create or replace function public.clinical_records_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if; -- SQL Editor / scripts
  if old.appointment_id is null then return old; end if;
  if public.sys_rule('ag_final_evolucao', 'block') <> 'block' then return old; end if;
  if exists (select 1 from public.appointments a where a.id = old.appointment_id and a.status = 'finalizado')
     and not exists (select 1 from public.clinical_records c where c.appointment_id = old.appointment_id and c.id <> old.id) then
    raise exception 'Esta evolução é a do atendimento Finalizado: tire o status Finalizado do atendimento antes de excluir.'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists clinical_records_delete_guard on public.clinical_records;
create trigger clinical_records_delete_guard
  before delete on public.clinical_records
  for each row execute function public.clinical_records_delete_guard();

-- 2. Recalcula a situação dos objetivos ----------------------------------------
create or replace function public.clinical_records_plan_goals_undo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_old_date text; v_plan uuid; v_sections jsonb; v_final text;
  v_last jsonb; v_last_date text; v_new_level text;
begin
  if jsonb_typeof(old.plan_goals) <> 'array' or jsonb_array_length(old.plan_goals) = 0 then
    return null;
  end if;
  v_old_date := coalesce(old.appointment_date, (old.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(old.plan_goals) loop
    -- na edição, só os objetivos que saíram da evolução (os que ficaram já foram regravados)
    if tg_op = 'UPDATE' and jsonb_typeof(new.plan_goals) = 'array' and exists (
         select 1 from jsonb_array_elements(new.plan_goals) n
          where n ->> 'planId' = g ->> 'planId' and n ->> 'objId' = g ->> 'objId') then
      continue;
    end if;
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = old.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    -- a situação atual ainda é a que esta evolução gravou?
    if not exists (
      select 1 from jsonb_array_elements(v_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
       where o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
         and o ->> 'levelId' is not distinct from g ->> 'levelId' and o ->> 'levelEm' = v_old_date) then
      continue;
    end if;
    -- última evolução que sobrou com esse objetivo
    v_last := null; v_last_date := null;
    select x, coalesce(c.appointment_date, (c.created_at at time zone 'America/Sao_Paulo')::date)::text
      into v_last, v_last_date
      from public.clinical_records c,
           jsonb_array_elements(case when jsonb_typeof(c.plan_goals) = 'array' then c.plan_goals else '[]'::jsonb end) x
     where c.patient_id = old.patient_id and c.id <> old.id
       and x ->> 'planId' = g ->> 'planId' and x ->> 'objId' = g ->> 'objId' and x ->> 'scaleId' = g ->> 'scaleId'
     order by 2 desc, c.created_at desc
     limit 1;
    v_new_level := v_last ->> 'levelId';
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId' then
            (case when v_last is null then o - 'levelId' - 'levelEm'
                  else o || jsonb_build_object('levelId', v_new_level, 'levelEm', v_last_date) end)
            || case when v_new_level is not null and v_new_level = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                      then jsonb_build_object('status', 'atingido', 'statusEm', coalesce(v_last_date, v_old_date))
                    when v_new_level is distinct from v_final and o ->> 'status' = 'atingido'
                      then jsonb_build_object('status', 'ativo', 'statusEm', to_char(current_date, 'YYYY-MM-DD'))
                    else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return null;
end $$;

drop trigger if exists clinical_records_plan_goals_del on public.clinical_records;
create trigger clinical_records_plan_goals_del after delete on public.clinical_records
  for each row execute function public.clinical_records_plan_goals_undo();
drop trigger if exists clinical_records_plan_goals_unmark on public.clinical_records;
create trigger clinical_records_plan_goals_unmark after update of plan_goals on public.clinical_records
  for each row when (new.plan_goals is distinct from old.plan_goals)
  execute function public.clinical_records_plan_goals_undo();

-- =====================================================================
-- Agenda Pipo — excluir paciente sem deixar dados de saúde soltos (2026-10-10)
--   Ao excluir um paciente do cadastro, o app chama delete_patient_health, que apaga
--   os dados de saúde dele (CID, alergias, medicações…). Só funciona para quem pode
--   excluir pacientes (ou Administrador) e só depois que o paciente já saiu do cadastro.
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.delete_patient_health(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'delete')) then
    raise exception 'Sem permissão para excluir pacientes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
              where d.path = 'patients/all' and x ->> 'id' = p_id) then
    raise exception 'O paciente ainda está no cadastro.' using errcode = '42501';
  end if;
  delete from public.patient_health where patient_id = p_id;
end $$;

grant execute on function public.delete_patient_health(text) to authenticated;
revoke execute on function public.delete_patient_health(text) from anon;

-- 2026-10-10f — Mesclar cadastros leva planos, tarefas e saúde
create or replace function public.merge_patient_records(
  p_drop_id text, p_drop_name text, p_keep_id text, p_keep_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
  n_rec int := 0;
  n_plan int := 0;
  n_task int := 0;
  v_keep jsonb; v_drop jsonb;
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
  if exists (select 1 from public.therapy_plans where patient_id = p_keep_id and status = 'vigente')
     and exists (select 1 from public.therapy_plans where patient_id = p_drop_id and status = 'vigente') then
    raise exception 'Os dois pacientes têm Plano Terapêutico vigente: encerre ou exclua um deles antes de mesclar.';
  end if;
  perform set_config('pipo.merging', '1', true);
  update public.appointments set patient = p_keep_name, patient_id = p_keep_id
    where not blocked and (patient_id = p_drop_id
       or (patient_id is null and group_id is null and lower(btrim(patient)) = lower(btrim(p_drop_name))));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_plan = row_count;
  update public.tasks set patient_id = p_keep_id where patient_id = p_drop_id;
  get diagnostics n_task = row_count;
  -- Saúde: o que o 1º tem preenchido fica; o que está vazio vem do 2º.
  select data into v_drop from public.patient_health where patient_id = p_drop_id;
  if v_drop is not null then
    select data into v_keep from public.patient_health where patient_id = p_keep_id;
    v_keep := coalesce(v_drop, '{}'::jsonb) || coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_keep, '{}'::jsonb))
       where value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)), '{}'::jsonb);
    insert into public.patient_health (patient_id, data) values (p_keep_id, v_keep)
      on conflict (patient_id) do update set data = excluded.data;
    delete from public.patient_health where patient_id = p_drop_id;
  end if;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan, 'tarefas', n_task, 'saude', true);
end;
$$;
revoke all on function public.merge_patient_records(text, text, text, text) from public;
grant execute on function public.merge_patient_records(text, text, text, text) to authenticated;

-- 2026-10-10g — status dos atendimentos protegidos
create or replace function public.statuses_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; v_new jsonb; n int;
begin
  if new.path <> 'config/statuses' or auth.uid() is null then return new; end if;
  for o in select x from jsonb_array_elements(coalesce(case when tg_op = 'UPDATE' then old.data -> 'list' end, '[]'::jsonb)) x loop
    v_new := null;
    select x into v_new from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id' limit 1;
    if o ->> 'id' in ('finalizado', 'nao-compareceu', 'falta-justificada') then
      if v_new is null then
        raise exception 'O status "%" é do sistema e não pode ser excluído.', o ->> 'name' using errcode = '42501';
      end if;
      if coalesce(v_new ->> 'name', '') is distinct from coalesce(o ->> 'name', '') then
        raise exception 'O status "%" é do sistema: só a cor pode mudar.', o ->> 'name' using errcode = '42501';
      end if;
    elsif v_new is null then
      select count(*) into n from public.appointments where status = o ->> 'id';
      if n > 0 then
        raise exception 'O status "%" está em % atendimento(s) da Agenda: troque o status deles antes de excluir.', o ->> 'name', n
          using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists statuses_guard on public.documents;
create trigger statuses_guard
  before update on public.documents
  for each row when (new.path = 'config/statuses')
  execute function public.statuses_guard();

-- 2026-10-10h — excluir Plano Terapêutico sem perder histórico
create or replace function public.therapy_plans_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if; -- SQL Editor / scripts
  if exists (select 1 from public.clinical_records c
              where jsonb_typeof(c.plan_goals) = 'array'
                and c.plan_goals @> jsonb_build_array(jsonb_build_object('planId', old.id::text))) then
    raise exception 'Este plano tem evoluções com objetivos avaliados e não pode ser excluído. Para mudar, use Revisar (nova versão).'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists therapy_plans_delete_guard on public.therapy_plans;
create trigger therapy_plans_delete_guard
  before delete on public.therapy_plans
  for each row execute function public.therapy_plans_delete_guard();

create or replace function public.therapy_plans_reopen_prev()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if old.status <> 'vigente' then return null; end if;
  if exists (select 1 from public.therapy_plans where patient_id = old.patient_id and status = 'vigente') then
    return null;
  end if;
  select id into v_id from public.therapy_plans
   where patient_id = old.patient_id and status = 'encerrado'
   order by (id = old.prev_id) desc, version desc, created_at desc
   limit 1;
  if v_id is not null then
    update public.therapy_plans set status = 'vigente' where id = v_id;
  end if;
  return null;
end $$;

drop trigger if exists therapy_plans_reopen_prev on public.therapy_plans;
create trigger therapy_plans_reopen_prev
  after delete on public.therapy_plans
  for each row execute function public.therapy_plans_reopen_prev();


-- ===== CRM: tarefa recorrente (2026-10-10i) =====
alter table public.tasks add column if not exists recurrence jsonb;

-- Próxima data de uma recorrência a partir de uma data
create or replace function public.crm_rec_next(p_from date, p_rec jsonb)
returns date language plpgsql immutable as $$
declare v_dias int[]; k int;
begin
  if p_rec ->> 'freq' = 'diaria' then return p_from + 1; end if;
  if p_rec ->> 'freq' = 'mensal' then return (p_from + interval '1 month')::date; end if;
  if p_rec ->> 'freq' = 'anual'  then return (p_from + interval '1 year')::date; end if;
  -- semanal: próximo dia da semana marcado (sem dias marcados: 7 dias depois)
  select coalesce(array_agg(x::int), '{}') into v_dias from jsonb_array_elements_text(coalesce(p_rec -> 'dias', '[]'::jsonb)) x;
  if coalesce(array_length(v_dias, 1), 0) = 0 then return p_from + 7; end if;
  for k in 1..7 loop
    if extract(dow from p_from + k)::int = any(v_dias) then return p_from + k; end if;
  end loop;
  return p_from + 7;
end $$;

-- status "done" de uma lista (config/task_lists)
create or replace function public.crm_status_done(p_list text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((s ->> 'done')::boolean, false)), false)
    from public.documents d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$$;

-- status da próxima: o escolhido, se ainda existir e não for finalizado; senão o 1º não finalizado da lista
create or replace function public.crm_rec_status(p_list text, p_want text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_want
        and not coalesce((s ->> 'done')::boolean, false) limit 1),
    (select s ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality s(s, i)
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and not coalesce((s ->> 'done')::boolean, false)
      order by i limit 1));
$$;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rec jsonb := new.recurrence;
  v_next date;
  v_st text;
begin
  if v_rec is null or jsonb_typeof(v_rec) <> 'object' or coalesce(v_rec ->> 'freq', '') = '' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if not public.crm_status_done(new.list_id, new.status) or public.crm_status_done(old.list_id, old.status) then return new; end if;

  v_next := public.crm_rec_next(coalesce(new.due_date, old.due_date, current_date), v_rec);
  if not coalesce((v_rec ->> 'sempre')::boolean, true) and nullif(v_rec ->> 'ate', '') is not null
     and v_next > (v_rec ->> 'ate')::date then
    return new;   -- acabou a recorrência: fica finalizada
  end if;
  v_st := public.crm_rec_status(new.list_id, v_rec ->> 'status');
  if v_st is null then return new; end if;

  if coalesce((v_rec ->> 'nova')::boolean, false) then
    insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, tags, patient_id, lead, position, recurrence)
    values (new.list_id, v_st, new.title, new.description, new.priority, v_next, new.assignees, new.tags, new.patient_id, new.lead, new.position, v_rec);
    new.recurrence := null;
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', true, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
  else
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', false, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
    new.status := v_st;
    new.due_date := v_next;
    new.closed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_recur on public.tasks;
create trigger tasks_recur before update of status on public.tasks
  for each row execute function public.tasks_recur();

-- ---------------------------------------------------------------------
-- CRM: lista ou status com tarefas não é excluído (2026-10-10j)
-- ---------------------------------------------------------------------
create or replace function public.task_lists_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; v_new jsonb; st jsonb; n int;
begin
  if new.path <> 'config/task_lists' or auth.uid() is null then return new; end if;
  for o in select x from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) x loop
    v_new := null;
    select x into v_new from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id' limit 1;
    if v_new is null then
      select count(*) into n from public.tasks where list_id = o ->> 'id';
      if n > 0 then
        raise exception 'A lista "%" tem % tarefa(s): exclua ou mova as tarefas antes de excluir a lista.', o ->> 'name', n
          using errcode = '42501';
      end if;
    else
      for st in select y from jsonb_array_elements(coalesce(o -> 'statuses', '[]'::jsonb)) y loop
        if not exists (select 1 from jsonb_array_elements(coalesce(v_new -> 'statuses', '[]'::jsonb)) z where z ->> 'id' = st ->> 'id') then
          select count(*) into n from public.tasks where list_id = o ->> 'id' and status = st ->> 'id';
          if n > 0 then
            raise exception 'O status "%" da lista "%" tem % tarefa(s): mude o status delas antes de excluir.', st ->> 'name', o ->> 'name', n
              using errcode = '42501';
          end if;
        end if;
      end loop;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists task_lists_guard on public.documents;
create trigger task_lists_guard
  before update on public.documents
  for each row when (new.path = 'config/task_lists')
  execute function public.task_lists_guard();

create or replace function public.crm_task_usage()
returns table(list_id text, status text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query select t.list_id, t.status, count(*) from public.tasks t group by t.list_id, t.status;
end $$;
grant execute on function public.crm_task_usage() to authenticated;
revoke execute on function public.crm_task_usage() from anon;

-- ---------------------------------------------------------------------
-- Renomear Diagnóstico/Origem/Convênio atualiza saúde e leads (2026-10-10k)
-- ---------------------------------------------------------------------
create or replace function public.rename_registry_text(p_kind text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_mod text; n_health int := 0; n_tasks int := 0;
begin
  v_key := case p_kind when 'diagnosticos' then 'diagnostico' when 'origens' then 'origem' when 'convenios' then 'convenio' end;
  v_mod := p_kind;
  if v_key is null then raise exception 'Cadastro desconhecido: %', p_kind using errcode = '22023'; end if;
  if not (public.is_admin() or public.has_perm(v_mod, 'edit')) then
    raise exception 'Seu nível não pode editar este cadastro.' using errcode = '42501';
  end if;
  if coalesce(trim(p_old), '') = '' or coalesce(trim(p_new), '') = '' or lower(trim(p_old)) = lower(trim(p_new)) then
    return jsonb_build_object('saude', 0, 'tarefas', 0);
  end if;
  if p_kind = 'diagnosticos' then
    update public.patient_health set data = jsonb_set(data, '{cid}', to_jsonb(trim(p_new)))
     where lower(trim(data ->> 'cid')) = lower(trim(p_old));
    get diagnostics n_health = row_count;
  end if;
  update public.tasks set lead = jsonb_set(lead, array[v_key], to_jsonb(trim(p_new)))
   where lead is not null and lower(trim(lead ->> v_key)) = lower(trim(p_old));
  get diagnostics n_tasks = row_count;
  return jsonb_build_object('saude', n_health, 'tarefas', n_tasks);
end $$;
grant execute on function public.rename_registry_text(text, text, text) to authenticated;
revoke execute on function public.rename_registry_text(text, text, text) from anon;

-- ---------------------------------------------------------------------
-- Usuário excluído sai dos responsáveis das tarefas (2026-10-10l)
-- ---------------------------------------------------------------------
create or replace function public.profiles_tasks_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set assignees = array_remove(assignees, old.id) where old.id = any(assignees);
  delete from public.task_reads where user_id = old.id;
  return old;
end $$;

drop trigger if exists profiles_tasks_cleanup on public.profiles;
create trigger profiles_tasks_cleanup
  after delete on public.profiles
  for each row execute function public.profiles_tasks_cleanup();

create or replace function public.crm_user_open_tasks(p_user uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_admin() or public.has_perm('usuarios', 'delete')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select count(*) into n from public.tasks
   where p_user = any(assignees) and not public.crm_status_done(list_id, status);
  return n;
end $$;
grant execute on function public.crm_user_open_tasks(uuid) to authenticated;
revoke execute on function public.crm_user_open_tasks(uuid) from anon;

-- Link de cadastro rápido (2026-10-10, migração 2026-10-10r-link-de-cadastro.sql)
--   intake_links (links: novo, atualizacao, crm, geral) e intake_submissions (envios, esperando revisão);
--   intake_form / intake_send: página pública cadastro.html (sem login); intake_remind: lembrete quando o link vence sem resposta.
create table if not exists public.intake_links (
  token           text primary key default replace(gen_random_uuid()::text, '-', ''),
  kind            text not null check (kind in ('novo', 'atualizacao', 'crm', 'geral')),
  patient_id      text,
  task_id         uuid references public.tasks(id) on delete set null,
  nome            text not null default '',
  telefone        text not null default '',
  prefill         jsonb not null default '{}'::jsonb,
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  used_at         timestamptz,
  canceled_at     timestamptz,
  reminded_at     timestamptz
);
create unique index if not exists intake_links_one_geral on public.intake_links (kind) where kind = 'geral' and canceled_at is null;

create table if not exists public.intake_submissions (
  id                uuid primary key default gen_random_uuid(),
  token             text references public.intake_links(token) on delete set null,
  kind              text not null,
  patient_id        text,
  task_id           uuid references public.tasks(id) on delete set null,
  data              jsonb not null default '{}'::jsonb,
  status            text not null default 'pendente' check (status in ('pendente', 'aprovado', 'descartado')),
  created_at        timestamptz not null default now(),
  reviewed_by       uuid,
  reviewed_by_name  text not null default '',
  reviewed_at       timestamptz,
  result_patient_id text
);
create index if not exists intake_submissions_status_idx on public.intake_submissions (status, created_at);

create or replace function public.intake_can()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('pacientes', 'create');
$$;

create or replace function public.intake_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.used_at := null; new.reminded_at := null;
    new.expires_at := case when new.kind = 'geral' then null else now() + interval '1 day' end;
  else
    -- Quem usa o app só pode cancelar ou mudar telefone/nome; uso e lembrete são marcados pelas funções.
    new.token := old.token; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.intake', true), '') <> '1' then new.used_at := old.used_at; new.reminded_at := old.reminded_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists intake_links_stamp on public.intake_links;
create trigger intake_links_stamp before insert or update on public.intake_links for each row execute function public.intake_links_stamp();

create or replace function public.intake_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_by_name := public.crm_my_name(); new.reviewed_at := now();
  end if;
  new.data := old.data; new.kind := old.kind; new.token := old.token; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists intake_submissions_stamp on public.intake_submissions;
create trigger intake_submissions_stamp before update on public.intake_submissions for each row execute function public.intake_submissions_stamp();

alter table public.intake_links enable row level security;
alter table public.intake_submissions enable row level security;
drop policy if exists intake_links_select on public.intake_links;
create policy intake_links_select on public.intake_links for select to authenticated using (public.intake_can());
drop policy if exists intake_links_insert on public.intake_links;
create policy intake_links_insert on public.intake_links for insert to authenticated with check (public.intake_can());
drop policy if exists intake_links_update on public.intake_links;
create policy intake_links_update on public.intake_links for update to authenticated using (public.intake_can()) with check (public.intake_can());
drop policy if exists intake_submissions_select on public.intake_submissions;
create policy intake_submissions_select on public.intake_submissions for select to authenticated using (public.intake_can());
drop policy if exists intake_submissions_update on public.intake_submissions;
create policy intake_submissions_update on public.intake_submissions for update to authenticated using (public.intake_can()) with check (public.intake_can());

-- Situação de um link (para a página pública).
create or replace function public.intake_link_state(l public.intake_links)
returns text language sql stable as $$
  select case when l.token is null then 'invalido' when l.canceled_at is not null then 'cancelado'
              when l.used_at is not null then 'usado' when l.expires_at is not null and l.expires_at < now() then 'vencido' else 'ok' end;
$$;

-- Lista de nomes de um cadastro em lista (ativos), para a página pública.
create or replace function public.intake_names(p_path text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) from (
    select distinct btrim(coalesce(e ->> 'name', e ->> 'nome', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = p_path and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
$$;

create or replace function public.intake_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select data into c from public.documents where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'campos', coalesce(cf, '{}'::jsonb));
end $$;

create or replace function public.intake_send(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l public.intake_links; st text; k text; v text; clean jsonb := '{}'::jsonb; tid uuid; lst text; sts text; cf jsonb; fk text; miss text[] := '{}';
  keys text[] := array['nome', 'nascimento', 'cpf', 'sexo', 'respNome', 'respParentesco', 'telefone', 'email', 'cep', 'rua', 'numero',
                       'compl', 'bairro', 'cidade', 'uf', 'convenio', 'diagnostico', 'laudo', 'escola', 'escolaTurno', 'comoConheceu', 'obs',
                       'rg', 'cns', 'entrada', 'respProfissao', 'convenioOutro', 'maeNome', 'maeCpf', 'maeProfissao', 'paiNome', 'paiCpf', 'paiProfissao',
                       'finNome', 'finDoc', 'finTelefone', 'finEmail', 'escolaSerie', 'professor', 'mediador', 'medico',
                       'diagData', 'suporte', 'comunicacao', 'alergias', 'medicacoes', 'restricoes', 'telNome', 'finQuem',
                       'plano', 'carteirinha', 'carteirinhaValidade'];
  lk text; it jsonb; arr jsonb; o jsonb; ra jsonb := '{}'::jsonb; dd text; pp text; cell jsonb;
begin
  select * into l from public.intake_links where token = p_token for update;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 30000 then return jsonb_build_object('ok', false, 'motivo', 'dados'); end if;
  foreach k in array keys loop
    v := left(btrim(coalesce(p_data ->> k, '')), case when k = 'obs' then 2000 else 300 end);
    if v <> '' then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  -- Listas de pessoas (até 10, só nome/parentesco/telefone/observação) e rotina atual (seg..sex, manhã/tarde).
  foreach lk in array array['retirada', 'protetiva'] loop
    arr := '[]'::jsonb;
    if jsonb_typeof(p_data -> lk) = 'array' then
      for it in select x from jsonb_array_elements(p_data -> lk) with ordinality t(x, n) where jsonb_typeof(x) = 'object' order by n limit 10 loop
        o := '{}'::jsonb;
        foreach k in array array['nome', 'rel', 'telefone', 'obs'] loop
          v := left(btrim(coalesce(it ->> k, '')), 300);
          if v <> '' then o := o || jsonb_build_object(k, v); end if;
        end loop;
        if coalesce(o ->> 'nome', '') <> '' then arr := arr || jsonb_build_array(o); end if;
      end loop;
    end if;
    if jsonb_array_length(arr) > 0 then clean := clean || jsonb_build_object(lk, arr); end if;
  end loop;
  if jsonb_typeof(p_data -> 'rotinaAtual') = 'object' then
    foreach dd in array array['seg', 'ter', 'qua', 'qui', 'sex'] loop
      foreach pp in array array['m', 't'] loop
        cell := p_data -> 'rotinaAtual' -> dd -> pp;
        if jsonb_typeof(cell) = 'object' and (cell ->> 'tipo') in ('escola', 'pipo', 'terapia', 'atividade', 'casa', 'outro') then
          o := jsonb_build_object('tipo', cell ->> 'tipo');
          if btrim(coalesce(cell ->> 'txt', '')) <> '' then o := o || jsonb_build_object('txt', left(btrim(cell ->> 'txt'), 120)); end if;
          ra := jsonb_set(case when ra ? dd then ra else ra || jsonb_build_object(dd, '{}'::jsonb) end, array[dd, pp], o);
        end if;
      end loop;
    end loop;
    if ra <> '{}'::jsonb then clean := clean || jsonb_build_object('rotinaAtual', ra); end if;
  end if;
  if coalesce((p_data ->> 'consentimento')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'motivo', 'obrigatorio');
  end if;
  -- Nome e telefone podem ser escolhidos em Campos obrigatórios; o envio precisa ter pelo menos um dado que identifique.
  if coalesce(clean ->> 'nome', '') = '' and coalesce(clean ->> 'telefone', '') = '' and coalesce(clean ->> 'cpf', '') = '' and coalesce(clean ->> 'email', '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'vazio');
  end if;
  -- Obrigatórios escolhidos em Campos obrigatórios (config/patient_fields.link.individual | geral).
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  if jsonb_typeof(cf) is distinct from 'object' then cf := '{"nascimento": {"req": true}, "cpf": {"req": true}}'::jsonb; end if;
  -- Configuração gravada antes de nome/telefone serem escolhíveis: continuam obrigatórios.
  if not cf ? 'nome' then cf := cf || '{"nome": {"req": true}}'::jsonb; end if;
  if not cf ? 'telefone' then cf := cf || '{"telefone": {"req": true}}'::jsonb; end if;
  for fk in select key from jsonb_each(cf) where coalesce((value ->> 'req')::boolean, false) loop
    if fk = 'responsavel' then
      null;   -- "Responsável e parentesco" saiu do link (2026-10-11): os dados vêm de Mãe, Pai, Contato e Financeiro.
    elsif fk = 'endereco' then
      if coalesce(clean ->> 'cep', '') = '' or coalesce(clean ->> 'numero', '') = '' or coalesce(clean ->> 'rua', '') = '' or coalesce(clean ->> 'cidade', '') = '' then miss := miss || fk; end if;
    elsif fk = 'mae' then
      if coalesce(clean ->> 'maeNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'pai' then
      if coalesce(clean ->> 'paiNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'financeiro' then
      if coalesce(clean ->> 'finNome', '') = '' and not (clean ->> 'finQuem' = 'Mãe' and coalesce(clean ->> 'maeNome', '') <> '')
         and not (clean ->> 'finQuem' = 'Pai' and coalesce(clean ->> 'paiNome', '') <> '') then miss := miss || fk; end if;
    elsif fk = 'rotina' then
      if not clean ? 'retirada' then miss := miss || fk; end if;
    elsif fk in ('protetiva', 'rotinaAtual') then
      if not clean ? fk then miss := miss || fk; end if;
    elsif fk = any(keys) and coalesce(clean ->> fk, '') = '' then miss := miss || fk;
    end if;
  end loop;
  if array_length(miss, 1) > 0 then return jsonb_build_object('ok', false, 'motivo', 'obrigatorio', 'campos', to_jsonb(miss)); end if;
  clean := clean || jsonb_build_object('consentimento', true, 'consentimentoEm', now());
  if l.kind = 'geral' and (select count(*) from public.intake_submissions where kind = 'geral' and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  tid := l.task_id;
  if l.kind = 'geral' then
    -- Lead novo no CRM: lista Atendimento (ou a primeira lista de atendimento), primeiro status.
    select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
      from public.documents d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, n)
     where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
     order by (e ->> 'id' = 'atendimento') desc, n limit 1;
    if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
    insert into public.tasks (list_id, status, title, description, lead, created_by_name)
    values (lst, coalesce(sts, 'triagem'), 'Cadastro pelo link: ' || coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome'),
            'Cadastro enviado pelo link da clínica. Revise em Cadastros → Pacientes → Revisar cadastro.',
            jsonb_strip_nulls(jsonb_build_object('nome', clean ->> 'nome', 'telefone', regexp_replace(clean ->> 'telefone', '\D', '', 'g'),
                                                 'diagnostico', clean ->> 'diagnostico', 'convenio', clean ->> 'convenio')),
            'Link de cadastro')
    returning id into tid;
  end if;
  if tid is not null then
    insert into public.task_events (task_id, kind, data, author_name)
    values (tid, 'field', jsonb_build_object('campo', 'cadastro_link', 'para', coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome')), 'Família (link de cadastro)');
  end if;
  insert into public.intake_submissions (token, kind, patient_id, task_id, data)
  values (l.token, l.kind, l.patient_id, tid, clean);
  if l.kind <> 'geral' then
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set used_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
  end if;
  return jsonb_build_object('ok', true);
end $$;
-- Lembrete: link individual que venceu (1 dia) sem ser preenchido → tarefa no CRM (uma vez por link).
create or replace function public.intake_remind()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare l public.intake_links; lst text; sts text; n integer := 0;
begin
  if not public.intake_can() then return 0; end if;
  select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
    from public.documents d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, k)
   where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
   order by (e ->> 'id' = 'atendimento') desc, k limit 1;
  if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null and reminded_at is null
              and expires_at is not null and expires_at < now() for update skip locked loop
    insert into public.tasks (list_id, status, title, description, due_date, assignees, patient_id, lead)
    values (lst, coalesce(sts, 'triagem'), 'Cobrar cadastro pelo link: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
            'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || coalesce(' por ' || nullif(l.created_by_name, ''), '') || ' venceu sem ser preenchido. Cobre a família e envie um novo link.' ||
              case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
            current_date,
            case when l.created_by is not null and public.crm_user_can(l.created_by, lst) then array[l.created_by] else '{}'::uuid[] end,
            l.patient_id,
            case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end);
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set reminded_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.intake_form(text) from public;
revoke all on function public.intake_send(text, jsonb) from public;
grant execute on function public.intake_form(text) to anon, authenticated;
grant execute on function public.intake_send(text, jsonb) to anon, authenticated;
grant execute on function public.intake_remind() to authenticated;

-- Tempo real: o aviso no botão Cadastros acompanha os envios.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intake_submissions') then
    alter publication supabase_realtime add table public.intake_submissions;
  end if;
end $$;

-- =====================================================================
-- (2026-10-10v) Revisão geral do sistema (2026-10-10). Pode rodar de novo sem problema.
-- 1. Backup do CRM: restaurar tarefas, comentários/histórico e links de cadastro
--    mantendo datas e autores originais (função backup_restore_crm, só para o
--    servidor — api/admin-backup.js — e os gatilhos param de carimbar durante a
--    restauração, com a marca pipo.restore).
-- 2. Apaga a tabela antiga planner_backups (cópia do Planner de 02/10, sem uso).
-- 3. Segurança: quem não fez login não pode chamar as funções internas do banco
--    (continuam liberadas só as da página do link de cadastro); 5 funções com o
--    caminho de busca fixo.
-- 4. Velocidade: 6 regras de acesso calculam o usuário uma vez por consulta.
-- =====================================================================

-- 1. Gatilhos do CRM e do link de cadastro: durante a restauração, mantêm o que veio.
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  return new;
end $$;

create or replace function public.tasks_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  v_name := public.crm_my_name();
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
  if new.patient_id is not null and new.patient_id is distinct from old.patient_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'paciente', 'de', nullif(btrim(coalesce(old.lead ->> 'nome', '')), ''), 'para', new.patient_id), auth.uid(), v_name);
  end if;
  return new;
end $$;

create or replace function public.tasks_assignees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; nm text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  foreach u in array coalesce(new.assignees, '{}'::uuid[]) loop
    if tg_op = 'INSERT' or new.list_id is distinct from old.list_id
       or not (u = any(coalesce(old.assignees, '{}'::uuid[]))) then
      if not public.crm_user_can(u, new.list_id) then
        select full_name into nm from public.profiles where id = u;
        raise exception '% não tem acesso ao CRM ou a esta lista e não pode ser responsável pela tarefa.', coalesce(nm, 'Esta pessoa');
      end if;
    end if;
  end loop;
  return new;
end $$;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rec jsonb := new.recurrence;
  v_next date;
  v_st text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if v_rec is null or jsonb_typeof(v_rec) <> 'object' or coalesce(v_rec ->> 'freq', '') = '' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if not public.crm_status_done(new.list_id, new.status) or public.crm_status_done(old.list_id, old.status) then return new; end if;

  v_next := public.crm_rec_next(coalesce(new.due_date, old.due_date, current_date), v_rec);
  if not coalesce((v_rec ->> 'sempre')::boolean, true) and nullif(v_rec ->> 'ate', '') is not null
     and v_next > (v_rec ->> 'ate')::date then
    return new;   -- acabou a recorrência: fica finalizada
  end if;
  v_st := public.crm_rec_status(new.list_id, v_rec ->> 'status');
  if v_st is null then return new; end if;

  if coalesce((v_rec ->> 'nova')::boolean, false) then
    insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, tags, patient_id, lead, position, recurrence)
    values (new.list_id, v_st, new.title, new.description, new.priority, v_next, new.assignees, new.tags, new.patient_id, new.lead, new.position, v_rec);
    new.recurrence := null;
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', true, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
  else
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', false, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
    new.status := v_st;
    new.due_date := v_next;
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function public.task_events_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if old.kind <> 'comment' then raise exception 'Só comentários podem ser editados.'; end if;
  new.id := old.id; new.task_id := old.task_id; new.kind := old.kind; new.data := old.data;
  new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then new.edited_at := now();
  else new.edited_at := old.edited_at; end if;
  return new;
end $$;

create or replace function public.intake_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.used_at := null; new.reminded_at := null;
    new.expires_at := case when new.kind = 'geral' then null else now() + interval '1 day' end;
  else
    -- Quem usa o app só pode cancelar ou mudar telefone/nome; uso e lembrete são marcados pelas funções.
    new.token := old.token; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.intake', true), '') <> '1' then new.used_at := old.used_at; new.reminded_at := old.reminded_at; end if;
  end if;
  return new;
end $$;

create or replace function public.intake_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_by_name := public.crm_my_name(); new.reviewed_at := now();
  end if;
  new.data := old.data; new.kind := old.kind; new.token := old.token; new.created_at := old.created_at;
  return new;
end $$;

-- Restauração do CRM e dos links (chamada só pelo servidor, com a chave secreta).
-- Acrescenta ou sobrescreve pelo código; nada criado depois do backup é apagado.
create or replace function public.backup_restore_crm(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  perform set_config('pipo.restore', '1', true);
  if p_table = 'tasks' then
    insert into public.tasks (id, list_id, status, title, description, priority, due_date, assignees, tags, patient_id,
                              lead, position, created_by, created_by_name, created_at, updated_at, closed_at, recurrence)
    select r.id, r.list_id, r.status, r.title, coalesce(r.description, ''), coalesce(r.priority, 'normal'), r.due_date,
           coalesce(r.assignees, '{}'), coalesce(r.tags, '{}'), r.patient_id, coalesce(r.lead, '{}'::jsonb),
           coalesce(r.position, 0), r.created_by, r.created_by_name, coalesce(r.created_at, now()),
           coalesce(r.updated_at, now()), r.closed_at, r.recurrence
      from jsonb_populate_recordset(null::public.tasks, p_rows) r
     where r.id is not null and r.list_id is not null and r.status is not null and r.title is not null
    on conflict (id) do update set
      list_id = excluded.list_id, status = excluded.status, title = excluded.title, description = excluded.description,
      priority = excluded.priority, due_date = excluded.due_date, assignees = excluded.assignees, tags = excluded.tags,
      patient_id = excluded.patient_id, lead = excluded.lead, position = excluded.position, created_by = excluded.created_by,
      created_by_name = excluded.created_by_name, created_at = excluded.created_at, updated_at = excluded.updated_at,
      closed_at = excluded.closed_at, recurrence = excluded.recurrence;
  elsif p_table = 'task_events' then
    insert into public.task_events (id, task_id, kind, body, data, mentions, author_id, author_name, created_at, edited_at)
    select r.id, r.task_id, r.kind, coalesce(r.body, ''), coalesce(r.data, '{}'::jsonb), coalesce(r.mentions, '{}'),
           r.author_id, r.author_name, coalesce(r.created_at, now()), r.edited_at
      from jsonb_populate_recordset(null::public.task_events, p_rows) r
     where r.id is not null and r.kind is not null and exists (select 1 from public.tasks t where t.id = r.task_id)
    on conflict (id) do update set
      task_id = excluded.task_id, kind = excluded.kind, body = excluded.body, data = excluded.data, mentions = excluded.mentions,
      author_id = excluded.author_id, author_name = excluded.author_name, created_at = excluded.created_at, edited_at = excluded.edited_at;
  elsif p_table = 'intake_links' then
    insert into public.intake_links (token, kind, patient_id, task_id, nome, telefone, prefill, created_by, created_by_name,
                                     created_at, expires_at, used_at, canceled_at, reminded_at)
    select r.token, r.kind, r.patient_id, (select t.id from public.tasks t where t.id = r.task_id), coalesce(r.nome, ''),
           coalesce(r.telefone, ''), coalesce(r.prefill, '{}'::jsonb), r.created_by, coalesce(r.created_by_name, ''),
           coalesce(r.created_at, now()), r.expires_at, r.used_at,
           -- um link geral antigo não pode tirar o lugar do link geral ativo de hoje
           case when r.kind = 'geral' and r.canceled_at is null
                     and exists (select 1 from public.intake_links g where g.kind = 'geral' and g.canceled_at is null and g.token <> r.token)
                then now() else r.canceled_at end,
           r.reminded_at
      from jsonb_populate_recordset(null::public.intake_links, p_rows) r
     where r.token is not null and r.kind is not null
    on conflict (token) do update set
      patient_id = excluded.patient_id, task_id = excluded.task_id, nome = excluded.nome, telefone = excluded.telefone,
      prefill = excluded.prefill, created_by = excluded.created_by, created_by_name = excluded.created_by_name,
      created_at = excluded.created_at, expires_at = excluded.expires_at, used_at = excluded.used_at,
      canceled_at = excluded.canceled_at, reminded_at = excluded.reminded_at;
  elsif p_table = 'intake_submissions' then
    insert into public.intake_submissions (id, token, kind, patient_id, task_id, data, status, created_at, reviewed_by,
                                           reviewed_by_name, reviewed_at, result_patient_id)
    select r.id, (select l.token from public.intake_links l where l.token = r.token), r.kind, r.patient_id,
           (select t.id from public.tasks t where t.id = r.task_id), coalesce(r.data, '{}'::jsonb), coalesce(r.status, 'pendente'),
           coalesce(r.created_at, now()), r.reviewed_by, coalesce(r.reviewed_by_name, ''), r.reviewed_at, r.result_patient_id
      from jsonb_populate_recordset(null::public.intake_submissions, p_rows) r
     where r.id is not null and r.kind is not null
    on conflict (id) do update set
      token = excluded.token, kind = excluded.kind, patient_id = excluded.patient_id, task_id = excluded.task_id,
      data = excluded.data, status = excluded.status, created_at = excluded.created_at, reviewed_by = excluded.reviewed_by,
      reviewed_by_name = excluded.reviewed_by_name, reviewed_at = excluded.reviewed_at, result_patient_id = excluded.result_patient_id;
  else
    raise exception 'Tabela inválida para restaurar: %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backup_restore_crm(text, jsonb) from public, anon, authenticated;
grant execute on function public.backup_restore_crm(text, jsonb) to service_role;

-- 2. Cópia antiga do Planner (02/10/2026), sem uso no sistema.
drop table if exists public.planner_backups;

-- 3a. Quem não fez login não chama as funções internas. A página pública do link de
--     cadastro usa só intake_form e intake_send (e intake_link_state por dentro).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and pg_get_userbyid(p.proowner) = current_user
              and p.proname not in ('intake_form', 'intake_send', 'intake_link_state', 'backup_restore_crm')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- funções criadas daqui em diante também nascem fechadas para quem não fez login
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- 3b. Caminho de busca fixo (aviso de segurança do Supabase).
alter function public.treatments_one_active() set search_path = public;
alter function public.treatments_cancel_rules() set search_path = public;
alter function public.module_for_path(text) set search_path = public;
alter function public.crm_rec_next(date, jsonb) set search_path = public;
alter function public.intake_link_state(public.intake_links) set search_path = public;

-- 4. Velocidade: (select auth.uid()) é calculado uma vez por consulta.
drop policy if exists clinical_records_update on public.clinical_records;
create policy clinical_records_update on public.clinical_records
  for update to authenticated
  using (public.has_perm('prontuario', 'edit') and author_id = (select auth.uid()))
  with check (public.has_perm('prontuario', 'edit') and author_id = (select auth.uid()));
drop policy if exists clinical_records_delete on public.clinical_records;
create policy clinical_records_delete on public.clinical_records
  for delete to authenticated
  using (public.is_admin() or (public.has_perm('prontuario', 'delete') and author_id = (select auth.uid())));
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin() or public.has_perm('usuarios', 'view'));
drop policy if exists task_events_delete on public.task_events;
create policy task_events_delete on public.task_events for delete to authenticated
  using (kind = 'comment' and (author_id = (select auth.uid()) or public.is_admin()));
drop policy if exists task_reads_own on public.task_reads;
create policy task_reads_own on public.task_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists task_events_update on public.task_events;
create policy task_events_update on public.task_events for update to authenticated
  using (kind = 'comment' and author_id = (select auth.uid()))
  with check (kind = 'comment' and author_id = (select auth.uid()));

-- =====================================================================
-- Conector Claude (servidor MCP) — Etapa 0 (2026-10-10). Pode rodar de novo.
-- Tudo roda COMO O PRÓPRIO USUÁRIO (security invoker): valem o nível de
-- permissão, as regras de acesso (RLS) e os gatilhos de sempre. O conector
-- só chama estas funções; nada é gravado "cru" no banco.
--  1. Origem nas atividades: evento feito por um aplicativo conectado (login
--     OAuth, ex.: Claude) ganha {"origem": "conector", "app": "Claude"}.
--  2. Data de finalização (closed_at) coerente com o status, sempre (antes só a tela cuidava).
--  3. Leitura: crm_listas_mcp, crm_tarefas_listar, crm_tarefa_obter, pacientes_buscar.
--  4. Escrita: crm_tarefa_criar, crm_tarefas_alterar (status, vencimento, prioridade,
--     responsáveis, paciente; até 50 por vez; devolve antes e depois),
--     crm_comentar, pacientes_definir_inativo (pela patch_list2, como a tela).
--  5. Permissão "Conector Claude" (conector_claude.view; Administrador sempre),
--     registro das chamadas (mcp_calls, sem nomes nem textos) e limite por minuto.
-- Nada é excluído por estas funções.
-- =====================================================================

-- normalização para busca: minúsculas e sem acento (igual ao normText do app)
create or replace function public.pipo_norm(p text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(normalize(coalesce(p, ''), NFD), '[̀-ͯ]', '', 'g'));
$$;

-- 1. Aplicativo que fez o login (token OAuth traz client_id). Vazio = o próprio sistema.
create or replace function public.pipo_origem()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_claims jsonb; v_cid text; v_nome text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null;
  end;
  v_cid := v_claims ->> 'client_id';
  if v_cid is null or v_cid = '' then return '{}'::jsonb; end if;
  begin
    execute 'select client_name from auth.oauth_clients where id::text = $1' into v_nome using v_cid;
  exception when others then v_nome := null;
  end;
  return jsonb_build_object('origem', 'conector', 'app', coalesce(nullif(v_nome, ''), 'Aplicativo conectado'));
end $$;

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  new.data := coalesce(new.data, '{}'::jsonb) || public.pipo_origem();
  return new;
end $$;

-- 2. Finalizado = closed_at preenchido; qualquer outro status = vazio.
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  if public.crm_status_done(new.list_id, new.status) then
    if new.closed_at is null then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;

-- 5. Permissão, registro e limite
create table if not exists public.mcp_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid(),
  ferramenta text not null,
  ok         boolean not null default true,
  ids        text[] not null default '{}',
  erro       text,
  app        text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_calls_user_idx on public.mcp_calls (user_id, created_at desc);
alter table public.mcp_calls enable row level security;
drop policy if exists mcp_calls_insert on public.mcp_calls;
create policy mcp_calls_insert on public.mcp_calls for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists mcp_calls_select on public.mcp_calls;
create policy mcp_calls_select on public.mcp_calls for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Pode usar o conector? {ok, motivo}. Confere usuário ativo, permissão e limite (60 por minuto).
create or replace function public.mcp_permitido()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not public.is_active_user() then
    return jsonb_build_object('ok', false, 'motivo', 'Usuário inativo ou sem login.');
  end if;
  if not (public.is_admin() or public.has_perm('conector_claude', 'view')) then
    return jsonb_build_object('ok', false, 'motivo', 'Seu nível de permissão não tem acesso ao Conector Claude (Acesso → Usuários → Níveis de permissão).');
  end if;
  select count(*) into n from public.mcp_calls where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if n >= 60 then
    return jsonb_build_object('ok', false, 'motivo', 'Muitas chamadas em pouco tempo (limite de 60 por minuto). Tente de novo em instantes.');
  end if;
  return jsonb_build_object('ok', true, 'usuario', public.crm_my_name());
end $$;

create or replace function public.mcp_registrar(p_ferramenta text, p_ok boolean, p_ids text[], p_erro text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into public.mcp_calls (ferramenta, ok, ids, erro, app)
  values (left(p_ferramenta, 60), coalesce(p_ok, true), coalesce(p_ids[1:50], '{}'), left(p_erro, 300),
          public.pipo_origem() ->> 'app');
end $$;

-- ---------------------------------------------------------------------
-- 3. Leitura
-- ---------------------------------------------------------------------
-- Listas e status que a pessoa vê (status reais do cadastro, na ordem do quadro).
create or replace function public.crm_listas_mcp()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l ->> 'id', 'nome', l ->> 'name',
           'funil', coalesce((l ->> 'lead')::boolean, false),
           'status', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s ->> 'id', 'nome', s ->> 'name',
                        'finalizado', coalesce((s ->> 'done')::boolean, false),
                        'perda', coalesce((s ->> 'lost')::boolean, false)) order by o), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality as x(s, o))
         ) order by lo), '[]'::jsonb)
    from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as y(l, lo)
   where d.path = 'config/task_lists' and (public.is_admin() or public.has_perm('crm_' || (l ->> 'id'), 'view'));
$$;

-- nome do paciente pelo código (documento patients/all)
create or replace function public.pipo_paciente_nome(p_id text)
returns text language sql stable security invoker set search_path = public as $$
  select p ->> 'nome' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and p ->> 'id' = p_id limit 1;
$$;

-- linha resumida de uma tarefa (usada na lista e no "antes/depois")
create or replace function public.crm_tarefa_json(t public.tasks)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'lista', t.list_id, 'status', t.status,
    'status_nome', (select s ->> 'name' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
                      jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
                     where d.path = 'config/task_lists' and l ->> 'id' = t.list_id and s ->> 'id' = t.status limit 1),
    'finalizada', t.closed_at is not null,
    'titulo', t.title, 'prioridade', case when t.priority = 'baixa' then 'normal' else t.priority end,
    'vencimento', t.due_date,
    'atrasada', t.closed_at is null and t.due_date is not null and t.due_date < current_date,
    'responsaveis', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name) order by p.full_name)
                                from public.crm_people() p where p.id = any(t.assignees)), '[]'::jsonb),
    'paciente', case when t.patient_id is not null
                     then jsonb_build_object('id', t.patient_id, 'nome', public.pipo_paciente_nome(t.patient_id)) end,
    'lead', case when t.patient_id is null and coalesce(t.lead ->> 'nome', '') <> '' then t.lead ->> 'nome' end,
    'atualizada_em', t.updated_at);
$$;

-- Lista de tarefas com filtros (jsonb):
-- {lista, status, responsavel: uuid|"eu"|"ninguem", prazo_de, prazo_ate, atrasadas, texto,
--  patient_id, incluir_finalizadas, limite (1–200, padrão 50)}
create or replace function public.crm_tarefas_listar(p_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_lim int := least(greatest(coalesce((f ->> 'limite')::int, 50), 1), 200);
  v_resp text := nullif(f ->> 'responsavel', '');
  v_txt text := public.pipo_norm(nullif(f ->> 'texto', ''));
  v_tot int; v_rows jsonb;
begin
  with base as (
    select t.* from public.tasks t
     where (nullif(f ->> 'lista', '') is null or t.list_id = f ->> 'lista')
       and (nullif(f ->> 'status', '') is null or t.status = f ->> 'status')
       and (coalesce((f ->> 'incluir_finalizadas')::boolean, false) or nullif(f ->> 'status', '') is not null or t.closed_at is null)
       and (v_resp is null
            or (v_resp = 'eu' and auth.uid() = any(t.assignees))
            or (v_resp = 'ninguem' and cardinality(t.assignees) = 0)
            or (case when v_resp ~ '^[0-9a-fA-F-]{36}$' then v_resp::uuid end) = any(t.assignees))
       and (nullif(f ->> 'prazo_de', '') is null or t.due_date >= (f ->> 'prazo_de')::date)
       and (nullif(f ->> 'prazo_ate', '') is null or t.due_date <= (f ->> 'prazo_ate')::date)
       and (not coalesce((f ->> 'atrasadas')::boolean, false) or (t.closed_at is null and t.due_date < current_date))
       and (nullif(f ->> 'patient_id', '') is null or t.patient_id = f ->> 'patient_id')
       and (v_txt is null or v_txt = '' or public.pipo_norm(t.title || ' ' || t.description || ' ' || coalesce(t.lead ->> 'nome', '')
                                   || ' ' || coalesce(public.pipo_paciente_nome(t.patient_id), '')) like '%' || v_txt || '%')
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public.crm_tarefa_json(b) order by b.due_date nulls last, b.updated_at desc)
                     from (select * from base order by due_date nulls last, updated_at desc limit v_lim) b), '[]'::jsonb)
    into v_tot, v_rows;
  return jsonb_build_object('total', v_tot, 'mostradas', jsonb_array_length(v_rows), 'tarefas', v_rows);
end $$;

-- Uma tarefa com descrição, dados do lead, comentários e histórico (até 300 eventos).
create or replace function public.crm_tarefa_obter(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_id;
  if not found then raise exception 'Tarefa não encontrada ou sem acesso.'; end if;
  return public.crm_tarefa_json(t) || jsonb_build_object(
    'descricao', t.description,
    'dados_lead', case when t.patient_id is null then t.lead - 'clickup' end,
    'recorrencia', t.recurrence,
    'criada_por', t.created_by_name, 'criada_em', t.created_at, 'finalizada_em', t.closed_at,
    'atividade', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'tipo', e.kind, 'texto', nullif(e.body, ''), 'dados', e.data,
        'mencoes', (select coalesce(jsonb_agg(p.full_name), '[]'::jsonb) from public.crm_people() p where p.id = any(e.mentions)),
        'autor', e.author_name, 'em', e.created_at, 'editado_em', e.edited_at) order by e.created_at)
      from (select * from public.task_events where task_id = p_id order by created_at desc limit 300) e), '[]'::jsonb));
end $$;

-- Busca de paciente por nome (sem acento/maiúscula). Exige "ver" em Pacientes.
create or replace function public.pacientes_buscar(p_texto text, p_limite int default 20, p_incluir_inativos boolean default true)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_q text := public.pipo_norm(p_texto);
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'view')) then
    raise exception 'Seu nível de permissão não pode ver Pacientes.';
  end if;
  if length(v_q) < 2 then raise exception 'Digite pelo menos 2 letras do nome.'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'nome') from (
      select jsonb_build_object(
        'id', p ->> 'id', 'nome', p ->> 'nome',
        'inativo', coalesce((p ->> 'inativo')::boolean, false),
        'nascimento', p ->> 'nascimento',
        'telefones', coalesce((select jsonb_agg(jsonb_build_object('numero', tl ->> 'numero', 'nome', tl ->> 'nome', 'via', tl ->> 'via'))
                                 from jsonb_array_elements(coalesce(p -> 'telefones', '[]'::jsonb)) tl), '[]'::jsonb),
        'emails', coalesce((select jsonb_agg(em ->> 'email') from jsonb_array_elements(coalesce(p -> 'emails', '[]'::jsonb)) em), '[]'::jsonb),
        'mae', p -> 'mae' ->> 'nome', 'pai', p -> 'pai' ->> 'nome') as x
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
      where d.path = 'patients/all'
        and public.pipo_norm(p ->> 'nome') like '%' || v_q || '%'
        and (coalesce(p_incluir_inativos, true) or not coalesce((p ->> 'inativo')::boolean, false))
      limit least(greatest(coalesce(p_limite, 20), 1), 50)) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Escrita
-- ---------------------------------------------------------------------
-- status da lista (null = não existe)
create or replace function public.crm_status_info(p_list text, p_status text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select s from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status limit 1;
$$;

-- Nova tarefa. p: {lista, titulo, descricao, status (padrão: 1º da lista), prioridade, vencimento,
-- responsaveis: [uuid], patient_id, lead_nome}
create or replace function public.crm_tarefa_criar(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_list text := nullif(p ->> 'lista', '');
  v_st text := nullif(p ->> 'status', '');
  v_pr text := coalesce(nullif(p ->> 'prioridade', ''), 'normal');
  v_tit text := btrim(coalesce(p ->> 'titulo', ''));
  v_ass uuid[] := '{}';
  v_pid text := nullif(p ->> 'patient_id', '');
  v_due date;
  t public.tasks;
begin
  if v_list is null or not exists (select 1 from jsonb_array_elements(public.crm_listas_mcp()) l where l ->> 'id' = v_list) then
    raise exception 'Lista inexistente ou sem acesso: %', coalesce(v_list, '(vazia)');
  end if;
  if v_tit = '' then raise exception 'O título é obrigatório.'; end if;
  if length(v_tit) > 300 then raise exception 'Título longo demais (máximo 300 caracteres).'; end if;
  if v_st is null then
    select s ->> 'id' into v_st from public.documents d, jsonb_array_elements(d.data -> 'list') l,
           jsonb_array_elements(l -> 'statuses') with ordinality as x(s, o)
     where d.path = 'config/task_lists' and l ->> 'id' = v_list order by o limit 1;
  elsif public.crm_status_info(v_list, v_st) is null then
    raise exception 'Status "%" não existe na lista %.', v_st, v_list;
  end if;
  if v_pr not in ('urgente', 'alta', 'normal') then raise exception 'Prioridade inválida: % (use urgente, alta ou normal).', v_pr; end if;
  if nullif(p ->> 'vencimento', '') is not null then
    begin v_due := (p ->> 'vencimento')::date; exception when others then raise exception 'Data de vencimento inválida: % (use AAAA-MM-DD).', p ->> 'vencimento'; end;
  end if;
  if jsonb_typeof(p -> 'responsaveis') = 'array' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_ass from jsonb_array_elements_text(p -> 'responsaveis') x;
  end if;
  if v_pid is not null and public.pipo_paciente_nome(v_pid) is null then raise exception 'Paciente não encontrado: %', v_pid; end if;
  insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, patient_id, lead)
  values (v_list, v_st, v_tit, left(coalesce(p ->> 'descricao', ''), 20000), v_pr, v_due, v_ass, v_pid,
          case when v_pid is null and nullif(btrim(coalesce(p ->> 'lead_nome', '')), '') is not null
               then jsonb_build_object('nome', btrim(p ->> 'lead_nome')) else '{}'::jsonb end)
  returning * into t;
  return jsonb_build_object('criada', public.crm_tarefa_json(t));
end $$;

-- Alteração em lote (até 50). p_campo: status | vencimento | prioridade | responsaveis | paciente.
-- p_valor: status = "id"; vencimento = "AAAA-MM-DD" ou null; prioridade = "urgente|alta|normal";
-- responsaveis = {"modo": "definir|adicionar|remover", "ids": [uuid]}; paciente = "id do paciente".
-- p_motivo: obrigatório ao ir para um status de perda (ex.: Cancelado) numa lista de funil.
-- Devolve {alteradas: [{id, titulo, antes, depois}], sem_mudanca: [...], erros: [{id, erro}]}.
create or replace function public.crm_tarefas_alterar(p_ids uuid[], p_campo text, p_valor jsonb, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; t public.tasks; n public.tasks;
  v_ok jsonb := '[]'::jsonb; v_same jsonb := '[]'::jsonb; v_err jsonb := '[]'::jsonb;
  v_st jsonb; v_due date; v_pr text; v_modo text; v_ids uuid[]; v_new uuid[]; v_pid text; v_lead jsonb;
  v_antes jsonb; v_depois jsonb; v_cnt int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Informe pelo menos uma tarefa.'; end if;
  if cardinality(p_ids) > 50 then raise exception 'No máximo 50 tarefas por vez (recebidas %).', cardinality(p_ids); end if;
  if p_campo not in ('status', 'vencimento', 'prioridade', 'responsaveis', 'paciente') then
    raise exception 'Campo inválido: %', p_campo;
  end if;
  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    begin
      select * into t from public.tasks where id = v_id;
      if not found then raise exception 'tarefa não encontrada ou sem acesso'; end if;
      n := t;
      if p_campo = 'status' then
        v_st := public.crm_status_info(t.list_id, p_valor #>> '{}');
        if v_st is null then raise exception 'status "%" não existe na lista %', p_valor #>> '{}', t.list_id; end if;
        n.status := v_st ->> 'id';
        if coalesce((v_st ->> 'lost')::boolean, false) and exists (
             select 1 from jsonb_array_elements(public.crm_listas_mcp()) l where l ->> 'id' = t.list_id and (l ->> 'funil')::boolean) then
          if nullif(btrim(coalesce(p_motivo, '')), '') is null and nullif(t.lead ->> 'motivoPerda', '') is null then
            raise exception 'informe o motivo da perda para o status "%"', v_st ->> 'name';
          end if;
          if nullif(btrim(coalesce(p_motivo, '')), '') is not null then
            n.lead := coalesce(t.lead, '{}'::jsonb) || jsonb_build_object('motivoPerda', left(btrim(p_motivo), 500));
          end if;
        end if;
        v_antes := jsonb_build_object('status', t.status); v_depois := jsonb_build_object('status', n.status);
      elsif p_campo = 'vencimento' then
        if p_valor is null or jsonb_typeof(p_valor) = 'null' or (p_valor #>> '{}') = '' then v_due := null;
        else begin v_due := (p_valor #>> '{}')::date; exception when others then raise exception 'data inválida (use AAAA-MM-DD)'; end;
        end if;
        n.due_date := v_due;
        v_antes := jsonb_build_object('vencimento', t.due_date); v_depois := jsonb_build_object('vencimento', v_due);
      elsif p_campo = 'prioridade' then
        v_pr := p_valor #>> '{}';
        if v_pr not in ('urgente', 'alta', 'normal') then raise exception 'prioridade inválida (use urgente, alta ou normal)'; end if;
        n.priority := v_pr;
        v_antes := jsonb_build_object('prioridade', t.priority); v_depois := jsonb_build_object('prioridade', v_pr);
      elsif p_campo = 'responsaveis' then
        v_modo := coalesce(p_valor ->> 'modo', 'definir');
        select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_valor -> 'ids', '[]'::jsonb)) x;
        if v_modo = 'definir' then v_new := v_ids;
        elsif v_modo = 'adicionar' then select coalesce(array_agg(distinct x), '{}') into v_new from unnest(t.assignees || v_ids) x;
        elsif v_modo = 'remover' then select coalesce(array_agg(x), '{}') into v_new from unnest(t.assignees) x where not (x = any(v_ids));
        else raise exception 'modo inválido (use definir, adicionar ou remover)'; end if;
        n.assignees := v_new;
        v_antes := jsonb_build_object('responsaveis', to_jsonb(t.assignees)); v_depois := jsonb_build_object('responsaveis', to_jsonb(v_new));
      else -- paciente
        v_pid := nullif(p_valor #>> '{}', '');
        if v_pid is null or public.pipo_paciente_nome(v_pid) is null then raise exception 'paciente não encontrado'; end if;
        n.patient_id := v_pid;
        v_antes := jsonb_build_object('patient_id', t.patient_id, 'lead', t.lead ->> 'nome');
        v_depois := jsonb_build_object('patient_id', v_pid, 'paciente', public.pipo_paciente_nome(v_pid));
      end if;
      if v_antes = v_depois and n.lead is not distinct from t.lead then
        v_same := v_same || jsonb_build_array(jsonb_build_object('id', t.id, 'titulo', t.title));
        continue;
      end if;
      update public.tasks set status = n.status, due_date = n.due_date, priority = n.priority,
                              assignees = n.assignees, patient_id = n.patient_id, lead = n.lead
       where id = t.id returning * into n;
      get diagnostics v_cnt = row_count;
      if v_cnt = 0 then raise exception 'sem permissão para editar tarefas da lista %', t.list_id; end if;
      v_ok := v_ok || jsonb_build_array(jsonb_build_object('id', t.id, 'titulo', t.title, 'antes', v_antes, 'depois', v_depois,
                                        'tarefa', public.crm_tarefa_json(n)));
    exception when others then
      v_err := v_err || jsonb_build_array(jsonb_build_object('id', v_id, 'erro', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('alteradas', v_ok, 'sem_mudanca', v_same, 'erros', v_err);
end $$;

-- Comentário (até 5000 caracteres; menções = ids de usuários ativos).
create or replace function public.crm_comentar(p_task uuid, p_texto text, p_mencoes uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_txt text := btrim(coalesce(p_texto, '')); v_men uuid[]; e public.task_events;
begin
  if v_txt = '' then raise exception 'O comentário está vazio.'; end if;
  if length(v_txt) > 5000 then raise exception 'Comentário longo demais (máximo 5000 caracteres).'; end if;
  if not exists (select 1 from public.tasks where id = p_task) then raise exception 'Tarefa não encontrada ou sem acesso.'; end if;
  select coalesce(array_agg(distinct p.id), '{}') into v_men from public.crm_people() p where p.id = any(coalesce(p_mencoes, '{}'));
  insert into public.task_events (task_id, kind, body, mentions) values (p_task, 'comment', v_txt, v_men) returning * into e;
  return jsonb_build_object('comentario_id', e.id, 'tarefa', p_task, 'autor', e.author_name, 'em', e.created_at,
                            'mencoes', (select coalesce(jsonb_agg(p.full_name), '[]'::jsonb) from public.crm_people() p where p.id = any(v_men)));
end $$;

-- Ativar/inativar pacientes (até 50): só o campo "inativo" (booleano), pela patch_list2 (mesmo
-- caminho da tela: confere "editar" em Pacientes e carimba quem mudou). Avisa tratamento ativo.
create or replace function public.pacientes_definir_inativo(p_ids text[], p_inativo boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_list jsonb; p jsonb; v_ups jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_same jsonb := '[]'::jsonb;
  v_err jsonb := '[]'::jsonb; v_id text; v_old boolean; v_trat boolean;
  v_upd jsonb := jsonb_build_object('por', public.crm_my_name(), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                 || public.pipo_origem();
begin
  if p_inativo is null then raise exception 'Informe inativo = true ou false.'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Informe pelo menos um paciente.'; end if;
  if cardinality(p_ids) > 50 then raise exception 'No máximo 50 pacientes por vez.'; end if;
  if not (public.is_admin() or public.has_perm('pacientes', 'edit')) then
    raise exception 'Seu nível de permissão não pode editar Pacientes.';
  end if;
  select coalesce(data -> 'list', '[]'::jsonb) into v_list from public.documents where path = 'patients/all';
  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select value into p from jsonb_array_elements(coalesce(v_list, '[]'::jsonb)) where value ->> 'id' = v_id limit 1;
    if p is null then v_err := v_err || jsonb_build_array(jsonb_build_object('id', v_id, 'erro', 'paciente não encontrado')); continue; end if;
    v_old := coalesce((p ->> 'inativo')::boolean, false);
    if v_old = p_inativo then v_same := v_same || jsonb_build_array(jsonb_build_object('id', v_id, 'nome', p ->> 'nome')); continue; end if;
    v_ups := v_ups || jsonb_build_array(p || jsonb_build_object('inativo', p_inativo, '_upd', v_upd));
    select exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
                    where d.path = 'treatments/all' and t ->> 'patientId' = v_id and t ->> 'status' = 'ativo') into v_trat;
    v_ok := v_ok || jsonb_build_array(jsonb_build_object('id', v_id, 'nome', p ->> 'nome',
              'antes', jsonb_build_object('inativo', v_old), 'depois', jsonb_build_object('inativo', p_inativo),
              'aviso', case when p_inativo and v_trat then 'O paciente tem tratamento ATIVO. O tratamento não foi alterado; cancele pelo sistema se for o caso.' end));
  end loop;
  if jsonb_array_length(v_ups) > 0 then
    perform public.patch_list2('patients/all', v_ups, '[]'::jsonb, '{}'::jsonb, null, true);
  end if;
  return jsonb_build_object('alterados', v_ok, 'sem_mudanca', v_same, 'erros', v_err);
end $$;

-- quem pode chamar
do $$
declare f text;
begin
  foreach f in array array[
    'public.pipo_norm(text)', 'public.pipo_origem()', 'public.mcp_permitido()', 'public.mcp_registrar(text, boolean, text[], text)',
    'public.crm_listas_mcp()', 'public.pipo_paciente_nome(text)', 'public.crm_tarefa_json(public.tasks)',
    'public.crm_tarefas_listar(jsonb)', 'public.crm_tarefa_obter(uuid)', 'public.pacientes_buscar(text, integer, boolean)',
    'public.crm_status_info(text, text)', 'public.crm_tarefa_criar(jsonb)', 'public.crm_tarefas_alterar(uuid[], text, jsonb, text)',
    'public.crm_comentar(uuid, text, uuid[])', 'public.pacientes_definir_inativo(text[], boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- 2026-10-11 — Notificações no celular/computador (Web Push)
-- Decisões do usuário: tarefas vencidas = 1 resumo por dia, às 8h de segunda a sexta, para cada
-- responsável; @menção = na hora, só para quem foi mencionado (quem escreveu não recebe); cada pessoa
-- liga no próprio aparelho em Acesso → Notificações e escolhe os avisos (vencidas, menções).
-- Quem envia é a Edge Function pipo-push. Pode rodar de novo.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) Aparelhos inscritos (um por navegador/app instalado). Cada pessoa só vê e mexe nos dela.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  prefs       jsonb not null default '{"vencidas": true, "mencoes": true}'::jsonb,
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
grant select, update, delete on public.push_subscriptions to service_role;

-- 2) Configuração privada do envio: senha interna do banco → função e chaves VAPID (criadas pela
--    própria função no primeiro uso; a chave privada nunca sai do servidor). Sem acesso pelo app.
create table if not exists public.push_config (
  id            integer primary key default 1 check (id = 1),
  secret        text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  vapid_public  text,
  vapid_private jsonb,
  updated_at    timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
grant select, update on public.push_config to service_role;
insert into public.push_config (id) values (1) on conflict (id) do nothing;

-- 3) Chama a função de envio (sem esperar a resposta; nunca impede a gravação de quem chamou).
create or replace function public.push_call(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  select secret into v_secret from public.push_config where id = 1;
  perform net.http_post(
    url := 'https://gnieydlriercezqowpqe.supabase.co/functions/v1/pipo-push',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pipo-push', v_secret),
    timeout_milliseconds := 8000);
exception when others then
  null;
end $$;
revoke execute on function public.push_call(jsonb) from public, anon, authenticated;

-- 4) @menção: comentário novo com menções → aviso na hora.
create or replace function public.task_events_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return null; end if;
  if new.kind = 'comment' and coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform public.push_call(jsonb_build_object('tipo', 'mencao', 'evento', new.id));
  end if;
  if new.kind in ('comment', 'status', 'field')
     and exists (select 1 from public.tasks where id = new.task_id and coalesce(array_length(followers, 1), 0) > 0) then
    perform public.push_call(jsonb_build_object('tipo', 'seguindo', 'evento', new.id));
  end if;
  return null;
end $$;
revoke execute on function public.task_events_push() from public, anon, authenticated;
drop trigger if exists task_events_push on public.task_events;
create trigger task_events_push after insert on public.task_events
  for each row execute function public.task_events_push();

-- 5) Dados que a função usa (só a função, com a chave de serviço).
-- Quem recebe a menção: mencionado ≠ autor, ativo e com acesso à lista da tarefa.
create or replace function public.push_mention_targets(p_event uuid)
returns table (user_id uuid, task_id uuid, title text, author text)
language sql stable security definer set search_path = public as $$
  select distinct m, t.id, t.title, coalesce(e.author_name, 'Alguém')
    from public.task_events e
    join public.tasks t on t.id = e.task_id
    cross join lateral unnest(e.mentions) m
   where e.id = p_event and e.kind = 'comment'
     and m is distinct from e.author_id
     and public.crm_user_can(m, t.list_id);
$$;
revoke execute on function public.push_mention_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_mention_targets(uuid) to service_role;

-- Vencidas por responsável: abertas (status que não finaliza), vencimento antes de hoje (Brasília).
create or replace function public.push_overdue_counts()
returns table (user_id uuid, n integer)
language sql stable security definer set search_path = public as $$
  select a, count(*)::integer
    from public.tasks t
    cross join lateral unnest(t.assignees) a
   where t.due_date < (now() at time zone 'America/Sao_Paulo')::date
     and not public.crm_status_done(t.list_id, t.status)
     and public.crm_user_can(a, t.list_id)
   group by a;
$$;
revoke execute on function public.push_overdue_counts() from public, anon, authenticated;
grant execute on function public.push_overdue_counts() to service_role;

-- 6) Resumo diário: 8h de Brasília (11h UTC), segunda a sexta.
select cron.unschedule(jobid) from cron.job where jobname = 'pipo-push-vencidas';
select cron.schedule('pipo-push-vencidas', '0 11 * * 1-5', $$select public.push_call('{"tipo": "vencidas"}'::jsonb)$$);

-- Cadastro de Fornecedores (2026-10-11)
--   config/suppliers  Cadastros → Fornecedores  (permissão "fornecedores")
--   {list:[{id, name, fantasia, documento, categoria, contato, telefone, email, endereco, pix, obs}]}
-- 1. caminho permitido  2. módulo do caminho  3. níveis começam com o mesmo acesso de Convênios.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
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
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
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

-- 3. Níveis: Fornecedores começa com o mesmo acesso de Convênios (o Administrador sempre tem tudo)
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('fornecedores', coalesce(permissions -> 'convenios', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'fornecedores');

-- Link de cadastro: lista de diagnósticos para "Possui diagnóstico? / Qual diagnóstico?" (2026-10-11)
-- A página pública passa a receber os diagnósticos cadastrados (Cadastros → Diagnósticos), sem os inativos.
-- Só substitui a função intake_form (os grants para a página do link continuam). Pode rodar de novo.

create or replace function public.intake_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select data into c from public.documents where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'code', '') || ' ' || coalesce(e ->> 'name', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'campos', coalesce(cf, '{}'::jsonb));
end $$;

create or replace function public.intake_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select data into c from public.documents where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'name', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'escolas', public.intake_names('config/schools'), 'medicos', public.intake_names('config/doctors'), 'campos', coalesce(cf, '{}'::jsonb));
end $$;


-- Financeiro, Fase 1 (2026-10-11): categorias de fornecedor, contas bancárias e plano de contas
--   config/supplier_categories  Cadastros → Categorias de fornecedor  (permissão "categorias_fornecedor")
--   config/bank_accounts        Cadastros → Contas bancárias           (permissão "contas_bancarias")
--   config/chart_accounts       Cadastros → Plano de contas            (permissão "plano_contas")
--   public.bank_account_finance saldo inicial de cada conta, tabela protegida (permissão "financeiro_valores")
-- 1. caminhos permitidos  2. módulo de cada caminho  3. tabela protegida do saldo inicial
-- 4. Plano de contas (67 subcategorias revisadas) e as 3 contas com o saldo de 01/01/2026.
-- Nenhum nível recebe estas permissões: só o Administrador vê e altera até você liberar em Níveis de permissão.
-- Pode rodar de novo (não troca o que já existe).

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
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
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
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

-- 3. Saldo inicial de cada conta (protegido por "Financeiro – valores")
create table if not exists public.bank_account_finance (
  account_id    text primary key,              -- id da conta em config/bank_accounts
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo    date not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
alter table public.bank_account_finance enable row level security;
grant select, insert, update, delete on public.bank_account_finance to authenticated;

create or replace function public.bank_account_finance_stamp()
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
drop trigger if exists bank_account_finance_stamp on public.bank_account_finance;
create trigger bank_account_finance_stamp
  before insert or update on public.bank_account_finance
  for each row execute function public.bank_account_finance_stamp();

drop policy if exists bank_account_finance_select on public.bank_account_finance;
create policy bank_account_finance_select on public.bank_account_finance
  for select to authenticated using (public.has_perm('financeiro_valores', 'view'));
drop policy if exists bank_account_finance_insert on public.bank_account_finance;
create policy bank_account_finance_insert on public.bank_account_finance
  for insert to authenticated with check (public.has_perm('financeiro_valores', 'edit'));
drop policy if exists bank_account_finance_update on public.bank_account_finance;
create policy bank_account_finance_update on public.bank_account_finance
  for update to authenticated
  using (public.has_perm('financeiro_valores', 'edit'))
  with check (public.has_perm('financeiro_valores', 'edit'));
drop policy if exists bank_account_finance_delete on public.bank_account_finance;
create policy bank_account_finance_delete on public.bank_account_finance
  for delete to authenticated
  using (public.has_perm('financeiro_valores', 'edit') or public.has_perm('contas_bancarias', 'delete'));

-- ===== Financeiro, Fase 2 (2026-10-11k): lançamentos =====
-- Financeiro, Fase 2 (2026-10-11): lançamentos (movimentação das contas)
--   public.finance_entries  uma linha por lançamento: conta, data, descrição, subcategoria do Plano de contas,
--                           valor (o que entra na DRE) e valor/data do extrato (o que passou de fato no banco).
-- Permissão própria "Financeiro" (financeiro: ver / incluir / editar / excluir). Nenhum nível recebe:
-- só o Administrador vê e altera até você liberar em Níveis de permissão.
-- O sinal vem do tipo da subcategoria no Plano de contas (Receita/Entrada somam, Despesa/Saída subtraem);
-- por isso o valor é sempre positivo.
-- origem_key: chave da importação da planilha (conta|data|descrição|valor|subcategoria|nº da repetição);
-- importar a mesma planilha de novo não duplica nada.
-- Pode rodar de novo.

create table if not exists public.finance_entries (
  id            uuid primary key default gen_random_uuid(),
  account_id    text not null,                           -- id da conta em config/bank_accounts
  data          date not null,
  descricao     text not null default '',
  plan_id       text,                                    -- id da subcategoria em config/chart_accounts
  valor         numeric(14,2) not null check (valor >= 0),
  data_extrato  date,
  valor_extrato numeric(14,2) check (valor_extrato is null or valor_extrato >= 0),
  obs           text,
  origem_key    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
create unique index if not exists finance_entries_origem_key on public.finance_entries (origem_key) where origem_key is not null;
create index if not exists finance_entries_data on public.finance_entries (data);
create index if not exists finance_entries_conta_data on public.finance_entries (account_id, data);

alter table public.finance_entries enable row level security;
grant select, insert, update, delete on public.finance_entries to authenticated;

create or replace function public.finance_entries_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then                 -- restauração / scripts: mantém o que veio
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists finance_entries_stamp on public.finance_entries;
create trigger finance_entries_stamp
  before insert or update on public.finance_entries
  for each row execute function public.finance_entries_stamp();

drop policy if exists finance_entries_select on public.finance_entries;
create policy finance_entries_select on public.finance_entries
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_entries_insert on public.finance_entries;
create policy finance_entries_insert on public.finance_entries
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_entries_update on public.finance_entries;
create policy finance_entries_update on public.finance_entries
  for update to authenticated
  using (public.has_perm('financeiro', 'edit'))
  with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_entries_delete on public.finance_entries;
create policy finance_entries_delete on public.finance_entries
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

do $$ begin
  alter publication supabase_realtime add table public.finance_entries;
exception when duplicate_object or undefined_object then null; end $$;

-- ===== Demonstrativos: visões salvas do DRE (2026-10-12) =====
-- Demonstrativos (Fluxo de caixa, DRE e Lançamentos) — 2026-10-12
--   config/dre_views   Financeiro → Demonstrativos → DRE → visões salvas com nome  (permissão "financeiro")
--   {list:[{id, name, cats:[chave da categoria], open}]}
-- 1. caminho permitido  2. módulo do caminho. Os níveis não mudam: quem tem "Financeiro" (incluir, editar,
-- excluir) salva e apaga visões; quem só vê, usa. Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
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
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'   -- visões salvas do DRE (Demonstrativos)
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

-- Conferência: caminho aceito | função conhece o caminho

-- ===== Demonstrativos: fechamento de mês (2026-10-12b) =====
-- Financeiro — Fechamento de mês (2026-10-12)
--   Mês fechado trava incluir, editar, excluir e importar lançamentos dele (para todos, inclusive o Administrador).
--   Fechar / reabrir: funções finance_close_month / finance_reopen_month, conforme a permissão "Fechamento de mês"
--   (fechamento_mes: incluir = fechar, excluir = reabrir, ver = histórico). Nenhum nível recebe: só o Administrador
--   até você liberar em Níveis de permissão. Quem vê o Financeiro vê os meses fechados.
-- Pode rodar de novo.

create table if not exists public.finance_closings (
  ym             text primary key check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at      timestamptz not null default now(),
  closed_by      uuid references auth.users(id) on delete set null,
  closed_by_name text
);
create table if not exists public.finance_closing_log (
  id       bigint generated always as identity primary key,
  ym       text not null,
  acao     text not null check (acao in ('fechou', 'reabriu')),
  em       timestamptz not null default now(),
  por      uuid references auth.users(id) on delete set null,
  por_nome text,
  motivo   text
);
alter table public.finance_closings enable row level security;
alter table public.finance_closing_log enable row level security;
grant select on public.finance_closings, public.finance_closing_log to authenticated;

drop policy if exists finance_closings_select on public.finance_closings;
create policy finance_closings_select on public.finance_closings
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_closing_log_select on public.finance_closing_log;
create policy finance_closing_log_select on public.finance_closing_log
  for select to authenticated using (public.has_perm('fechamento_mes', 'view'));
create or replace function public.finance_close_month(p_ym text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.has_perm('fechamento_mes', 'create') then raise exception 'Seu nível não pode fechar mês.'; end if;
  if p_ym is null or p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  if exists (select 1 from public.finance_closings where ym = p_ym) then raise exception 'Esse mês já está fechado.'; end if;
  nm := (select full_name from public.profiles where id = auth.uid());
  insert into public.finance_closings (ym, closed_by, closed_by_name) values (p_ym, auth.uid(), nm);
  insert into public.finance_closing_log (ym, acao, por, por_nome) values (p_ym, 'fechou', auth.uid(), nm);
end $$;

create or replace function public.finance_reopen_month(p_ym text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.has_perm('fechamento_mes', 'delete') then raise exception 'Seu nível não pode reabrir mês.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  if not exists (select 1 from public.finance_closings where ym = p_ym) then raise exception 'Esse mês não está fechado.'; end if;
  nm := (select full_name from public.profiles where id = auth.uid());
  delete from public.finance_closings where ym = p_ym;
  insert into public.finance_closing_log (ym, acao, por, por_nome, motivo) values (p_ym, 'reabriu', auth.uid(), nm, btrim(p_motivo));
end $$;
revoke all on function public.finance_close_month(text) from public, anon;
revoke all on function public.finance_reopen_month(text, text) from public, anon;
grant execute on function public.finance_close_month(text) to authenticated;
grant execute on function public.finance_reopen_month(text, text) to authenticated;

-- Mês fechado não aceita incluir, alterar nem excluir lançamento (nem mudar a data para dentro dele)
create or replace function public.finance_entries_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;     -- restauração / scripts
  if tg_op in ('UPDATE', 'DELETE') then
    m := to_char(old.data, 'YYYY-MM');
    if exists (select 1 from public.finance_closings where ym = m) then raise exception 'PIPO_MES_FECHADO:%', m; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    m := to_char(new.data, 'YYYY-MM');
    if exists (select 1 from public.finance_closings where ym = m) then raise exception 'PIPO_MES_FECHADO:%', m; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists finance_entries_lock on public.finance_entries;
create trigger finance_entries_lock
  before insert or update or delete on public.finance_entries
  for each row execute function public.finance_entries_lock();

do $$ begin alter publication supabase_realtime add table public.finance_closings;
exception when duplicate_object or undefined_object then null; end $$;

-- ===== Contas a pagar e a receber (2026-10-12c) =====
-- Financeiro: Contas a pagar e a receber (2026-10-12)
--   public.finance_payables  contas PREVISTAS (vencimento, valor, subcategoria do Plano de contas, fornecedor, conta).
--                            Quando a conta é paga/recebida, "Baixar" cria o lançamento (finance_entries) e liga os dois
--                            por entry_id. Conta sem entry_id = em aberto. Apagar o lançamento reabre a conta.
--   finance_payable_settle   baixa numa transação só (cria o lançamento + liga). Roda com o nível de quem chama:
--                            precisa de incluir lançamento e editar contas (permissão "Financeiro").
-- Mesma permissão dos Lançamentos (financeiro: ver / incluir / editar / excluir). Nenhum nível novo precisa de ajuste.
-- grupo / parcela / parcelas: contas que se repetem (todo mês ou em N vezes) compartilham o mesmo grupo.
-- Pode rodar de novo.

create table if not exists public.finance_payables (
  id          uuid primary key default gen_random_uuid(),
  vencimento  date not null,
  descricao   text not null default '',
  plan_id     text,                                      -- id da subcategoria em config/chart_accounts (o tipo dá pagar/receber)
  account_id  text,                                      -- conta bancária prevista (opcional)
  supplier_id text,                                      -- id em config/suppliers (opcional)
  valor       numeric(14,2) not null check (valor >= 0),
  entry_id    uuid references public.finance_entries(id) on delete set null,
  grupo       text,
  parcela     integer,
  parcelas    integer,
  obs         text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
create index if not exists finance_payables_venc on public.finance_payables (vencimento);
create index if not exists finance_payables_entry on public.finance_payables (entry_id);
create index if not exists finance_payables_grupo on public.finance_payables (grupo) where grupo is not null;

alter table public.finance_payables enable row level security;
grant select, insert, update, delete on public.finance_payables to authenticated;

create or replace function public.finance_payables_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then                 -- restauração / scripts: mantém o que veio
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists finance_payables_stamp on public.finance_payables;
create trigger finance_payables_stamp
  before insert or update on public.finance_payables
  for each row execute function public.finance_payables_stamp();

drop policy if exists finance_payables_select on public.finance_payables;
create policy finance_payables_select on public.finance_payables
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_payables_insert on public.finance_payables;
create policy finance_payables_insert on public.finance_payables
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_payables_update on public.finance_payables;
create policy finance_payables_update on public.finance_payables
  for update to authenticated
  using (public.has_perm('financeiro', 'edit'))
  with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_payables_delete on public.finance_payables;
create policy finance_payables_delete on public.finance_payables
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

-- Baixa: cria o lançamento e liga à conta, numa transação só (security invoker: vale a permissão de quem chama)
create or replace function public.finance_payable_settle(
  p_id uuid, p_acc text, p_date date, p_valor numeric,
  p_ext_data date default null, p_ext_val numeric default null, p_obs text default null, p_descricao text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare pay public.finance_payables; eid uuid;
begin
  select * into pay from public.finance_payables where id = p_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if pay.entry_id is not null then raise exception 'Esta conta já foi baixada.'; end if;
  if p_acc is null or p_acc = '' then raise exception 'Escolha a conta bancária.'; end if;
  if p_date is null then raise exception 'Informe a data.'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Valor inválido.'; end if;
  insert into public.finance_entries (account_id, data, descricao, plan_id, valor, data_extrato, valor_extrato, obs)
    values (p_acc, p_date, coalesce(nullif(btrim(p_descricao), ''), pay.descricao), pay.plan_id, p_valor, p_ext_data, p_ext_val, coalesce(nullif(btrim(p_obs), ''), pay.obs))
    returning id into eid;
  update public.finance_payables set entry_id = eid, account_id = coalesce(account_id, p_acc) where id = p_id;
  return eid;
end $$;
revoke all on function public.finance_payable_settle(uuid, text, date, numeric, date, numeric, text, text) from public, anon;
grant execute on function public.finance_payable_settle(uuid, text, date, numeric, date, numeric, text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.finance_payables;
exception when duplicate_object or undefined_object then null; end $$;

-- ===== Um lançamento só em UMA conta a pagar/receber (2026-10-12d) =====
create unique index if not exists finance_payables_entry_uni on public.finance_payables (entry_id) where entry_id is not null;

-- ===== Rateio das contas a pagar/receber (2026-10-12e) =====
-- Financeiro: rateio das contas a pagar/receber em várias subcategorias (2026-10-12)
--   finance_payables.linhas   [{plan, valor}] — a composição da conta (ex.: parcela de empréstimo = principal + juros).
--                             Vazio = conta de uma subcategoria só (plan_id). Com linhas, plan_id é o da 1ª linha e valor a soma.
--   finance_entries.payable_id  lançamento criado pela baixa de uma conta (uma baixa com rateio cria UM lançamento por linha).
--   finance_payable_settle_split  baixa com rateio numa transação só (security invoker: vale a permissão de quem chama).
-- A função de baixa simples (finance_payable_settle) continua como está. Pode rodar de novo.

alter table public.finance_payables add column if not exists linhas jsonb;
alter table public.finance_entries add column if not exists payable_id uuid references public.finance_payables(id) on delete set null;
create index if not exists finance_entries_payable on public.finance_entries (payable_id) where payable_id is not null;

create or replace function public.finance_payable_settle_split(
  p_id uuid, p_acc text, p_date date, p_linhas jsonb, p_obs text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare pay public.finance_payables; eid uuid; first_id uuid; l jsonb; n int := 0;
begin
  select * into pay from public.finance_payables where id = p_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if pay.entry_id is not null then raise exception 'Esta conta já foi baixada.'; end if;
  if p_acc is null or p_acc = '' then raise exception 'Escolha a conta bancária.'; end if;
  if p_date is null then raise exception 'Informe a data.'; end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) < 1 then raise exception 'Informe as linhas do rateio.'; end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    if coalesce(l->>'plan', '') = '' or coalesce((l->>'valor')::numeric, -1) < 0 then raise exception 'Linha do rateio inválida.'; end if;
    insert into public.finance_entries (account_id, data, descricao, plan_id, valor, obs, payable_id)
      values (p_acc, p_date, coalesce(nullif(btrim(l->>'desc'), ''), pay.descricao), l->>'plan', (l->>'valor')::numeric,
              coalesce(nullif(btrim(p_obs), ''), pay.obs), p_id)
      returning id into eid;
    n := n + 1;
    if n = 1 then first_id := eid; end if;
  end loop;
  update public.finance_payables set entry_id = first_id, account_id = coalesce(account_id, p_acc) where id = p_id;
  return first_id;
end $$;
revoke all on function public.finance_payable_settle_split(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.finance_payable_settle_split(uuid, text, date, jsonb, text) to authenticated;

-- Financeiro: Empréstimos (2026-10-12f)

create table if not exists public.finance_loans (
  id           uuid primary key default gen_random_uuid(),
  sentido      text not null check (sentido in ('tomado', 'concedido')),
  descricao    text not null default '',
  contraparte  text,
  supplier_id  text,
  account_id   text,
  valor        numeric(14,2) not null check (valor > 0),
  tipo         text not null check (tipo in ('simples', 'composto', 'price', 'sac')),
  taxa         numeric(9,4) not null default 0 check (taxa >= 0),
  parcelas     integer not null check (parcelas between 1 and 600),
  liberacao    date not null,
  primeiro_venc date not null,
  obs          text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);
alter table public.finance_loans enable row level security;
grant select, insert, update, delete on public.finance_loans to authenticated;

create or replace function public.finance_loans_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid();
  else new.created_at := old.created_at; new.created_by := old.created_by; end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists finance_loans_stamp on public.finance_loans;
create trigger finance_loans_stamp before insert or update on public.finance_loans
  for each row execute function public.finance_loans_stamp();

drop policy if exists finance_loans_select on public.finance_loans;
create policy finance_loans_select on public.finance_loans
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_loans_insert on public.finance_loans;
create policy finance_loans_insert on public.finance_loans
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_loans_update on public.finance_loans;
create policy finance_loans_update on public.finance_loans
  for update to authenticated using (public.has_perm('financeiro', 'edit')) with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_loans_delete on public.finance_loans;
create policy finance_loans_delete on public.finance_loans
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

alter table public.finance_payables add column if not exists loan_id uuid references public.finance_loans(id) on delete set null;
create index if not exists finance_payables_loan on public.finance_payables (loan_id) where loan_id is not null;

do $$ begin
  alter publication supabase_realtime add table public.finance_loans;
exception when duplicate_object or undefined_object then null; end $$;

-- Subcategorias novas no Plano de contas (não repete as que já existem)
update public.documents d set data = jsonb_set(d.data, '{list}', d.data->'list' || (
  select coalesce(jsonb_agg(n), '[]'::jsonb) from (values
    ('pagamento-de-emprestimos', 'Pagamento de Empréstimos', 'Saída', 'Empréstimos'),
    ('recebimento-de-emprestimos', 'Recebimento de Empréstimos', 'Entrada', 'Empréstimos'),
    ('juros-de-emprestimos-concedidos', 'Juros de Empréstimos Concedidos', 'Receita', 'Receita Financeira')
  ) as v(id, name, tipo, categoria),
  lateral (select jsonb_build_object('id', v.id, 'name', v.name, 'tipo', v.tipo, 'categoria', v.categoria) as n) j
  where not exists (select 1 from jsonb_array_elements(d.data->'list') e where e->>'id' = v.id)))
where d.path = 'config/chart_accounts';


-- Financeiro: Conciliação com o extrato (2026-10-12g)

create table if not exists public.finance_statement_lines (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  data        date not null,
  descricao   text not null default '',
  valor       numeric(14,2) not null,
  doc         text,
  key         text not null,
  entry_id    uuid references public.finance_entries(id) on delete set null,
  matched_at  timestamptz,
  matched_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);
create unique index if not exists finance_statement_key on public.finance_statement_lines (account_id, key);
create unique index if not exists finance_statement_entry on public.finance_statement_lines (entry_id) where entry_id is not null;
create index if not exists finance_statement_data on public.finance_statement_lines (account_id, data);
alter table public.finance_statement_lines enable row level security;
grant select, insert, update, delete on public.finance_statement_lines to authenticated;

create or replace function public.finance_statement_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.created_at := coalesce(new.created_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  if new.entry_id is distinct from (case when tg_op = 'INSERT' then null else old.entry_id end) then
    if new.entry_id is null then new.matched_at := null; new.matched_by := null;
    else new.matched_at := now(); new.matched_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_statement_stamp on public.finance_statement_lines;
create trigger finance_statement_stamp before insert or update on public.finance_statement_lines
  for each row execute function public.finance_statement_stamp();

drop policy if exists finance_statement_select on public.finance_statement_lines;
create policy finance_statement_select on public.finance_statement_lines
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_statement_insert on public.finance_statement_lines;
create policy finance_statement_insert on public.finance_statement_lines
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_statement_update on public.finance_statement_lines;
create policy finance_statement_update on public.finance_statement_lines
  for update to authenticated using (public.has_perm('financeiro', 'edit')) with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_statement_delete on public.finance_statement_lines;
create policy finance_statement_delete on public.finance_statement_lines
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

do $$ begin
  alter publication supabase_realtime add table public.finance_statement_lines;
exception when duplicate_object or undefined_object then null; end $$;

-- ===== CRM: automações (2026-10-12h) =====
-- CRM → Automações (2026-10-12)
--   Documento config/crm_automations {rules: {<regra>: {on, listId, assignees: [uuid], dias, ...}}} — só quem edita
--   "CRM" (crm_listas) grava. 26 regras (cada uma começa DESLIGADA). Duas formas de rodar:
--     * por evento (gatilhos): lead perdido, contrato assinado, cadastro recebido pelo link, falta, faltas seguidas,
--       primeiro atendimento e rodízio de leads novos;
--     * por dia (pg_cron 11:10 UTC = 8:10 de Brasília): lead parado, 2ª cobrança do link, tratamento vencendo/cancelado,
--       abaixo do contratado, carteirinha, encaminhamento, pacientes sem tratamento, pendências de status, contas a
--       pagar/receber, saldo baixo, mês sem fechar, conciliação, tarefas recorrentes prontas, plano terapêutico,
--       tarefa parada/atrasada e aniversário.
--   Nada se repete: public.crm_auto_log guarda uma chave por ocorrência (regra|item|período).
--   A tarefa/comentário criado leva o nome "Automação" e a marca "· via Automação" na atividade
--   (GUC pipo.auto, lido por crm_my_name, pipo_origem, tasks_stamp e task_events_stamp).
--   "Rodar agora" (função crm_auto_run_now) vale para quem edita CRM e ignora o dia da semana/do mês das regras.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
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
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'   -- visões salvas do DRE (Demonstrativos)
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
    when p_path = 'config/crm_automations'  then 'crm_listas'  -- CRM → Automações: quem edita "CRM"
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 1. Registro das execuções (uma chave por ocorrência) e estado do rodízio -------------------------------
create table if not exists public.crm_auto_log (
  id         bigint generated always as identity primary key,
  rule       text not null,
  key        text not null unique,
  task_id    uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_auto_log_rule_idx on public.crm_auto_log (rule, created_at desc);
alter table public.crm_auto_log enable row level security;
drop policy if exists crm_auto_log_select on public.crm_auto_log;
create policy crm_auto_log_select on public.crm_auto_log for select to authenticated
  using (public.is_admin() or public.has_perm('crm_listas', 'view'));
grant select on public.crm_auto_log to authenticated;

create table if not exists public.crm_auto_state (
  rule text primary key,
  n    bigint not null default 0
);
alter table public.crm_auto_state enable row level security;
revoke all on public.crm_auto_state from public, anon, authenticated;

-- 2. "Automação" como autor (o GUC pipo.auto só existe dentro das funções abaixo) ---------------------------
create or replace function public.crm_my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('pipo.auto', true), ''),
                  (select full_name from public.profiles where id = auth.uid()), '');
$$;

create or replace function public.pipo_origem()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_claims jsonb; v_cid text; v_nome text;
begin
  if coalesce(current_setting('pipo.auto', true), '') <> '' then
    return jsonb_build_object('origem', 'automacao', 'app', 'Automação');
  end if;
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null;
  end;
  v_cid := v_claims ->> 'client_id';
  if v_cid is null or v_cid = '' then return '{}'::jsonb; end if;
  begin
    execute 'select client_name from auth.oauth_clients where id::text = $1' into v_nome using v_cid;
  exception when others then v_nome := null;
  end;
  return jsonb_build_object('origem', 'conector', 'app', coalesce(nullif(v_nome, ''), 'Aplicativo conectado'));
end $$;

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if auth.uid() is not null and coalesce(current_setting('pipo.auto', true), '') = '' then
    new.author_id := auth.uid(); new.author_name := public.crm_my_name();
  end if;
  new.created_at := now();
  new.data := coalesce(new.data, '{}'::jsonb) || public.pipo_origem();
  return new;
end $$;

create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and coalesce(current_setting('pipo.auto', true), '') = '' then
      new.created_by := auth.uid(); new.created_by_name := public.crm_my_name();
    end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  if public.crm_status_done(new.list_id, new.status) then
    if new.closed_at is null then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;

-- 3. Peças comuns -------------------------------------------------------------------------------------------
create or replace function public.crm_auto_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Configuração da regra; vazio (null) quando está desligada ou não existe.
create or replace function public.crm_auto_cfg(p_rule text)
returns jsonb language sql stable security definer set search_path = public as $$
  select d.data -> 'rules' -> p_rule
    from public.documents d
   where d.path = 'config/crm_automations'
     and coalesce((d.data -> 'rules' -> p_rule ->> 'on')::boolean, false);
$$;

create or replace function public.crm_auto_num(p_cfg jsonb, p_key text, p_default int)
returns int language plpgsql immutable set search_path = public as $$
declare v text := p_cfg ->> p_key;
begin
  if v is not null and v ~ '^[0-9]{1,5}$' then return v::int; end if;
  return p_default;
end $$;

create or replace function public.crm_auto_date(p_text text)
returns date language plpgsql immutable set search_path = public as $$
begin
  if p_text is not null and p_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then return left(p_text, 10)::date; end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.crm_auto_money(p_text text)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_text is not null and replace(p_text, ',', '.') ~ '^[0-9]+(\.[0-9]+)?$' then return replace(p_text, ',', '.')::numeric; end if;
  return null;
end $$;

create or replace function public.crm_auto_brl(p_valor numeric)
returns text language sql immutable set search_path = public as $$
  select 'R$ ' || replace(to_char(coalesce(p_valor, 0), 'FM999999990.00'), '.', ',');
$$;

create or replace function public.crm_status_lost(p_list text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((s ->> 'lost')::boolean, false)), false)
    from public.documents d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$$;

-- Lista de funil de contatos (leads)? Sem o cadastro das listas, só "atendimento".
create or replace function public.crm_list_is_lead(p_list text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce((l ->> 'lead')::boolean, false)
       from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_list limit 1),
    p_list = 'atendimento');
$$;

-- Lista de destino: a escolhida na regra (se existir), senão a padrão, senão a primeira lista.
create or replace function public.crm_auto_list(p_cfg jsonb, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = nullif(p_cfg ->> 'listId', '') limit 1),
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_default limit 1),
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(l, i)
      where d.path = 'config/task_lists' order by i limit 1),
    nullif(p_cfg ->> 'listId', ''),
    p_default);
$$;

-- Responsáveis da regra que ainda têm acesso à lista (os outros são ignorados, não derrubam a regra).
create or replace function public.crm_auto_people(p_cfg jsonb, p_list text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_out uuid[] := '{}'; x text;
begin
  for x in select jsonb_array_elements_text(coalesce(p_cfg -> 'assignees', '[]'::jsonb)) loop
    begin
      if public.crm_user_can(x::uuid, p_list) and not (x::uuid = any(v_out)) then v_out := v_out || x::uuid; end if;
    exception when others then null;
    end;
  end loop;
  return v_out;
end $$;

-- Nome do paciente pelo código (patients/all).
create or replace function public.crm_auto_patient(p_id text)
returns text language sql stable security definer set search_path = public as $$
  select e ->> 'nome' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
   where d.path = 'patients/all' and e ->> 'id' = p_id limit 1;
$$;

-- Cria a tarefa da automação (uma vez por chave). Devolve o id, ou null (desligada, repetida, sem status).
create or replace function public.crm_auto_make(
  p_rule text, p_key text, p_title text, p_desc text, p_due date default null, p_prio text default 'normal',
  p_patient text default null, p_lead jsonb default '{}'::jsonb, p_default_list text default 'gestao',
  p_recurrence jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg(p_rule); v_list text; v_st text; v_id uuid; v_log bigint;
begin
  if v_cfg is null then return null; end if;
  v_list := public.crm_auto_list(v_cfg, p_default_list);
  v_st := public.crm_rec_status(v_list, null);
  if v_list is null or v_st is null then return null; end if;
  insert into public.crm_auto_log (rule, key) values (p_rule, left(p_key, 300))
    on conflict (key) do nothing returning id into v_log;
  if v_log is null then return null; end if;
  perform set_config('pipo.auto', 'Automação', true);
  insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, patient_id, lead,
                            created_by, created_by_name, recurrence)
  values (v_list, v_st, left(p_title, 200), coalesce(p_desc, ''),
          case when p_prio in ('urgente', 'alta', 'normal') then p_prio else 'normal' end, p_due,
          public.crm_auto_people(v_cfg, v_list), nullif(p_patient, ''), coalesce(p_lead, '{}'::jsonb),
          null, 'Automação', p_recurrence)
  returning id into v_id;
  perform set_config('pipo.auto', '', true);
  update public.crm_auto_log set task_id = v_id where id = v_log;
  return v_id;
exception when others then
  perform set_config('pipo.auto', '', true);
  raise;
end $$;

-- Comentário da automação numa tarefa existente, com @menção (vira aviso no celular). Uma vez por chave.
create or replace function public.crm_auto_comment(p_rule text, p_key text, p_task uuid, p_body text, p_mention uuid[])
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_log bigint; v_list text; v_men uuid[] := '{}'; u uuid;
begin
  select list_id into v_list from public.tasks where id = p_task;
  if v_list is null then return false; end if;
  insert into public.crm_auto_log (rule, key, task_id) values (p_rule, left(p_key, 300), p_task)
    on conflict (key) do nothing returning id into v_log;
  if v_log is null then return false; end if;
  foreach u in array coalesce(p_mention, '{}'::uuid[]) loop
    if public.crm_user_can(u, v_list) and not (u = any(v_men)) then v_men := v_men || u; end if;
  end loop;
  perform set_config('pipo.auto', 'Automação', true);
  insert into public.task_events (task_id, kind, body, mentions, author_id, author_name)
  values (p_task, 'comment', p_body, v_men, null, 'Automação');
  perform set_config('pipo.auto', '', true);
  return true;
exception when others then
  perform set_config('pipo.auto', '', true);
  raise;
end $$;

-- 4. Gatilhos por evento --------------------------------------------------------------------------------------
-- 4.1 Rodízio de leads novos (6): tarefa nova de funil sem responsável recebe o próximo da fila.
create or replace function public.tasks_auto_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_pool uuid[]; v_n bigint;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' or coalesce(array_length(new.assignees, 1), 0) > 0 then return new; end if;
  v_cfg := public.crm_auto_cfg('rodizio_leads');
  if v_cfg is null or not public.crm_list_is_lead(new.list_id) then return new; end if;
  if nullif(v_cfg ->> 'listId', '') is not null and v_cfg ->> 'listId' <> new.list_id then return new; end if;
  select coalesce(array_agg(u order by u), '{}') into v_pool
    from (select x::uuid u from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x
           where public.crm_user_can(x::uuid, new.list_id)) q;
  if coalesce(array_length(v_pool, 1), 0) = 0 then return new; end if;
  insert into public.crm_auto_state (rule, n) values ('rodizio_leads', 1)
    on conflict (rule) do update set n = public.crm_auto_state.n + 1 returning n into v_n;
  new.assignees := array[v_pool[((v_n - 1) % array_length(v_pool, 1))::int + 1]];
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists tasks_auto_assign on public.tasks;
create trigger tasks_auto_assign before insert on public.tasks
  for each row execute function public.tasks_auto_assign();

-- 4.2 Lead perdido (4) e contrato assinado (5): ao mudar o status de uma tarefa de funil.
create or replace function public.tasks_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text; v_cfg jsonb; v_mot text; v_dias int;
begin
  if new.status is not distinct from old.status
     or coalesce(current_setting('pipo.restore', true), '') = '1'
     or coalesce(current_setting('pipo.auto', true), '') <> '' then return null; end if;
  if not public.crm_list_is_lead(new.list_id) then return null; end if;
  v_nome := coalesce(nullif(btrim(new.lead ->> 'nome'), ''), public.crm_auto_patient(new.patient_id), 'sem nome');
  if public.crm_status_lost(new.list_id, new.status) then
    v_cfg := public.crm_auto_cfg('lead_perdido');
    if v_cfg is not null then
      v_mot := coalesce(nullif(btrim(v_cfg ->> 'motivo'), ''), 'Financeiro');
      if public.pipo_norm(coalesce(new.lead ->> 'motivoPerda', '')) = public.pipo_norm(v_mot) then
        v_dias := public.crm_auto_num(v_cfg, 'dias', 60);
        perform public.crm_auto_make('lead_perdido', 'perdido|' || new.id, 'Retomar contato com ' || v_nome || ' (perdido: ' || v_mot || ')',
          'O contato foi perdido em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || ' pelo motivo “' || v_mot || '”. Veja se a situação mudou e ofereça de novo o atendimento.' ||
          case when coalesce(new.lead ->> 'telefone', '') <> '' then ' Telefone: ' || (new.lead ->> 'telefone') || '.' else '' end,
          public.crm_auto_today() + v_dias, 'normal', new.patient_id, coalesce(new.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
      end if;
    end if;
  elsif public.crm_status_done(new.list_id, new.status) and not public.crm_status_done(old.list_id, old.status) then
    perform public.crm_auto_make('contrato_assinado', 'contrato|' || new.id,
      case when new.patient_id is null then 'Cadastrar paciente e abrir tratamento: ' else 'Abrir o tratamento de ' end || v_nome,
      'Contrato assinado em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. ' ||
      case when new.patient_id is null then 'Abra a tarefa do contato, use “Cadastrar paciente” e depois abra o tratamento (convênio, sessões por mês, especialidades e horário).'
           else 'Confira o cadastro do paciente e abra o tratamento (convênio, sessões por mês, especialidades e horário).' end,
      public.crm_auto_today(), 'alta', new.patient_id, coalesce(new.lead, '{}'::jsonb), 'atendimento');
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists tasks_auto_status on public.tasks;
create trigger tasks_auto_status after update of status on public.tasks
  for each row execute function public.tasks_auto_status();

-- 4.3 Cadastro recebido pelo link (2): tarefa para revisar.
create or replace function public.intake_auto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return null; end if;
  v_nome := coalesce(nullif(btrim(new.data ->> 'nome'), ''), nullif(btrim(new.data ->> 'telefone'), ''), 'sem nome');
  perform public.crm_auto_make('link_respondido', 'link|' || new.id, 'Revisar cadastro recebido: ' || v_nome,
    'A família preencheu o link de cadastro em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. Abra Cadastros → Pacientes → Revisar Cadastro, confira os dados e aprove.',
    public.crm_auto_today(), 'alta', new.patient_id,
    case when new.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(new.data ->> 'nome', ''), 'telefone', nullif(new.data ->> 'telefone', ''))) else '{}'::jsonb end,
    'atendimento');
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists intake_auto on public.intake_submissions;
create trigger intake_auto after insert on public.intake_submissions
  for each row execute function public.intake_auto();

-- 4.4 Falta (12) e faltas seguidas (13): atendimento passa para "Não compareceu".
create or replace function public.appointments_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_n int := 0; v_min int; r record;
begin
  if new.status is not distinct from old.status or new.status is distinct from 'nao-compareceu'
     or coalesce(current_setting('pipo.restore', true), '') = '1' or new.blocked
     or new.patient_id is null or new.group_id is not null then return null; end if;
  perform public.crm_auto_make('falta', 'falta|' || new.id, 'Contatar a família de ' || new.patient || ': não compareceu em ' || to_char(new.date, 'DD/MM'),
    'O paciente não compareceu ao atendimento de ' || to_char(new.date, 'DD/MM/YYYY') || ' às ' || new.time || '. Entre em contato com a família e, se for o caso, remarque.',
    public.crm_auto_today(), 'normal', new.patient_id, '{}'::jsonb, 'agendas');
  v_cfg := public.crm_auto_cfg('faltas_seguidas');
  if v_cfg is not null then
    v_min := greatest(public.crm_auto_num(v_cfg, 'dias', 2), 2);
    for r in select a.status from public.appointments a
              where a.patient_id = new.patient_id and not a.blocked and a.group_id is null and a.status is not null
                and (a.date, a.time) <= (new.date, new.time)
              order by a.date desc, a.time desc limit 10 loop
      exit when r.status <> 'nao-compareceu';
      v_n := v_n + 1;
    end loop;
    if v_n >= v_min then
      perform public.crm_auto_make('faltas_seguidas', 'faltas|' || new.id, v_n || ' faltas seguidas de ' || new.patient,
        'O paciente faltou ' || v_n || ' atendimentos seguidos (o último em ' || to_char(new.date, 'DD/MM/YYYY') || '). Converse com a família para entender o motivo e evitar o abandono do tratamento.',
        public.crm_auto_today(), 'alta', new.patient_id, '{}'::jsonb, 'gestao');
    end if;
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists appointments_auto_status on public.appointments;
create trigger appointments_auto_status after update of status on public.appointments
  for each row execute function public.appointments_auto_status();

-- 4.5 Primeiro atendimento do paciente (15).
create or replace function public.appointments_auto_first()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' or new.blocked or new.patient_id is null or new.group_id is not null then return null; end if;
  if public.crm_auto_cfg('primeiro_atendimento') is null then return null; end if;
  if exists (select 1 from public.appointments a where a.patient_id = new.patient_id and a.id <> new.id and not a.blocked and a.group_id is null) then return null; end if;
  perform public.crm_auto_make('primeiro_atendimento', 'primeiro|' || new.patient_id, 'Receber ' || new.patient || ': primeiro atendimento em ' || to_char(new.date, 'DD/MM'),
    'Primeiro atendimento do paciente na Agenda: ' || to_char(new.date, 'DD/MM/YYYY') || ' às ' || new.time || '. Envie as boas-vindas à família e confira o cadastro e o tratamento.',
    greatest(new.date - 1, public.crm_auto_today()), 'normal', new.patient_id, '{}'::jsonb, 'agendas');
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists appointments_auto_first on public.appointments;
create trigger appointments_auto_first after insert on public.appointments
  for each row execute function public.appointments_auto_first();

-- 5. Regras do dia (cada uma com a sua função, para uma falhar sem derrubar as outras) -----------------------
-- 1. Lead parado
create or replace function public.crm_auto_r_lead_parado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('lead_parado'); v_dias int; t record; v_nome text;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for t in select k.* from public.tasks k
            where public.crm_list_is_lead(k.list_id) and not public.crm_status_done(k.list_id, k.status)
              and coalesce(k.created_by_name, '') <> 'Automação'
              and k.updated_at < now() - make_interval(days => v_dias) loop
    v_nome := coalesce(nullif(btrim(t.lead ->> 'nome'), ''), public.crm_auto_patient(t.patient_id), 'sem nome');
    perform public.crm_auto_make('lead_parado', 'parado|' || t.id || '|' || to_char(t.updated_at, 'YYYYMMDD'),
      'Dar retorno a ' || v_nome || ': sem movimento há ' || v_dias || ' dias',
      'A tarefa “' || t.title || '” está parada desde ' || to_char(t.updated_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '. Entre em contato com a família e atualize o status.',
      public.crm_auto_today(), 'normal', t.patient_id, coalesce(t.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
  end loop;
end $$;

-- 3. Link de cadastro sem resposta: segunda cobrança
create or replace function public.crm_auto_r_link_segunda(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('link_segunda_cobranca'); v_dias int; l record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null
              and reminded_at is not null and reminded_at < now() - make_interval(days => v_dias) loop
    perform public.crm_auto_make('link_segunda_cobranca', 'link2|' || l.token, '2ª cobrança de cadastro: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
      'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || ' continua sem resposta. Ligue para a família ou envie um novo link.' ||
        case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
      public.crm_auto_today(), 'normal', l.patient_id,
      case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end,
      'atendimento');
  end loop;
end $$;

-- 7. Tratamento vencendo
create or replace function public.crm_auto_r_trat_vencendo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('trat_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'validoAte') as ate
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo' and coalesce(e ->> 'vencPor', 'data') <> 'sem'
              and public.crm_auto_date(e ->> 'validoAte') is not null
              and public.crm_auto_date(e ->> 'validoAte') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('trat_vencendo', 'trvence|' || t.id || '|' || t.ate,
      'Renegociar o tratamento de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' ||
        case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'O tratamento ativo ' || case when t.ate < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end ||
        ' (validade ' || to_char(t.ate, 'DD/MM/YYYY') || '). Converse com a família sobre a renovação ou a renegociação.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.pid, '{}'::jsonb, 'gestao');
  end loop;
end $$;

-- 8. Tratamento cancelado
create or replace function public.crm_auto_r_trat_cancelado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('trat_cancelado'); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'statusEm') as em,
                  coalesce(nullif(e ->> 'motivoCancelNome', ''), 'não informado') as motivo, coalesce(e ->> 'obsCancel', '') as obs
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'cancelado'
              and public.crm_auto_date(e ->> 'statusEm') >= public.crm_auto_today() - 2 loop
    perform public.crm_auto_make('trat_cancelado', 'trcanc|' || t.id || '|' || t.em,
      'Pós-cancelamento: contatar a família de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente'),
      'Tratamento cancelado em ' || to_char(t.em, 'DD/MM/YYYY') || '. Motivo: ' || t.motivo || '.' || case when t.obs <> '' then ' Observação: ' || t.obs else '' end ||
        ' Entre em contato para entender a situação e ver se há como retomar.',
      public.crm_auto_today(), 'normal', t.pid, '{}'::jsonb, 'atendimento');
  end loop;
end $$;

-- 9. Abaixo do contratado (sessões agendadas no mês × Sessão/Mês do tratamento ativo)
create or replace function public.crm_auto_r_abaixo_contratado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('abaixo_contratado'); v_dia int; t record; v_ms date; v_me date; v_n int; v_contr numeric;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 20);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ms := date_trunc('month', public.crm_auto_today())::date;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_money(e ->> 'sessoesMes') as contr
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
              and coalesce(public.crm_auto_date(e ->> 'inicio'), v_ms) < v_ms
              and public.crm_auto_money(e ->> 'sessoesMes') > 0 loop
    v_contr := t.contr;
    select count(*) into v_n from public.appointments a
     where a.patient_id = t.pid and a.date between v_ms and v_me and not a.blocked and a.group_id is null;
    if v_n < v_contr then
      perform public.crm_auto_make('abaixo_contratado', 'abaixo|' || t.id || '|' || to_char(v_ms, 'YYYY-MM'),
        'Encaixar sessões de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' || v_n || ' de ' || trim(to_char(v_contr, 'FM999990.##')) || ' no mês',
        'O tratamento prevê ' || trim(to_char(v_contr, 'FM999990.##')) || ' sessões por mês e a Agenda de ' || to_char(v_ms, 'MM/YYYY') || ' tem só ' || v_n || '. Veja horários livres com a família.',
        v_me, 'normal', t.pid, '{}'::jsonb, 'agendas');
    end if;
  end loop;
end $$;

-- 10. Carteirinha do convênio vencendo
create or replace function public.crm_auto_r_carteirinha(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('carteirinha_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'carteirinhaValidade') as ate
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'carteirinhaValidade') is not null
              and public.crm_auto_date(e ->> 'carteirinhaValidade') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('carteirinha_vencendo', 'cart|' || t.id || '|' || t.ate,
      'Pedir carteirinha nova de ' || t.nome || ': ' || case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'A carteirinha do convênio ' || case when t.ate < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end || ' (' || to_char(t.ate, 'DD/MM/YYYY') || '). Peça à família a carteirinha atualizada e registre no cadastro do paciente.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'agendas');
  end loop;
end $$;

-- 11. Pacientes sem tratamento ativo (resumo semanal)
create or replace function public.crm_auto_r_sem_tratamento(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('sem_tratamento'); v_n int; v_nomes text;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  with pat as (
    select e ->> 'id' as id, e ->> 'nome' as nome
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'),
  ativos as (
    select distinct e ->> 'patientId' as pid
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'treatments/all' and e ->> 'status' = 'ativo')
  select count(*), string_agg(nome, ', ' order by nome) into v_n, v_nomes
    from (select nome from pat where id not in (select pid from ativos where pid is not null) order by nome limit 30) q;
  select count(*) into v_n from (
    select e ->> 'id' as id from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
       and not exists (select 1 from public.documents t, jsonb_array_elements(coalesce(t.data -> 'list', '[]'::jsonb)) x
                        where t.path = 'treatments/all' and x ->> 'status' = 'ativo' and x ->> 'patientId' = e ->> 'id')) z;
  if coalesce(v_n, 0) = 0 then return; end if;
  perform public.crm_auto_make('sem_tratamento', 'semtrat|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Pacientes sem tratamento ativo: ' || v_n,
    'Pacientes ativos sem tratamento Ativo: ' || coalesce(v_nomes, '') || case when v_n > 30 then ' e mais ' || (v_n - 30) || '.' else '.' end ||
      ' Abra Cadastros → Tratamentos (filtro “Pacientes sem tratamento ativo”) e crie o tratamento ou inative o paciente.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'gestao');
end $$;

-- 14. Pendências de status (resumo semanal)
create or replace function public.crm_auto_r_pendencias_status(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('pendencias_status'); v_n int;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  select count(*) into v_n from public.appointments a
   where a.date < public.crm_auto_today() and a.date >= public.crm_auto_today() - 60 and a.status is null
     and not a.blocked and a.patient_id is not null and a.group_id is null;
  if v_n = 0 then return; end if;
  perform public.crm_auto_make('pendencias_status', 'pend|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Atendimentos sem status: ' || v_n,
    v_n || ' atendimentos dos últimos 60 dias ainda estão sem status (Finalizado, Não compareceu, Falta justificada). Use Agenda → Outras Opções → Pendências de Status.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'agendas');
end $$;

-- 16 e 17. Contas a pagar e a receber vencendo / vencidas
create or replace function public.crm_auto_r_contas(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_c1 jsonb := public.crm_auto_cfg('conta_vencendo'); v_c2 jsonb := public.crm_auto_cfg('conta_vencida'); v_dias int; r record; v_pagar boolean;
begin
  if v_c1 is null and v_c2 is null then return; end if;
  v_dias := public.crm_auto_num(v_c1, 'dias', 3);
  for r in with ca as (select e ->> 'id' as id, e ->> 'tipo' as tipo
                         from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts')
           select p.id, p.vencimento, p.descricao, p.valor, p.parcela, p.parcelas, ca.tipo
             from public.finance_payables p left join ca on ca.id = p.plan_id
            where p.entry_id is null and ca.tipo in ('Despesa', 'Saída', 'Receita', 'Entrada')
              and p.vencimento <= public.crm_auto_today() + greatest(v_dias, 0) loop
    v_pagar := r.tipo in ('Despesa', 'Saída');
    if r.vencimento < public.crm_auto_today() then
      perform public.crm_auto_make('conta_vencida', 'vencida|' || r.id,
        case when v_pagar then 'Conta vencida: pagar ' else 'Conta atrasada: cobrar ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end,
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' — venceu em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        public.crm_auto_today(), 'urgente', null, '{}'::jsonb, 'fature');
    elsif v_c1 is not null then
      perform public.crm_auto_make('conta_vencendo', 'vencendo|' || r.id || '|' || r.vencimento,
        case when v_pagar then 'Pagar: ' else 'Receber: ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end || ' — vence em ' || to_char(r.vencimento, 'DD/MM'),
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        r.vencimento, 'normal', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $$;

-- 18. Saldo abaixo do mínimo da conta bancária (saldo de hoje)
create or replace function public.crm_auto_r_saldo_baixo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('saldo_baixo'); a record; v_saldo numeric; v_min numeric;
begin
  if v_cfg is null then return; end if;
  for a in select e ->> 'id' as id, e ->> 'name' as nome, public.crm_auto_money(e ->> 'saldoMinimo') as minimo
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'config/bank_accounts' and public.crm_auto_money(e ->> 'saldoMinimo') > 0 loop
    v_min := a.minimo;
    select coalesce(f.saldo_inicial, 0) + coalesce((
        select sum(case ca.tipo when 'Receita' then x.valor when 'Entrada' then x.valor when 'Despesa' then -x.valor when 'Saída' then -x.valor else 0 end)
          from public.finance_entries x
          left join (select e ->> 'id' as id, e ->> 'tipo' as tipo
                       from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts') ca on ca.id = x.plan_id
         where x.account_id = a.id and x.data <= public.crm_auto_today() and (f.data_saldo is null or x.data >= f.data_saldo)), 0)
      into v_saldo
      from (select 1) one left join public.bank_account_finance f on f.account_id = a.id;
    if v_saldo < v_min then
      perform public.crm_auto_make('saldo_baixo', 'saldo|' || a.id || '|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
        'Saldo baixo em ' || a.nome || ': ' || public.crm_auto_brl(v_saldo),
        'O saldo de ' || a.nome || ' está em ' || public.crm_auto_brl(v_saldo) || ', abaixo do mínimo de ' || public.crm_auto_brl(v_min) || '. Veja as contas a pagar dos próximos dias e programe a entrada de recursos.',
        public.crm_auto_today(), 'alta', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $$;

-- 19. Mês anterior sem fechar
create or replace function public.crm_auto_r_mes_sem_fechar(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('mes_sem_fechar'); v_dia int; v_ym text; v_ini date;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 5);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ini := (date_trunc('month', public.crm_auto_today()) - interval '1 month')::date;
  v_ym := to_char(v_ini, 'YYYY-MM');
  if exists (select 1 from public.finance_closings where ym = v_ym) then return; end if;
  if not exists (select 1 from public.finance_entries where data >= v_ini and data < (v_ini + interval '1 month')::date) then return; end if;
  perform public.crm_auto_make('mes_sem_fechar', 'fechar|' || v_ym, 'Fechar o mês ' || to_char(v_ini, 'MM/YYYY'),
    'O mês ' || to_char(v_ini, 'MM/YYYY') || ' tem lançamentos e ainda não foi fechado. Confira os lançamentos e use Financeiro → Lançamentos → Outras Opções → Fechamento de Mês.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'fature');
end $$;

-- 20. Conciliação pendente (resumo semanal)
create or replace function public.crm_auto_r_conciliacao(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('conciliacao_pendente'); v_n int;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  select count(*) into v_n from public.finance_statement_lines where entry_id is null;
  if v_n = 0 then return; end if;
  perform public.crm_auto_make('conciliacao_pendente', 'concil|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Conciliar o extrato: ' || v_n || ' linhas pendentes',
    v_n || ' linhas do extrato ainda não foram conciliadas com um lançamento. Abra Financeiro → Conciliação.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'fature');
end $$;

-- 21. Tarefas recorrentes prontas (criadas uma vez; a recorrência gera as próximas ao finalizar)
create or replace function public.crm_auto_r_rotinas(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('rotinas_prontas'); v_hoje date := public.crm_auto_today(); v_sex date; v_mes date;
begin
  if v_cfg is null then return; end if;
  v_sex := v_hoje + ((5 - extract(dow from v_hoje)::int + 7) % 7);
  v_mes := (date_trunc('month', v_hoje) + interval '1 month')::date;
  perform public.crm_auto_make('rotinas_prontas', 'rotina|faltas-semana', 'Conferir faltas e remarcações da semana',
    'Toda sexta: veja os pacientes que faltaram na semana, confirme as remarcações e os atendimentos sem status. Ao finalizar a tarefa, a próxima sexta é criada sozinha.',
    v_sex, 'normal', null, '{}'::jsonb, 'agendas', jsonb_build_object('freq', 'semanal', 'dias', jsonb_build_array(5), 'nova', false, 'sempre', true));
  perform public.crm_auto_make('rotinas_prontas', 'rotina|trat-mes', 'Revisar tratamentos e convênios do mês',
    'Todo mês: confira tratamentos perto de vencer, carteirinhas, pacientes sem tratamento ativo e sessões abaixo do contratado. Ao finalizar a tarefa, a do mês seguinte é criada sozinha.',
    v_mes, 'normal', null, '{}'::jsonb, 'gestao', jsonb_build_object('freq', 'mensal', 'nova', false, 'sempre', true));
end $$;

-- 22. Plano Terapêutico vencendo
create or replace function public.crm_auto_r_plano_vencendo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('plano_vencendo'); v_dias int; p record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for p in select * from public.therapy_plans
            where status = 'vigente' and review_date is not null and review_date <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('plano_vencendo', 'plano|' || p.id || '|' || p.review_date,
      'Revisar o Plano Terapêutico de ' || coalesce(nullif(p.patient_name, ''), public.crm_auto_patient(p.patient_id), 'paciente') || ': ' ||
        case when p.review_date < public.crm_auto_today() then 'revisão venceu em ' else 'revisão em ' end || to_char(p.review_date, 'DD/MM/YYYY'),
      'O plano vigente (versão ' || p.version || ') tem revisão marcada para ' || to_char(p.review_date, 'DD/MM/YYYY') || '. Abra Prontuário → Plano Terapêutico e use Revisar.',
      greatest(p.review_date, public.crm_auto_today()), case when p.review_date < public.crm_auto_today() then 'alta' else 'normal' end, p.patient_id, '{}'::jsonb, 'gestao');
  end loop;
end $$;

-- 23. Tarefa parada (comentário com @menção ao responsável e à coordenação)
create or replace function public.crm_auto_r_tarefa_parada(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('tarefa_parada'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 7);
  for t in select k.* from public.tasks k
            where not public.crm_status_done(k.list_id, k.status) and coalesce(k.created_by_name, '') <> 'Automação'
              and (nullif(v_cfg ->> 'listId', '') is null or k.list_id = v_cfg ->> 'listId')
              and k.updated_at < now() - make_interval(days => v_dias)
              and not exists (select 1 from public.task_events e where e.task_id = k.id and e.created_at >= now() - make_interval(days => v_dias)) loop
    perform public.crm_auto_comment('tarefa_parada', 'parada|' || t.id || '|' || to_char(t.updated_at, 'YYYYMMDD'), t.id,
      'Esta tarefa está sem movimento há mais de ' || v_dias || ' dias. Atualize o status ou comente o que falta.',
      t.assignees || (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x));
  end loop;
end $$;

-- 24. Tarefa vencida há muitos dias (escala para a coordenação)
create or replace function public.crm_auto_r_tarefa_atrasada(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('tarefa_atrasada'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for t in select k.* from public.tasks k
            where not public.crm_status_done(k.list_id, k.status) and k.due_date is not null
              and (nullif(v_cfg ->> 'listId', '') is null or k.list_id = v_cfg ->> 'listId')
              and k.due_date < public.crm_auto_today() - v_dias loop
    perform public.crm_auto_comment('tarefa_atrasada', 'atraso|' || t.id || '|' || t.due_date, t.id,
      'Tarefa vencida há ' || (public.crm_auto_today() - t.due_date) || ' dias (vencimento ' || to_char(t.due_date, 'DD/MM/YYYY') || '). Avisando a coordenação.',
      t.assignees || (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x));
  end loop;
end $$;

-- 25. Aniversário do paciente
create or replace function public.crm_auto_r_aniversario(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('aniversario'); v_hoje date := public.crm_auto_today(); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'nascimento') as nasc
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'nascimento') is not null
              and extract(month from public.crm_auto_date(e ->> 'nascimento')) = extract(month from v_hoje)
              and extract(day from public.crm_auto_date(e ->> 'nascimento')) = extract(day from v_hoje) loop
    perform public.crm_auto_make('aniversario', 'aniv|' || t.id || '|' || extract(year from v_hoje)::int,
      'Aniversário de ' || t.nome || ' (' || (extract(year from v_hoje)::int - extract(year from t.nasc)::int) || ' anos)',
      'Hoje é aniversário do paciente. Envie uma mensagem carinhosa à família.',
      v_hoje, 'normal', t.id, '{}'::jsonb, 'agendas');
  end loop;
end $$;

-- 26. Encaminhamento médico vencendo (grupo Saúde do paciente)
create or replace function public.crm_auto_r_encaminhamento(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('encaminhamento_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select h.patient_id as id, public.crm_auto_patient(h.patient_id) as nome, public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') as venc
             from public.patient_health h
            where public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') is not null
              and public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') <= public.crm_auto_today() + v_dias
              and exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
                           where d.path = 'patients/all' and e ->> 'id' = h.patient_id and coalesce(e ->> 'inativo', '') <> 'true') loop
    perform public.crm_auto_make('encaminhamento_vencendo', 'enc|' || t.id || '|' || t.venc,
      'Pedir novo encaminhamento de ' || coalesce(t.nome, 'paciente') || ': ' || case when t.venc < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.venc, 'DD/MM/YYYY'),
      'O encaminhamento médico ' || case when t.venc < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end || ' (' || to_char(t.venc, 'DD/MM/YYYY') || '). Peça à família um novo encaminhamento e atualize o cadastro do paciente (grupo Saúde).',
      greatest(t.venc, public.crm_auto_today()), case when t.venc < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'atendimento');
  end loop;
end $$;

-- 6. Execução: todas as regras do dia, cada uma isolada. p_force = ignora dia da semana/do mês (Rodar agora).
create or replace function public.crm_auto_run(p_force boolean default false)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_start timestamptz := now(); v_fn text; v_n integer;
begin
  foreach v_fn in array array['lead_parado', 'link_segunda', 'trat_vencendo', 'trat_cancelado', 'abaixo_contratado', 'carteirinha',
                              'sem_tratamento', 'pendencias_status', 'contas', 'saldo_baixo', 'mes_sem_fechar', 'conciliacao',
                              'rotinas', 'plano_vencendo', 'tarefa_parada', 'tarefa_atrasada', 'aniversario', 'encaminhamento'] loop
    begin
      execute format('select public.crm_auto_r_%s($1)', v_fn) using p_force;
    exception when others then
      raise warning 'crm_auto_run: regra % falhou: %', v_fn, sqlerrm;
    end;
  end loop;
  select count(*) into v_n from public.crm_auto_log where created_at >= v_start;
  return v_n;
end $$;

-- Rodar agora (botão da tela): quem edita CRM. Devolve quantas ocorrências novas foram criadas.
create or replace function public.crm_auto_run_now()
returns integer language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'edit')) then
    raise exception 'Sem permissão para rodar as automações.';
  end if;
  return public.crm_auto_run(true);
end $$;

grant execute on function public.crm_auto_run_now() to authenticated;
revoke execute on function public.crm_auto_run(boolean) from public, anon, authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and (p.proname like 'crm\_auto\_%' and p.proname <> 'crm_auto_run_now'
                  or p.proname in ('tasks_auto_assign', 'tasks_auto_status', 'intake_auto', 'appointments_auto_status', 'appointments_auto_first', 'crm_status_lost', 'crm_list_is_lead')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 7. Agendamento diário: 8h10 de Brasília (11h10 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'pipo-crm-automacoes';
select cron.schedule('pipo-crm-automacoes', '10 11 * * *', $$select public.crm_auto_run(false)$$);

-- ===== CRM: automações com status (2026-10-12i) =====
-- CRM → Automações: status da tarefa criada e status que dispara (2026-10-12)
--   config/crm_automations.rules.<regra>.statusId = status em que a tarefa nasce (vazio = o 1º status que não finaliza);
--   .gatilho (lead_perdido, contrato_assinado) = status que dispara a regra (vazio = qualquer status de perda / de sucesso).
-- Só duas funções mudam (crm_auto_make e tasks_auto_status). Pode rodar de novo.

create or replace function public.crm_auto_make(
  p_rule text, p_key text, p_title text, p_desc text, p_due date default null, p_prio text default 'normal',
  p_patient text default null, p_lead jsonb default '{}'::jsonb, p_default_list text default 'gestao',
  p_recurrence jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg(p_rule); v_list text; v_st text; v_id uuid; v_log bigint;
begin
  if v_cfg is null then return null; end if;
  v_list := public.crm_auto_list(v_cfg, p_default_list);
  v_st := public.crm_rec_status(v_list, nullif(v_cfg ->> 'statusId', ''));
  if v_list is null or v_st is null then return null; end if;
  insert into public.crm_auto_log (rule, key) values (p_rule, left(p_key, 300))
    on conflict (key) do nothing returning id into v_log;
  if v_log is null then return null; end if;
  perform set_config('pipo.auto', 'Automação', true);
  insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, patient_id, lead,
                            created_by, created_by_name, recurrence)
  values (v_list, v_st, left(p_title, 200), coalesce(p_desc, ''),
          case when p_prio in ('urgente', 'alta', 'normal') then p_prio else 'normal' end, p_due,
          public.crm_auto_people(v_cfg, v_list), nullif(p_patient, ''), coalesce(p_lead, '{}'::jsonb),
          null, 'Automação', p_recurrence)
  returning id into v_id;
  perform set_config('pipo.auto', '', true);
  update public.crm_auto_log set task_id = v_id where id = v_log;
  return v_id;
exception when others then
  perform set_config('pipo.auto', '', true);
  raise;
end $$;

create or replace function public.tasks_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text; v_cfg jsonb; v_mot text; v_dias int; v_g text;
begin
  if new.status is not distinct from old.status
     or coalesce(current_setting('pipo.restore', true), '') = '1'
     or coalesce(current_setting('pipo.auto', true), '') <> '' then return null; end if;
  if not public.crm_list_is_lead(new.list_id) then return null; end if;
  v_nome := coalesce(nullif(btrim(new.lead ->> 'nome'), ''), public.crm_auto_patient(new.patient_id), 'sem nome');
  -- Lead perdido: status escolhido (gatilho) ou qualquer status de perda
  v_cfg := public.crm_auto_cfg('lead_perdido');
  if v_cfg is not null then
    v_g := nullif(v_cfg ->> 'gatilho', '');
    if (v_g is not null and new.status = v_g) or (v_g is null and public.crm_status_lost(new.list_id, new.status)) then
      v_mot := coalesce(nullif(btrim(v_cfg ->> 'motivo'), ''), 'Financeiro');
      if public.pipo_norm(coalesce(new.lead ->> 'motivoPerda', '')) = public.pipo_norm(v_mot) then
        v_dias := public.crm_auto_num(v_cfg, 'dias', 60);
        perform public.crm_auto_make('lead_perdido', 'perdido|' || new.id, 'Retomar contato com ' || v_nome || ' (perdido: ' || v_mot || ')',
          'O contato foi perdido em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || ' pelo motivo “' || v_mot || '”. Veja se a situação mudou e ofereça de novo o atendimento.' ||
          case when coalesce(new.lead ->> 'telefone', '') <> '' then ' Telefone: ' || (new.lead ->> 'telefone') || '.' else '' end,
          public.crm_auto_today() + v_dias, 'normal', new.patient_id, coalesce(new.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
      end if;
    end if;
  end if;
  -- Contrato assinado: status escolhido (gatilho) ou qualquer status que finaliza sem ser de perda
  v_cfg := public.crm_auto_cfg('contrato_assinado');
  if v_cfg is not null then
    v_g := nullif(v_cfg ->> 'gatilho', '');
    if (v_g is not null and new.status = v_g and old.status is distinct from v_g)
       or (v_g is null and public.crm_status_done(new.list_id, new.status) and not public.crm_status_lost(new.list_id, new.status)
           and not public.crm_status_done(old.list_id, old.status)) then
      perform public.crm_auto_make('contrato_assinado', 'contrato|' || new.id,
        case when new.patient_id is null then 'Cadastrar paciente e abrir tratamento: ' else 'Abrir o tratamento de ' end || v_nome,
        'Contrato assinado em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. ' ||
        case when new.patient_id is null then 'Abra a tarefa do contato, use “Cadastrar paciente” e depois abra o tratamento (convênio, sessões por mês, especialidades e horário).'
             else 'Confira o cadastro do paciente e abra o tratamento (convênio, sessões por mês, especialidades e horário).' end,
        public.crm_auto_today(), 'alta', new.patient_id, coalesce(new.lead, '{}'::jsonb), 'atendimento');
    end if;
  end if;
  return null;
exception when others then
  return null;
end $$;

revoke execute on function public.crm_auto_make(text, text, text, text, date, text, text, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.tasks_auto_status() from public, anon, authenticated;

-- Unidades (nível de organização) — Fase 1 (2026-10-12)
-- Cadastro de Unidades, nível Gestão, vínculo usuário↔unidade e lista de unidades da tela de login.
-- Nada muda para quem usa hoje: tudo vira "Unidade 1" e o Administrador atual passa a ser Gestão.
--   config/units  Cadastros → Unidades (só a Gestão)  {list:[{id, name, fantasia, cnpj, telefone, email, endereco, cidade, inativo}]}
--   roles.is_manager   nível Gestão (acesso total a todas as unidades; Administrador = total só na própria unidade)
--   profiles.unit_id   unidade do usuário (id do item de config/units)
-- Pode rodar de novo.

-- 1. Caminho permitido e módulo do caminho
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'
    when p_path = 'config/crm_automations'  then 'crm_listas'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

-- 2. Coluna do nível Gestão e unidade do usuário
alter table public.roles add column if not exists is_manager boolean not null default false;
alter table public.profiles add column if not exists unit_id text not null default 'unidade-1';

-- 3. Nível Gestão (administrador total + todas as unidades; travado como o Administrador)
alter table public.roles disable trigger roles_before_insert;
insert into public.roles (id, name, is_admin, is_manager, sort, permissions)
values ('gestao', 'Gestão', true, true, 0, '{}'::jsonb)
on conflict (id) do nothing;
alter table public.roles enable trigger roles_before_insert;

-- 4. Unidade 1 com os dados da clínica de hoje
insert into public.documents (path, data)
select 'config/units',
       jsonb_build_object('list', jsonb_build_array(jsonb_build_object(
         'id', 'unidade-1', 'name', 'Unidade 1',
         'fantasia', coalesce(c.data ->> 'nome', ''), 'cnpj', coalesce(c.data ->> 'cnpj', ''),
         'telefone', coalesce(c.data ->> 'telefone', ''), 'email', coalesce(c.data ->> 'email', ''),
         'endereco', coalesce(c.data ->> 'endereco', ''), 'cidade', coalesce(c.data ->> 'cidade', ''))))
  from (select 1) x
  left join public.documents c on c.path = 'config/clinic'
on conflict (path) do nothing;

-- 5. Funções
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and r.is_manager
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.my_unit()
returns text language sql stable security definer set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid();
$$;

-- A unidade existe no cadastro? (sem cadastro ainda = aceita)
create or replace function public.unit_exists(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.documents where path = 'config/units') then true
    else exists (
      select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) i
      where d.path = 'config/units' and i ->> 'id' = p_unit)
  end;
$$;

-- Lista de unidades da tela de login (antes de entrar): só id e nome, só as ativas.
create or replace function public.login_units()
returns table (id text, name text) language sql stable security definer set search_path = public as $$
  select i ->> 'id', coalesce(nullif(btrim(i ->> 'name'), ''), i ->> 'id')
    from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(i, n)
   where d.path = 'config/units'
     and coalesce(i ->> 'inativo', 'false') <> 'true'
   order by n;
$$;
revoke all on function public.login_units() from public;
revoke execute on function public.login_units() from anon;   -- o login não lista unidades (só quem já entrou)
grant execute on function public.login_units() to authenticated;

-- 6. Só a Gestão altera o cadastro de unidades; a Unidade 1 e unidade com usuários não saem
create or replace function public.units_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if auth.uid() is null then return new; end if;
  if not public.is_manager() then
    raise exception 'Só a Gestão altera as unidades.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    for r in
      select i ->> 'id' as id
        from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) i
       where not exists (
         select 1 from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) j where j ->> 'id' = i ->> 'id')
    loop
      if r.id = 'unidade-1' then
        raise exception 'A Unidade 1 não pode ser excluída.' using errcode = '42501';
      end if;
      if exists (select 1 from public.profiles where unit_id = r.id) then
        raise exception 'Esta unidade ainda tem usuários. Mude-os de unidade antes de excluir.' using errcode = '23503';
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists documents_a_units_guard on public.documents;
create trigger documents_a_units_guard
  before insert or update on public.documents
  for each row when (new.path = 'config/units')
  execute function public.units_guard();

-- 7. Usuários: unidade existente; Administrador só mexe na própria unidade e não dá nível de Gestão/Administrador
create or replace function public.profiles_unit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_mgr boolean := false;
  v_new_mgr boolean;
  v_old_adm boolean := false;
  v_new_adm boolean;
begin
  if tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id then
    if not public.unit_exists(new.unit_id) then
      raise exception 'Unidade não encontrada.' using errcode = '23503';
    end if;
  end if;
  if auth.uid() is null or public.is_manager() then
    return new;   -- Gestão, service role (API) e scripts
  end if;
  select coalesce(is_manager, false), coalesce(is_admin, false) into v_new_mgr, v_new_adm from public.roles where id = new.role_id;
  if tg_op = 'UPDATE' then
    select coalesce(is_manager, false), coalesce(is_admin, false) into v_old_mgr, v_old_adm from public.roles where id = old.role_id;
    if new.unit_id is distinct from old.unit_id then
      raise exception 'Só a Gestão muda o usuário de unidade.' using errcode = '42501';
    end if;
    if old.unit_id is distinct from public.my_unit() then
      raise exception 'Este usuário é de outra unidade.' using errcode = '42501';
    end if;
    if v_old_mgr then
      raise exception 'Só a Gestão altera uma conta de Gestão.' using errcode = '42501';
    end if;
    if v_old_adm and old.id <> auth.uid() then
      raise exception 'Só a Gestão altera uma conta de Administrador.' using errcode = '42501';
    end if;
    if new.role_id is distinct from old.role_id and (v_new_mgr or v_new_adm) then
      raise exception 'Só a Gestão dá o nível Administrador ou Gestão.' using errcode = '42501';
    end if;
  else
    if v_new_mgr or v_new_adm then
      raise exception 'Só a Gestão cria usuários Administrador ou Gestão.' using errcode = '42501';
    end if;
    if new.unit_id is distinct from public.my_unit() then
      raise exception 'Só a Gestão cria usuários em outra unidade.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_unit_guard on public.profiles;
create trigger profiles_unit_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_unit_guard();

-- 8. Quem lê e edita usuários: a Gestão vê todos; os demais, só a própria unidade (e a si mesmos)
alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'view')) and unit_id = public.my_unit()));
alter policy profiles_update on public.profiles
  using (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.my_unit()))
  with check (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.my_unit()));

-- 8b. Níveis de permissão valem para todas as unidades: só a Gestão cria, edita e exclui nível
alter policy roles_insert on public.roles with check (public.is_manager());
alter policy roles_update on public.roles using (public.is_manager()) with check (public.is_manager());
alter policy roles_delete on public.roles using (public.is_manager());

-- 9. O Administrador mais antigo passa a ser Gestão (só se ainda não houver nenhuma Gestão ativa)
update public.profiles
   set role_id = 'gestao'
 where id = (select p.id from public.profiles p join public.roles r on r.id = p.role_id
              where r.is_admin and not r.is_manager and p.active order by p.created_at limit 1)
   and not exists (select 1 from public.profiles p2 join public.roles r2 on r2.id = p2.role_id where r2.is_manager);

-- Unidades — Fase 2A: documentos por unidade (2026-10-12)
-- Cada documento do sistema passa a ter a unidade a que pertence (`documents.unit_id`):
--   • 'empresa'  = cadastros únicos da empresa (convênios, diagnósticos, plano de contas, níveis…), iguais em todas as unidades;
--   • uma unidade = dados da unidade (pacientes, tratamentos, Planner, salas, colaboradores, clínica, fornecedores, contas bancárias,
--     médicos, escolas, listas do CRM…). Os que já existem ficam na 'unidade-1'.
-- `active_unit()` diz qual unidade a pessoa está usando: a dela (profiles.unit_id) ou, para a Gestão, a escolhida no login/topo,
-- guardada no token (user_metadata.active_unit). Uma regra RESTRITIVA em `documents` deixa passar só 'empresa' + a unidade ativa;
-- um gatilho carimba a unidade em todo documento novo (a pessoa nunca escolhe). Nada muda para quem usa só a Unidade 1.
-- A chave antiga (path) continua até a segunda unidade começar a ser usada; já existe a chave nova (path, unit_id).
-- Pode rodar de novo.

-- 1. Coluna e índice
alter table public.documents add column if not exists unit_id text not null default 'unidade-1';

-- 2. O que é da empresa e o que é da unidade (por caminho)
create or replace function public.doc_scope(p_path text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_path like 'schedule/%' then 'unit'
    when p_path in ('patients/all', 'treatments/all', 'config/rooms', 'config/professionals', 'config/clinic', 'config/doctors',
                    'config/schools', 'config/suppliers', 'config/bank_accounts', 'config/task_lists', 'config/crm_automations',
                    'config/planner_blocks') then 'unit'
    else 'company'
  end;
$$;

update public.documents set unit_id = 'empresa' where public.doc_scope(path) = 'company' and unit_id <> 'empresa';

create unique index if not exists documents_path_unit_key on public.documents (path, unit_id);

-- Fase 2D: a chave final de documents é (path, unit_id)
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.documents'::regclass and contype = 'p'
              and pg_get_constraintdef(oid) = 'PRIMARY KEY (path)') then
    alter table public.documents drop constraint documents_pkey;
    alter table public.documents add constraint documents_pkey primary key using index documents_path_unit_key;
  end if;
end $$;

-- 3. Unidade ativa da sessão
--   • sem usuário (cron, link público, restauração): a unidade posta em `pipo.unit` (set_config) ou a Unidade 1;
--   • Gestão: a escolhida (token), se existir; • os demais: a do próprio perfil (nunca vale o que vem no token).
create or replace function public.active_unit()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if auth.uid() is null then
    return coalesce(nullif(current_setting('pipo.unit', true), ''), 'unidade-1');
  end if;
  if public.is_manager() then
    v := nullif(auth.jwt() -> 'user_metadata' ->> 'active_unit', '');
    if v is not null and public.unit_exists(v) then return v; end if;
  end if;
  return coalesce(public.my_unit(), 'unidade-1');
end $$;

-- 4. Carimbo da unidade nos documentos (roda antes dos outros gatilhos: nome com "0")
create or replace function public.documents_unit_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.unit_id := old.unit_id;
  elsif public.doc_scope(new.path) = 'company' then
    new.unit_id := 'empresa';
  elsif auth.uid() is not null then
    new.unit_id := public.active_unit();
  elsif nullif(current_setting('pipo.unit', true), '') is not null then
    new.unit_id := current_setting('pipo.unit', true);
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'documents_0_unit_stamp' and not tgisinternal) then
    create trigger documents_0_unit_stamp
      before insert or update on public.documents
      for each row execute function public.documents_unit_stamp();
  end if;
end $$;

-- 5. Regra restritiva: só 'empresa' + a unidade ativa (soma-se às regras de permissão que já existem)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_unit') then
    create policy documents_unit on public.documents as restrictive for all to authenticated
      using (unit_id = 'empresa' or unit_id = (select public.active_unit()))
      with check (unit_id = 'empresa' or unit_id = (select public.active_unit()));
  end if;
end $$;

-- 6. Funções que gravam documentos passam a usar a chave (path, unit_id)
CREATE OR REPLACE FUNCTION public.patch_bookings(p_path text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  on conflict (path, unit_id) do update set data = excluded.data;

  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.patch_list(p_path text, p_upserts jsonb, p_deletes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  on conflict (path, unit_id) do update set data = excluded.data;
  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.patch_list2(p_path text, p_upserts jsonb, p_deletes jsonb, p_expect jsonb DEFAULT '{}'::jsonb, p_order jsonb DEFAULT NULL::jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_data jsonb;
  v_list jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_ord  jsonb := '[]'::jsonb;
  v_del  text[];
  v_seen text[] := '{}';
  v_used text[] := '{}';
  v_conf jsonb := '[]'::jsonb;
  v_cur  jsonb;
  e jsonb;
  u jsonb;
  k text;
begin
  if p_path like 'schedule/%' then
    raise exception 'patch_list2 não vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then v_data := '{}'::jsonb; end if;
  v_list := coalesce(v_data -> 'list', '[]'::jsonb);

  -- Conflitos: item que a pessoa alterou mudou (ou sumiu) depois que ela o abriu.
  if not coalesce(p_force, false) then
    for k in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
      v_cur := null;
      select value into v_cur from jsonb_array_elements(v_list) where value ->> 'id' = k limit 1;
      if v_cur is null then
        select value into u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) where value ->> 'id' = k limit 1;
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k, 'excluido', true,
          'nome', coalesce(u ->> 'nome', u ->> 'name', '')));
      elsif coalesce(v_cur -> '_upd' ->> 'em', '') <> coalesce(p_expect ->> k, '') then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k,
          'nome', coalesce(v_cur ->> 'nome', v_cur ->> 'name', ''),
          'por', v_cur -> '_upd' ->> 'por', 'em', v_cur -> '_upd' ->> 'em'));
      end if;
    end loop;
    if jsonb_array_length(v_conf) > 0 then
      raise exception 'PIPO_CONFLITO:%', v_conf::text using errcode = 'P0001';
    end if;
  end if;

  select coalesce(array_agg(x), '{}') into v_del
  from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)) as x;

  -- Mantém a ordem: substitui no lugar os alterados e tira os excluídos.
  for e in select value from jsonb_array_elements(v_list) loop
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

  -- Ordem pedida: primeiro os da lista, na ordem dela; depois os que a pessoa não via.
  if p_order is not null and jsonb_typeof(p_order) = 'array' then
    for k in select value from jsonb_array_elements_text(p_order) loop
      select value into e from jsonb_array_elements(v_out) where value ->> 'id' = k limit 1;
      if found and not (k = any(v_used)) then
        v_ord := v_ord || jsonb_build_array(e);
        v_used := v_used || k;
      end if;
    end loop;
    for e in select value from jsonb_array_elements(v_out) loop
      if not ((e ->> 'id') = any(v_used)) then v_ord := v_ord || jsonb_build_array(e); end if;
    end loop;
    v_out := v_ord;
  end if;

  v_data := jsonb_set(v_data, '{list}', v_out, true);
  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path, unit_id) do update set data = excluded.data;
  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.documents_enforce()
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
  if tg_op = 'INSERT' and exists (select 1 from public.documents where path = new.path and unit_id = new.unit_id) then
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

-- Unidades — Fase 2B: unidade nas tabelas (2026-10-12)
-- Cada registro das tabelas abaixo passa a ter a unidade (`unit_id`, padrão 'unidade-1' = tudo o que já existe).
--   • um gatilho carimba a unidade da pessoa no registro novo (quem usa o sistema não escolhe) e impede mudar depois;
--   • uma regra RESTRITIVA deixa ver e gravar só a unidade ativa (`active_unit()`, da migração 2A), somada às permissões que já existem.
-- Sem usuário (cron, link público, restauração): vale `pipo.unit` (set_config) ou o que veio no registro / Unidade 1.
-- Pode rodar de novo.

create or replace function public.unit_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.unit_id := old.unit_id;
  elsif auth.uid() is not null then
    new.unit_id := public.active_unit();
  elsif nullif(current_setting('pipo.unit', true), '') is not null then
    new.unit_id := current_setting('pipo.unit', true);
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'clinical_records', 'therapy_plans', 'patient_health', 'tasks', 'task_events',
    'staff', 'staff_pay', 'treatment_finance', 'bank_account_finance',
    'finance_entries', 'finance_payables', 'finance_loans', 'finance_statement_lines', 'finance_closings', 'finance_closing_log',
    'intake_links', 'intake_submissions', 'crm_auto_log'
  ] loop
    execute format('alter table public.%I add column if not exists unit_id text not null default %L', t, 'unidade-1');
    if not exists (select 1 from pg_trigger where tgname = t || '_0_unit_stamp' and not tgisinternal) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.unit_stamp()', t || '_0_unit_stamp', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_unit') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()))', t || '_unit', t);
    end if;
  end loop;
end $$;

-- Unidades — Fase 2C: funções que leem por cima das regras de acesso (2026-10-12)
-- As funções "security definer" (leem tudo, sem passar pelas regras de unidade) agora enxergam só os documentos da empresa e da unidade ativa,
-- pela visão interna `documents_u`; as consultas de relatório/CRM filtram a unidade ativa; a página pública do link de cadastro usa a
-- unidade DO LINK (`pipo.unit`). As rotinas diárias de automação do CRM continuam na Unidade 1 (por unidade: Fase 6).
-- Pode rodar de novo.

create or replace view public.documents_u as
  select * from public.documents where unit_id = 'empresa' or unit_id = public.active_unit();
revoke all on public.documents_u from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.appointments_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = new.patient_id and lower(btrim(x ->> 'nome')) = v_n
  ) then
    new.group_id := null; return new;
  end if;
  if new.group_id is not null and exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = new.group_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = v_n
  ) then
    new.patient_id := null; return new;
  end if;
  -- Pelo nome.
  select count(*), min(x ->> 'id') into v_cnt, v_id
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all' and lower(btrim(x ->> 'nome')) = v_n;
  if v_cnt = 1 then
    new.patient_id := v_id; new.group_id := null; return new;
  end if;
  if v_cnt > 1 then
    -- Homônimos sem código escolhido: fica o que já estava, se for um deles.
    if tg_op = 'UPDATE' and old.patient_id is not null and exists (
      select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'patients/all' and x ->> 'id' = old.patient_id and lower(btrim(x ->> 'nome')) = v_n
    ) then new.patient_id := old.patient_id; else new.patient_id := null; end if;
    new.group_id := null; return new;
  end if;
  new.patient_id := null;
  select x ->> 'id' into v_id
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false) and lower(btrim(x ->> 'name')) = v_n
  limit 1;
  new.group_id := v_id;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.appointments_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         select 1 from public.documents_u d, jsonb_array_elements(d.data -> 'list') p
         where d.path = 'patients/all' and lower(btrim(p ->> 'nome')) = lower(btrim(new.patient))
       )
       and not exists (select 1 from public.clinical_records c where c.appointment_id = new.id)
    then
      raise exception 'Para finalizar, registre a evolução deste atendimento no prontuário.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clinical_records_plan_goals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.clinical_records_plan_goals_undo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g jsonb; v_old_date text; v_plan uuid; v_sections jsonb; v_final text;
  v_last jsonb; v_last_date text; v_new_level text;
begin
  if jsonb_typeof(old.plan_goals) <> 'array' or jsonb_array_length(old.plan_goals) = 0 then
    return null;
  end if;
  v_old_date := coalesce(old.appointment_date, (old.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(old.plan_goals) loop
    -- na edição, só os objetivos que saíram da evolução (os que ficaram já foram regravados)
    if tg_op = 'UPDATE' and jsonb_typeof(new.plan_goals) = 'array' and exists (
         select 1 from jsonb_array_elements(new.plan_goals) n
          where n ->> 'planId' = g ->> 'planId' and n ->> 'objId' = g ->> 'objId') then
      continue;
    end if;
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = old.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    -- a situação atual ainda é a que esta evolução gravou?
    if not exists (
      select 1 from jsonb_array_elements(v_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
       where o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
         and o ->> 'levelId' is not distinct from g ->> 'levelId' and o ->> 'levelEm' = v_old_date) then
      continue;
    end if;
    -- última evolução que sobrou com esse objetivo
    v_last := null; v_last_date := null;
    select x, coalesce(c.appointment_date, (c.created_at at time zone 'America/Sao_Paulo')::date)::text
      into v_last, v_last_date
      from public.clinical_records c,
           jsonb_array_elements(case when jsonb_typeof(c.plan_goals) = 'array' then c.plan_goals else '[]'::jsonb end) x
     where c.patient_id = old.patient_id and c.id <> old.id
       and x ->> 'planId' = g ->> 'planId' and x ->> 'objId' = g ->> 'objId' and x ->> 'scaleId' = g ->> 'scaleId'
     order by 2 desc, c.created_at desc
     limit 1;
    v_new_level := v_last ->> 'levelId';
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId' then
            (case when v_last is null then o - 'levelId' - 'levelEm'
                  else o || jsonb_build_object('levelId', v_new_level, 'levelEm', v_last_date) end)
            || case when v_new_level is not null and v_new_level = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                      then jsonb_build_object('status', 'atingido', 'statusEm', coalesce(v_last_date, v_old_date))
                    when v_new_level is distinct from v_final and o ->> 'status' = 'atingido'
                      then jsonb_build_object('status', 'ativo', 'statusEm', to_char(current_date, 'YYYY-MM-DD'))
                    else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_cfg(p_rule text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.data -> 'rules' -> p_rule
    from public.documents_u d
   where d.path = 'config/crm_automations'
     and coalesce((d.data -> 'rules' -> p_rule ->> 'on')::boolean, false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_list(p_cfg jsonb, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = nullif(p_cfg ->> 'listId', '') limit 1),
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_default limit 1),
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(l, i)
      where d.path = 'config/task_lists' order by i limit 1),
    nullif(p_cfg ->> 'listId', ''),
    p_default);
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_patient(p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e ->> 'nome' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
   where d.path = 'patients/all' and e ->> 'id' = p_id limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_abaixo_contratado(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('abaixo_contratado'); v_dia int; t record; v_ms date; v_me date; v_n int; v_contr numeric;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 20);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ms := date_trunc('month', public.crm_auto_today())::date;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_money(e ->> 'sessoesMes') as contr
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
              and coalesce(public.crm_auto_date(e ->> 'inicio'), v_ms) < v_ms
              and public.crm_auto_money(e ->> 'sessoesMes') > 0 loop
    v_contr := t.contr;
    select count(*) into v_n from public.appointments a
     where a.patient_id = t.pid and a.date between v_ms and v_me and not a.blocked and a.group_id is null;
    if v_n < v_contr then
      perform public.crm_auto_make('abaixo_contratado', 'abaixo|' || t.id || '|' || to_char(v_ms, 'YYYY-MM'),
        'Encaixar sessões de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' || v_n || ' de ' || trim(to_char(v_contr, 'FM999990.##')) || ' no mês',
        'O tratamento prevê ' || trim(to_char(v_contr, 'FM999990.##')) || ' sessões por mês e a Agenda de ' || to_char(v_ms, 'MM/YYYY') || ' tem só ' || v_n || '. Veja horários livres com a família.',
        v_me, 'normal', t.pid, '{}'::jsonb, 'agendas');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_aniversario(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('aniversario'); v_hoje date := public.crm_auto_today(); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'nascimento') as nasc
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'nascimento') is not null
              and extract(month from public.crm_auto_date(e ->> 'nascimento')) = extract(month from v_hoje)
              and extract(day from public.crm_auto_date(e ->> 'nascimento')) = extract(day from v_hoje) loop
    perform public.crm_auto_make('aniversario', 'aniv|' || t.id || '|' || extract(year from v_hoje)::int,
      'Aniversário de ' || t.nome || ' (' || (extract(year from v_hoje)::int - extract(year from t.nasc)::int) || ' anos)',
      'Hoje é aniversário do paciente. Envie uma mensagem carinhosa à família.',
      v_hoje, 'normal', t.id, '{}'::jsonb, 'agendas');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_carteirinha(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('carteirinha_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'carteirinhaValidade') as ate
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'carteirinhaValidade') is not null
              and public.crm_auto_date(e ->> 'carteirinhaValidade') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('carteirinha_vencendo', 'cart|' || t.id || '|' || t.ate,
      'Pedir carteirinha nova de ' || t.nome || ': ' || case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'A carteirinha do convênio ' || case when t.ate < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end || ' (' || to_char(t.ate, 'DD/MM/YYYY') || '). Peça à família a carteirinha atualizada e registre no cadastro do paciente.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'agendas');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_contas(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c1 jsonb := public.crm_auto_cfg('conta_vencendo'); v_c2 jsonb := public.crm_auto_cfg('conta_vencida'); v_dias int; r record; v_pagar boolean;
begin
  if v_c1 is null and v_c2 is null then return; end if;
  v_dias := public.crm_auto_num(v_c1, 'dias', 3);
  for r in with ca as (select e ->> 'id' as id, e ->> 'tipo' as tipo
                         from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts')
           select p.id, p.vencimento, p.descricao, p.valor, p.parcela, p.parcelas, ca.tipo
             from public.finance_payables p left join ca on ca.id = p.plan_id
            where p.entry_id is null and ca.tipo in ('Despesa', 'Saída', 'Receita', 'Entrada')
              and p.vencimento <= public.crm_auto_today() + greatest(v_dias, 0) loop
    v_pagar := r.tipo in ('Despesa', 'Saída');
    if r.vencimento < public.crm_auto_today() then
      perform public.crm_auto_make('conta_vencida', 'vencida|' || r.id,
        case when v_pagar then 'Conta vencida: pagar ' else 'Conta atrasada: cobrar ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end,
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' — venceu em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        public.crm_auto_today(), 'urgente', null, '{}'::jsonb, 'fature');
    elsif v_c1 is not null then
      perform public.crm_auto_make('conta_vencendo', 'vencendo|' || r.id || '|' || r.vencimento,
        case when v_pagar then 'Pagar: ' else 'Receber: ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end || ' — vence em ' || to_char(r.vencimento, 'DD/MM'),
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        r.vencimento, 'normal', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_encaminhamento(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('encaminhamento_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select h.patient_id as id, public.crm_auto_patient(h.patient_id) as nome, public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') as venc
             from public.patient_health h
            where public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') is not null
              and public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') <= public.crm_auto_today() + v_dias
              and exists (select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
                           where d.path = 'patients/all' and e ->> 'id' = h.patient_id and coalesce(e ->> 'inativo', '') <> 'true') loop
    perform public.crm_auto_make('encaminhamento_vencendo', 'enc|' || t.id || '|' || t.venc,
      'Pedir novo encaminhamento de ' || coalesce(t.nome, 'paciente') || ': ' || case when t.venc < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.venc, 'DD/MM/YYYY'),
      'O encaminhamento médico ' || case when t.venc < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end || ' (' || to_char(t.venc, 'DD/MM/YYYY') || '). Peça à família um novo encaminhamento e atualize o cadastro do paciente (grupo Saúde).',
      greatest(t.venc, public.crm_auto_today()), case when t.venc < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'atendimento');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_saldo_baixo(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('saldo_baixo'); a record; v_saldo numeric; v_min numeric;
begin
  if v_cfg is null then return; end if;
  for a in select e ->> 'id' as id, e ->> 'name' as nome, public.crm_auto_money(e ->> 'saldoMinimo') as minimo
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'config/bank_accounts' and public.crm_auto_money(e ->> 'saldoMinimo') > 0 loop
    v_min := a.minimo;
    select coalesce(f.saldo_inicial, 0) + coalesce((
        select sum(case ca.tipo when 'Receita' then x.valor when 'Entrada' then x.valor when 'Despesa' then -x.valor when 'Saída' then -x.valor else 0 end)
          from public.finance_entries x
          left join (select e ->> 'id' as id, e ->> 'tipo' as tipo
                       from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts') ca on ca.id = x.plan_id
         where x.account_id = a.id and x.data <= public.crm_auto_today() and (f.data_saldo is null or x.data >= f.data_saldo)), 0)
      into v_saldo
      from (select 1) one left join public.bank_account_finance f on f.account_id = a.id;
    if v_saldo < v_min then
      perform public.crm_auto_make('saldo_baixo', 'saldo|' || a.id || '|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
        'Saldo baixo em ' || a.nome || ': ' || public.crm_auto_brl(v_saldo),
        'O saldo de ' || a.nome || ' está em ' || public.crm_auto_brl(v_saldo) || ', abaixo do mínimo de ' || public.crm_auto_brl(v_min) || '. Veja as contas a pagar dos próximos dias e programe a entrada de recursos.',
        public.crm_auto_today(), 'alta', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_sem_tratamento(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('sem_tratamento'); v_n int; v_nomes text;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  with pat as (
    select e ->> 'id' as id, e ->> 'nome' as nome
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'),
  ativos as (
    select distinct e ->> 'patientId' as pid
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'treatments/all' and e ->> 'status' = 'ativo')
  select count(*), string_agg(nome, ', ' order by nome) into v_n, v_nomes
    from (select nome from pat where id not in (select pid from ativos where pid is not null) order by nome limit 30) q;
  select count(*) into v_n from (
    select e ->> 'id' as id from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
       and not exists (select 1 from public.documents_u t, jsonb_array_elements(coalesce(t.data -> 'list', '[]'::jsonb)) x
                        where t.path = 'treatments/all' and x ->> 'status' = 'ativo' and x ->> 'patientId' = e ->> 'id')) z;
  if coalesce(v_n, 0) = 0 then return; end if;
  perform public.crm_auto_make('sem_tratamento', 'semtrat|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Pacientes sem tratamento ativo: ' || v_n,
    'Pacientes ativos sem tratamento Ativo: ' || coalesce(v_nomes, '') || case when v_n > 30 then ' e mais ' || (v_n - 30) || '.' else '.' end ||
      ' Abra Cadastros → Tratamentos (filtro “Pacientes sem tratamento ativo”) e crie o tratamento ou inative o paciente.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'gestao');
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_trat_cancelado(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('trat_cancelado'); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'statusEm') as em,
                  coalesce(nullif(e ->> 'motivoCancelNome', ''), 'não informado') as motivo, coalesce(e ->> 'obsCancel', '') as obs
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'cancelado'
              and public.crm_auto_date(e ->> 'statusEm') >= public.crm_auto_today() - 2 loop
    perform public.crm_auto_make('trat_cancelado', 'trcanc|' || t.id || '|' || t.em,
      'Pós-cancelamento: contatar a família de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente'),
      'Tratamento cancelado em ' || to_char(t.em, 'DD/MM/YYYY') || '. Motivo: ' || t.motivo || '.' || case when t.obs <> '' then ' Observação: ' || t.obs else '' end ||
        ' Entre em contato para entender a situação e ver se há como retomar.',
      public.crm_auto_today(), 'normal', t.pid, '{}'::jsonb, 'atendimento');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_trat_vencendo(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('trat_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'validoAte') as ate
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo' and coalesce(e ->> 'vencPor', 'data') <> 'sem'
              and public.crm_auto_date(e ->> 'validoAte') is not null
              and public.crm_auto_date(e ->> 'validoAte') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('trat_vencendo', 'trvence|' || t.id || '|' || t.ate,
      'Renegociar o tratamento de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' ||
        case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'O tratamento ativo ' || case when t.ate < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end ||
        ' (validade ' || to_char(t.ate, 'DD/MM/YYYY') || '). Converse com a família sobre a renovação ou a renegociação.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.pid, '{}'::jsonb, 'gestao');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_list_is_lead(p_list text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select coalesce((l ->> 'lead')::boolean, false)
       from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_list limit 1),
    p_list = 'atendimento');
$function$;

CREATE OR REPLACE FUNCTION public.crm_rec_status(p_list text, p_want text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_want
        and not coalesce((s ->> 'done')::boolean, false) limit 1),
    (select s ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality s(s, i)
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and not coalesce((s ->> 'done')::boolean, false)
      order by i limit 1));
$function$;

CREATE OR REPLACE FUNCTION public.crm_status_done(p_list text, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(bool_or(coalesce((s ->> 'done')::boolean, false)), false)
    from public.documents_u d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$function$;

CREATE OR REPLACE FUNCTION public.crm_status_lost(p_list text, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(bool_or(coalesce((s ->> 'lost')::boolean, false)), false)
    from public.documents_u d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$function$;

CREATE OR REPLACE FUNCTION public.delete_patient_health(p_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'delete')) then
    raise exception 'Sem permissão para excluir pacientes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
              where d.path = 'patients/all' and x ->> 'id' = p_id) then
    raise exception 'O paciente ainda está no cadastro.' using errcode = '42501';
  end if;
  delete from public.patient_health where patient_id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.intake_form(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  perform set_config('pipo.unit', l.unit_id, true);   -- tudo o que a página lê vem da unidade do link
  select data into c from public.documents_u where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents_u where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'name', '')) as n
      from public.documents_u d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', ''),
                                  'redes', case when jsonb_typeof(c -> 'redes') = 'array' then c -> 'redes' else '[]'::jsonb end),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'escolas', public.intake_names('config/schools'), 'medicos', public.intake_names('config/doctors'), 'campos', coalesce(cf, '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.intake_names(p_path text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) from (
    select distinct btrim(coalesce(e ->> 'name', e ->> 'nome', '')) as n
      from public.documents_u d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = p_path and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
$function$;

CREATE OR REPLACE FUNCTION public.intake_remind()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; lst text; sts text; n integer := 0;
begin
  if not public.intake_can() then return 0; end if;
  select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
    from public.documents_u d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, k)
   where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
   order by (e ->> 'id' = 'atendimento') desc, k limit 1;
  if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null and reminded_at is null
              and expires_at is not null and expires_at < now() and unit_id = public.active_unit() for update skip locked loop
    insert into public.tasks (list_id, status, title, description, due_date, assignees, patient_id, lead)
    values (lst, coalesce(sts, 'triagem'), 'Cobrar cadastro pelo link: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
            'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || coalesce(' por ' || nullif(l.created_by_name, ''), '') || ' venceu sem ser preenchido. Cobre a família e envie um novo link.' ||
              case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
            current_date,
            case when l.created_by is not null and public.crm_user_can(l.created_by, lst) then array[l.created_by] else '{}'::uuid[] end,
            l.patient_id,
            case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end);
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set reminded_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.intake_send(p_token text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; st text; k text; v text; clean jsonb := '{}'::jsonb; tid uuid; lst text; sts text; cf jsonb; fk text; miss text[] := '{}';
  keys text[] := array['nome', 'nascimento', 'cpf', 'sexo', 'respNome', 'respParentesco', 'telefone', 'email', 'cep', 'rua', 'numero',
                       'compl', 'bairro', 'cidade', 'uf', 'convenio', 'diagnostico', 'laudo', 'escola', 'escolaTurno', 'comoConheceu', 'obs',
                       'rg', 'cns', 'entrada', 'respProfissao', 'convenioOutro', 'maeNome', 'maeCpf', 'maeProfissao', 'paiNome', 'paiCpf', 'paiProfissao',
                       'finNome', 'finDoc', 'finTelefone', 'finEmail', 'escolaSerie', 'professor', 'mediador', 'medico',
                       'diagData', 'suporte', 'comunicacao', 'alergias', 'medicacoes', 'restricoes', 'telNome', 'finQuem',
                       'plano', 'carteirinha', 'carteirinhaValidade'];
  lk text; it jsonb; arr jsonb; o jsonb; ra jsonb := '{}'::jsonb; dd text; pp text; cell jsonb;
begin
  select * into l from public.intake_links where token = p_token for update;
  st := public.intake_link_state(l);
  perform set_config('pipo.unit', l.unit_id, true);   -- tarefa, envio e leituras ficam na unidade do link
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 30000 then return jsonb_build_object('ok', false, 'motivo', 'dados'); end if;
  foreach k in array keys loop
    v := left(btrim(coalesce(p_data ->> k, '')), case when k = 'obs' then 2000 else 300 end);
    if v <> '' then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  -- Listas de pessoas (até 10, só nome/parentesco/telefone/observação) e rotina atual (seg..sex, manhã/tarde).
  foreach lk in array array['retirada', 'protetiva'] loop
    arr := '[]'::jsonb;
    if jsonb_typeof(p_data -> lk) = 'array' then
      for it in select x from jsonb_array_elements(p_data -> lk) with ordinality t(x, n) where jsonb_typeof(x) = 'object' order by n limit 10 loop
        o := '{}'::jsonb;
        foreach k in array array['nome', 'rel', 'telefone', 'obs'] loop
          v := left(btrim(coalesce(it ->> k, '')), 300);
          if v <> '' then o := o || jsonb_build_object(k, v); end if;
        end loop;
        if coalesce(o ->> 'nome', '') <> '' then arr := arr || jsonb_build_array(o); end if;
      end loop;
    end if;
    if jsonb_array_length(arr) > 0 then clean := clean || jsonb_build_object(lk, arr); end if;
  end loop;
  if jsonb_typeof(p_data -> 'rotinaAtual') = 'object' then
    foreach dd in array array['seg', 'ter', 'qua', 'qui', 'sex'] loop
      foreach pp in array array['m', 't'] loop
        cell := p_data -> 'rotinaAtual' -> dd -> pp;
        if jsonb_typeof(cell) = 'object' and (cell ->> 'tipo') in ('escola', 'pipo', 'terapia', 'atividade', 'casa', 'outro') then
          o := jsonb_build_object('tipo', cell ->> 'tipo');
          if btrim(coalesce(cell ->> 'txt', '')) <> '' then o := o || jsonb_build_object('txt', left(btrim(cell ->> 'txt'), 120)); end if;
          ra := jsonb_set(case when ra ? dd then ra else ra || jsonb_build_object(dd, '{}'::jsonb) end, array[dd, pp], o);
        end if;
      end loop;
    end loop;
    if ra <> '{}'::jsonb then clean := clean || jsonb_build_object('rotinaAtual', ra); end if;
  end if;
  if coalesce((p_data ->> 'consentimento')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'motivo', 'obrigatorio');
  end if;
  -- Nome e telefone podem ser escolhidos em Campos obrigatórios; o envio precisa ter pelo menos um dado que identifique.
  if coalesce(clean ->> 'nome', '') = '' and coalesce(clean ->> 'telefone', '') = '' and coalesce(clean ->> 'cpf', '') = '' and coalesce(clean ->> 'email', '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'vazio');
  end if;
  -- Obrigatórios escolhidos em Campos obrigatórios (config/patient_fields.link.individual | geral).
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents_u where path = 'config/patient_fields';
  if jsonb_typeof(cf) is distinct from 'object' then cf := '{"nascimento": {"req": true}, "cpf": {"req": true}}'::jsonb; end if;
  -- Configuração gravada antes de nome/telefone serem escolhíveis: continuam obrigatórios.
  if not cf ? 'nome' then cf := cf || '{"nome": {"req": true}}'::jsonb; end if;
  if not cf ? 'telefone' then cf := cf || '{"telefone": {"req": true}}'::jsonb; end if;
  for fk in select key from jsonb_each(cf) where coalesce((value ->> 'req')::boolean, false) loop
    if fk = 'responsavel' then
      null;   -- "Responsável e parentesco" saiu do link (2026-10-11): os dados vêm de Mãe, Pai, Contato e Financeiro.
    elsif fk = 'endereco' then
      if coalesce(clean ->> 'cep', '') = '' or coalesce(clean ->> 'numero', '') = '' or coalesce(clean ->> 'rua', '') = '' or coalesce(clean ->> 'cidade', '') = '' then miss := miss || fk; end if;
    elsif fk = 'mae' then
      if coalesce(clean ->> 'maeNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'pai' then
      if coalesce(clean ->> 'paiNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'financeiro' then
      if coalesce(clean ->> 'finNome', '') = '' and not (clean ->> 'finQuem' = 'Mãe' and coalesce(clean ->> 'maeNome', '') <> '')
         and not (clean ->> 'finQuem' = 'Pai' and coalesce(clean ->> 'paiNome', '') <> '') then miss := miss || fk; end if;
    elsif fk = 'rotina' then
      if not clean ? 'retirada' then miss := miss || fk; end if;
    elsif fk in ('protetiva', 'rotinaAtual') then
      if not clean ? fk then miss := miss || fk; end if;
    elsif fk = any(keys) and coalesce(clean ->> fk, '') = '' then miss := miss || fk;
    end if;
  end loop;
  if array_length(miss, 1) > 0 then return jsonb_build_object('ok', false, 'motivo', 'obrigatorio', 'campos', to_jsonb(miss)); end if;
  clean := clean || jsonb_build_object('consentimento', true, 'consentimentoEm', now());
  if l.kind = 'geral' and (select count(*) from public.intake_submissions where kind = 'geral' and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  tid := l.task_id;
  if l.kind = 'geral' then
    -- Lead novo no CRM: lista Atendimento (ou a primeira lista de atendimento), primeiro status.
    select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
      from public.documents_u d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, n)
     where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
     order by (e ->> 'id' = 'atendimento') desc, n limit 1;
    if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
    insert into public.tasks (list_id, status, title, description, lead, created_by_name)
    values (lst, coalesce(sts, 'triagem'), 'Cadastro pelo link: ' || coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome'),
            'Cadastro enviado pelo link da clínica. Revise em Cadastros → Pacientes → Revisar cadastro.',
            jsonb_strip_nulls(jsonb_build_object('nome', clean ->> 'nome', 'telefone', regexp_replace(clean ->> 'telefone', '\D', '', 'g'),
                                                 'diagnostico', clean ->> 'diagnostico', 'convenio', clean ->> 'convenio')),
            'Link de cadastro')
    returning id into tid;
  end if;
  if tid is not null then
    insert into public.task_events (task_id, kind, data, author_name)
    values (tid, 'field', jsonb_build_object('campo', 'cadastro_link', 'para', coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome')), 'Família (link de cadastro)');
  end if;
  insert into public.intake_submissions (token, kind, patient_id, task_id, data)
  values (l.token, l.kind, l.patient_id, tid, clean);
  if l.kind <> 'geral' then
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set used_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
  end if;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_prof_update(p_id uuid, p_sections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.profiles_professional_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(coalesce(item ->> 'nome', item ->> 'name')) into v_name
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_group(p_id text, p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = p_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o grupo com o nome novo antes.';
  end if;
  perform set_config('pipo.merging', '1', true);   -- mesmo grupo, nome novo
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt);
end $function$;

CREATE OR REPLACE FUNCTION public.rename_patient(p_id text, p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o cadastro do paciente com o nome novo antes.';
  end if;
  select exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.sys_rule(p_id text, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select d.data -> 'rules' ->> p_id from public.documents_u d where d.path = 'config/system'), p_default);
$function$;

CREATE OR REPLACE FUNCTION public.tasks_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1
      from public.documents_u d,
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
end $function$;

CREATE OR REPLACE FUNCTION public.report_appointments_with_records(p_from date, p_to date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and a.unit_id = public.active_unit()
      and (v_scope is null or a.professional_id = v_scope);
end;
$function$;

CREATE OR REPLACE FUNCTION public.group_slot_appointments(p_id uuid)
 RETURNS SETOF appointments
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then return; end if;
  select * into g from public.appointments where id = p_id and unit_id = public.active_unit();
  if g.id is null or g.room_id is null then return; end if;
  if v_scope is not null and g.professional_id is distinct from v_scope then return; end if;
  return query
    select a.* from public.appointments a
     where a.room_id = g.room_id and a.date = g.date and a.time = g.time
       and a.id <> g.id and not coalesce(a.blocked, false)
       and a.group_id is null and a.unit_id = public.active_unit();
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_task_usage()
 RETURNS TABLE(list_id text, status text, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query select t.list_id, t.status, count(*) from public.tasks t where t.unit_id = public.active_unit() group by t.list_id, t.status;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_people()
 RETURNS TABLE(id uuid, full_name text, admin boolean, crm boolean, lists text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name,
         coalesce(r.is_admin, false) as admin,
         coalesce(r.is_admin, false) or (
           case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                else exists (select 1 from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                              where e.key like 'crm\_%' and e.key <> 'crm_listas'
                                and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)) end
         ) as crm,
         coalesce((select array_agg(substr(e.key, 5) order by e.key)
                     from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                    where e.key like 'crm\_%' and e.key <> 'crm_listas'
                      and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)),
                  '{}'::text[]) as lists
    from public.profiles p left join public.roles r on r.id = p.role_id
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
     and (p.unit_id = public.active_unit() or coalesce(r.is_manager, false))
   order by p.full_name;
$function$;

-- Seguir tarefa (2026-10-13, migração 2026-10-13-seguir-tarefa.sql)
-- Seguir / deixar de seguir: qualquer pessoa que vê a lista (não precisa poder editar a tarefa).
create or replace function public.task_follow(p_task uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.' using errcode = '42501'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit()
     or not public.crm_user_can(auth.uid(), t.list_id) then
    raise exception 'Sem acesso a esta tarefa.' using errcode = '42501';
  end if;
  update public.tasks
     set followers = case when p_on then (select coalesce(array_agg(distinct f), '{}') from unnest(followers || auth.uid()) f)
                          else array_remove(followers, auth.uid()) end
   where id = p_task;
end $$;
revoke execute on function public.task_follow(uuid, boolean) from public, anon;
grant execute on function public.task_follow(uuid, boolean) to authenticated;

-- Quem recebe: seguidor ≠ autor, com acesso à lista, que não foi mencionado (esse já recebe o aviso de menção).
create or replace function public.push_follow_targets(p_event uuid)
returns table (user_id uuid, task_id uuid, title text, author text, acao text)
language sql stable security definer set search_path = public as $$
  select distinct f, t.id, t.title, coalesce(e.author_name, 'Alguém'),
         case e.kind when 'comment' then 'comentou' when 'status' then 'mudou o status' else 'alterou a tarefa' end
    from public.task_events e
    join public.tasks t on t.id = e.task_id
    cross join lateral unnest(t.followers) f
   where e.id = p_event
     and f is distinct from e.author_id
     and not (f = any(coalesce(e.mentions, '{}')))
     and public.crm_user_can(f, t.list_id);
$$;
revoke execute on function public.push_follow_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_follow_targets(uuid) to service_role;

-- Anexos das tarefas no Drive (2026-10-13, migração 2026-10-13b-anexos-de-tarefas.sql)
-- Arquivo no Google Drive (pasta por paciente: Documentos / Relatórios); aqui só nome, código do arquivo e autor.
create table if not exists public.task_attachments (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  patient_id      text,
  kind            text not null check (kind in ('documentos', 'relatorios')),
  drive_file_id   text not null,
  name            text not null check (char_length(name) between 1 and 250),
  mime            text,
  size            bigint,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  unit_id         text not null default 'unidade-1'
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id, created_at);
create index if not exists task_attachments_patient_idx on public.task_attachments (patient_id);

create table if not exists public.patient_drive_folders (
  patient_id    text not null,
  unit_id       text not null default 'unidade-1',
  folder_id     text not null,
  documentos_id text not null,
  relatorios_id text not null,
  created_at    timestamptz not null default now(),
  primary key (patient_id, unit_id)
);
alter table public.patient_drive_folders enable row level security;
revoke all on public.patient_drive_folders from public, anon, authenticated;

-- Pode ver / anexar? (view = ver e baixar; create, edit e delete = poder editar a lista da tarefa)
create or replace function public.task_attachment_can(p_task uuid, p_kind text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit() then return false; end if;
  if not public.has_perm('crm_' || t.list_id, case when p_action = 'view' then 'view' else 'edit' end) then
    return false;
  end if;
  if p_kind = 'documentos' and not public.has_perm('saude_paciente', 'view') then return false; end if;
  return true;
end $$;
revoke execute on function public.task_attachment_can(uuid, text, text) from public, anon;
grant execute on function public.task_attachment_can(uuid, text, text) to authenticated;

-- Paciente da tarefa (código e nome) para a função do servidor montar a pasta e o nome do arquivo.
create or replace function public.task_attachment_ctx(p_task uuid)
returns table (patient_id text, patient_name text, unit_id text)
language plpgsql stable security definer set search_path = public as $$
declare t public.tasks%rowtype; v_name text;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.' using errcode = '42501'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit()
     or not public.has_perm('crm_' || t.list_id, 'view') then
    raise exception 'Sem acesso a esta tarefa.' using errcode = '42501';
  end if;
  if t.patient_id is not null then
    select btrim(p ->> 'nome') into v_name
      from public.documents_u d, jsonb_array_elements(d.data -> 'list') p
     where d.path = 'patients/all' and p ->> 'id' = t.patient_id
     limit 1;
  end if;
  return query select t.patient_id, v_name, t.unit_id;
end $$;
revoke execute on function public.task_attachment_ctx(uuid) from public, anon;
grant execute on function public.task_attachment_ctx(uuid) to authenticated;

alter table public.task_attachments enable row level security;
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (public.task_attachment_can(task_id, kind, 'view'));
drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (public.task_attachment_can(task_id, kind, 'create'));
drop policy if exists task_attachments_update on public.task_attachments;
create policy task_attachments_update on public.task_attachments for update to authenticated
  using (public.task_attachment_can(task_id, kind, 'edit'))
  with check (public.task_attachment_can(task_id, kind, 'edit'));
drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (public.task_attachment_can(task_id, kind, 'delete'));
grant select, insert, update, delete on public.task_attachments to authenticated;

-- Unidade (mesma regra das outras tabelas)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'task_attachments_0_unit_stamp' and not tgisinternal) then
    create trigger task_attachments_0_unit_stamp before insert or update on public.task_attachments
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_attachments' and policyname = 'task_attachments_unit') then
    create policy task_attachments_unit on public.task_attachments as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

-- Quem enviou: sempre quem está logado
create or replace function public.task_attachments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
    select p.full_name into new.created_by_name from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists task_attachments_stamp on public.task_attachments;
create trigger task_attachments_stamp before insert on public.task_attachments
  for each row execute function public.task_attachments_stamp();

-- Histórico da tarefa
create or replace function public.task_attachments_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_task uuid; v_data jsonb;
begin
  v_task := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  if not exists (select 1 from public.tasks where id = v_task) then return null; end if;
  select p.full_name into v_name from public.profiles p where p.id = auth.uid();
  if tg_op = 'INSERT' then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'anexou', 'para', new.name, 'pasta', new.kind);
  elsif tg_op = 'DELETE' then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'excluiu', 'de', old.name, 'pasta', old.kind);
  elsif new.name is distinct from old.name then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'renomeou', 'de', old.name, 'para', new.name, 'pasta', new.kind);
  else
    return null;
  end if;
  insert into public.task_events (task_id, kind, data, author_id, author_name)
  values (v_task, 'field', v_data, auth.uid(), v_name);
  return null;
end $$;
drop trigger if exists task_attachments_history on public.task_attachments;
create trigger task_attachments_history after insert or update or delete on public.task_attachments
  for each row execute function public.task_attachments_history();

-- Backup e restauração por quem não é usuário: a restauração do app não leva os anexos (só os registros;
-- os arquivos continuam no Drive). Nada a fazer aqui.

-- ===== 2026-10-13c-motivos-de-bloqueio.sql =====
-- Cadastro de Motivos de Bloqueio (2026-10-13)
--   config/block_reasons  Cadastros → Motivos de Bloqueio  (permissão "motivos_bloqueio")
--   {list:[{id, name}]}  — o paciente guarda o id em patients/all (bloqueado, bloqueioMotivo, bloqueioObs, bloqueioDesde, bloqueioPor)
-- 1. caminho permitido  2. módulo do caminho  3. níveis começam com o mesmo acesso de Origens.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|block_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'
    when p_path = 'config/crm_automations'  then 'crm_listas'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('motivos_bloqueio', coalesce(permissions -> 'origens', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'motivos_bloqueio');

-- Conferência: caminho aceito | função conhece o caminho | níveis com a permissão
select (select pg_get_constraintdef(oid) like '%block_reasons%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       (public.module_for_path('config/block_reasons') = 'motivos_bloqueio') as funcao_ok,
       (select count(*) from public.roles where not coalesce(is_admin, false) and permissions ? 'motivos_bloqueio') as niveis_com_permissao;

-- ===== 2026-10-13d-permissoes-crm-separadas.sql =====

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object(
          'crmlistas', coalesce(permissions -> 'crm_listas', '{}'::jsonb),
          'crmautomacoes', jsonb_build_object(
            'view', coalesce((permissions -> 'crm_listas' ->> 'view')::boolean, false),
            'edit', coalesce((permissions -> 'crm_listas' ->> 'edit')::boolean, false)))
 where not coalesce(is_admin, false)
   and permissions ? 'crm_listas'
   and not (permissions ? 'crmlistas');

create or replace function public.crm_auto_run_now()
returns integer language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crmautomacoes', 'edit')) then
    raise exception 'Sem permissão para rodar as automações.';
  end if;
  return public.crm_auto_run(true);
end $$;

alter policy crm_auto_log_select on public.crm_auto_log
  using (public.is_admin() or public.has_perm('crmautomacoes', 'view'));

-- ===== 2026-10-13e-atividades.sql =====
-- Cadastro de Atividades (2026-10-13)
--   config/activities  Prontuário ▾ → Atividades  (permissão "atividades")
--   {list:[{id, name, descricao, materiais, duracao, faixas, specIds, goalIds, inativo}]}
--   goalIds = objetivos do Banco de objetivos (config/goal_bank) que a atividade trabalha. Cadastro da empresa (igual aos Objetivos).
-- 1. caminho permitido  2. módulo do caminho  3. níveis começam com o mesmo acesso de Objetivos.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|activities|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|block_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/activities'       then 'atividades'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('atividades', coalesce(permissions -> 'objetivos', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'atividades');

-- Conferência: caminho aceito | função conhece o caminho | níveis com a permissão
select (select pg_get_constraintdef(oid) like '%activities%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       (public.module_for_path('config/activities') = 'atividades') as funcao_ok,
       (select count(*) from public.roles where not coalesce(is_admin, false) and permissions ? 'atividades') as niveis_com_permissao;

-- CRM: Caixa de Entrada (2026-10-13f)
create table if not exists public.task_inbox (
  user_id        uuid not null default auth.uid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  cleared_at     timestamptz,
  snoozed_until  timestamptz,
  mark_unread    boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (user_id, task_id)
);
alter table public.task_inbox enable row level security;
drop policy if exists task_inbox_own on public.task_inbox;
create policy task_inbox_own on public.task_inbox for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.task_inbox to authenticated;

create or replace function public.crm_inbox(p_days int default 30)
returns table(task_id uuid, last_at timestamptz, total int, news int, unseen int, mentioned boolean,
              cleared_at timestamptz, snoozed_until timestamptz, mark_unread boolean, events jsonb)
language sql stable security invoker set search_path = public as $$
  with me as (select auth.uid() as u),
  mine as (
    select t.id from public.tasks t, me
     where me.u = any(t.assignees) or me.u = any(t.followers) or t.created_by = me.u
        or exists (select 1 from public.task_events m where m.task_id = t.id and me.u = any(m.mentions))
  ),
  ev as (
    select e.id, e.task_id, e.kind, e.body, e.data, e.mentions, e.author_id, e.author_name, e.created_at
      from public.task_events e
     where e.task_id in (select id from mine) and e.created_at > now() - make_interval(days => greatest(p_days, 1))
    union all
    -- Vencimento: tarefa em aberto que a pessoa responde ou segue e que chegou na data (às 8h de Brasília do dia).
    select null::uuid, t.id, 'field', '', jsonb_build_object('campo', 'vencimento', 'due', true, 'due_date', t.due_date),
           '{}'::uuid[], null::uuid, 'Vencimento',
           ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo')
      from public.tasks t, me
     where t.due_date is not null
       and (me.u = any(t.assignees) or me.u = any(t.followers))
       and not public.crm_status_done(t.list_id, t.status)
       and ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo') <= now()
       and ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo') > now() - make_interval(days => greatest(p_days, 1))
  )
  select t.id,
         max(e.created_at),
         count(*)::int,
         count(*) filter (where e.author_id is distinct from (select u from me) and e.created_at > coalesce(i.cleared_at, '-infinity'::timestamptz))::int,
         count(*) filter (where e.author_id is distinct from (select u from me) and e.created_at > coalesce(r.seen_at, '-infinity'::timestamptz))::int,
         bool_or((select u from me) = any(e.mentions)),
         i.cleared_at, i.snoozed_until, coalesce(i.mark_unread, false),
         (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'body', x.body, 'data', x.data, 'author_id', x.author_id,
                  'author_name', x.author_name, 'created_at', x.created_at, 'mine', x.author_id = (select u from me),
                  'mention', (select u from me) = any(x.mentions)) order by x.created_at desc), '[]'::jsonb)
            from (select y.* from ev y where y.task_id = t.id order by y.created_at desc limit 5) x)
    from public.tasks t
    join ev e on e.task_id = t.id
    left join public.task_inbox i on i.task_id = t.id and i.user_id = (select u from me)
    left join public.task_reads r on r.task_id = t.id and r.user_id = (select u from me)
   group by t.id, i.cleared_at, i.snoozed_until, i.mark_unread
$$;
grant execute on function public.crm_inbox(int) to authenticated;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('crmcaixa', jsonb_build_object('view', coalesce((permissions -> 'crm_listas' ->> 'view')::boolean, false)))
 where not coalesce(is_admin, false)
   and permissions ? 'crm_listas'
   and not (permissions ? 'crmcaixa');



-- Empréstimo a colaborador e abatimento em conta a pagar (2026-10-14b)
alter table public.finance_loans    add column if not exists staff_id text;
alter table public.finance_payables add column if not exists staff_id text;
alter table public.finance_payables add column if not exists abate_id uuid references public.finance_payables(id) on delete set null;
create index if not exists finance_payables_abate_idx on public.finance_payables (abate_id) where abate_id is not null;

create or replace function public.finance_payables_abate_guard()
returns trigger language plpgsql set search_path = public as $$
declare alvo public.finance_payables;
begin
  if new.abate_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.abate_id is not distinct from old.abate_id and new.entry_id is not distinct from old.entry_id then return new; end if;
  if new.loan_id is null or coalesce(new.parcela, 0) < 1 then raise exception 'Só parcela de empréstimo pode ser abatida.'; end if;
  if new.entry_id is not null then raise exception 'Esta parcela já foi baixada.'; end if;
  if new.abate_id = new.id then raise exception 'A parcela não pode abater nela mesma.'; end if;
  select * into alvo from public.finance_payables where id = new.abate_id;
  if not found then raise exception 'Conta a pagar do abatimento não encontrada.'; end if;
  if alvo.entry_id is not null then raise exception 'A conta a pagar escolhida já foi paga.'; end if;
  if alvo.loan_id is not null then raise exception 'Escolha uma conta a pagar que não seja de empréstimo.'; end if;
  if coalesce(alvo.staff_id, '') = '' or alvo.staff_id is distinct from new.staff_id then
    raise exception 'O abatimento só vale em conta a pagar do mesmo colaborador.';
  end if;
  return new;
end $$;
drop trigger if exists finance_payables_abate_guard on public.finance_payables;
create trigger finance_payables_abate_guard before insert or update of abate_id, entry_id on public.finance_payables
  for each row execute function public.finance_payables_abate_guard();


-- Contratos (2026-10-14c): caminho config/contract_templates e módulo "contratos"
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|activities|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|contract_templates|block_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/activities'       then 'atividades'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/contract_templates' then 'contratos'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

