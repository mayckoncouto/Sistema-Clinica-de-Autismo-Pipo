-- Financeiro: Empréstimos tomados e concedidos (2026-10-12)
--   public.finance_loans   o contrato: sentido (tomado = a clínica pegou; concedido = a clínica emprestou), contraparte,
--                          valor, tipo de juros (simples | composto | price | sac), taxa ao mês, nº de parcelas,
--                          data da liberação e vencimento da 1ª parcela. As parcelas são contas em finance_payables
--                          (loan_id); a liberação é a conta de parcela 0.
--   finance_payables.loan_id  liga a conta ao empréstimo.
-- Mesma permissão do Financeiro. Subcategorias novas no Plano de contas (só se ainda não existem).
-- Pode rodar de novo.

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

-- Conferência: tabela | RLS | políticas (4) | coluna loan_id | subcategorias novas (3)
select to_regclass('public.finance_loans') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.finance_loans'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'finance_loans') as politicas,
       exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_payables' and column_name = 'loan_id') as loan_id,
       (select count(*) from public.documents d, jsonb_array_elements(d.data->'list') e
         where d.path = 'config/chart_accounts' and e->>'id' in ('pagamento-de-emprestimos', 'recebimento-de-emprestimos', 'juros-de-emprestimos-concedidos')) as subcategorias;
