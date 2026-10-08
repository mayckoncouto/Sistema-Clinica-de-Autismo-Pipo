-- 2026-10-08c — Agenda ▾ → Visão geral: permissão própria (só "ver").
-- Quem hoje vê a Agenda passa a ver também a Visão geral (o banco continua limitando
-- quais atendimentos cada usuário enxerga). Pode rodar mais de uma vez.

begin;

alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions || jsonb_build_object('visao_geral', jsonb_build_object('view', true))
 where coalesce((r.permissions -> 'agenda' ->> 'view')::boolean, false)
   and not (r.permissions ? 'visao_geral');
alter table public.roles enable trigger roles_guard;

commit;

-- Conferência: níveis que veem a Agenda e os que veem a Visão geral (devem ser iguais)
select
  (select count(*) from public.roles where coalesce((permissions -> 'agenda' ->> 'view')::boolean, false)) as niveis_com_agenda,
  (select count(*) from public.roles where coalesce((permissions -> 'visao_geral' ->> 'view')::boolean, false)) as niveis_com_visao_geral;
