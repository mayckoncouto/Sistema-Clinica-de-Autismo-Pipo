-- 2026-10-06d — Atendimento finalizado: o terapeuta não altera o status.
--   Usuário ligado a um profissional (profiles.professional_id), que não seja
--   Administrador, não troca o status de um atendimento "finalizado" na Agenda;
--   a evolução continua editável no Prontuário. Os demais níveis seguem as
--   regras de antes. Substitui appointments_status_guard (2026-10-02i).
-- Pode rodar mais de uma vez.

create or replace function public.appointments_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
    if old.status = 'finalizado' and not public.is_admin()
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id is not null) then
      raise exception 'Atendimento finalizado: o terapeuta não altera o status. A evolução é editada no Prontuário.' using errcode = '42501';
    end if;
    if new.status = 'finalizado'
       and exists (
         select 1 from public.documents d, jsonb_array_elements(d.data -> 'list') p
         where d.path = 'patients/all' and lower(btrim(p ->> 'nome')) = lower(btrim(new.patient))
       )
       and not exists (select 1 from public.clinical_records c where c.appointment_id = new.id)
    then
      raise exception 'Para finalizar, registre a evolução deste atendimento no prontuário.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
