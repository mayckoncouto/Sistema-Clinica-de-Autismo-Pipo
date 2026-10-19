-- 2026-10-19d — Agenda ▾ → Agenda Planner e Agendamentos: permissão própria (só "ver").
-- Quem hoje vê a Agenda passa a ver também as duas telas. Pode rodar mais de uma vez.

begin;

alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions
     || case when r.permissions ? 'agenda_planner' then '{}'::jsonb else jsonb_build_object('agenda_planner', jsonb_build_object('view', true)) end
     || case when r.permissions ? 'agendamentos_lista' then '{}'::jsonb else jsonb_build_object('agendamentos_lista', jsonb_build_object('view', true)) end
 where coalesce((r.permissions -> 'agenda' ->> 'view')::boolean, false)
   and not (r.permissions ? 'agenda_planner' and r.permissions ? 'agendamentos_lista');
alter table public.roles enable trigger roles_guard;

commit;

select
  (select count(*) from public.roles where coalesce((permissions -> 'agenda' ->> 'view')::boolean, false)) as niveis_com_agenda,
  (select count(*) from public.roles where coalesce((permissions -> 'agenda_planner' ->> 'view')::boolean, false)) as niveis_com_agenda_planner,
  (select count(*) from public.roles where coalesce((permissions -> 'agendamentos_lista' ->> 'view')::boolean, false)) as niveis_com_agendamentos;
