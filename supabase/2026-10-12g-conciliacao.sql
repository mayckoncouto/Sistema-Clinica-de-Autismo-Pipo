-- Financeiro: Conciliação com o extrato do banco (2026-10-12)
--   public.finance_statement_lines  linhas do extrato importadas (OFX, Excel ou CSV): conta, data, descrição e valor COM SINAL
--                                   (entrada +, saída −). entry_id liga a linha ao lançamento do sistema (conciliada);
--                                   sem entry_id = pendente. 'key' evita importar a mesma linha duas vezes (conta + chave).
-- Mesma permissão do Financeiro (ver / incluir / editar / excluir). Um lançamento só pode estar ligado a uma linha.
-- Pode rodar de novo.

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

-- Conferência: tabela | RLS | políticas (4) | gatilho | índice único do lançamento
select to_regclass('public.finance_statement_lines') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.finance_statement_lines'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'finance_statement_lines') as politicas,
       exists(select 1 from pg_trigger where tgname = 'finance_statement_stamp' and not tgisinternal) as gatilho,
       exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_statement_entry') as indice;
