-- =====================================================================
-- Agenda Pipo — atendimento com status ou evolução fica protegido (2026-10-10)
-- Decisões do usuário (vale para QUALQUER status):
--   * Excluir: só o Administrador (com evolução já era assim).
--   * Mudar data, horário ou profissional: só o Administrador; a evolução ligada acompanha.
--   * Trocar o paciente: ninguém (renomear e mesclar paciente/grupo continuam funcionando).
--   * SQL Editor / scripts (sem usuário logado) não são bloqueados.
-- Pode rodar de novo sem estragar.
-- =====================================================================

-- 1. Excluir
create or replace function public.appointments_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return old; end if;
  if coalesce(old.status, '') <> '' then
    raise exception 'Este atendimento tem status: só o Administrador pode excluir (ou tire o status antes).'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.clinical_records c where c.appointment_id = old.id) then
    raise exception 'Este atendimento tem evolução no prontuário: apague a evolução antes de excluir o atendimento (ou peça ao Administrador).'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists appointments_delete_guard on public.appointments;
create trigger appointments_delete_guard
  before delete on public.appointments
  for each row execute function public.appointments_delete_guard();

-- 2. Alterar
create or replace function public.appointments_done_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(current_setting('pipo.merging', true), '') = '1' then return new; end if;
  if coalesce(old.status, '') = ''
     and not exists (select 1 from public.clinical_records c where c.appointment_id = old.id) then
    return new;
  end if;
  if lower(btrim(coalesce(new.patient, ''))) is distinct from lower(btrim(coalesce(old.patient, '')))
     or coalesce(new.blocked, false) is distinct from coalesce(old.blocked, false)
     or (old.patient_id is not null and new.patient_id is distinct from old.patient_id)
     or (old.group_id is not null and new.group_id is distinct from old.group_id) then
    raise exception 'Este atendimento tem status ou evolução: o paciente não pode ser trocado.' using errcode = '42501';
  end if;
  if (new.date, new.time, new.professional_id) is distinct from (old.date, old.time, old.professional_id)
     and not public.is_admin() then
    raise exception 'Este atendimento tem status ou evolução: só o Administrador muda a data, o horário ou o profissional.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_done_guard on public.appointments;
create trigger appointments_done_guard
  before update on public.appointments
  for each row execute function public.appointments_done_guard();

-- 3. A evolução acompanha a data, o horário e o profissional do atendimento (Administrador)
create or replace function public.appointments_sync_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.date, new.time, new.professional_id) is distinct from (old.date, old.time, old.professional_id) then
    perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
    update public.clinical_records
       set appointment_date = new.date, appointment_time = new.time, professional_id = new.professional_id
     where appointment_id = new.id;
    perform set_config('pipo.merging', '', true);
  end if;
  return null;
end;
$$;

drop trigger if exists appointments_sync_record on public.appointments;
create trigger appointments_sync_record
  after update on public.appointments
  for each row execute function public.appointments_sync_record();

-- 4. Renomear grupo de suporte continua funcionando em atendimentos com status
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
  perform set_config('pipo.merging', '1', true);   -- mesmo grupo, nome novo
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt);
end $$;
revoke all on function public.rename_group(text, text, text) from public;
grant execute on function public.rename_group(text, text, text) to authenticated;

-- Conferência: deve mostrar 3
select count(*) as travas_criadas from pg_trigger
 where tgname in ('appointments_delete_guard', 'appointments_done_guard', 'appointments_sync_record');
