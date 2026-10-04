-- =====================================================================
-- Agenda Pipo — Profissionais dentro de Funcionários e Prestadores (2026-10-05)
--
--   * O cadastro dos profissionais (config/professionals) passa a seguir a
--     permissão "Funcionários e Prestadores" (rh_funcionarios), com as mesmas
--     regras de antes: ver / incluir / editar / excluir (em uso = inativar).
--     O item "Profissionais" saiu dos Níveis de permissão e do menu Cadastros.
--   * Ninguém perde acesso: cada nível recebe em "Funcionários e Prestadores"
--     tudo o que já tinha em "Profissionais" (somado ao que já tinha no RH).
--
-- PRECISA da migração 2026-10-05e-rh-funcionarios.sql antes.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Quem grava config/professionals: permissão rh_funcionarios.
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

-- 2. Copia o acesso de "Profissionais" para "Funcionários e Prestadores".
update public.roles r set permissions = r.permissions || jsonb_build_object('rh_funcionarios', jsonb_build_object(
  'view',   coalesce((r.permissions #>> '{rh_funcionarios,view}')::boolean, false)   or coalesce((r.permissions #>> '{profissionais,view}')::boolean, false),
  'create', coalesce((r.permissions #>> '{rh_funcionarios,create}')::boolean, false) or coalesce((r.permissions #>> '{profissionais,create}')::boolean, false),
  'edit',   coalesce((r.permissions #>> '{rh_funcionarios,edit}')::boolean, false)   or coalesce((r.permissions #>> '{profissionais,edit}')::boolean, false),
  'delete', coalesce((r.permissions #>> '{rh_funcionarios,delete}')::boolean, false) or coalesce((r.permissions #>> '{profissionais,delete}')::boolean, false)))
where not r.is_admin;

-- conferência: acesso de cada nível em Funcionários e Prestadores
select name as nivel, permissions -> 'rh_funcionarios' as funcionarios_e_prestadores
from public.roles order by sort;
