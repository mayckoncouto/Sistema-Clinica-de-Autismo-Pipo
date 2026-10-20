-- Níveis: Gestor (antes "Gestão"), Supervisor com acesso a todas as unidades, Administrador edita os níveis (2026-10-20)
-- • roles.all_units: o nível acessa todas as unidades (troca de unidade no topo). Gestor (is_manager) sempre acessa.
--   Começa ligado só no nível "supervisor". Só o Gestor liga/desliga essa marca.
-- • O Administrador passa a criar, editar e excluir níveis — menos Gestor e Administrador (travados) e os níveis que
--   acessam todas as unidades (Supervisor), que só o Gestor altera.
-- • Quem não é Gestor não dá a ninguém um nível de todas as unidades.
-- • Ordem: Gestor, Supervisor, Administrador, demais.
-- Pode rodar de novo.

-- 1. Coluna
alter table public.roles add column if not exists all_units boolean not null default false;

-- 2. Acessa todas as unidades?
create or replace function public.all_units()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (r.is_manager or r.all_units)
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- 3. Unidade ativa: Gestor e níveis de todas as unidades escolhem (token); os demais usam a do perfil
create or replace function public.active_unit()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if auth.uid() is null then
    return coalesce(nullif(current_setting('pipo.unit', true), ''), 'unidade-1');
  end if;
  if public.all_units() then
    v := nullif(auth.jwt() -> 'user_metadata' ->> 'active_unit', '');
    if v is not null and public.unit_exists(v) then return v; end if;
  end if;
  return coalesce(public.my_unit(), 'unidade-1');
end $$;

-- 4. Guardas dos níveis
create or replace function public.roles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_admin then
    return old;   -- Gestor e Administrador: travados
  end if;
  if auth.uid() is not null and not public.is_manager() then
    if old.all_units then
      raise exception 'Só o Gestor altera um nível que acessa todas as unidades.' using errcode = '42501';
    end if;
    new.all_units := old.all_units;
  end if;
  new.id := old.id;
  new.is_admin := false;
  new.is_manager := old.is_manager;
  new.sort := old.sort;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.roles_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.is_admin := false;
  new.is_manager := false;
  if auth.uid() is not null and not public.is_manager() then
    new.all_units := false;
  end if;
  new.name := btrim(new.name);
  new.sort := coalesce((select max(sort) from public.roles), 0) + 1;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.roles_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if old.is_admin then
    raise exception 'Os níveis Gestor e Administrador não podem ser excluídos.' using errcode = '42501';
  end if;
  if old.all_units and auth.uid() is not null and not public.is_manager() then
    raise exception 'Só o Gestor exclui um nível que acessa todas as unidades.' using errcode = '42501';
  end if;
  select count(*) into n from public.profiles where role_id = old.id;
  if n > 0 then
    raise exception 'Este nível ainda tem % usuário(s). Mude-os de nível antes de excluir.', n using errcode = '23503';
  end if;
  return old;
end $$;

-- 5. Administrador (e Gestor) criam, editam e excluem níveis
alter policy roles_insert on public.roles with check (public.is_admin());
alter policy roles_update on public.roles using (public.is_admin()) with check (public.is_admin());
alter policy roles_delete on public.roles using (public.is_admin());

-- 6. Usuários: a unidade é a ativa (Supervisor em outra unidade vê e edita os usuários dela, se tiver a permissão)
create or replace function public.profiles_unit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_mgr boolean := false;
  v_new_mgr boolean;
  v_old_adm boolean := false;
  v_new_adm boolean;
  v_old_all boolean := false;
  v_new_all boolean;
begin
  if tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id then
    if not public.unit_exists(new.unit_id) then
      raise exception 'Unidade não encontrada.' using errcode = '23503';
    end if;
  end if;
  if auth.uid() is null or public.is_manager() then
    return new;   -- Gestor, service role (API) e scripts
  end if;
  select coalesce(is_manager, false), coalesce(is_admin, false), coalesce(all_units, false) into v_new_mgr, v_new_adm, v_new_all from public.roles where id = new.role_id;
  if tg_op = 'UPDATE' then
    select coalesce(is_manager, false), coalesce(is_admin, false), coalesce(all_units, false) into v_old_mgr, v_old_adm, v_old_all from public.roles where id = old.role_id;
    if new.unit_id is distinct from old.unit_id then
      raise exception 'Só o Gestor muda o usuário de unidade.' using errcode = '42501';
    end if;
    if old.unit_id is distinct from public.active_unit() then
      raise exception 'Este usuário é de outra unidade.' using errcode = '42501';
    end if;
    if v_old_mgr then
      raise exception 'Só o Gestor altera uma conta de Gestor.' using errcode = '42501';
    end if;
    if (v_old_adm or v_old_all) and old.id <> auth.uid() then
      raise exception 'Só o Gestor altera uma conta de Administrador ou Supervisor.' using errcode = '42501';
    end if;
    if new.role_id is distinct from old.role_id and (v_new_mgr or v_new_adm or v_new_all) then
      raise exception 'Só o Gestor dá os níveis Gestor, Supervisor ou Administrador.' using errcode = '42501';
    end if;
  else
    if v_new_mgr or v_new_adm or v_new_all then
      raise exception 'Só o Gestor cria usuários Gestor, Supervisor ou Administrador.' using errcode = '42501';
    end if;
    if new.unit_id is distinct from public.active_unit() then
      raise exception 'Só o Gestor cria usuários em outra unidade.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'view')) and unit_id = public.active_unit()));
alter policy profiles_update on public.profiles
  using (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.active_unit()))
  with check (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.active_unit()));

-- 7. Gestão passa a se chamar Gestor; Supervisor acessa todas as unidades; ordem Gestor, Supervisor, Administrador, demais
alter table public.roles disable trigger roles_guard;
update public.roles set name = 'Gestor' where id = 'gestao' and name <> 'Gestor';
update public.roles set all_units = true where id = 'supervisor' and not all_units;
update public.roles set sort = 0 where id = 'gestao';
update public.roles set sort = 1 where id = 'supervisor';
update public.roles set sort = 2 where id = 'administrador';
update public.roles r set sort = s.n + 2
  from (select id, row_number() over (order by sort, name) n from public.roles
         where id not in ('gestao', 'supervisor', 'administrador')) s
 where r.id = s.id;
alter table public.roles enable trigger roles_guard;

revoke all on function public.all_units() from public, anon;
grant execute on function public.all_units() to authenticated;

-- Conferência
select (select name from public.roles where id = 'gestao') as gestor,
       (select all_units from public.roles where id = 'supervisor') as supervisor_todas,
       (select string_agg(name, ' > ' order by sort) from public.roles) as ordem;
