-- =====================================================================
-- Agenda Pipo — Cadastro da Clínica e sábado/domingo (2026-10-02, parte 8)
--
--   * Novo documento config/clinic (dados da clínica + horário de atendimento
--     de cada dia, seg a dom). Só o Administrador altera (módulo
--     "cadastro_clinica", que nenhum nível tem); todos leem.
--   * O Planner passa a aceitar sábado e domingo (schedule/sab-N, dom-N),
--     usados quando a clínica abre nesses dias.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic)|patients/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'config/specialties'     then 'pacientes'
    when p_path = 'config/convenios'       then 'pacientes'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'profissionais'
    when p_path = 'config/rooms'           then 'salas'
    when p_path = 'config/statuses'        then 'cadastro_status' -- só Administrador
    when p_path = 'config/clinic'          then 'cadastro_clinica' -- só Administrador
  end;
$$;

commit;
