-- 2026-10-06c — Plano terapêutico, Parte 2: objetivos trabalhados na evolução.
--   * clinical_records.plan_goals = [{planId, specId, objId, scaleId, levelId}]:
--     objetivos do plano vigente marcados na evolução, com o nível alcançado.
--   * Trigger clinical_records_plan_goals: ao salvar a evolução, a Situação do
--     objetivo no plano vigente passa a ser o nível registrado (levelId) — se a
--     data da evolução não for anterior à do último nível registrado (levelEm).
--     Último nível da escala = status "atingido"; voltar dele = "ativo".
--     Roda como dono da tabela: vale para quem escreve a evolução, mesmo sem
--     permissão de editar o plano.
--   * plan_prof_update aceita também a troca de levelEm (data da Situação).
-- Precisa da 2026-10-06-plano-terapeutico.sql antes. Pode rodar mais de uma vez.

alter table public.clinical_records add column if not exists plan_goals jsonb not null default '[]'::jsonb;

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
      case when s ->> 'specId' = g ->> 'specId' then jsonb_set(s, '{objectives}', (
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
      else s end order by sord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_sections) with ordinality u(s, sord);
    update public.therapy_plans set sections = v_sections where id = v_plan;
  end loop;
  return new;
end $$;

drop trigger if exists clinical_records_plan_goals_ins on public.clinical_records;
create trigger clinical_records_plan_goals_ins after insert on public.clinical_records
  for each row execute function public.clinical_records_plan_goals();
drop trigger if exists clinical_records_plan_goals_upd on public.clinical_records;
create trigger clinical_records_plan_goals_upd after update of plan_goals on public.clinical_records
  for each row when (new.plan_goals is distinct from old.plan_goals)
  execute function public.clinical_records_plan_goals();

create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  s jsonb; os jsonb; o jsonb; oo jsonb; v_spec text;
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

  -- o que já existia: só situação/status mudam, e só nas especialidades dele
  for os in select * from jsonb_array_elements(v_old) loop
    v_spec := os ->> 'specId';
    s := (select x from jsonb_array_elements(p_sections) x where x ->> 'specId' = v_spec limit 1);
    if s is null then raise exception 'Quadros do plano não podem ser excluídos.'; end if;
    if not (v_spec = any(v_allowed)) then
      if s <> os then raise exception 'Você só pode alterar as especialidades em que atende.'; end if;
      continue;
    end if;
    for oo in select * from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) loop
      o := (select x from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = oo ->> 'id' limit 1);
      if o is null then raise exception 'Objetivos não podem ser excluídos.'; end if;
      if (o - 'levelId' - 'levelEm' - 'status' - 'statusEm') <> (oo - 'levelId' - 'levelEm' - 'status' - 'statusEm') then
        raise exception 'Você só pode alterar a situação e o status dos objetivos.';
      end if;
    end loop;
  end loop;

  -- objetivos novos: só na especialidade principal
  for s in select * from jsonb_array_elements(p_sections) loop
    v_spec := s ->> 'specId';
    os := (select x from jsonb_array_elements(v_old) x where x ->> 'specId' = v_spec limit 1);
    for o in select * from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) loop
      if os is null or not exists (select 1 from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
        if v_spec is distinct from v_principal then
          raise exception 'Você só pode incluir objetivos na sua especialidade principal.';
        end if;
      end if;
    end loop;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;
