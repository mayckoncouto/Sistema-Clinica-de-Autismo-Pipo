-- 2026-10-07c — Revisão de nomes e campos, Etapa 2: paciente (e grupo) por código.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   * Agenda (appointments): colunas novas patient_id (código do paciente) e group_id
--     (código do grupo de suporte marcado no lugar do paciente). O nome continua
--     gravado em "patient" (é o que aparece na tela).
--   * Gatilho appointments_refs: toda gravação preenche os códigos sozinha pelo nome
--     (quando só um paciente tem aquele nome). Com homônimos vale o código que o app
--     manda (o paciente escolhido na lista).
--   * Preenche os códigos dos atendimentos que já existem e das marcações do Planner
--     (patientId nas colunas de sala, roomRef = sala marcada nas colunas de grupo).
--   * rename_patient e merge_patient_records passam a usar o código; rename_group
--     (novo) atualiza o nome do grupo nos atendimentos da Agenda.
--   * treatment_appt_summary devolve também o código do paciente.
-- Pode rodar mais de uma vez.

begin;

-- 1. Colunas
alter table public.appointments add column if not exists patient_id text;
alter table public.appointments add column if not exists group_id text;
create index if not exists appointments_patient_id_idx on public.appointments (patient_id);
create index if not exists appointments_group_id_idx on public.appointments (group_id);

-- 2. Gatilho: preenche os códigos pelo nome
create or replace function public.appointments_refs()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n   text := lower(btrim(coalesce(new.patient, '')));
  v_cnt int;
  v_id  text;
begin
  if new.blocked or v_n in ('', 'treinamento', 'bloqueado') or new.patient = 'Reunião Clínica' then
    new.patient_id := null; new.group_id := null; return new;
  end if;
  -- Nada mudou no nome nem nos códigos: mantém.
  if tg_op = 'UPDATE' and v_n = lower(btrim(coalesce(old.patient, '')))
     and new.patient_id is not distinct from old.patient_id
     and new.group_id is not distinct from old.group_id then
    return new;
  end if;
  -- Código mandado pelo app e que confere com o nome: mantém.
  if new.patient_id is not null and exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = new.patient_id and lower(btrim(x ->> 'nome')) = v_n
  ) then
    new.group_id := null; return new;
  end if;
  if new.group_id is not null and exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = new.group_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = v_n
  ) then
    new.patient_id := null; return new;
  end if;
  -- Pelo nome.
  select count(*), min(x ->> 'id') into v_cnt, v_id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all' and lower(btrim(x ->> 'nome')) = v_n;
  if v_cnt = 1 then
    new.patient_id := v_id; new.group_id := null; return new;
  end if;
  if v_cnt > 1 then
    -- Homônimos sem código escolhido: fica o que já estava, se for um deles.
    if tg_op = 'UPDATE' and old.patient_id is not null and exists (
      select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'patients/all' and x ->> 'id' = old.patient_id and lower(btrim(x ->> 'nome')) = v_n
    ) then new.patient_id := old.patient_id; else new.patient_id := null; end if;
    new.group_id := null; return new;
  end if;
  new.patient_id := null;
  select x ->> 'id' into v_id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false) and lower(btrim(x ->> 'name')) = v_n
  limit 1;
  new.group_id := v_id;
  return new;
end $$;

drop trigger if exists appointments_refs on public.appointments;
create trigger appointments_refs
  before insert or update on public.appointments
  for each row execute function public.appointments_refs();

