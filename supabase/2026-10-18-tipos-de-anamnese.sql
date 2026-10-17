-- Cadastro de Tipos de Anamnese (2026-10-18)
--   config/anamnesis_types  Prontuário ▾ → Tipos de Anamnese  (permissão "tipos_anamnese")
--   {list:[{id, name, descricao, validadeMeses, versao, inativo, perguntas:[{id, tipo, titulo, ajuda, obrigatoria, opcoes, min, max, campo, cond}]}]}
--   Modelos de formulário da EMPRESA (as anamneses preenchidas por paciente entram na etapa 2).
-- 1. caminho permitido  2. módulo do caminho  3. níveis começam com o mesmo acesso de Objetivos.
-- Pode rodar de novo.


alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|activities|system|planner_blocks|autoplan_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|contract_templates|block_reasons|treatment_types|anamnesis_types)|patients/all|treatments/all|(schedule|autoplan)/(seg|ter|qua|qui|sex|sab|dom)-[1-4]|autoplan/rascunho-[1-5])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path like 'autoplan/%'           then 'autoplanner'
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
    when p_path = 'config/activities'       then 'atividades'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/autoplan_blocks'  then 'autoplanner'
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/contract_templates' then 'contratos'
    when p_path = 'config/treatment_types'  then 'tipos_tratamento'
    when p_path = 'config/anamnesis_types'  then 'tipos_anamnese'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('tipos_anamnese', coalesce(permissions -> 'objetivos', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'tipos_anamnese');

-- Conferência: caminho aceito | função conhece o caminho | níveis com a permissão
select (select pg_get_constraintdef(oid) like '%anamnesis_types%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       (public.module_for_path('config/anamnesis_types') = 'tipos_anamnese') as funcao_ok,
       (select count(*) from public.roles where not coalesce(is_admin, false) and permissions ? 'tipos_anamnese') as niveis_com_permissao;
