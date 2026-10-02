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
