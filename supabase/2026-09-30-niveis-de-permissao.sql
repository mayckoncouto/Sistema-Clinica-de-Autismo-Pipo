-- =====================================================================
-- Agenda Pipo — Níveis de permissão (2026-09-30)
--
-- Troca "permissão por pessoa" por "permissão por nível":
--   public.roles  — Administrador, Financeiro, Profissional, Secretária,
--                   cada um com a grade módulo × ação.
--   profiles.role_id — o nível de cada usuário.
-- Só quem é do nível Administrador acessa as telas de Usuários e Níveis.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- Usuários atuais: quem era administrador vira "Administrador"; os demais
-- viram "Secretária". Confira o resultado na consulta do final.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabela de níveis + os 4 níveis iniciais
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  id          text primary key,
  name        text not null,
  is_admin    boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.roles enable row level security;

insert into public.roles (id, name, is_admin, sort, permissions) values
  ('administrador', 'Administrador', true, 1, '{
    "agenda":        {"view": true, "create": true, "edit": true, "delete": true},
    "pacientes":     {"view": true, "create": true, "edit": true, "delete": true},
    "profissionais": {"view": true, "create": true, "edit": true, "delete": true},
    "salas":         {"view": true, "create": true, "edit": true, "delete": true}
  }'),
  ('financeiro', 'Financeiro', false, 2, '{
    "agenda":        {"view": true, "create": false, "edit": false, "delete": false},
    "pacientes":     {"view": true, "create": true,  "edit": true,  "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false}
  }'),
  ('profissional', 'Profissional', false, 3, '{
    "agenda":        {"view": true, "create": false, "edit": false, "delete": false},
    "pacientes":     {"view": true, "create": false, "edit": false, "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false}
  }'),
  ('secretaria', 'Secretária', false, 4, '{
    "agenda":        {"view": true, "create": true,  "edit": true,  "delete": true},
    "pacientes":     {"view": true, "create": true,  "edit": true,  "delete": false},
    "profissionais": {"view": true, "create": false, "edit": false, "delete": false},
    "salas":         {"view": true, "create": false, "edit": false, "delete": false}
  }')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Nível de cada usuário
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists role_id text references public.roles(id);

do $$
begin
  -- Só na primeira execução (enquanto a coluna antiga is_admin existe).
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin') then
    execute $q$update public.profiles
               set role_id = case when is_admin then 'administrador' else 'secretaria' end
               where role_id is null$q$;
  end if;
end $$;

update public.profiles set role_id = 'profissional' where role_id is null;
alter table public.profiles alter column role_id set default 'profissional';
alter table public.profiles alter column role_id set not null;

-- ---------------------------------------------------------------------
-- 3. Funções de permissão passam a ler o nível
-- ---------------------------------------------------------------------
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

-- Novo usuário do Auth: o primeiro do projeto vira Administrador; os demais
-- nascem "Profissional" (só visualizar) e o administrador ajusta na tela.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'profissional' else 'administrador' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

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

-- Níveis: o Administrador tem sempre acesso total (não editável); nenhum
-- outro nível pode virar administrador pela tela.
create or replace function public.roles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.is_admin := old.is_admin;
  new.sort := old.sort;
  if old.is_admin then
    new.permissions := old.permissions;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists roles_guard on public.roles;
create trigger roles_guard
  before update on public.roles
  for each row execute function public.roles_guard();

-- ---------------------------------------------------------------------
-- 4. Colunas antigas (profiles.is_admin / profiles.permissions)
-- ---------------------------------------------------------------------
-- Ficam no banco, SEM USO, só para a versão anterior do app continuar
-- funcionando nos minutos entre rodar este script e a nova versão entrar no
-- ar. Nada mais lê essas colunas; podem ser removidas depois com:
--   alter table public.profiles drop column if exists is_admin;
--   alter table public.profiles drop column if exists permissions;

-- ---------------------------------------------------------------------
-- 5. Políticas e privilégios dos níveis
-- ---------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (public.is_active_user());

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.roles from anon;
grant select, update on public.roles to authenticated;

-- Realtime: mudança num nível chega na hora para quem está logado.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'roles'
  ) then
    alter publication supabase_realtime add table public.roles;
  end if;
end $$;

commit;

-- Confira: cada usuário e o nível dele.
select p.full_name, p.email, r.name as nivel, p.active as ativo
from public.profiles p join public.roles r on r.id = p.role_id
order by r.sort, p.full_name;
