-- Cadastro de Motivos de Bloqueio (2026-10-13)
--   config/block_reasons  Cadastros → Motivos de Bloqueio  (permissão "motivos_bloqueio")
--   {list:[{id, name}]}  — o paciente guarda o id em patients/all (bloqueado, bloqueioMotivo, bloqueioObs, bloqueioDesde, bloqueioPor)
-- 1. caminho permitido  2. módulo do caminho  3. níveis começam com o mesmo acesso de Origens.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|block_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'
    when p_path = 'config/crm_automations'  then 'crm_listas'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('motivos_bloqueio', coalesce(permissions -> 'origens', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'motivos_bloqueio');

-- Conferência: caminho aceito | função conhece o caminho | níveis com a permissão
select (select pg_get_constraintdef(oid) like '%block_reasons%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       (public.module_for_path('config/block_reasons') = 'motivos_bloqueio') as funcao_ok,
       (select count(*) from public.roles where not coalesce(is_admin, false) and permissions ? 'motivos_bloqueio') as niveis_com_permissao;
