-- =====================================================================
-- Agenda Pipo — Mesclar cadastros leva tudo do 2º paciente (2026-10-10)
--   * Os dois com Plano Terapêutico vigente: não mescla (encerre ou exclua um antes).
--   * Planos terapêuticos (vigente e versões anteriores) do 2º passam para o 1º.
--   * Tarefas do CRM ligadas ao 2º passam para o 1º.
--   * Dados de saúde: campos vazios do 1º são completados com os do 2º; a saúde do 2º
--     é apagada.
--   (Agenda e Prontuário já passavam.)
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.merge_patient_records(
  p_drop_id text, p_drop_name text, p_keep_id text, p_keep_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
  n_rec int := 0;
  n_plan int := 0;
  n_task int := 0;
  v_keep jsonb; v_drop jsonb;
begin
  if not public.is_admin() then
    raise exception 'Só o Administrador pode mesclar cadastros.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drop_id), '') = '' or coalesce(btrim(p_keep_id), '') = ''
     or coalesce(btrim(p_drop_name), '') = '' or coalesce(btrim(p_keep_name), '') = '' then
    raise exception 'Escolha os dois pacientes.';
  end if;
  if p_drop_id = p_keep_id then
    raise exception 'Escolha dois pacientes diferentes.';
  end if;
  if exists (select 1 from public.therapy_plans where patient_id = p_keep_id and status = 'vigente')
     and exists (select 1 from public.therapy_plans where patient_id = p_drop_id and status = 'vigente') then
    raise exception 'Os dois pacientes têm Plano Terapêutico vigente: encerre ou exclua um deles antes de mesclar.';
  end if;
  perform set_config('pipo.merging', '1', true);
  update public.appointments set patient = p_keep_name, patient_id = p_keep_id
    where not blocked and (patient_id = p_drop_id
       or (patient_id is null and group_id is null and lower(btrim(patient)) = lower(btrim(p_drop_name))));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_plan = row_count;
  update public.tasks set patient_id = p_keep_id where patient_id = p_drop_id;
  get diagnostics n_task = row_count;
  -- Saúde: o que o 1º tem preenchido fica; o que está vazio vem do 2º.
  select data into v_drop from public.patient_health where patient_id = p_drop_id;
  if v_drop is not null then
    select data into v_keep from public.patient_health where patient_id = p_keep_id;
    v_keep := coalesce(v_drop, '{}'::jsonb) || coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(coalesce(v_keep, '{}'::jsonb))
       where value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)), '{}'::jsonb);
    insert into public.patient_health (patient_id, data) values (p_keep_id, v_keep)
      on conflict (patient_id) do update set data = excluded.data;
    delete from public.patient_health where patient_id = p_drop_id;
  end if;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan, 'tarefas', n_task, 'saude', true);
end;
$$;
revoke all on function public.merge_patient_records(text, text, text, text) from public;
grant execute on function public.merge_patient_records(text, text, text, text) to authenticated;
