-- 2026-10-18h — Planner ▾ → Planner List: permissão própria (só "ver").
-- Quem hoje vê o Planner passa a ver também o Planner List. Pode rodar mais de uma vez.

begin;

alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions || jsonb_build_object('planner_list', jsonb_build_object('view', true))
 where coalesce((r.permissions -> 'planner' ->> 'view')::boolean, false)
   and not (r.permissions ? 'planner_list');
alter table public.roles enable trigger roles_guard;

commit;

-- Conferência: níveis que veem o Planner e os que veem o Planner List (devem ser iguais)
select
  (select count(*) from public.roles where coalesce((permissions -> 'planner' ->> 'view')::boolean, false)) as niveis_com_planner,
  (select count(*) from public.roles where coalesce((permissions -> 'planner_list' ->> 'view')::boolean, false)) as niveis_com_planner_list;
