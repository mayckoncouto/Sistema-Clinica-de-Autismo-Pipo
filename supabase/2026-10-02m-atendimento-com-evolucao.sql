-- =====================================================================
-- Agenda Pipo — atendimento com evolução não pode ser apagado
-- (2026-10-02, parte 13)
--
--   * Atendimento da Agenda (appointments) que tem evolução no prontuário
--     (clinical_records.appointment_id) é registro clínico: só o
--     Administrador pode excluí-lo. Os demais precisam apagar a evolução antes.
--   * Quando o Administrador exclui, a evolução continua no prontuário
--     (fica sem a ligação com a agenda — regra "on delete set null" de antes).
--   * SQL Editor / scripts (sem usuário logado) não são bloqueados.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.appointments_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return old; end if;
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
