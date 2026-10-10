-- =====================================================================
-- Agenda Pipo — excluir Plano Terapêutico sem perder histórico (2026-10-10)
--   * Plano (qualquer versão) com evoluções que avaliaram objetivos dele não é
--     excluído: use Revisar (nova versão).
--   * Excluir a versão VIGENTE faz a versão anterior voltar a ser a vigente.
-- Vale para todos os usuários (o SQL Editor/scripts continuam livres).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.therapy_plans_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if; -- SQL Editor / scripts
  if exists (select 1 from public.clinical_records c
              where jsonb_typeof(c.plan_goals) = 'array'
                and c.plan_goals @> jsonb_build_array(jsonb_build_object('planId', old.id::text))) then
    raise exception 'Este plano tem evoluções com objetivos avaliados e não pode ser excluído. Para mudar, use Revisar (nova versão).'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists therapy_plans_delete_guard on public.therapy_plans;
create trigger therapy_plans_delete_guard
  before delete on public.therapy_plans
  for each row execute function public.therapy_plans_delete_guard();

create or replace function public.therapy_plans_reopen_prev()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if old.status <> 'vigente' then return null; end if;
  if exists (select 1 from public.therapy_plans where patient_id = old.patient_id and status = 'vigente') then
    return null;
  end if;
  select id into v_id from public.therapy_plans
   where patient_id = old.patient_id and status = 'encerrado'
   order by (id = old.prev_id) desc, version desc, created_at desc
   limit 1;
  if v_id is not null then
    update public.therapy_plans set status = 'vigente' where id = v_id;
  end if;
  return null;
end $$;

drop trigger if exists therapy_plans_reopen_prev on public.therapy_plans;
create trigger therapy_plans_reopen_prev
  after delete on public.therapy_plans
  for each row execute function public.therapy_plans_reopen_prev();

-- Conferência: deve mostrar 2
select count(*) as travas_criadas from pg_trigger
 where tgname in ('therapy_plans_delete_guard', 'therapy_plans_reopen_prev');
