-- Financeiro: Contas a pagar e a receber (2026-10-12)
--   public.finance_payables  contas PREVISTAS (vencimento, valor, subcategoria do Plano de contas, fornecedor, conta).
--                            Quando a conta é paga/recebida, "Baixar" cria o lançamento (finance_entries) e liga os dois
--                            por entry_id. Conta sem entry_id = em aberto. Apagar o lançamento reabre a conta.
--   finance_payable_settle   baixa numa transação só (cria o lançamento + liga). Roda com o nível de quem chama:
--                            precisa de incluir lançamento e editar contas (permissão "Financeiro").
-- Mesma permissão dos Lançamentos (financeiro: ver / incluir / editar / excluir). Nenhum nível novo precisa de ajuste.
-- grupo / parcela / parcelas: contas que se repetem (todo mês ou em N vezes) compartilham o mesmo grupo.
-- Pode rodar de novo.

create table if not exists public.finance_payables (
  id          uuid primary key default gen_random_uuid(),
  vencimento  date not null,
  descricao   text not null default '',
  plan_id     text,                                      -- id da subcategoria em config/chart_accounts (o tipo dá pagar/receber)
  account_id  text,                                      -- conta bancária prevista (opcional)
  supplier_id text,                                      -- id em config/suppliers (opcional)
  valor       numeric(14,2) not null check (valor >= 0),
  entry_id    uuid references public.finance_entries(id) on delete set null,
  grupo       text,
  parcela     integer,
  parcelas    integer,
  obs         text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
create index if not exists finance_payables_venc on public.finance_payables (vencimento);
create index if not exists finance_payables_entry on public.finance_payables (entry_id);
create index if not exists finance_payables_grupo on public.finance_payables (grupo) where grupo is not null;

alter table public.finance_payables enable row level security;
grant select, insert, update, delete on public.finance_payables to authenticated;

create or replace function public.finance_payables_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then                 -- restauração / scripts: mantém o que veio
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists finance_payables_stamp on public.finance_payables;
create trigger finance_payables_stamp
  before insert or update on public.finance_payables
  for each row execute function public.finance_payables_stamp();

drop policy if exists finance_payables_select on public.finance_payables;
create policy finance_payables_select on public.finance_payables
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_payables_insert on public.finance_payables;
create policy finance_payables_insert on public.finance_payables
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_payables_update on public.finance_payables;
create policy finance_payables_update on public.finance_payables
  for update to authenticated
  using (public.has_perm('financeiro', 'edit'))
  with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_payables_delete on public.finance_payables;
create policy finance_payables_delete on public.finance_payables
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

-- Baixa: cria o lançamento e liga à conta, numa transação só (security invoker: vale a permissão de quem chama)
create or replace function public.finance_payable_settle(
  p_id uuid, p_acc text, p_date date, p_valor numeric,
  p_ext_data date default null, p_ext_val numeric default null, p_obs text default null, p_descricao text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare pay public.finance_payables; eid uuid;
begin
  select * into pay from public.finance_payables where id = p_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if pay.entry_id is not null then raise exception 'Esta conta já foi baixada.'; end if;
  if p_acc is null or p_acc = '' then raise exception 'Escolha a conta bancária.'; end if;
  if p_date is null then raise exception 'Informe a data.'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Valor inválido.'; end if;
  insert into public.finance_entries (account_id, data, descricao, plan_id, valor, data_extrato, valor_extrato, obs)
    values (p_acc, p_date, coalesce(nullif(btrim(p_descricao), ''), pay.descricao), pay.plan_id, p_valor, p_ext_data, p_ext_val, coalesce(nullif(btrim(p_obs), ''), pay.obs))
    returning id into eid;
  update public.finance_payables set entry_id = eid, account_id = coalesce(account_id, p_acc) where id = p_id;
  return eid;
end $$;
revoke all on function public.finance_payable_settle(uuid, text, date, numeric, date, numeric, text, text) from public, anon;
grant execute on function public.finance_payable_settle(uuid, text, date, numeric, date, numeric, text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.finance_payables;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: tabela | RLS ligada | políticas (esperado 4) | função | gatilho
select to_regclass('public.finance_payables') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.finance_payables'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'finance_payables') as politicas,
       exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'finance_payable_settle') as funcao,
       exists(select 1 from pg_trigger where tgname = 'finance_payables_stamp' and not tgisinternal) as gatilho;
