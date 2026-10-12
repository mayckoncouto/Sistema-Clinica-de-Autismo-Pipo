-- Financeiro: um lançamento só pode estar ligado a UMA conta a pagar/receber (2026-10-12)
-- Garante no banco o que o app já confere ao vincular um lançamento existente a uma conta em aberto.
-- Pode rodar de novo.
create unique index if not exists finance_payables_entry_uni on public.finance_payables (entry_id) where entry_id is not null;

-- Conferência: índice criado
select exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_payables_entry_uni') as indice;
