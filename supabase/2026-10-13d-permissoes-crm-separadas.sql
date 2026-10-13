-- Permissões separadas no CRM (2026-10-13)
--   crm_listas   = "CRM": só ver (botão CRM, tela CRM e Minhas Tarefas)  [continua valendo no banco para acesso]
--   crmlistas    = "CRM – Listas e Status": ver/incluir/editar/excluir (documento config/task_lists)
--   crmautomacoes= "CRM – Automações": ver/editar (documento config/crm_automations, Rodar Agora, log)
-- Os níveis começam com o que já tinham em crm_listas. Pode rodar de novo.

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
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object(
          'crmlistas', coalesce(permissions -> 'crm_listas', '{}'::jsonb),
          'crmautomacoes', jsonb_build_object(
            'view', coalesce((permissions -> 'crm_listas' ->> 'view')::boolean, false),
            'edit', coalesce((permissions -> 'crm_listas' ->> 'edit')::boolean, false)))
 where not coalesce(is_admin, false)
   and permissions ? 'crm_listas'
   and not (permissions ? 'crmlistas');

create or replace function public.crm_auto_run_now()
returns integer language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crmautomacoes', 'edit')) then
    raise exception 'Sem permissão para rodar as automações.';
  end if;
  return public.crm_auto_run(true);
end $$;

alter policy crm_auto_log_select on public.crm_auto_log
  using (public.is_admin() or public.has_perm('crmautomacoes', 'view'));

-- Conferência: função conhece os caminhos | níveis com a permissão nova | política atualizada
select (public.module_for_path('config/task_lists') = 'crmlistas' and public.module_for_path('config/crm_automations') = 'crmautomacoes') as funcao_ok,
       (select count(*) from public.roles where not coalesce(is_admin, false) and permissions ? 'crmlistas') as niveis_com_permissao,
       (select pg_get_expr(polqual, polrelid) like '%crmautomacoes%' from pg_policy where polname = 'crm_auto_log_select') as politica_ok;
