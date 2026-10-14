-- Empréstimo a colaborador e abatimento em conta a pagar (2026-10-14)
-- finance_loans.staff_id  = colaborador tomador (vazio = nome digitado em `contraparte`)
-- finance_payables.staff_id = colaborador da conta a pagar (folha, adiantamento…)
-- finance_payables.abate_id = (na parcela de um empréstimo) conta a pagar do MESMO colaborador onde a parcela é descontada.
-- Pode rodar de novo.

alter table public.finance_loans    add column if not exists staff_id text;
alter table public.finance_payables add column if not exists staff_id text;
alter table public.finance_payables add column if not exists abate_id uuid references public.finance_payables(id) on delete set null;
create index if not exists finance_payables_abate_idx on public.finance_payables (abate_id) where abate_id is not null;

create or replace function public.finance_payables_abate_guard()
returns trigger language plpgsql set search_path = public as $$
declare alvo public.finance_payables;
begin
  if new.abate_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.abate_id is not distinct from old.abate_id and new.entry_id is not distinct from old.entry_id then return new; end if;
  if new.loan_id is null or coalesce(new.parcela, 0) < 1 then raise exception 'Só parcela de empréstimo pode ser abatida.'; end if;
  if new.entry_id is not null then raise exception 'Esta parcela já foi baixada.'; end if;
  if new.abate_id = new.id then raise exception 'A parcela não pode abater nela mesma.'; end if;
  select * into alvo from public.finance_payables where id = new.abate_id;
  if not found then raise exception 'Conta a pagar do abatimento não encontrada.'; end if;
  if alvo.entry_id is not null then raise exception 'A conta a pagar escolhida já foi paga.'; end if;
  if alvo.loan_id is not null then raise exception 'Escolha uma conta a pagar que não seja de empréstimo.'; end if;
  if coalesce(alvo.staff_id, '') = '' or alvo.staff_id is distinct from new.staff_id then
    raise exception 'O abatimento só vale em conta a pagar do mesmo colaborador.';
  end if;
  return new;
end $$;
drop trigger if exists finance_payables_abate_guard on public.finance_payables;
create trigger finance_payables_abate_guard before insert or update of abate_id, entry_id on public.finance_payables
  for each row execute function public.finance_payables_abate_guard();

select (select count(*) from information_schema.columns where table_name = 'finance_payables' and column_name in ('staff_id', 'abate_id')) as colunas_payables,
       (select count(*) from information_schema.columns where table_name = 'finance_loans' and column_name = 'staff_id') as coluna_loans,
       (select count(*) from pg_trigger where tgname = 'finance_payables_abate_guard') as trava;
