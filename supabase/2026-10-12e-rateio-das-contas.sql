-- Financeiro: rateio das contas a pagar/receber em várias subcategorias (2026-10-12)
--   finance_payables.linhas   [{plan, valor}] — a composição da conta (ex.: parcela de empréstimo = principal + juros).
--                             Vazio = conta de uma subcategoria só (plan_id). Com linhas, plan_id é o da 1ª linha e valor a soma.
--   finance_entries.payable_id  lançamento criado pela baixa de uma conta (uma baixa com rateio cria UM lançamento por linha).
--   finance_payable_settle_split  baixa com rateio numa transação só (security invoker: vale a permissão de quem chama).
-- A função de baixa simples (finance_payable_settle) continua como está. Pode rodar de novo.

alter table public.finance_payables add column if not exists linhas jsonb;
alter table public.finance_entries add column if not exists payable_id uuid references public.finance_payables(id) on delete set null;
create index if not exists finance_entries_payable on public.finance_entries (payable_id) where payable_id is not null;

create or replace function public.finance_payable_settle_split(
  p_id uuid, p_acc text, p_date date, p_linhas jsonb, p_obs text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare pay public.finance_payables; eid uuid; first_id uuid; l jsonb; n int := 0;
begin
  select * into pay from public.finance_payables where id = p_id for update;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if pay.entry_id is not null then raise exception 'Esta conta já foi baixada.'; end if;
  if p_acc is null or p_acc = '' then raise exception 'Escolha a conta bancária.'; end if;
  if p_date is null then raise exception 'Informe a data.'; end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) < 1 then raise exception 'Informe as linhas do rateio.'; end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    if coalesce(l->>'plan', '') = '' or coalesce((l->>'valor')::numeric, -1) < 0 then raise exception 'Linha do rateio inválida.'; end if;
    insert into public.finance_entries (account_id, data, descricao, plan_id, valor, obs, payable_id)
      values (p_acc, p_date, coalesce(nullif(btrim(l->>'desc'), ''), pay.descricao), l->>'plan', (l->>'valor')::numeric,
              coalesce(nullif(btrim(p_obs), ''), pay.obs), p_id)
      returning id into eid;
    n := n + 1;
    if n = 1 then first_id := eid; end if;
  end loop;
  update public.finance_payables set entry_id = first_id, account_id = coalesce(account_id, p_acc) where id = p_id;
  return first_id;
end $$;
revoke all on function public.finance_payable_settle_split(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.finance_payable_settle_split(uuid, text, date, jsonb, text) to authenticated;

-- Conferência: coluna linhas | coluna payable_id | função
select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_payables' and column_name = 'linhas') as linhas,
       exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_entries' and column_name = 'payable_id') as payable_id,
       exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'finance_payable_settle_split') as funcao;
