-- Conciliação: uma linha do extrato pode ter VÁRIOS lançamentos (2026-10-20)
-- Juntar (vários lançamentos numa linha só) e dividir (uma linha do extrato em vários lançamentos) usam a mesma tabela de vínculos:
-- cada lançamento liga a UMA linha (chave = entry_id); uma linha pode ter vários lançamentos. `finance_statement_lines.entry_id`
-- continua guardando o primeiro lançamento da linha (compatibilidade). Pode rodar de novo.

create table if not exists public.finance_statement_links (
  entry_id    uuid primary key references public.finance_entries(id) on delete cascade,
  line_id     uuid not null references public.finance_statement_lines(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  unit_id     text not null default 'unidade-1'
);
create index if not exists finance_statement_links_line on public.finance_statement_links (line_id);
alter table public.finance_statement_links enable row level security;
grant select, insert, update, delete on public.finance_statement_links to authenticated;

create or replace function public.finance_statement_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_statement_links_stamp on public.finance_statement_links;
create trigger finance_statement_links_stamp before insert on public.finance_statement_links
  for each row execute function public.finance_statement_links_stamp();

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'finance_statement_links_0_unit_stamp' and not tgisinternal) then
    create trigger finance_statement_links_0_unit_stamp before insert or update on public.finance_statement_links
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'finance_statement_links' and policyname = 'finance_statement_links_unit') then
    create policy finance_statement_links_unit on public.finance_statement_links as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

drop policy if exists finance_statement_links_select on public.finance_statement_links;
create policy finance_statement_links_select on public.finance_statement_links
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_statement_links_insert on public.finance_statement_links;
create policy finance_statement_links_insert on public.finance_statement_links
  for insert to authenticated with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_statement_links_update on public.finance_statement_links;
create policy finance_statement_links_update on public.finance_statement_links
  for update to authenticated using (public.has_perm('financeiro', 'edit')) with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_statement_links_delete on public.finance_statement_links;
create policy finance_statement_links_delete on public.finance_statement_links
  for delete to authenticated using (public.has_perm('financeiro', 'edit'));

-- vínculos que já existem (um lançamento por linha)
insert into public.finance_statement_links (entry_id, line_id, unit_id)
select l.entry_id, l.id, l.unit_id from public.finance_statement_lines l
 where l.entry_id is not null
on conflict (entry_id) do nothing;

do $$ begin
  alter publication supabase_realtime add table public.finance_statement_links;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: tabela | RLS | 4 políticas + a da unidade | vínculos copiados
select to_regclass('public.finance_statement_links') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.finance_statement_links'::regclass) as rls,
       (select count(*) from pg_policies where tablename = 'finance_statement_links') as politicas,
       (select count(*) from public.finance_statement_links) as vinculos;
