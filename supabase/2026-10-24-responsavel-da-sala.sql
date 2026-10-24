-- Responsável pela sala: o profissional que só vê a própria agenda também vê
-- os atendimentos das salas em que é responsável (config/rooms -> responsaveis).

create or replace function public.agenda_scope_row(p_prof text, p_room text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.agenda_scope_professional() is null then true
    when p_prof = public.agenda_scope_professional() then true
    when p_room is not null and exists (
      select 1 from public.documents_u d,
             jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
       where d.path = 'config/rooms'
         and e ->> 'id' = p_room
         and coalesce(e -> 'responsaveis', '[]'::jsonb) ? public.agenda_scope_professional()
    ) then true
    else false
  end;
$function$;
revoke all on function public.agenda_scope_row(text, text) from public, anon;
grant execute on function public.agenda_scope_row(text, text) to authenticated;

alter policy appointments_select on public.appointments
  using (public.has_perm('agenda', 'view') and public.agenda_scope_row(professional_id, room_id));

create or replace function public.set_appointment_status(p_id uuid, p_status text)
 returns appointments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_scope is not null and not exists (
    select 1 from public.appointments a where a.id = p_id and public.agenda_scope_row(a.professional_id, a.room_id)
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
$function$;

create or replace function public.group_slot_appointments(p_id uuid)
 returns setof appointments
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  g public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then return; end if;
  select * into g from public.appointments where id = p_id and unit_id = public.active_unit();
  if g.id is null or g.room_id is null then return; end if;
  if v_scope is not null and not public.agenda_scope_row(g.professional_id, g.room_id) then return; end if;
  return query
    select a.* from public.appointments a
     where a.room_id = g.room_id and a.date = g.date and a.time = g.time
       and a.id <> g.id and not coalesce(a.blocked, false)
       and a.group_id is null and a.unit_id = public.active_unit();
end;
$function$;

create or replace function public.report_appointments_with_records(p_from date, p_to date)
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_report('pendentes') then
    raise exception 'Sem permissão para este relatório.' using errcode = '42501';
  end if;
  return query
    select distinct cr.appointment_id
    from public.clinical_records cr
    join public.appointments a on a.id = cr.appointment_id
    where a.date between p_from and p_to
      and a.unit_id = public.active_unit()
      and (v_scope is null or public.agenda_scope_row(a.professional_id, a.room_id));
end;
$function$;
