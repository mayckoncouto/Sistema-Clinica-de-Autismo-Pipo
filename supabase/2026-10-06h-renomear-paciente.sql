-- =====================================================================
-- Agenda Pipo — trocar o nome do paciente atualiza Agenda, Prontuário e Plano (2026-10-06)
--
--   A Agenda (appointments.patient) guarda o NOME do paciente. Ao salvar o
--   cadastro com nome novo, o app chama rename_patient: os atendimentos com o
--   nome antigo passam para o novo, e o nome também nas evoluções
--   (clinical_records.patient_name) e nos planos (therapy_plans.patient_name).
--   O Planner é atualizado pelo próprio app.
--   Quem pode: Administrador ou quem tem "editar" em Pacientes. O novo nome
--   precisa já estar salvo no cadastro do paciente.
-- Rode no SQL Editor do Supabase (pode rodar de novo).
-- =====================================================================

create or replace function public.rename_patient(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0; n_rec int := 0; n_plan int := 0;
begin
  if not coalesce(public.is_admin() or public.has_perm('pacientes', 'edit'), false) then
    raise exception 'Sem permissão para alterar pacientes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_old), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o cadastro do paciente com o nome novo antes.';
  end if;
  perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
  update public.appointments set patient = btrim(p_new)
    where lower(btrim(patient)) = lower(btrim(p_old));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_plan = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan);
end $$;
grant execute on function public.rename_patient(text, text, text) to authenticated;