-- 3. Códigos dos atendimentos que já existem
with pats as (
  select x ->> 'id' as id, lower(btrim(x ->> 'nome')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all'
), uniq as (select n, min(id) as id from pats group by n having count(*) = 1)
update public.appointments a set patient_id = u.id
  from uniq u
 where a.patient_id is null and not a.blocked and lower(btrim(a.patient)) = u.n;

with grps as (
  select x ->> 'id' as id, lower(btrim(x ->> 'name')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false)
)
update public.appointments a set group_id = g.id
  from grps g
 where a.group_id is null and a.patient_id is null and not a.blocked and lower(btrim(a.patient)) = g.n;

-- 4. Códigos das marcações do Planner
with pats as (
  select x ->> 'id' as id, lower(btrim(x ->> 'nome')) as n
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all'
), uniq as (select n, min(id) as id from pats group by n having count(*) = 1),
rooms as (
  select x ->> 'id' as id, lower(btrim(x ->> 'name')) as n, coalesce((x ->> 'group')::boolean, false) as grp
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms'
)
update public.documents d
   set data = jsonb_set(d.data, '{bookings}', (
     select coalesce(jsonb_object_agg(b.key,
       case
         when jsonb_typeof(b.value) <> 'object' or coalesce(b.value ->> 'patient', '') = ''
              or coalesce((b.value ->> 'blocked')::boolean, false) or coalesce((b.value ->> 'training')::boolean, false)
              or b.value ->> 'patient' = 'Reunião Clínica' or lower(btrim(b.value ->> 'patient')) = 'bloqueado'
           then b.value
         when coalesce((select r.grp from rooms r where r.id = split_part(b.key, '|', 2)), false)
           then case when (select r.id from rooms r where not r.grp and r.n = lower(btrim(b.value ->> 'patient')) limit 1) is not null
                     then b.value || jsonb_build_object('roomRef', (select r.id from rooms r where not r.grp and r.n = lower(btrim(b.value ->> 'patient')) limit 1))
                     else b.value end
         when b.value ? 'patientId' then b.value
         when (select u.id from uniq u where u.n = lower(btrim(b.value ->> 'patient'))) is not null
           then b.value || jsonb_build_object('patientId', (select u.id from uniq u where u.n = lower(btrim(b.value ->> 'patient'))))
         else b.value
       end), '{}'::jsonb)
     from jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
   ))
 where d.path like 'schedule/%' and jsonb_typeof(d.data -> 'bookings') = 'object';

-- 5. Renomear paciente: pelo código (sem código, pelo nome antigo se nenhum outro
--    paciente tem esse nome).
create or replace function public.rename_patient(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0; n_rec int := 0; n_plan int := 0; v_homo boolean;
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
  select exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' <> p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_old))
  ) into v_homo;
  perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
  update public.appointments set patient = btrim(p_new), patient_id = p_id
    where not blocked and (patient_id = p_id
       or (patient_id is null and group_id is null and not v_homo and lower(btrim(patient)) = lower(btrim(p_old))));
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

-- 6. Mesclar cadastros: os atendimentos do 2º (pelo código ou pelo nome) passam ao 1º.
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
  update public.appointments set patient = p_keep_name, patient_id = p_keep_id
    where not blocked and (patient_id = p_drop_id
       or (patient_id is null and group_id is null and lower(btrim(patient)) = lower(btrim(p_drop_name))));
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

-- 7. Renomear grupo de suporte: atendimentos da Agenda com o grupo no lugar do paciente.
create or replace function public.rename_group(p_id text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_appt int := 0;
begin
  if not coalesce(public.is_admin() or public.has_perm('grupos', 'edit'), false) then
    raise exception 'Sem permissão para alterar grupos de suporte.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = p_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o grupo com o nome novo antes.';
  end if;
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  return jsonb_build_object('agenda', n_appt);
end $$;
revoke all on function public.rename_group(text, text, text) from public;
grant execute on function public.rename_group(text, text, text) to authenticated;

-- 8. Resumo dos atendimentos para os tratamentos, com o código do paciente
drop function if exists public.treatment_appt_summary(date);
create function public.treatment_appt_summary(p_until date)
returns table(patient text, d date, prof text, svc text, st text, n int, pid text)
language sql stable security invoker set search_path = public as $$
  select a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), count(*)::int, a.patient_id
  from public.appointments a
  where not a.blocked and a.date <= p_until and a.patient <> ''
  group by a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), a.patient_id
  order by 2, 1, 3, 4, 5
$$;
grant execute on function public.treatment_appt_summary(date) to authenticated;
revoke execute on function public.treatment_appt_summary(date) from anon;

commit;

-- Conferência: atendimentos de paciente/grupo sem código e marcações do Planner sem código
-- (deve dar 0 / 0; nomes que não estão no cadastro aparecem aqui).
select
  (select count(*) from public.appointments
    where not blocked and patient <> '' and patient <> 'Reunião Clínica' and lower(btrim(patient)) not in ('treinamento', 'bloqueado')
      and patient_id is null and group_id is null) as agenda_sem_codigo,
  (select count(*) from public.documents d, jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
    where d.path like 'schedule/%' and jsonb_typeof(b.value) = 'object' and coalesce(b.value ->> 'patient', '') <> ''
      and not coalesce((b.value ->> 'blocked')::boolean, false) and not coalesce((b.value ->> 'training')::boolean, false)
      and b.value ->> 'patient' <> 'Reunião Clínica' and lower(btrim(b.value ->> 'patient')) <> 'bloqueado'
      and not (b.value ? 'patientId') and not (b.value ? 'roomRef')) as planner_sem_codigo;
