-- Unidades — Fase 2B: unidade nas tabelas (2026-10-12)
-- Cada registro das tabelas abaixo passa a ter a unidade (`unit_id`, padrão 'unidade-1' = tudo o que já existe).
--   • um gatilho carimba a unidade da pessoa no registro novo (quem usa o sistema não escolhe) e impede mudar depois;
--   • uma regra RESTRITIVA deixa ver e gravar só a unidade ativa (`active_unit()`, da migração 2A), somada às permissões que já existem.
-- Sem usuário (cron, link público, restauração): vale `pipo.unit` (set_config) ou o que veio no registro / Unidade 1.
-- Pode rodar de novo.

create or replace function public.unit_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.unit_id := old.unit_id;
  elsif auth.uid() is not null then
    new.unit_id := public.active_unit();
  elsif nullif(current_setting('pipo.unit', true), '') is not null then
    new.unit_id := current_setting('pipo.unit', true);
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'clinical_records', 'therapy_plans', 'patient_health', 'tasks', 'task_events',
    'staff', 'staff_pay', 'treatment_finance', 'bank_account_finance',
    'finance_entries', 'finance_payables', 'finance_loans', 'finance_statement_lines', 'finance_closings', 'finance_closing_log',
    'intake_links', 'intake_submissions', 'crm_auto_log'
  ] loop
    execute format('alter table public.%I add column if not exists unit_id text not null default %L', t, 'unidade-1');
    if not exists (select 1 from pg_trigger where tgname = t || '_0_unit_stamp' and not tgisinternal) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.unit_stamp()', t || '_0_unit_stamp', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_unit') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()))', t || '_unit', t);
    end if;
  end loop;
end $$;

-- Conferência: tabelas com a coluna | com o gatilho | com a regra | registros fora da Unidade 1
select (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'unit_id' and table_name <> 'profiles') as com_coluna,
       (select count(*) from pg_trigger where tgname like '%\_0\_unit\_stamp' and not tgisinternal) as com_gatilho,
       (select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_unit' and policyname <> 'documents_unit') as com_regra,
       (select count(*) from public.appointments where unit_id <> 'unidade-1') + (select count(*) from public.tasks where unit_id <> 'unidade-1') as fora_da_unidade_1;
