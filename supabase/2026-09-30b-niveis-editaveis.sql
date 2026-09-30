-- =====================================================================
-- Agenda Pipo — Níveis de permissão editáveis (2026-09-30, parte 2)
--
-- O administrador passa a poder CRIAR, RENOMEAR e EXCLUIR níveis.
-- Regras garantidas pelo banco:
--   * O nível Administrador não pode ser alterado nem excluído.
--   * Nenhum nível criado pela tela vira administrador.
--   * Não dá para excluir um nível que ainda tem usuários.
--   * Nomes de nível não se repetem (sem diferenciar maiúsculas).
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- Identificador do nível: letras minúsculas, números e hífen.
alter table public.roles drop constraint if exists roles_id_format;
alter table public.roles add constraint roles_id_format check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$');

alter table public.roles drop constraint if exists roles_name_not_blank;
alter table public.roles add constraint roles_name_not_blank check (length(btrim(name)) > 0);

create unique index if not exists roles_name_unique on public.roles (lower(btrim(name)));

-- Novo usuário: o nível vem da criação pelo administrador (API), com
-- reserva para "Profissional" ou, se ele não existir mais, o primeiro nível
-- não-administrador. O primeiro usuário do projeto continua sendo admin.
alter table public.profiles alter column role_id drop default;

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

-- Inserção: nunca administrador; vai para o fim da lista.
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

-- Alteração: o Administrador fica totalmente travado; os demais podem mudar
-- nome e permissões, mas nunca virar administrador.
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

-- Exclusão: nem o Administrador, nem nível com usuários.
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

-- Políticas: administrador cria e exclui níveis.
drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (public.is_admin());

grant insert, delete on public.roles to authenticated;

commit;

select id, name, is_admin, sort from public.roles order by sort;
