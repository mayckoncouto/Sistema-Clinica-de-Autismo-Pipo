-- =====================================================================
-- Agenda Pipo — excluir ou editar evolução sem deixar dados soltos (2026-10-10)
--   1. Evolução que é a ÚNICA ligada a um atendimento Finalizado não pode ser excluída
--      (tire o status Finalizado primeiro). Segue a regra "Finalizado exige evolução"
--      (Acesso → Sistema): só vale no modo Bloquear.
--   2. Objetivo do Plano Terapêutico avaliado na evolução excluída (ou desmarcado ao
--      editar a evolução) volta à situação da ÚLTIMA evolução que sobrou; sem nenhuma,
--      fica sem situação. Só mexe se a situação do objetivo ainda é a que essa evolução
--      gravou (mudança feita depois, à mão ou por outra evolução, fica).
-- Pode rodar de novo sem estragar.
-- =====================================================================

-- 1. Trava de exclusão ---------------------------------------------------------
create or replace function public.clinical_records_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return old; end if; -- SQL Editor / scripts
  if old.appointment_id is null then return old; end if;
  if public.sys_rule('ag_final_evolucao', 'block') <> 'block' then return old; end if;
  if exists (select 1 from public.appointments a where a.id = old.appointment_id and a.status = 'finalizado')
     and not exists (select 1 from public.clinical_records c where c.appointment_id = old.appointment_id and c.id <> old.id) then
    raise exception 'Esta evolução é a do atendimento Finalizado: tire o status Finalizado do atendimento antes de excluir.'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists clinical_records_delete_guard on public.clinical_records;
create trigger clinical_records_delete_guard
  before delete on public.clinical_records
  for each row execute function public.clinical_records_delete_guard();

-- 2. Recalcula a situação dos objetivos ----------------------------------------
create or replace function public.clinical_records_plan_goals_undo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_old_date text; v_plan uuid; v_sections jsonb; v_final text;
  v_last jsonb; v_last_date text; v_new_level text;
begin
  if jsonb_typeof(old.plan_goals) <> 'array' or jsonb_array_length(old.plan_goals) = 0 then
    return null;
  end if;
  v_old_date := coalesce(old.appointment_date, (old.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(old.plan_goals) loop
    -- na edição, só os objetivos que saíram da evolução (os que ficaram já foram regravados)
    if tg_op = 'UPDATE' and jsonb_typeof(new.plan_goals) = 'array' and exists (
         select 1 from jsonb_array_elements(new.plan_goals) n
          where n ->> 'planId' = g ->> 'planId' and n ->> 'objId' = g ->> 'objId') then
      continue;
    end if;
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = old.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    -- a situação atual ainda é a que esta evolução gravou?
    if not exists (
      select 1 from jsonb_array_elements(v_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
       where o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
         and o ->> 'levelId' is not distinct from g ->> 'levelId' and o ->> 'levelEm' = v_old_date) then
      continue;
    end if;
    -- última evolução que sobrou com esse objetivo
    v_last := null; v_last_date := null;
    select x, coalesce(c.appointment_date, (c.created_at at time zone 'America/Sao_Paulo')::date)::text
      into v_last, v_last_date
      from public.clinical_records c,
           jsonb_array_elements(case when jsonb_typeof(c.plan_goals) = 'array' then c.plan_goals else '[]'::jsonb end) x
     where c.patient_id = old.patient_id and c.id <> old.id
       and x ->> 'planId' = g ->> 'planId' and x ->> 'objId' = g ->> 'objId' and x ->> 'scaleId' = g ->> 'scaleId'
     order by 2 desc, c.created_at desc
     limit 1;
    v_new_level := v_last ->> 'levelId';
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId' then
            (case when v_last is null then o - 'levelId' - 'levelEm'
                  else o || jsonb_build_object('levelId', v_new_level, 'levelEm', v_last_date) end)
            || case when v_new_level is not null and v_new_level = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                      then jsonb_build_object('status', 'atingido', 'statusEm', coalesce(v_last_date, v_old_date))
                    when v_new_level is distinct from v_final and o ->> 'status' = 'atingido'
                      then jsonb_build_object('status', 'ativo', 'statusEm', to_char(current_date, 'YYYY-MM-DD'))
                    else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return null;
end $$;

drop trigger if exists clinical_records_plan_goals_del on public.clinical_records;
create trigger clinical_records_plan_goals_del after delete on public.clinical_records
  for each row execute function public.clinical_records_plan_goals_undo();
drop trigger if exists clinical_records_plan_goals_unmark on public.clinical_records;
create trigger clinical_records_plan_goals_unmark after update of plan_goals on public.clinical_records
  for each row when (new.plan_goals is distinct from old.plan_goals)
  execute function public.clinical_records_plan_goals_undo();

-- Conferência: deve mostrar 2
select count(*) as funcoes_criadas from pg_proc
 where proname in ('clinical_records_delete_guard', 'clinical_records_plan_goals_undo')
   and pronamespace = 'public'::regnamespace;
