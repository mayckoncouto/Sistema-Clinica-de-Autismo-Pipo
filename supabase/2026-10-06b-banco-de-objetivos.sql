-- 2026-10-06b — Plano terapêutico: Banco de objetivos.
--   * Documento config/goal_bank {list:[{id, name (texto do objetivo), areaId,
--     criterio, scaleId, specId}]} — objetivos prontos para usar no plano.
--   * Permissão nova "objetivos" (Banco de objetivos): copia o acesso de
--     Habilidades/áreas; o nível Coordenador recebe tudo.
-- Precisa da 2026-10-06-plano-terapeutico.sql antes. Pode rodar mais de uma vez.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
  end;
$$;

insert into public.documents (path, data) values ('config/goal_bank', '{"list": []}'::jsonb)
on conflict (path) do nothing;

update public.roles set permissions = permissions
  || jsonb_build_object('objetivos', coalesce(permissions -> 'habilidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
where not is_admin and not (permissions ? 'objetivos');

update public.roles set permissions = permissions
  || '{"objetivos": {"view": true, "create": true, "edit": true, "delete": true}}'::jsonb
where id = 'coordenador';

-- conferência
select name as nivel, permissions -> 'objetivos' as banco_de_objetivos from public.roles order by sort, name;
