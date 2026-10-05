-- =====================================================================
-- Agenda Pipo — cadastro do profissional segue a permissão Colaboradores (2026-10-05)
--
-- Só a parte 1 da 2026-10-05f: quem grava config/professionals (horário de
-- trabalho, especialidade, serviços…) passa a ser conferido pela permissão
-- "Colaboradores" (rh_funcionarios). NÃO mexe nos Níveis de permissão (a parte 2
-- da 05f copiava o acesso antigo de "Profissionais" e poderia abrir o RH para
-- níveis que o Administrador já ajustou).
-- Rode no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = funcionário (RH)
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
  end;
$$;

-- conferência: deve mostrar rh_funcionarios
select public.module_for_path('config/professionals') as module_for_path;
