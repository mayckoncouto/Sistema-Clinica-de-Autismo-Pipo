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

-- conferência: níveis e os itens novos
select name, is_admin, permissions -> 'usuarios' as usuarios, permissions -> 'backup' as backup,
       permissions -> 'ajuda' as ajuda, permissions -> 'senha' as senha
from public.roles order by is_admin desc, name;
