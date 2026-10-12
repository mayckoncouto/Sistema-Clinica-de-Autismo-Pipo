-- CRM → Automações: status da tarefa criada e status que dispara (2026-10-12)
--   config/crm_automations.rules.<regra>.statusId = status em que a tarefa nasce (vazio = o 1º status que não finaliza);
--   .gatilho (lead_perdido, contrato_assinado) = status que dispara a regra (vazio = qualquer status de perda / de sucesso).
-- Só duas funções mudam (crm_auto_make e tasks_auto_status). Pode rodar de novo.

create or replace function public.crm_auto_make(
  p_rule text, p_key text, p_title text, p_desc text, p_due date default null, p_prio text default 'normal',
  p_patient text default null, p_lead jsonb default '{}'::jsonb, p_default_list text default 'gestao',
  p_recurrence jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg(p_rule); v_list text; v_st text; v_id uuid; v_log bigint;
begin
  if v_cfg is null then return null; end if;
  v_list := public.crm_auto_list(v_cfg, p_default_list);
  v_st := public.crm_rec_status(v_list, nullif(v_cfg ->> 'statusId', ''));
  if v_list is null or v_st is null then return null; end if;
  insert into public.crm_auto_log (rule, key) values (p_rule, left(p_key, 300))
    on conflict (key) do nothing returning id into v_log;
  if v_log is null then return null; end if;
  perform set_config('pipo.auto', 'Automação', true);
  insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, patient_id, lead,
                            created_by, created_by_name, recurrence)
  values (v_list, v_st, left(p_title, 200), coalesce(p_desc, ''),
          case when p_prio in ('urgente', 'alta', 'normal') then p_prio else 'normal' end, p_due,
          public.crm_auto_people(v_cfg, v_list), nullif(p_patient, ''), coalesce(p_lead, '{}'::jsonb),
          null, 'Automação', p_recurrence)
  returning id into v_id;
  perform set_config('pipo.auto', '', true);
  update public.crm_auto_log set task_id = v_id where id = v_log;
  return v_id;
exception when others then
  perform set_config('pipo.auto', '', true);
  raise;
end $$;

create or replace function public.tasks_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text; v_cfg jsonb; v_mot text; v_dias int; v_g text;
begin
  if new.status is not distinct from old.status
     or coalesce(current_setting('pipo.restore', true), '') = '1'
     or coalesce(current_setting('pipo.auto', true), '') <> '' then return null; end if;
  if not public.crm_list_is_lead(new.list_id) then return null; end if;
  v_nome := coalesce(nullif(btrim(new.lead ->> 'nome'), ''), public.crm_auto_patient(new.patient_id), 'sem nome');
  -- Lead perdido: status escolhido (gatilho) ou qualquer status de perda
  v_cfg := public.crm_auto_cfg('lead_perdido');
  if v_cfg is not null then
    v_g := nullif(v_cfg ->> 'gatilho', '');
    if (v_g is not null and new.status = v_g) or (v_g is null and public.crm_status_lost(new.list_id, new.status)) then
      v_mot := coalesce(nullif(btrim(v_cfg ->> 'motivo'), ''), 'Financeiro');
      if public.pipo_norm(coalesce(new.lead ->> 'motivoPerda', '')) = public.pipo_norm(v_mot) then
        v_dias := public.crm_auto_num(v_cfg, 'dias', 60);
        perform public.crm_auto_make('lead_perdido', 'perdido|' || new.id, 'Retomar contato com ' || v_nome || ' (perdido: ' || v_mot || ')',
          'O contato foi perdido em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || ' pelo motivo “' || v_mot || '”. Veja se a situação mudou e ofereça de novo o atendimento.' ||
          case when coalesce(new.lead ->> 'telefone', '') <> '' then ' Telefone: ' || (new.lead ->> 'telefone') || '.' else '' end,
          public.crm_auto_today() + v_dias, 'normal', new.patient_id, coalesce(new.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
      end if;
    end if;
  end if;
  -- Contrato assinado: status escolhido (gatilho) ou qualquer status que finaliza sem ser de perda
  v_cfg := public.crm_auto_cfg('contrato_assinado');
  if v_cfg is not null then
    v_g := nullif(v_cfg ->> 'gatilho', '');
    if (v_g is not null and new.status = v_g and old.status is distinct from v_g)
       or (v_g is null and public.crm_status_done(new.list_id, new.status) and not public.crm_status_lost(new.list_id, new.status)
           and not public.crm_status_done(old.list_id, old.status)) then
      perform public.crm_auto_make('contrato_assinado', 'contrato|' || new.id,
        case when new.patient_id is null then 'Cadastrar paciente e abrir tratamento: ' else 'Abrir o tratamento de ' end || v_nome,
        'Contrato assinado em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. ' ||
        case when new.patient_id is null then 'Abra a tarefa do contato, use “Cadastrar paciente” e depois abra o tratamento (convênio, sessões por mês, especialidades e horário).'
             else 'Confira o cadastro do paciente e abra o tratamento (convênio, sessões por mês, especialidades e horário).' end,
        public.crm_auto_today(), 'alta', new.patient_id, coalesce(new.lead, '{}'::jsonb), 'atendimento');
    end if;
  end if;
  return null;
exception when others then
  return null;
end $$;

revoke execute on function public.crm_auto_make(text, text, text, text, date, text, text, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.tasks_auto_status() from public, anon, authenticated;

-- Conferência: a função lê statusId e gatilho
select (select prosrc like '%statusId%' from pg_proc where proname = 'crm_auto_make' and pronamespace = 'public'::regnamespace) as status_na_criacao,
       (select prosrc like '%gatilho%' from pg_proc where proname = 'tasks_auto_status' and pronamespace = 'public'::regnamespace) as gatilho;
