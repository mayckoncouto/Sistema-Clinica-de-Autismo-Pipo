-- Unidades — Fase 2C: funções que leem por cima das regras de acesso (2026-10-12)
-- As funções "security definer" (leem tudo, sem passar pelas regras de unidade) agora enxergam só os documentos da empresa e da unidade ativa,
-- pela visão interna `documents_u`; as consultas de relatório/CRM filtram a unidade ativa; a página pública do link de cadastro usa a
-- unidade DO LINK (`pipo.unit`). As rotinas diárias de automação do CRM continuam na Unidade 1 (por unidade: Fase 6).
-- Pode rodar de novo.

create or replace view public.documents_u as
  select * from public.documents where unit_id = 'empresa' or unit_id = public.active_unit();
revoke all on public.documents_u from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.appointments_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n   text := lower(btrim(coalesce(new.patient, '')));
  v_cnt int;
  v_id  text;
begin
  if new.blocked or v_n in ('', 'treinamento', 'bloqueado') or new.patient = 'Reunião Clínica' then
    new.patient_id := null; new.group_id := null; return new;
  end if;
  -- Nada mudou no nome nem nos códigos: mantém.
  if tg_op = 'UPDATE' and v_n = lower(btrim(coalesce(old.patient, '')))
     and new.patient_id is not distinct from old.patient_id
     and new.group_id is not distinct from old.group_id then
    return new;
  end if;
  -- Código mandado pelo app e que confere com o nome: mantém.
  if new.patient_id is not null and exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = new.patient_id and lower(btrim(x ->> 'nome')) = v_n
  ) then
    new.group_id := null; return new;
  end if;
  if new.group_id is not null and exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = new.group_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = v_n
  ) then
    new.patient_id := null; return new;
  end if;
  -- Pelo nome.
  select count(*), min(x ->> 'id') into v_cnt, v_id
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'patients/all' and lower(btrim(x ->> 'nome')) = v_n;
  if v_cnt = 1 then
    new.patient_id := v_id; new.group_id := null; return new;
  end if;
  if v_cnt > 1 then
    -- Homônimos sem código escolhido: fica o que já estava, se for um deles.
    if tg_op = 'UPDATE' and old.patient_id is not null and exists (
      select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
      where d.path = 'patients/all' and x ->> 'id' = old.patient_id and lower(btrim(x ->> 'nome')) = v_n
    ) then new.patient_id := old.patient_id; else new.patient_id := null; end if;
    new.group_id := null; return new;
  end if;
  new.patient_id := null;
  select x ->> 'id' into v_id
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/rooms' and coalesce((x ->> 'group')::boolean, false) and lower(btrim(x ->> 'name')) = v_n
  limit 1;
  new.group_id := v_id;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.appointments_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
    if old.status = 'finalizado' and not public.is_admin()
       and public.sys_rule('ag_final_terapeuta', 'block') = 'block'
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id is not null) then
      raise exception 'Atendimento finalizado: o terapeuta não altera o status. A evolução é editada no Prontuário.' using errcode = '42501';
    end if;
    if new.status = 'finalizado'
       and public.sys_rule('ag_final_evolucao', 'block') = 'block'
       and exists (
         select 1 from public.documents_u d, jsonb_array_elements(d.data -> 'list') p
         where d.path = 'patients/all' and lower(btrim(p ->> 'nome')) = lower(btrim(new.patient))
       )
       and not exists (select 1 from public.clinical_records c where c.appointment_id = new.id)
    then
      raise exception 'Para finalizar, registre a evolução deste atendimento no prontuário.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clinical_records_plan_goals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.clinical_records_plan_goals_undo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_cfg(p_rule text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select d.data -> 'rules' -> p_rule
    from public.documents_u d
   where d.path = 'config/crm_automations'
     and coalesce((d.data -> 'rules' -> p_rule ->> 'on')::boolean, false);
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_list(p_cfg jsonb, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = nullif(p_cfg ->> 'listId', '') limit 1),
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_default limit 1),
    (select l ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(l, i)
      where d.path = 'config/task_lists' order by i limit 1),
    nullif(p_cfg ->> 'listId', ''),
    p_default);
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_patient(p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e ->> 'nome' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
   where d.path = 'patients/all' and e ->> 'id' = p_id limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_abaixo_contratado(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('abaixo_contratado'); v_dia int; t record; v_ms date; v_me date; v_n int; v_contr numeric;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 20);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ms := date_trunc('month', public.crm_auto_today())::date;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_money(e ->> 'sessoesMes') as contr
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
              and coalesce(public.crm_auto_date(e ->> 'inicio'), v_ms) < v_ms
              and public.crm_auto_money(e ->> 'sessoesMes') > 0 loop
    v_contr := t.contr;
    select count(*) into v_n from public.appointments a
     where a.patient_id = t.pid and a.date between v_ms and v_me and not a.blocked and a.group_id is null;
    if v_n < v_contr then
      perform public.crm_auto_make('abaixo_contratado', 'abaixo|' || t.id || '|' || to_char(v_ms, 'YYYY-MM'),
        'Encaixar sessões de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' || v_n || ' de ' || trim(to_char(v_contr, 'FM999990.##')) || ' no mês',
        'O tratamento prevê ' || trim(to_char(v_contr, 'FM999990.##')) || ' sessões por mês e a Agenda de ' || to_char(v_ms, 'MM/YYYY') || ' tem só ' || v_n || '. Veja horários livres com a família.',
        v_me, 'normal', t.pid, '{}'::jsonb, 'agendas');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_aniversario(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('aniversario'); v_hoje date := public.crm_auto_today(); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'nascimento') as nasc
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'nascimento') is not null
              and extract(month from public.crm_auto_date(e ->> 'nascimento')) = extract(month from v_hoje)
              and extract(day from public.crm_auto_date(e ->> 'nascimento')) = extract(day from v_hoje) loop
    perform public.crm_auto_make('aniversario', 'aniv|' || t.id || '|' || extract(year from v_hoje)::int,
      'Aniversário de ' || t.nome || ' (' || (extract(year from v_hoje)::int - extract(year from t.nasc)::int) || ' anos)',
      'Hoje é aniversário do paciente. Envie uma mensagem carinhosa à família.',
      v_hoje, 'normal', t.id, '{}'::jsonb, 'agendas');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_carteirinha(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('carteirinha_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'carteirinhaValidade') as ate
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'carteirinhaValidade') is not null
              and public.crm_auto_date(e ->> 'carteirinhaValidade') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('carteirinha_vencendo', 'cart|' || t.id || '|' || t.ate,
      'Pedir carteirinha nova de ' || t.nome || ': ' || case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'A carteirinha do convênio ' || case when t.ate < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end || ' (' || to_char(t.ate, 'DD/MM/YYYY') || '). Peça à família a carteirinha atualizada e registre no cadastro do paciente.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'agendas');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_contas(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c1 jsonb := public.crm_auto_cfg('conta_vencendo'); v_c2 jsonb := public.crm_auto_cfg('conta_vencida'); v_dias int; r record; v_pagar boolean;
begin
  if v_c1 is null and v_c2 is null then return; end if;
  v_dias := public.crm_auto_num(v_c1, 'dias', 3);
  for r in with ca as (select e ->> 'id' as id, e ->> 'tipo' as tipo
                         from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts')
           select p.id, p.vencimento, p.descricao, p.valor, p.parcela, p.parcelas, ca.tipo
             from public.finance_payables p left join ca on ca.id = p.plan_id
            where p.entry_id is null and ca.tipo in ('Despesa', 'Saída', 'Receita', 'Entrada')
              and p.vencimento <= public.crm_auto_today() + greatest(v_dias, 0) loop
    v_pagar := r.tipo in ('Despesa', 'Saída');
    if r.vencimento < public.crm_auto_today() then
      perform public.crm_auto_make('conta_vencida', 'vencida|' || r.id,
        case when v_pagar then 'Conta vencida: pagar ' else 'Conta atrasada: cobrar ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end,
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' — venceu em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        public.crm_auto_today(), 'urgente', null, '{}'::jsonb, 'fature');
    elsif v_c1 is not null then
      perform public.crm_auto_make('conta_vencendo', 'vencendo|' || r.id || '|' || r.vencimento,
        case when v_pagar then 'Pagar: ' else 'Receber: ' end || coalesce(nullif(r.descricao, ''), 'sem descrição') ||
          case when r.parcelas > 1 then ' (' || r.parcela || '/' || r.parcelas || ')' else '' end || ' — vence em ' || to_char(r.vencimento, 'DD/MM'),
        case when v_pagar then 'Pagar ' else 'Receber ' end || public.crm_auto_brl(r.valor) || ' em ' || to_char(r.vencimento, 'DD/MM/YYYY') || '. Abra Financeiro → Contas a ' || case when v_pagar then 'Pagar' else 'Receber' end || '.',
        r.vencimento, 'normal', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_encaminhamento(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('encaminhamento_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select h.patient_id as id, public.crm_auto_patient(h.patient_id) as nome, public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') as venc
             from public.patient_health h
            where public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') is not null
              and public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') <= public.crm_auto_today() + v_dias
              and exists (select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
                           where d.path = 'patients/all' and e ->> 'id' = h.patient_id and coalesce(e ->> 'inativo', '') <> 'true') loop
    perform public.crm_auto_make('encaminhamento_vencendo', 'enc|' || t.id || '|' || t.venc,
      'Pedir novo encaminhamento de ' || coalesce(t.nome, 'paciente') || ': ' || case when t.venc < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.venc, 'DD/MM/YYYY'),
      'O encaminhamento médico ' || case when t.venc < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end || ' (' || to_char(t.venc, 'DD/MM/YYYY') || '). Peça à família um novo encaminhamento e atualize o cadastro do paciente (grupo Saúde).',
      greatest(t.venc, public.crm_auto_today()), case when t.venc < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'atendimento');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_saldo_baixo(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('saldo_baixo'); a record; v_saldo numeric; v_min numeric;
begin
  if v_cfg is null then return; end if;
  for a in select e ->> 'id' as id, e ->> 'name' as nome, public.crm_auto_money(e ->> 'saldoMinimo') as minimo
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'config/bank_accounts' and public.crm_auto_money(e ->> 'saldoMinimo') > 0 loop
    v_min := a.minimo;
    select coalesce(f.saldo_inicial, 0) + coalesce((
        select sum(case ca.tipo when 'Receita' then x.valor when 'Entrada' then x.valor when 'Despesa' then -x.valor when 'Saída' then -x.valor else 0 end)
          from public.finance_entries x
          left join (select e ->> 'id' as id, e ->> 'tipo' as tipo
                       from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts') ca on ca.id = x.plan_id
         where x.account_id = a.id and x.data <= public.crm_auto_today() and (f.data_saldo is null or x.data >= f.data_saldo)), 0)
      into v_saldo
      from (select 1) one left join public.bank_account_finance f on f.account_id = a.id;
    if v_saldo < v_min then
      perform public.crm_auto_make('saldo_baixo', 'saldo|' || a.id || '|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
        'Saldo baixo em ' || a.nome || ': ' || public.crm_auto_brl(v_saldo),
        'O saldo de ' || a.nome || ' está em ' || public.crm_auto_brl(v_saldo) || ', abaixo do mínimo de ' || public.crm_auto_brl(v_min) || '. Veja as contas a pagar dos próximos dias e programe a entrada de recursos.',
        public.crm_auto_today(), 'alta', null, '{}'::jsonb, 'fature');
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_sem_tratamento(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('sem_tratamento'); v_n int; v_nomes text;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  with pat as (
    select e ->> 'id' as id, e ->> 'nome' as nome
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'),
  ativos as (
    select distinct e ->> 'patientId' as pid
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'treatments/all' and e ->> 'status' = 'ativo')
  select count(*), string_agg(nome, ', ' order by nome) into v_n, v_nomes
    from (select nome from pat where id not in (select pid from ativos where pid is not null) order by nome limit 30) q;
  select count(*) into v_n from (
    select e ->> 'id' as id from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
       and not exists (select 1 from public.documents_u t, jsonb_array_elements(coalesce(t.data -> 'list', '[]'::jsonb)) x
                        where t.path = 'treatments/all' and x ->> 'status' = 'ativo' and x ->> 'patientId' = e ->> 'id')) z;
  if coalesce(v_n, 0) = 0 then return; end if;
  perform public.crm_auto_make('sem_tratamento', 'semtrat|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Pacientes sem tratamento ativo: ' || v_n,
    'Pacientes ativos sem tratamento Ativo: ' || coalesce(v_nomes, '') || case when v_n > 30 then ' e mais ' || (v_n - 30) || '.' else '.' end ||
      ' Abra Cadastros → Tratamentos (filtro “Pacientes sem tratamento ativo”) e crie o tratamento ou inative o paciente.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'gestao');
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_trat_cancelado(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('trat_cancelado'); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'statusEm') as em,
                  coalesce(nullif(e ->> 'motivoCancelNome', ''), 'não informado') as motivo, coalesce(e ->> 'obsCancel', '') as obs
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'cancelado'
              and public.crm_auto_date(e ->> 'statusEm') >= public.crm_auto_today() - 2 loop
    perform public.crm_auto_make('trat_cancelado', 'trcanc|' || t.id || '|' || t.em,
      'Pós-cancelamento: contatar a família de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente'),
      'Tratamento cancelado em ' || to_char(t.em, 'DD/MM/YYYY') || '. Motivo: ' || t.motivo || '.' || case when t.obs <> '' then ' Observação: ' || t.obs else '' end ||
        ' Entre em contato para entender a situação e ver se há como retomar.',
      public.crm_auto_today(), 'normal', t.pid, '{}'::jsonb, 'atendimento');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_auto_r_trat_vencendo(p_force boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb := public.crm_auto_cfg('trat_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'validoAte') as ate
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo' and coalesce(e ->> 'vencPor', 'data') <> 'sem'
              and public.crm_auto_date(e ->> 'validoAte') is not null
              and public.crm_auto_date(e ->> 'validoAte') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('trat_vencendo', 'trvence|' || t.id || '|' || t.ate,
      'Renegociar o tratamento de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' ||
        case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'O tratamento ativo ' || case when t.ate < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end ||
        ' (validade ' || to_char(t.ate, 'DD/MM/YYYY') || '). Converse com a família sobre a renovação ou a renegociação.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.pid, '{}'::jsonb, 'gestao');
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_list_is_lead(p_list text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select coalesce((l ->> 'lead')::boolean, false)
       from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_list limit 1),
    p_list = 'atendimento');
$function$;

CREATE OR REPLACE FUNCTION public.crm_rec_status(p_list text, p_want text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select s ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_want
        and not coalesce((s ->> 'done')::boolean, false) limit 1),
    (select s ->> 'id' from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality s(s, i)
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and not coalesce((s ->> 'done')::boolean, false)
      order by i limit 1));
$function$;

CREATE OR REPLACE FUNCTION public.crm_status_done(p_list text, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(bool_or(coalesce((s ->> 'done')::boolean, false)), false)
    from public.documents_u d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$function$;

CREATE OR REPLACE FUNCTION public.crm_status_lost(p_list text, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(bool_or(coalesce((s ->> 'lost')::boolean, false)), false)
    from public.documents_u d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$function$;

CREATE OR REPLACE FUNCTION public.delete_patient_health(p_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'delete')) then
    raise exception 'Sem permissão para excluir pacientes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
              where d.path = 'patients/all' and x ->> 'id' = p_id) then
    raise exception 'O paciente ainda está no cadastro.' using errcode = '42501';
  end if;
  delete from public.patient_health where patient_id = p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.intake_form(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  perform set_config('pipo.unit', l.unit_id, true);   -- tudo o que a página lê vem da unidade do link
  select data into c from public.documents_u where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents_u where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'name', '')) as n
      from public.documents_u d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'escolas', public.intake_names('config/schools'), 'medicos', public.intake_names('config/doctors'), 'campos', coalesce(cf, '{}'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.intake_names(p_path text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) from (
    select distinct btrim(coalesce(e ->> 'name', e ->> 'nome', '')) as n
      from public.documents_u d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = p_path and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
$function$;

CREATE OR REPLACE FUNCTION public.intake_remind()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; lst text; sts text; n integer := 0;
begin
  if not public.intake_can() then return 0; end if;
  select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
    from public.documents_u d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, k)
   where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
   order by (e ->> 'id' = 'atendimento') desc, k limit 1;
  if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null and reminded_at is null
              and expires_at is not null and expires_at < now() and unit_id = public.active_unit() for update skip locked loop
    insert into public.tasks (list_id, status, title, description, due_date, assignees, patient_id, lead)
    values (lst, coalesce(sts, 'triagem'), 'Cobrar cadastro pelo link: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
            'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || coalesce(' por ' || nullif(l.created_by_name, ''), '') || ' venceu sem ser preenchido. Cobre a família e envie um novo link.' ||
              case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
            current_date,
            case when l.created_by is not null and public.crm_user_can(l.created_by, lst) then array[l.created_by] else '{}'::uuid[] end,
            l.patient_id,
            case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end);
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set reminded_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.intake_send(p_token text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; st text; k text; v text; clean jsonb := '{}'::jsonb; tid uuid; lst text; sts text; cf jsonb; fk text; miss text[] := '{}';
  keys text[] := array['nome', 'nascimento', 'cpf', 'sexo', 'respNome', 'respParentesco', 'telefone', 'email', 'cep', 'rua', 'numero',
                       'compl', 'bairro', 'cidade', 'uf', 'convenio', 'diagnostico', 'laudo', 'escola', 'escolaTurno', 'comoConheceu', 'obs',
                       'rg', 'cns', 'entrada', 'respProfissao', 'convenioOutro', 'maeNome', 'maeCpf', 'maeProfissao', 'paiNome', 'paiCpf', 'paiProfissao',
                       'finNome', 'finDoc', 'finTelefone', 'finEmail', 'escolaSerie', 'professor', 'mediador', 'medico',
                       'diagData', 'suporte', 'comunicacao', 'alergias', 'medicacoes', 'restricoes', 'telNome', 'finQuem',
                       'plano', 'carteirinha', 'carteirinhaValidade'];
  lk text; it jsonb; arr jsonb; o jsonb; ra jsonb := '{}'::jsonb; dd text; pp text; cell jsonb;
begin
  select * into l from public.intake_links where token = p_token for update;
  st := public.intake_link_state(l);
  perform set_config('pipo.unit', l.unit_id, true);   -- tarefa, envio e leituras ficam na unidade do link
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 30000 then return jsonb_build_object('ok', false, 'motivo', 'dados'); end if;
  foreach k in array keys loop
    v := left(btrim(coalesce(p_data ->> k, '')), case when k = 'obs' then 2000 else 300 end);
    if v <> '' then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  -- Listas de pessoas (até 10, só nome/parentesco/telefone/observação) e rotina atual (seg..sex, manhã/tarde).
  foreach lk in array array['retirada', 'protetiva'] loop
    arr := '[]'::jsonb;
    if jsonb_typeof(p_data -> lk) = 'array' then
      for it in select x from jsonb_array_elements(p_data -> lk) with ordinality t(x, n) where jsonb_typeof(x) = 'object' order by n limit 10 loop
        o := '{}'::jsonb;
        foreach k in array array['nome', 'rel', 'telefone', 'obs'] loop
          v := left(btrim(coalesce(it ->> k, '')), 300);
          if v <> '' then o := o || jsonb_build_object(k, v); end if;
        end loop;
        if coalesce(o ->> 'nome', '') <> '' then arr := arr || jsonb_build_array(o); end if;
      end loop;
    end if;
    if jsonb_array_length(arr) > 0 then clean := clean || jsonb_build_object(lk, arr); end if;
  end loop;
  if jsonb_typeof(p_data -> 'rotinaAtual') = 'object' then
    foreach dd in array array['seg', 'ter', 'qua', 'qui', 'sex'] loop
      foreach pp in array array['m', 't'] loop
        cell := p_data -> 'rotinaAtual' -> dd -> pp;
        if jsonb_typeof(cell) = 'object' and (cell ->> 'tipo') in ('escola', 'pipo', 'terapia', 'atividade', 'casa', 'outro') then
          o := jsonb_build_object('tipo', cell ->> 'tipo');
          if btrim(coalesce(cell ->> 'txt', '')) <> '' then o := o || jsonb_build_object('txt', left(btrim(cell ->> 'txt'), 120)); end if;
          ra := jsonb_set(case when ra ? dd then ra else ra || jsonb_build_object(dd, '{}'::jsonb) end, array[dd, pp], o);
        end if;
      end loop;
    end loop;
    if ra <> '{}'::jsonb then clean := clean || jsonb_build_object('rotinaAtual', ra); end if;
  end if;
  if coalesce((p_data ->> 'consentimento')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'motivo', 'obrigatorio');
  end if;
  -- Nome e telefone podem ser escolhidos em Campos obrigatórios; o envio precisa ter pelo menos um dado que identifique.
  if coalesce(clean ->> 'nome', '') = '' and coalesce(clean ->> 'telefone', '') = '' and coalesce(clean ->> 'cpf', '') = '' and coalesce(clean ->> 'email', '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'vazio');
  end if;
  -- Obrigatórios escolhidos em Campos obrigatórios (config/patient_fields.link.individual | geral).
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents_u where path = 'config/patient_fields';
  if jsonb_typeof(cf) is distinct from 'object' then cf := '{"nascimento": {"req": true}, "cpf": {"req": true}}'::jsonb; end if;
  -- Configuração gravada antes de nome/telefone serem escolhíveis: continuam obrigatórios.
  if not cf ? 'nome' then cf := cf || '{"nome": {"req": true}}'::jsonb; end if;
  if not cf ? 'telefone' then cf := cf || '{"telefone": {"req": true}}'::jsonb; end if;
  for fk in select key from jsonb_each(cf) where coalesce((value ->> 'req')::boolean, false) loop
    if fk = 'responsavel' then
      null;   -- "Responsável e parentesco" saiu do link (2026-10-11): os dados vêm de Mãe, Pai, Contato e Financeiro.
    elsif fk = 'endereco' then
      if coalesce(clean ->> 'cep', '') = '' or coalesce(clean ->> 'numero', '') = '' or coalesce(clean ->> 'rua', '') = '' or coalesce(clean ->> 'cidade', '') = '' then miss := miss || fk; end if;
    elsif fk = 'mae' then
      if coalesce(clean ->> 'maeNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'pai' then
      if coalesce(clean ->> 'paiNome', '') = '' then miss := miss || fk; end if;
    elsif fk = 'financeiro' then
      if coalesce(clean ->> 'finNome', '') = '' and not (clean ->> 'finQuem' = 'Mãe' and coalesce(clean ->> 'maeNome', '') <> '')
         and not (clean ->> 'finQuem' = 'Pai' and coalesce(clean ->> 'paiNome', '') <> '') then miss := miss || fk; end if;
    elsif fk = 'rotina' then
      if not clean ? 'retirada' then miss := miss || fk; end if;
    elsif fk in ('protetiva', 'rotinaAtual') then
      if not clean ? fk then miss := miss || fk; end if;
    elsif fk = any(keys) and coalesce(clean ->> fk, '') = '' then miss := miss || fk;
    end if;
  end loop;
  if array_length(miss, 1) > 0 then return jsonb_build_object('ok', false, 'motivo', 'obrigatorio', 'campos', to_jsonb(miss)); end if;
  clean := clean || jsonb_build_object('consentimento', true, 'consentimentoEm', now());
  if l.kind = 'geral' and (select count(*) from public.intake_submissions where kind = 'geral' and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  tid := l.task_id;
  if l.kind = 'geral' then
    -- Lead novo no CRM: lista Atendimento (ou a primeira lista de atendimento), primeiro status.
    select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
      from public.documents_u d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, n)
     where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
     order by (e ->> 'id' = 'atendimento') desc, n limit 1;
    if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
    insert into public.tasks (list_id, status, title, description, lead, created_by_name)
    values (lst, coalesce(sts, 'triagem'), 'Cadastro pelo link: ' || coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome'),
            'Cadastro enviado pelo link da clínica. Revise em Cadastros → Pacientes → Revisar cadastro.',
            jsonb_strip_nulls(jsonb_build_object('nome', clean ->> 'nome', 'telefone', regexp_replace(clean ->> 'telefone', '\D', '', 'g'),
                                                 'diagnostico', clean ->> 'diagnostico', 'convenio', clean ->> 'convenio')),
            'Link de cadastro')
    returning id into tid;
  end if;
  if tid is not null then
    insert into public.task_events (task_id, kind, data, author_name)
    values (tid, 'field', jsonb_build_object('campo', 'cadastro_link', 'para', coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome')), 'Família (link de cadastro)');
  end if;
  insert into public.intake_submissions (token, kind, patient_id, task_id, data)
  values (l.token, l.kind, l.patient_id, tid, clean);
  if l.kind <> 'geral' then
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set used_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
  end if;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.plan_prof_update(p_id uuid, p_sections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
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
end $function$;

CREATE OR REPLACE FUNCTION public.profiles_professional_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(coalesce(item ->> 'nome', item ->> 'name')) into v_name
      from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_group(p_id text, p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n_appt int := 0;
begin
  if not coalesce(public.is_admin() or public.has_perm('grupos', 'edit'), false) then
    raise exception 'Sem permissão para alterar grupos de suporte.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'config/rooms' and x ->> 'id' = p_id and coalesce((x ->> 'group')::boolean, false)
      and lower(btrim(x ->> 'name')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o grupo com o nome novo antes.';
  end if;
  perform set_config('pipo.merging', '1', true);   -- mesmo grupo, nome novo
  update public.appointments set patient = btrim(p_new), group_id = p_id
    where not blocked and (group_id = p_id
       or (group_id is null and patient_id is null and lower(btrim(patient)) = lower(btrim(coalesce(p_old, '')))));
  get diagnostics n_appt = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt);
end $function$;

CREATE OR REPLACE FUNCTION public.rename_patient(p_id text, p_old text, p_new text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n_appt int := 0; n_rec int := 0; n_plan int := 0; v_homo boolean;
begin
  if not coalesce(public.is_admin() or public.has_perm('pacientes', 'edit'), false) then
    raise exception 'Sem permissão para alterar pacientes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_old), '') = '' or coalesce(btrim(p_new), '') = '' then
    raise exception 'Nome inválido.';
  end if;
  if not exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' = p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_new))
  ) then
    raise exception 'Salve o cadastro do paciente com o nome novo antes.';
  end if;
  select exists (
    select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
    where d.path = 'patients/all' and x ->> 'id' <> p_id and lower(btrim(x ->> 'nome')) = lower(btrim(p_old))
  ) into v_homo;
  perform set_config('pipo.merging', '1', true);   -- evoluções: mantém autor e datas
  update public.appointments set patient = btrim(p_new), patient_id = p_id
    where not blocked and (patient_id = p_id
       or (patient_id is null and group_id is null and not v_homo and lower(btrim(patient)) = lower(btrim(p_old))));
  get diagnostics n_appt = row_count;
  update public.clinical_records set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_rec = row_count;
  update public.therapy_plans set patient_name = btrim(p_new)
    where patient_id = p_id and patient_name is distinct from btrim(p_new);
  get diagnostics n_plan = row_count;
  perform set_config('pipo.merging', '', true);
  return jsonb_build_object('agenda', n_appt, 'prontuario', n_rec, 'planos', n_plan);
end $function$;

CREATE OR REPLACE FUNCTION public.sys_rule(p_id text, p_default text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select d.data -> 'rules' ->> p_id from public.documents_u d where d.path = 'config/system'), p_default);
$function$;

CREATE OR REPLACE FUNCTION public.tasks_delete_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1
      from public.documents_u d,
           jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
     where d.path = 'config/task_lists'
       and l ->> 'id' = old.list_id
       and s ->> 'id' = old.status
       and coalesce((s ->> 'done')::boolean, false)
  ) then
    raise exception 'Tarefa finalizada não pode ser excluída.' using errcode = '42501';
  end if;
  return old;
end $function$;

CREATE OR REPLACE FUNCTION public.report_appointments_with_records(p_from date, p_to date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      and (v_scope is null or a.professional_id = v_scope);
end;
$function$;

CREATE OR REPLACE FUNCTION public.group_slot_appointments(p_id uuid)
 RETURNS SETOF appointments
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then return; end if;
  select * into g from public.appointments where id = p_id and unit_id = public.active_unit();
  if g.id is null or g.room_id is null then return; end if;
  if v_scope is not null and g.professional_id is distinct from v_scope then return; end if;
  return query
    select a.* from public.appointments a
     where a.room_id = g.room_id and a.date = g.date and a.time = g.time
       and a.id <> g.id and not coalesce(a.blocked, false)
       and a.group_id is null and a.unit_id = public.active_unit();
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_task_usage()
 RETURNS TABLE(list_id text, status text, n bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query select t.list_id, t.status, count(*) from public.tasks t where t.unit_id = public.active_unit() group by t.list_id, t.status;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_people()
 RETURNS TABLE(id uuid, full_name text, admin boolean, crm boolean, lists text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name,
         coalesce(r.is_admin, false) as admin,
         coalesce(r.is_admin, false) or (
           case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                else exists (select 1 from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                              where e.key like 'crm\_%' and e.key <> 'crm_listas'
                                and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)) end
         ) as crm,
         coalesce((select array_agg(substr(e.key, 5) order by e.key)
                     from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                    where e.key like 'crm\_%' and e.key <> 'crm_listas'
                      and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)),
                  '{}'::text[]) as lists
    from public.profiles p left join public.roles r on r.id = p.role_id
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
     and (p.unit_id = public.active_unit() or coalesce(r.is_manager, false))
   order by p.full_name;
$function$;


-- Conferência: visão | funções que ainda leem documents direto (esperado: só documents_enforce, unit_exists, login_units, patch_*, pacientes_definir_inativo, funções de usuário)
select to_regclass('public.documents_u') is not null as visao,
       (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prosrc ~ 'public\.documents(?!_)' and p.proname not in ('documents_enforce', 'unit_exists', 'login_units')) as definer_lendo_direto;
