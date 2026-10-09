-- Cadastros de Diagnósticos e Origens (2026-10-09)
--   config/diagnoses  Cadastros → Diagnósticos  (permissão "diagnosticos")  {list:[{id, code, name}]}
--   config/origins    Cadastros → Origens       (permissão "origens")       {list:[{id, name}]}
-- O paciente e o lead do CRM continuam guardando o TEXTO ("F84.0 Autismo infantil", "Indicação médica").
-- 1. caminhos permitidos  2. módulo de cada caminho  3. níveis copiam o acesso de Pacientes
-- 4. listas iniciais (sugestões + o que já está gravado nos pacientes e nos leads). Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'  -- nenhum nível tem: só o Administrador
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 3. Níveis: Diagnósticos e Origens começam com o mesmo acesso de Pacientes
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('diagnosticos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'diagnosticos');
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('origens', coalesce(permissions -> 'pacientes', '{}'::jsonb))
 where not coalesce(is_admin, false) and not (coalesce(permissions, '{}'::jsonb) ? 'origens');

-- 4a. Diagnósticos iniciais: sugestões + textos já gravados (saúde do paciente, cadastro do paciente e leads)
with txt as (
  select unnest(array['F84.0 Autismo infantil', 'F84.1 Autismo atípico', 'F84.5 Síndrome de Asperger',
    'F84.8 Outros transtornos globais do desenvolvimento', 'F84.9 Transtorno global do desenvolvimento não especificado',
    'F90.0 TDAH', 'F80.1 Transtorno expressivo de linguagem', 'F80.2 Transtorno receptivo de linguagem',
    'F82 Transtorno do desenvolvimento motor', 'F70 Retardo mental leve', 'F81.9 Transtorno do desenvolvimento das habilidades escolares']) as t, 0 as ord
  union all
  select trim(h.data ->> 'cid'), 1 from public.patient_health h where coalesce(trim(h.data ->> 'cid'), '') <> ''
  union all
  select trim(p ->> 'cid'), 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and coalesce(trim(p ->> 'cid'), '') <> ''
  union all
  select trim(t.lead ->> 'diagnostico'), 1 from public.tasks t where coalesce(trim(t.lead ->> 'diagnostico'), '') <> ''
), uniq as (
  select distinct on (lower(t)) t, ord from txt order by lower(t), ord
), parsed as (
  select t, ord,
         case when t ~* '^[A-Z][0-9]{2}(\.[0-9]{1,2})?\s+' then upper(substring(t from '^([A-Za-z][0-9]{2}(?:\.[0-9]{1,2})?)')) else '' end as code,
         case when t ~* '^[A-Z][0-9]{2}(\.[0-9]{1,2})?\s+' then trim(regexp_replace(t, '^[A-Za-z][0-9]{2}(\.[0-9]{1,2})?\s+', '')) else t end as name
    from uniq
)
insert into public.documents (path, data)
select 'config/diagnoses', jsonb_build_object('list', coalesce(jsonb_agg(jsonb_build_object(
         'id', 'dg-' || md5(lower(t)), 'code', code, 'name', name) order by ord, code, name), '[]'::jsonb))
  from parsed
on conflict (path) do nothing;

-- 4b. Origens iniciais: as de sempre + as já gravadas nos pacientes e nos leads
with txt as (
  select unnest(array['Indicação médica', 'Indicação de outro paciente', 'Escola', 'Convênio', 'Internet / redes sociais', 'Outro']) as t,
         generate_series(1, 6) as ord
  union all
  select trim(p ->> 'comoConheceu'), 100 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and coalesce(trim(p ->> 'comoConheceu'), '') <> ''
  union all
  select trim(t.lead ->> 'origem'), 100 from public.tasks t where coalesce(trim(t.lead ->> 'origem'), '') <> ''
), uniq as (
  select distinct on (lower(t)) t, ord from txt order by lower(t), ord
)
insert into public.documents (path, data)
select 'config/origins', jsonb_build_object('list', coalesce(jsonb_agg(jsonb_build_object(
         'id', 'or-' || md5(lower(t)), 'name', t) order by ord, t), '[]'::jsonb))
  from uniq
on conflict (path) do nothing;

-- Conferência
select path, jsonb_array_length(data -> 'list') as itens from public.documents
 where path in ('config/diagnoses', 'config/origins') order by path;
