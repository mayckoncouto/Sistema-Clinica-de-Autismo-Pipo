-- 2026-10-08b — Planner ▾ → Disponibilidade: permissão própria (só "ver").
-- Quem hoje vê o Resumo do Planner passa a ver também a Disponibilidade.
-- Pode rodar mais de uma vez.

begin;

alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions || jsonb_build_object('disponibilidade', jsonb_build_object('view', true))
 where coalesce((r.permissions -> 'resumo' ->> 'view')::boolean, false)
   and not (r.permissions ? 'disponibilidade');
alter table public.roles enable trigger roles_guard;

commit;

-- Conferência: níveis que veem o Resumo e os que veem a Disponibilidade (devem ser iguais)
select
  (select count(*) from public.roles where coalesce((permissions -> 'resumo' ->> 'view')::boolean, false)) as niveis_com_resumo,
  (select count(*) from public.roles where coalesce((permissions -> 'disponibilidade' ->> 'view')::boolean, false)) as niveis_com_disponibilidade;
