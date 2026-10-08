-- 2026-10-08d — Correção: o cadastro de bloqueios do Planner (config/planner_blocks) não estava
-- na lista de caminhos permitidos da tabela documents. Por isso "Bloquear horário" mostrava
-- "violates check constraint documents_path_valid". Só acrescenta o caminho; nada é apagado.
-- Pode rodar mais de uma vez.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- Conferência (deve mostrar true):
select 'config/planner_blocks' ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$' as caminho_permitido;
