-- Verificação do banco (SÓ LEITURA). Rodada pelo protocolo "Verificação Completa".
-- Devolve uma linha por item: area | item | valor | situacao (ok / atenção / limpar).
with x as (
  select 'Operação' area, 'Atendimentos passados sem status' item,
         (select count(*) from appointments where blocked is not true and coalesce(patient,'')<>'' and status is null and date < current_date and group_id is null and patient_id is not null) v, 1 limite
  union all select 'Operação','Atendimentos de paciente sem sala',
         (select count(*) from appointments where room_id is null and group_id is null and blocked is not true and coalesce(patient,'')<>'' and patient not in ('Reserva','Reunião Clínica','Treinamento')), 1
  union all select 'Operação','Atendimentos de paciente sem código do paciente',
         (select count(*) from appointments where patient_id is null and group_id is null and blocked is not true and coalesce(patient,'')<>'' and patient not in ('Reserva','Reunião Clínica','Treinamento')), 1
  union all select 'Operação','Tarefas do CRM vencidas e abertas',
         (select count(*) from tasks where due_date < current_date and closed_at is null), 1
  union all select 'Operação','Contas a pagar/receber vencidas há mais de 30 dias',
         (select count(*) from finance_payables where entry_id is null and vencimento < current_date - 30), 1
  union all select 'Operação','Evoluções vazias',
         (select count(*) from clinical_records where coalesce(btrim(regexp_replace(content,'<[^>]*>','','g')),'')=''), 1
  union all select 'Operação','Usuários inativos',
         (select count(*) from profiles where active is not true), 1
  union all select 'Dados desnecessários','Tabelas temporárias ou de cópia (datadas, backup, tmp, imp_, bkp)',
         (select count(*) from pg_tables where schemaname='public' and (tablename ~ '(20261[0-9]{3}$|2026_10_[0-9]{2}$|_bkp|^backup_|_tmp|^imp_|^map_|^sheet_|^import_|^evolucoes_texto|^evo_|^agil_stage)')), 1
  union all select 'Dados desnecessários','Linhas nessas tabelas',
         (select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public' and (relname ~ '(20261[0-9]{3}$|2026_10_[0-9]{2}$|_bkp|^backup_|_tmp|^imp_|^map_|^sheet_|^import_|^evolucoes_texto|^evo_|^agil_stage)')), 1
  union all select 'Segurança','Funções abertas para quem não fez login (esperado: 3 do link de cadastro)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') and p.prokind='f' and p.proname not in ('intake_form','intake_send','intake_link_state','anamnese_form','anamnese_send','anamnese_link_state')
            and p.prosecdef), 1
  union all select 'Segurança','Tabelas do app sem RLS',
         (select count(*) from pg_tables where schemaname='public' and not rowsecurity), 1
  union all select 'Integridade','Atendimentos apontando para paciente que não existe',
         (select count(*) from appointments a where a.patient_id is not null and not exists (select 1 from documents d, jsonb_array_elements(d.data->'list') p where d.path='patients/all' and p->>'id'=a.patient_id)), 1
  union all select 'Integridade','Evoluções apontando para paciente que não existe',
         (select count(*) from clinical_records c where c.patient_id is not null and not exists (select 1 from documents d, jsonb_array_elements(d.data->'list') p where d.path='patients/all' and p->>'id'=c.patient_id)), 1
  union all select 'Integridade','Tarefas com responsável que não é usuário',
         (select count(*) from tasks t, unnest(t.assignees) u where not exists (select 1 from profiles p where p.id=u)), 1
  union all select 'Integridade','Valores de tratamento soltos (sem tratamento)',
         (select count(*) from treatment_finance f where not exists (select 1 from documents d, jsonb_array_elements(d.data->'list') t where d.path='treatments/all' and t->>'id'=f.treatment_id)), 1
)
select area, item, v as valor, case when v < limite then 'ok' when area='Dados desnecessários' then 'limpar' else 'atenção' end as situacao
from x order by area, item;
