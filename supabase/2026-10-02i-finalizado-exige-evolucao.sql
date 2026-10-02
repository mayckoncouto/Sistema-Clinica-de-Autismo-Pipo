-- =====================================================================
-- Agenda Pipo — "Finalizado" exige evolução (2026-10-02, parte 9)
--
--   * Um atendimento de PACIENTE CADASTRADO só pode passar para o status
--     "finalizado" se já existir uma evolução no prontuário ligada a ele
--     (clinical_records.appointment_id). Atendimentos de grupo de suporte
--     (nome que não é paciente) finalizam sem evolução.
--   * Vale só para a TROCA de status (update). Recriar uma linha (desfazer)
--     não é bloqueado.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

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
