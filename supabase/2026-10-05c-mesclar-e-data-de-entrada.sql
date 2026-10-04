-- =====================================================================
-- Agenda Pipo — mesclar cadastros de pacientes e data de entrada (2026-10-05)
--
--   * Pacientes → Outras opções → "Mesclar cadastros" (só Administrador):
--     função merge_patient_records(...) passa os atendimentos da Agenda
--     (appointments.patient) e as evoluções do Prontuário (clinical_records)
--     do paciente que será excluído para o paciente que fica. O Planner, os
--     tratamentos e o cadastro dos pacientes são acertados pelo próprio app.
--   * clinical_records_stamp: o Prontuário não deixa trocar o paciente de uma
--     evolução; só a função de mesclar pode (marca "pipo.merging" na transação).
--   * Data de entrada: pacientes sem data de entrada recebem 01/01/2026 ou,
--     se o primeiro tratamento começou antes, a data de início dele (acerto
--     único; daqui em diante o cadastro novo já nasce com a data do dia).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Prontuário: só a mesclagem pode trocar o paciente de uma evolução.
create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém autor e datas da cópia.
    if tg_op = 'UPDATE' then
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
    new.updated_at := now();
  elsif coalesce(current_setting('pipo.merging', true), '') = '1' then
    -- Mesclar cadastros: muda só o paciente; autor, conteúdo e datas ficam.
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    new.updated_at := old.updated_at;
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- 2. Mesclar: Agenda e Prontuário do paciente excluído passam para o que fica.
create or replace function public.merge_patient_records(
  p_drop_id text, p_drop_name text, p_keep_id text, p_keep_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
  n_rec int := 0;
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
  perform set_config('pipo.merging', '1', true);
  update public.appointments set patient = p_keep_name
    where lower(btrim(patient)) = lower(btrim(p_drop_name));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_id = p_keep_id, patient_name = p_keep_name
    where patient_id = p_drop_id;
  get diagnostics n_rec = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec);
end;
$$;
revoke all on function public.merge_patient_records(text, text, text, text) from public;
grant execute on function public.merge_patient_records(text, text, text, text) to authenticated;

-- 3. Data de entrada dos pacientes que estão em branco (acerto único).
with primeiro as (
  select t ->> 'patientId' as pid, min(t ->> 'inicio') as inicio
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
  where d.path = 'treatments/all' and coalesce(t ->> 'inicio', '') <> ''
  group by 1
)
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg(
    case when coalesce(p ->> 'entrada', '') = ''
      then p || jsonb_build_object('entrada', least('2026-01-01', coalesce((select inicio from primeiro where pid = p ->> 'id'), '2026-01-01')))
      else p end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, ord)
))
where d.path = 'patients/all';

-- conferência: pacientes ainda sem data de entrada (deve dar 0)
select count(*) as sem_data_de_entrada
from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
where d.path = 'patients/all' and coalesce(p ->> 'entrada', '') = '';
