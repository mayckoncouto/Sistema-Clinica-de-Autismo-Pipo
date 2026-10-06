-- =====================================================================
-- Agenda Pipo — Plano terapêutico por Habilidade (2026-10-06)
--
--   * Os quadros do plano passam a ser por HABILIDADE:
--       sections = [{areaId, objectives: [{id, objetivo, criterio, specIds: [...],
--                    prazo, scaleId, levelId, levelEm, status, statusEm, criadoEm}]}]
--     specIds = especialidades que podem trabalhar o objetivo.
--   * Decisão do usuário: os planos gravados no formato antigo (um quadro por
--     especialidade) são EXCLUÍDOS, e os objetivos marcados nas evoluções
--     (clinical_records.plan_goals) apontavam para eles: ficam vazios. O texto das
--     evoluções não muda.
--   * Situação única por objetivo: vale a evolução mais recente, de qualquer
--     especialidade (trigger clinical_records_plan_goals procura só pelo objetivo).
--   * plan_prof_update (profissional sem "editar"): inclui objetivos com a
--     especialidade principal dele marcada; altera tudo nos objetivos que têm a
--     principal dele (ela não pode sair); nos que têm só uma área complementar,
--     só situação e status; não exclui objetivos já gravados.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode no SQL Editor do Supabase (pode rodar de novo: a exclusão só apaga o
-- que estiver no formato antigo).
-- =====================================================================

-- 1. Exclui os planos do formato antigo (quadros com specId) e limpa as marcações.
update public.therapy_plans set prev_id = null
  where prev_id in (select id from public.therapy_plans t
                    where exists (select 1 from jsonb_array_elements(t.sections) s where s ? 'specId'));
delete from public.therapy_plans t
  where exists (select 1 from jsonb_array_elements(t.sections) s where s ? 'specId');
update public.clinical_records c set plan_goals = '[]'::jsonb
  where jsonb_array_length(coalesce(c.plan_goals, '[]'::jsonb)) > 0
    and not exists (
      select 1 from jsonb_array_elements(c.plan_goals) g
      join public.therapy_plans t on t.id::text = g ->> 'planId');

-- 2. Evolução atualiza a Situação do objetivo (em qualquer quadro), pela data mais recente.
create or replace function public.clinical_records_plan_goals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g jsonb; v_date text; v_sections jsonb; v_final text; v_plan uuid;
begin
  if jsonb_typeof(new.plan_goals) <> 'array' or jsonb_array_length(new.plan_goals) = 0 then return new; end if;
  v_date := coalesce(new.appointment_date, (new.created_at at time zone 'America/Sao_Paulo')::date, current_date)::text;
  for g in select * from jsonb_array_elements(new.plan_goals) loop
    begin v_plan := (g ->> 'planId')::uuid; exception when others then continue; end;
    select sections into v_sections from public.therapy_plans
      where id = v_plan and patient_id = new.patient_id and status = 'vigente' for update;
    if not found then continue; end if;
    select x -> 'levels' -> (jsonb_array_length(x -> 'levels') - 1) ->> 'id' into v_final
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'config/scales' and x ->> 'id' = g ->> 'scaleId';
    select coalesce(jsonb_agg(
      jsonb_set(s, '{objectives}', (
        select coalesce(jsonb_agg(
          case when o ->> 'id' = g ->> 'objId' and o ->> 'scaleId' = g ->> 'scaleId'
                    and (o ->> 'levelEm' is null or o ->> 'levelEm' <= v_date) then
            o || jsonb_build_object('levelId', g ->> 'levelId', 'levelEm', v_date)
              || case when g ->> 'levelId' = v_final and coalesce(o ->> 'status', 'ativo') <> 'atingido'
                        then jsonb_build_object('status', 'atingido', 'statusEm', v_date)
                      when g ->> 'levelId' is distinct from v_final and o ->> 'status' = 'atingido'
                        then jsonb_build_object('status', 'ativo', 'statusEm', v_date)
                      else '{}'::jsonb end
          else o end order by ord), '[]'::jsonb)
        from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality t(o, ord)))
      order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return new;
end $$;

-- 3. Gravação pelo profissional (sem "editar" no Plano terapêutico).
create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  oo jsonb; o jsonb; v_old_area text; v_new_area text; v_old_specs text[]; v_new_specs text[];
begin
  select p.professional_id into v_prof from public.profiles p where p.id = auth.uid() and p.active;
  if v_prof is null or not public.has_perm('plano_terapeutico', 'view') then
    raise exception 'Sem permissão para alterar o plano terapêutico.';
  end if;
  select x ->> 'specialtyId',
         coalesce(array(select jsonb_array_elements_text(coalesce(x -> 'complementares', '[]'::jsonb))), '{}')
    into v_principal, v_allowed
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/professionals' and x ->> 'id' = v_prof;
  v_allowed := coalesce(v_allowed, '{}') || coalesce(v_principal, '');
  select sections into v_old from public.therapy_plans where id = p_id and status = 'vigente' for update;
  if not found then raise exception 'Plano não encontrado ou já encerrado.'; end if;
  if jsonb_typeof(p_sections) <> 'array' then raise exception 'Dados inválidos.'; end if;

  -- objetivos que já existiam
  for v_old_area, oo in
    select s ->> 'areaId', x from jsonb_array_elements(v_old) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
  loop
    o := null; v_new_area := null;
    select s ->> 'areaId', x into v_new_area, o
      from jsonb_array_elements(p_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
      where x ->> 'id' = oo ->> 'id' limit 1;
    if o is null then raise exception 'Objetivos já gravados não podem ser excluídos.'; end if;
    v_old_specs := array(select jsonb_array_elements_text(coalesce(oo -> 'specIds', '[]'::jsonb)));
    v_new_specs := array(select jsonb_array_elements_text(coalesce(o -> 'specIds', '[]'::jsonb)));
    if v_principal is not null and v_principal = any(v_old_specs) then
      if not (v_principal = any(v_new_specs)) then
        raise exception 'A sua especialidade principal não pode sair do objetivo.';
      end if;
    elsif v_old_specs && v_allowed then
      if v_new_area is distinct from v_old_area
         or (o - 'levelId' - 'levelEm' - 'status' - 'statusEm') <> (oo - 'levelId' - 'levelEm' - 'status' - 'statusEm') then
        raise exception 'Neste objetivo você só pode alterar a situação e o status.';
      end if;
    elsif v_new_area is distinct from v_old_area or o <> oo then
      raise exception 'Você não pode alterar objetivos de especialidades em que não atende.';
    end if;
  end loop;

  -- objetivos novos: precisam ter a especialidade principal do profissional
  for o in
    select x from jsonb_array_elements(p_sections) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x
  loop
    if not exists (select 1 from jsonb_array_elements(v_old) s, jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
      v_new_specs := array(select jsonb_array_elements_text(coalesce(o -> 'specIds', '[]'::jsonb)));
      if v_principal is null or not (v_principal = any(v_new_specs)) then
        raise exception 'Objetivo novo precisa ter a sua especialidade principal marcada.';
      end if;
    end if;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;

-- conferência
select (select count(*) from public.therapy_plans) as planos_restantes,
       (select count(*) from public.therapy_plans t where exists (select 1 from jsonb_array_elements(t.sections) s where s ? 'specId')) as planos_formato_antigo;
