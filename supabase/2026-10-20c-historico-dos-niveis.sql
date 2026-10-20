-- Histórico de mudanças nos Níveis de Permissão (2026-10-20)
-- Cada criação, alteração (nome, permissões, "acessa todas as unidades") e exclusão de nível vira uma linha em
-- role_history, com o nível como estava antes e como ficou, quem mudou e quando. Gestor e Administrador leem.
-- Voltar uma versão é feito pela tela (grava o nível de novo; as regras dos níveis continuam valendo).
-- Pode rodar de novo.

create table if not exists public.role_history (
  id bigserial primary key,
  role_id text not null,
  role_name text,
  acao text not null check (acao in ('criou', 'alterou', 'excluiu')),
  antes jsonb,
  depois jsonb,
  by_id uuid,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists role_history_role_idx on public.role_history (role_id, created_at desc);
alter table public.role_history enable row level security;
drop policy if exists role_history_select on public.role_history;
create policy role_history_select on public.role_history for select to authenticated using (public.is_admin());

create or replace function public.roles_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_old jsonb;
  v_new jsonb;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  if tg_op <> 'INSERT' then v_old := jsonb_build_object('name', old.name, 'permissions', old.permissions, 'all_units', old.all_units); end if;
  if tg_op <> 'DELETE' then v_new := jsonb_build_object('name', new.name, 'permissions', new.permissions, 'all_units', new.all_units); end if;
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  insert into public.role_history (role_id, role_name, acao, antes, depois, by_id, by_name)
  values (coalesce(new.id, old.id), coalesce(new.name, old.name),
          case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end,
          v_old, v_new, auth.uid(), coalesce(v_name, case when auth.uid() is null then 'Sistema' end));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists roles_history on public.roles;
create trigger roles_history
  after insert or update or delete on public.roles
  for each row execute function public.roles_history();

revoke all on function public.roles_history() from public, anon;

select to_regclass('public.role_history') is not null as tabela,
       exists(select 1 from pg_trigger where tgname = 'roles_history') as gatilho;
