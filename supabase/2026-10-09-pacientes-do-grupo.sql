-- Detalhes de um agendamento de Grupo de Suporte (Coordenador, Aplicador ABA…):
-- lista os atendimentos de PACIENTE na mesma sala, data e horário.
-- Quem só vê a própria agenda (profissional) não lê os atendimentos dos outros
-- profissionais; esta função entrega só esses, e só se a pessoa pode ver o
-- agendamento do grupo. Pode rodar de novo.

create or replace function public.group_slot_appointments(p_id uuid)
 returns setof public.appointments
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  g public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then return; end if;
  select * into g from public.appointments where id = p_id;
  if g.id is null or g.room_id is null then return; end if;
  if v_scope is not null and g.professional_id is distinct from v_scope then return; end if;
  return query
    select a.* from public.appointments a
     where a.room_id = g.room_id and a.date = g.date and a.time = g.time
       and a.id <> g.id and not coalesce(a.blocked, false)
       and a.group_id is null;
end;
$function$;

grant execute on function public.group_slot_appointments(uuid) to authenticated;
