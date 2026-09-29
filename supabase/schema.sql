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
--   profiles   — um por usuário do Supabase Auth: nome, admin, ativo e a
--                grade de permissões módulo × ação.
--
-- Segurança: RLS em tudo. A leitura exige usuário logado e ativo; a escrita
-- é conferida AÇÃO POR AÇÃO por um trigger (incluir / editar / excluir),
-- então esconder botões na tela não é a única barreira.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null default '',
  full_name   text not null default '',
  is_admin    boolean not null default false,
  active      boolean not null default true,
  permissions jsonb not null default '{
    "agenda":        {"view": true, "create": false, "edit": false, "delete": false},
    "pacientes":     {"view": true, "create": false, "edit": false, "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false}
  }'::jsonb,
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
    path ~ '^(config/(rooms|specialties|convenios|professionals)|patients/all|schedule/(seg|ter|qua|qui|sex)-[1-4])$'
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
  select coalesce((select is_admin and active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_perm(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (p.is_admin or coalesce((p.permissions -> p_module ->> p_action)::boolean, false))
    from public.profiles p where p.id = auth.uid()
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
    when p_path = 'config/rooms'           then 'salas'
  end;
$$;

-- ---------------------------------------------------------------------
-- Perfil criado automaticamente para cada novo usuário do Auth.
-- O PRIMEIRO usuário criado no projeto vira administrador.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, is_admin)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    not exists (select 1 from public.profiles)
  )
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
begin
  new.updated_at := now();
  new.id := old.id;
  new.email := old.email; -- e-mail só muda pelo Auth
  if (old.is_admin and old.active) and not (new.is_admin and new.active) then
    if not exists (
      select 1 from public.profiles
      where is_admin and active and id <> old.id
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

-- Privilégios: nada para anônimos.
revoke all on public.documents from anon;
revoke all on public.profiles  from anon;
grant select, insert, update, delete on public.documents to authenticated;
grant select, update on public.profiles to authenticated;
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
end $$;
