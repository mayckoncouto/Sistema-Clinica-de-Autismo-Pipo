-- =====================================================================
-- Agenda Pipo — Profissional vê só a própria agenda (2026-10-02, parte 6)
--
--   * Usuário ligado a um profissional (profiles.professional_id), que não é
--     Administrador e NÃO tem "editar" na Agenda (ex.: nível Profissional):
--     só enxerga os atendimentos desse profissional na Agenda por data.
--   * Quem tem "editar" na Agenda (Secretária, Administrador...) continua
--     vendo todos.
--   * A troca de status (set_appointment_status) também fica limitada aos
--     atendimentos do próprio profissional.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- Profissional ao qual a Agenda do usuário fica restrita (null = vê todos).
create or replace function public.agenda_scope_professional()
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.active and not r.is_admin and p.professional_id is not null
         and not coalesce((r.permissions -> 'agendamentos' ->> 'edit')::boolean, false)
    then p.professional_id
  end
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    public.has_perm('agendamentos', 'view')
    and (public.agenda_scope_professional() is null or professional_id = public.agenda_scope_professional())
  );

create or replace function public.set_appointment_status(p_id uuid, p_status text)
returns public.appointments language plpgsql security definer set search_path = public as $$
declare
  r public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agendamentos', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_scope is not null and not exists (
    select 1 from public.appointments a where a.id = p_id and a.professional_id = v_scope
  ) then
    raise exception 'Você só pode mudar o status dos seus atendimentos.' using errcode = '42501';
  end if;
  update public.appointments set status = nullif(btrim(coalesce(p_status, '')), '')
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'Atendimento não encontrado (talvez já tenha sido apagado).';
  end if;
  return r;
end;
$$;

revoke all on function public.set_appointment_status(uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;

commit;
