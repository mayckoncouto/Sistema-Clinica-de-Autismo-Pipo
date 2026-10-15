-- Vendas dos tratamentos (2026-10-15)
--   public.treatment_sales   uma linha por venda: cada tratamento novo e cada alteração comercial dele (aditivo, renovação)
--                            vira uma venda. A anterior fica 'substituida' (replaced_by aponta para a nova);
--                            tratamento cancelado marca as vendas como 'cancelada'.
--   finance_payables.sale_id liga a conta a receber (parcela) à venda que a gerou.
-- Permissão própria 'vendas' (ver / incluir / editar / excluir): nenhum nível recebe, só o Administrador libera.
-- Pode rodar de novo.

create table if not exists public.treatment_sales (
  id              uuid primary key default gen_random_uuid(),
  treatment_id    text not null,
  patient_id      text not null,
  tipo            text not null default 'nova' check (tipo in ('nova', 'renovacao', 'aditivo')),
  data            date not null default current_date,
  seller_id       text,
  seller_name     text,
  valor_mensal    numeric(14,2) not null default 0,
  meses           integer not null default 1 check (meses between 1 and 120),
  total           numeric(14,2) not null default 0,
  forma           text,
  status          text not null default 'ativa' check (status in ('ativa', 'substituida', 'cancelada')),
  replaced_by     uuid,
  obs             text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  unit_id         text not null default 'unidade-1'
);
create index if not exists treatment_sales_treatment_idx on public.treatment_sales (treatment_id, created_at);
create index if not exists treatment_sales_patient_idx on public.treatment_sales (patient_id);
create index if not exists treatment_sales_data_idx on public.treatment_sales (data);
alter table public.treatment_sales enable row level security;
grant select, insert, update, delete on public.treatment_sales to authenticated;

drop policy if exists treatment_sales_select on public.treatment_sales;
create policy treatment_sales_select on public.treatment_sales
  for select to authenticated using (public.has_perm('vendas', 'view'));
drop policy if exists treatment_sales_insert on public.treatment_sales;
create policy treatment_sales_insert on public.treatment_sales
  for insert to authenticated with check (public.has_perm('vendas', 'create'));
drop policy if exists treatment_sales_update on public.treatment_sales;
create policy treatment_sales_update on public.treatment_sales
  for update to authenticated using (public.has_perm('vendas', 'edit')) with check (public.has_perm('vendas', 'edit'));
drop policy if exists treatment_sales_delete on public.treatment_sales;
create policy treatment_sales_delete on public.treatment_sales
  for delete to authenticated using (public.has_perm('vendas', 'delete'));

-- Quem registrou: sempre quem está logado (a restauração de cópia sem usuário mantém o que veio)
create or replace function public.treatment_sales_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.created_at := coalesce(new.created_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.created_by_name := public.crm_my_name();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
  end if;
  return new;
end $$;
drop trigger if exists treatment_sales_stamp on public.treatment_sales;
create trigger treatment_sales_stamp before insert or update on public.treatment_sales
  for each row execute function public.treatment_sales_stamp();

-- Unidade (mesma regra das outras tabelas)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'treatment_sales_0_unit_stamp' and not tgisinternal) then
    create trigger treatment_sales_0_unit_stamp before insert or update on public.treatment_sales
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'treatment_sales' and policyname = 'treatment_sales_unit') then
    create policy treatment_sales_unit on public.treatment_sales as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.treatment_sales;
exception when duplicate_object or undefined_object then null; end $$;

-- Parcelas geradas pela venda
alter table public.finance_payables add column if not exists sale_id uuid;
create index if not exists finance_payables_sale_idx on public.finance_payables (sale_id) where sale_id is not null;

-- Conferência: tabela | RLS | políticas (4 + unidade) | gatilho | coluna das parcelas
select to_regclass('public.treatment_sales') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.treatment_sales'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'treatment_sales') as politicas,
       exists(select 1 from pg_trigger where tgname = 'treatment_sales_stamp' and not tgisinternal) as gatilho,
       exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_payables' and column_name = 'sale_id') as coluna_parcelas;
