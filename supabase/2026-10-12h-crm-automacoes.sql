-- CRM → Automações (2026-10-12)
--   Documento config/crm_automations {rules: {<regra>: {on, listId, assignees: [uuid], dias, ...}}} — só quem edita
--   "CRM" (crm_listas) grava. 26 regras (cada uma começa DESLIGADA). Duas formas de rodar:
--     * por evento (gatilhos): lead perdido, contrato assinado, cadastro recebido pelo link, falta, faltas seguidas,
--       primeiro atendimento e rodízio de leads novos;
--     * por dia (pg_cron 11:10 UTC = 8:10 de Brasília): lead parado, 2ª cobrança do link, tratamento vencendo/cancelado,
--       abaixo do contratado, carteirinha, encaminhamento, pacientes sem tratamento, pendências de status, contas a
--       pagar/receber, saldo baixo, mês sem fechar, conciliação, tarefas recorrentes prontas, plano terapêutico,
--       tarefa parada/atrasada e aniversário.
--   Nada se repete: public.crm_auto_log guarda uma chave por ocorrência (regra|item|período).
--   A tarefa/comentário criado leva o nome "Automação" e a marca "· via Automação" na atividade
--   (GUC pipo.auto, lido por crm_my_name, pipo_origem, tasks_stamp e task_events_stamp).
--   "Rodar agora" (função crm_auto_run_now) vale para quem edita CRM e ignora o dia da semana/do mês das regras.
-- Pode rodar de novo.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'   -- visões salvas do DRE (Demonstrativos)
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'  -- nenhum nível tem: só o Administrador
    when p_path = 'config/crm_automations'  then 'crm_listas'  -- CRM → Automações: quem edita "CRM"
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 1. Registro das execuções (uma chave por ocorrência) e estado do rodízio -------------------------------
create table if not exists public.crm_auto_log (
  id         bigint generated always as identity primary key,
  rule       text not null,
  key        text not null unique,
  task_id    uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crm_auto_log_rule_idx on public.crm_auto_log (rule, created_at desc);
alter table public.crm_auto_log enable row level security;
drop policy if exists crm_auto_log_select on public.crm_auto_log;
create policy crm_auto_log_select on public.crm_auto_log for select to authenticated
  using (public.is_admin() or public.has_perm('crm_listas', 'view'));
grant select on public.crm_auto_log to authenticated;

create table if not exists public.crm_auto_state (
  rule text primary key,
  n    bigint not null default 0
);
alter table public.crm_auto_state enable row level security;
revoke all on public.crm_auto_state from public, anon, authenticated;

-- 2. "Automação" como autor (o GUC pipo.auto só existe dentro das funções abaixo) ---------------------------
create or replace function public.crm_my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('pipo.auto', true), ''),
                  (select full_name from public.profiles where id = auth.uid()), '');
$$;

create or replace function public.pipo_origem()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_claims jsonb; v_cid text; v_nome text;
begin
  if coalesce(current_setting('pipo.auto', true), '') <> '' then
    return jsonb_build_object('origem', 'automacao', 'app', 'Automação');
  end if;
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then v_claims := null;
  end;
  v_cid := v_claims ->> 'client_id';
  if v_cid is null or v_cid = '' then return '{}'::jsonb; end if;
  begin
    execute 'select client_name from auth.oauth_clients where id::text = $1' into v_nome using v_cid;
  exception when others then v_nome := null;
  end;
  return jsonb_build_object('origem', 'conector', 'app', coalesce(nullif(v_nome, ''), 'Aplicativo conectado'));
end $$;

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if auth.uid() is not null and coalesce(current_setting('pipo.auto', true), '') = '' then
    new.author_id := auth.uid(); new.author_name := public.crm_my_name();
  end if;
  new.created_at := now();
  new.data := coalesce(new.data, '{}'::jsonb) || public.pipo_origem();
  return new;
end $$;

create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and coalesce(current_setting('pipo.auto', true), '') = '' then
      new.created_by := auth.uid(); new.created_by_name := public.crm_my_name();
    end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  if public.crm_status_done(new.list_id, new.status) then
    if new.closed_at is null then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;

-- 3. Peças comuns -------------------------------------------------------------------------------------------
create or replace function public.crm_auto_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Configuração da regra; vazio (null) quando está desligada ou não existe.
create or replace function public.crm_auto_cfg(p_rule text)
returns jsonb language sql stable security definer set search_path = public as $$
  select d.data -> 'rules' -> p_rule
    from public.documents d
   where d.path = 'config/crm_automations'
     and coalesce((d.data -> 'rules' -> p_rule ->> 'on')::boolean, false);
$$;

create or replace function public.crm_auto_num(p_cfg jsonb, p_key text, p_default int)
returns int language plpgsql immutable set search_path = public as $$
declare v text := p_cfg ->> p_key;
begin
  if v is not null and v ~ '^[0-9]{1,5}$' then return v::int; end if;
  return p_default;
end $$;

create or replace function public.crm_auto_date(p_text text)
returns date language plpgsql immutable set search_path = public as $$
begin
  if p_text is not null and p_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then return left(p_text, 10)::date; end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.crm_auto_money(p_text text)
returns numeric language plpgsql immutable set search_path = public as $$
begin
  if p_text is not null and replace(p_text, ',', '.') ~ '^[0-9]+(\.[0-9]+)?$' then return replace(p_text, ',', '.')::numeric; end if;
  return null;
end $$;

create or replace function public.crm_auto_brl(p_valor numeric)
returns text language sql immutable set search_path = public as $$
  select 'R$ ' || replace(to_char(coalesce(p_valor, 0), 'FM999999990.00'), '.', ',');
$$;

create or replace function public.crm_status_lost(p_list text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((s ->> 'lost')::boolean, false)), false)
    from public.documents d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$$;

-- Lista de funil de contatos (leads)? Sem o cadastro das listas, só "atendimento".
create or replace function public.crm_list_is_lead(p_list text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce((l ->> 'lead')::boolean, false)
       from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_list limit 1),
    p_list = 'atendimento');
$$;

-- Lista de destino: a escolhida na regra (se existir), senão a padrão, senão a primeira lista.
create or replace function public.crm_auto_list(p_cfg jsonb, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = nullif(p_cfg ->> 'listId', '') limit 1),
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l
      where d.path = 'config/task_lists' and l ->> 'id' = p_default limit 1),
    (select l ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(l, i)
      where d.path = 'config/task_lists' order by i limit 1),
    nullif(p_cfg ->> 'listId', ''),
    p_default);
$$;

-- Responsáveis da regra que ainda têm acesso à lista (os outros são ignorados, não derrubam a regra).
create or replace function public.crm_auto_people(p_cfg jsonb, p_list text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_out uuid[] := '{}'; x text;
begin
  for x in select jsonb_array_elements_text(coalesce(p_cfg -> 'assignees', '[]'::jsonb)) loop
    begin
      if public.crm_user_can(x::uuid, p_list) and not (x::uuid = any(v_out)) then v_out := v_out || x::uuid; end if;
    exception when others then null;
    end;
  end loop;
  return v_out;
end $$;

-- Nome do paciente pelo código (patients/all).
create or replace function public.crm_auto_patient(p_id text)
returns text language sql stable security definer set search_path = public as $$
  select e ->> 'nome' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
   where d.path = 'patients/all' and e ->> 'id' = p_id limit 1;
$$;

-- Cria a tarefa da automação (uma vez por chave). Devolve o id, ou null (desligada, repetida, sem status).
create or replace function public.crm_auto_make(
  p_rule text, p_key text, p_title text, p_desc text, p_due date default null, p_prio text default 'normal',
  p_patient text default null, p_lead jsonb default '{}'::jsonb, p_default_list text default 'gestao',
  p_recurrence jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg(p_rule); v_list text; v_st text; v_id uuid; v_log bigint;
begin
  if v_cfg is null then return null; end if;
  v_list := public.crm_auto_list(v_cfg, p_default_list);
  v_st := public.crm_rec_status(v_list, null);
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

-- Comentário da automação numa tarefa existente, com @menção (vira aviso no celular). Uma vez por chave.
create or replace function public.crm_auto_comment(p_rule text, p_key text, p_task uuid, p_body text, p_mention uuid[])
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_log bigint; v_list text; v_men uuid[] := '{}'; u uuid;
begin
  select list_id into v_list from public.tasks where id = p_task;
  if v_list is null then return false; end if;
  insert into public.crm_auto_log (rule, key, task_id) values (p_rule, left(p_key, 300), p_task)
    on conflict (key) do nothing returning id into v_log;
  if v_log is null then return false; end if;
  foreach u in array coalesce(p_mention, '{}'::uuid[]) loop
    if public.crm_user_can(u, v_list) and not (u = any(v_men)) then v_men := v_men || u; end if;
  end loop;
  perform set_config('pipo.auto', 'Automação', true);
  insert into public.task_events (task_id, kind, body, mentions, author_id, author_name)
  values (p_task, 'comment', p_body, v_men, null, 'Automação');
  perform set_config('pipo.auto', '', true);
  return true;
exception when others then
  perform set_config('pipo.auto', '', true);
  raise;
end $$;

-- 4. Gatilhos por evento --------------------------------------------------------------------------------------
-- 4.1 Rodízio de leads novos (6): tarefa nova de funil sem responsável recebe o próximo da fila.
create or replace function public.tasks_auto_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_pool uuid[]; v_n bigint;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' or coalesce(array_length(new.assignees, 1), 0) > 0 then return new; end if;
  v_cfg := public.crm_auto_cfg('rodizio_leads');
  if v_cfg is null or not public.crm_list_is_lead(new.list_id) then return new; end if;
  if nullif(v_cfg ->> 'listId', '') is not null and v_cfg ->> 'listId' <> new.list_id then return new; end if;
  select coalesce(array_agg(u order by u), '{}') into v_pool
    from (select x::uuid u from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x
           where public.crm_user_can(x::uuid, new.list_id)) q;
  if coalesce(array_length(v_pool, 1), 0) = 0 then return new; end if;
  insert into public.crm_auto_state (rule, n) values ('rodizio_leads', 1)
    on conflict (rule) do update set n = public.crm_auto_state.n + 1 returning n into v_n;
  new.assignees := array[v_pool[((v_n - 1) % array_length(v_pool, 1))::int + 1]];
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists tasks_auto_assign on public.tasks;
create trigger tasks_auto_assign before insert on public.tasks
  for each row execute function public.tasks_auto_assign();

-- 4.2 Lead perdido (4) e contrato assinado (5): ao mudar o status de uma tarefa de funil.
create or replace function public.tasks_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text; v_cfg jsonb; v_mot text; v_dias int;
begin
  if new.status is not distinct from old.status
     or coalesce(current_setting('pipo.restore', true), '') = '1'
     or coalesce(current_setting('pipo.auto', true), '') <> '' then return null; end if;
  if not public.crm_list_is_lead(new.list_id) then return null; end if;
  v_nome := coalesce(nullif(btrim(new.lead ->> 'nome'), ''), public.crm_auto_patient(new.patient_id), 'sem nome');
  if public.crm_status_lost(new.list_id, new.status) then
    v_cfg := public.crm_auto_cfg('lead_perdido');
    if v_cfg is not null then
      v_mot := coalesce(nullif(btrim(v_cfg ->> 'motivo'), ''), 'Financeiro');
      if public.pipo_norm(coalesce(new.lead ->> 'motivoPerda', '')) = public.pipo_norm(v_mot) then
        v_dias := public.crm_auto_num(v_cfg, 'dias', 60);
        perform public.crm_auto_make('lead_perdido', 'perdido|' || new.id, 'Retomar contato com ' || v_nome || ' (perdido: ' || v_mot || ')',
          'O contato foi perdido em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || ' pelo motivo “' || v_mot || '”. Veja se a situação mudou e ofereça de novo o atendimento.' ||
          case when coalesce(new.lead ->> 'telefone', '') <> '' then ' Telefone: ' || (new.lead ->> 'telefone') || '.' else '' end,
          public.crm_auto_today() + v_dias, 'normal', new.patient_id, coalesce(new.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
      end if;
    end if;
  elsif public.crm_status_done(new.list_id, new.status) and not public.crm_status_done(old.list_id, old.status) then
    perform public.crm_auto_make('contrato_assinado', 'contrato|' || new.id,
      case when new.patient_id is null then 'Cadastrar paciente e abrir tratamento: ' else 'Abrir o tratamento de ' end || v_nome,
      'Contrato assinado em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. ' ||
      case when new.patient_id is null then 'Abra a tarefa do contato, use “Cadastrar paciente” e depois abra o tratamento (convênio, sessões por mês, especialidades e horário).'
           else 'Confira o cadastro do paciente e abra o tratamento (convênio, sessões por mês, especialidades e horário).' end,
      public.crm_auto_today(), 'alta', new.patient_id, coalesce(new.lead, '{}'::jsonb), 'atendimento');
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists tasks_auto_status on public.tasks;
create trigger tasks_auto_status after update of status on public.tasks
  for each row execute function public.tasks_auto_status();

-- 4.3 Cadastro recebido pelo link (2): tarefa para revisar.
create or replace function public.intake_auto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return null; end if;
  v_nome := coalesce(nullif(btrim(new.data ->> 'nome'), ''), nullif(btrim(new.data ->> 'telefone'), ''), 'sem nome');
  perform public.crm_auto_make('link_respondido', 'link|' || new.id, 'Revisar cadastro recebido: ' || v_nome,
    'A família preencheu o link de cadastro em ' || to_char(public.crm_auto_today(), 'DD/MM/YYYY') || '. Abra Cadastros → Pacientes → Revisar Cadastro, confira os dados e aprove.',
    public.crm_auto_today(), 'alta', new.patient_id,
    case when new.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(new.data ->> 'nome', ''), 'telefone', nullif(new.data ->> 'telefone', ''))) else '{}'::jsonb end,
    'atendimento');
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists intake_auto on public.intake_submissions;
create trigger intake_auto after insert on public.intake_submissions
  for each row execute function public.intake_auto();

-- 4.4 Falta (12) e faltas seguidas (13): atendimento passa para "Não compareceu".
create or replace function public.appointments_auto_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_n int := 0; v_min int; r record;
begin
  if new.status is not distinct from old.status or new.status is distinct from 'nao-compareceu'
     or coalesce(current_setting('pipo.restore', true), '') = '1' or new.blocked
     or new.patient_id is null or new.group_id is not null then return null; end if;
  perform public.crm_auto_make('falta', 'falta|' || new.id, 'Contatar a família de ' || new.patient || ': não compareceu em ' || to_char(new.date, 'DD/MM'),
    'O paciente não compareceu ao atendimento de ' || to_char(new.date, 'DD/MM/YYYY') || ' às ' || new.time || '. Entre em contato com a família e, se for o caso, remarque.',
    public.crm_auto_today(), 'normal', new.patient_id, '{}'::jsonb, 'agendas');
  v_cfg := public.crm_auto_cfg('faltas_seguidas');
  if v_cfg is not null then
    v_min := greatest(public.crm_auto_num(v_cfg, 'dias', 2), 2);
    for r in select a.status from public.appointments a
              where a.patient_id = new.patient_id and not a.blocked and a.group_id is null and a.status is not null
                and (a.date, a.time) <= (new.date, new.time)
              order by a.date desc, a.time desc limit 10 loop
      exit when r.status <> 'nao-compareceu';
      v_n := v_n + 1;
    end loop;
    if v_n >= v_min then
      perform public.crm_auto_make('faltas_seguidas', 'faltas|' || new.id, v_n || ' faltas seguidas de ' || new.patient,
        'O paciente faltou ' || v_n || ' atendimentos seguidos (o último em ' || to_char(new.date, 'DD/MM/YYYY') || '). Converse com a família para entender o motivo e evitar o abandono do tratamento.',
        public.crm_auto_today(), 'alta', new.patient_id, '{}'::jsonb, 'gestao');
    end if;
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists appointments_auto_status on public.appointments;
create trigger appointments_auto_status after update of status on public.appointments
  for each row execute function public.appointments_auto_status();

-- 4.5 Primeiro atendimento do paciente (15).
create or replace function public.appointments_auto_first()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' or new.blocked or new.patient_id is null or new.group_id is not null then return null; end if;
  if public.crm_auto_cfg('primeiro_atendimento') is null then return null; end if;
  if exists (select 1 from public.appointments a where a.patient_id = new.patient_id and a.id <> new.id and not a.blocked and a.group_id is null) then return null; end if;
  perform public.crm_auto_make('primeiro_atendimento', 'primeiro|' || new.patient_id, 'Receber ' || new.patient || ': primeiro atendimento em ' || to_char(new.date, 'DD/MM'),
    'Primeiro atendimento do paciente na Agenda: ' || to_char(new.date, 'DD/MM/YYYY') || ' às ' || new.time || '. Envie as boas-vindas à família e confira o cadastro e o tratamento.',
    greatest(new.date - 1, public.crm_auto_today()), 'normal', new.patient_id, '{}'::jsonb, 'agendas');
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists appointments_auto_first on public.appointments;
create trigger appointments_auto_first after insert on public.appointments
  for each row execute function public.appointments_auto_first();

-- 5. Regras do dia (cada uma com a sua função, para uma falhar sem derrubar as outras) -----------------------
-- 1. Lead parado
create or replace function public.crm_auto_r_lead_parado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('lead_parado'); v_dias int; t record; v_nome text;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for t in select k.* from public.tasks k
            where public.crm_list_is_lead(k.list_id) and not public.crm_status_done(k.list_id, k.status)
              and coalesce(k.created_by_name, '') <> 'Automação'
              and k.updated_at < now() - make_interval(days => v_dias) loop
    v_nome := coalesce(nullif(btrim(t.lead ->> 'nome'), ''), public.crm_auto_patient(t.patient_id), 'sem nome');
    perform public.crm_auto_make('lead_parado', 'parado|' || t.id || '|' || to_char(t.updated_at, 'YYYYMMDD'),
      'Dar retorno a ' || v_nome || ': sem movimento há ' || v_dias || ' dias',
      'A tarefa “' || t.title || '” está parada desde ' || to_char(t.updated_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '. Entre em contato com a família e atualize o status.',
      public.crm_auto_today(), 'normal', t.patient_id, coalesce(t.lead, '{}'::jsonb) - 'motivoPerda', 'atendimento');
  end loop;
end $$;

-- 3. Link de cadastro sem resposta: segunda cobrança
create or replace function public.crm_auto_r_link_segunda(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('link_segunda_cobranca'); v_dias int; l record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null
              and reminded_at is not null and reminded_at < now() - make_interval(days => v_dias) loop
    perform public.crm_auto_make('link_segunda_cobranca', 'link2|' || l.token, '2ª cobrança de cadastro: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
      'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || ' continua sem resposta. Ligue para a família ou envie um novo link.' ||
        case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
      public.crm_auto_today(), 'normal', l.patient_id,
      case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end,
      'atendimento');
  end loop;
end $$;

-- 7. Tratamento vencendo
create or replace function public.crm_auto_r_trat_vencendo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('trat_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'validoAte') as ate
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
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
end $$;

-- 8. Tratamento cancelado
create or replace function public.crm_auto_r_trat_cancelado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('trat_cancelado'); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'statusEm') as em,
                  coalesce(nullif(e ->> 'motivoCancelNome', ''), 'não informado') as motivo, coalesce(e ->> 'obsCancel', '') as obs
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'cancelado'
              and public.crm_auto_date(e ->> 'statusEm') >= public.crm_auto_today() - 2 loop
    perform public.crm_auto_make('trat_cancelado', 'trcanc|' || t.id || '|' || t.em,
      'Pós-cancelamento: contatar a família de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente'),
      'Tratamento cancelado em ' || to_char(t.em, 'DD/MM/YYYY') || '. Motivo: ' || t.motivo || '.' || case when t.obs <> '' then ' Observação: ' || t.obs else '' end ||
        ' Entre em contato para entender a situação e ver se há como retomar.',
      public.crm_auto_today(), 'normal', t.pid, '{}'::jsonb, 'atendimento');
  end loop;
end $$;

-- 9. Abaixo do contratado (sessões agendadas no mês × Sessão/Mês do tratamento ativo)
create or replace function public.crm_auto_r_abaixo_contratado(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('abaixo_contratado'); v_dia int; t record; v_ms date; v_me date; v_n int; v_contr numeric;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 20);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ms := date_trunc('month', public.crm_auto_today())::date;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_money(e ->> 'sessoesMes') as contr
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
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
end $$;

-- 10. Carteirinha do convênio vencendo
create or replace function public.crm_auto_r_carteirinha(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('carteirinha_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'carteirinhaValidade') as ate
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'carteirinhaValidade') is not null
              and public.crm_auto_date(e ->> 'carteirinhaValidade') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('carteirinha_vencendo', 'cart|' || t.id || '|' || t.ate,
      'Pedir carteirinha nova de ' || t.nome || ': ' || case when t.ate < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.ate, 'DD/MM/YYYY'),
      'A carteirinha do convênio ' || case when t.ate < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end || ' (' || to_char(t.ate, 'DD/MM/YYYY') || '). Peça à família a carteirinha atualizada e registre no cadastro do paciente.',
      greatest(t.ate, public.crm_auto_today()), case when t.ate < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'agendas');
  end loop;
end $$;

-- 11. Pacientes sem tratamento ativo (resumo semanal)
create or replace function public.crm_auto_r_sem_tratamento(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('sem_tratamento'); v_n int; v_nomes text;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  with pat as (
    select e ->> 'id' as id, e ->> 'nome' as nome
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'),
  ativos as (
    select distinct e ->> 'patientId' as pid
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'treatments/all' and e ->> 'status' = 'ativo')
  select count(*), string_agg(nome, ', ' order by nome) into v_n, v_nomes
    from (select nome from pat where id not in (select pid from ativos where pid is not null) order by nome limit 30) q;
  select count(*) into v_n from (
    select e ->> 'id' as id from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
     where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
       and not exists (select 1 from public.documents t, jsonb_array_elements(coalesce(t.data -> 'list', '[]'::jsonb)) x
                        where t.path = 'treatments/all' and x ->> 'status' = 'ativo' and x ->> 'patientId' = e ->> 'id')) z;
  if coalesce(v_n, 0) = 0 then return; end if;
  perform public.crm_auto_make('sem_tratamento', 'semtrat|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Pacientes sem tratamento ativo: ' || v_n,
    'Pacientes ativos sem tratamento Ativo: ' || coalesce(v_nomes, '') || case when v_n > 30 then ' e mais ' || (v_n - 30) || '.' else '.' end ||
      ' Abra Cadastros → Tratamentos (filtro “Pacientes sem tratamento ativo”) e crie o tratamento ou inative o paciente.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'gestao');
end $$;

-- 14. Pendências de status (resumo semanal)
create or replace function public.crm_auto_r_pendencias_status(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('pendencias_status'); v_n int;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  select count(*) into v_n from public.appointments a
   where a.date < public.crm_auto_today() and a.date >= public.crm_auto_today() - 60 and a.status is null
     and not a.blocked and a.patient_id is not null and a.group_id is null;
  if v_n = 0 then return; end if;
  perform public.crm_auto_make('pendencias_status', 'pend|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Atendimentos sem status: ' || v_n,
    v_n || ' atendimentos dos últimos 60 dias ainda estão sem status (Finalizado, Não compareceu, Falta justificada). Use Agenda → Outras Opções → Pendências de Status.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'agendas');
end $$;

-- 16 e 17. Contas a pagar e a receber vencendo / vencidas
create or replace function public.crm_auto_r_contas(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_c1 jsonb := public.crm_auto_cfg('conta_vencendo'); v_c2 jsonb := public.crm_auto_cfg('conta_vencida'); v_dias int; r record; v_pagar boolean;
begin
  if v_c1 is null and v_c2 is null then return; end if;
  v_dias := public.crm_auto_num(v_c1, 'dias', 3);
  for r in with ca as (select e ->> 'id' as id, e ->> 'tipo' as tipo
                         from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts')
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
end $$;

-- 18. Saldo abaixo do mínimo da conta bancária (saldo de hoje)
create or replace function public.crm_auto_r_saldo_baixo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('saldo_baixo'); a record; v_saldo numeric; v_min numeric;
begin
  if v_cfg is null then return; end if;
  for a in select e ->> 'id' as id, e ->> 'name' as nome, public.crm_auto_money(e ->> 'saldoMinimo') as minimo
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'config/bank_accounts' and public.crm_auto_money(e ->> 'saldoMinimo') > 0 loop
    v_min := a.minimo;
    select coalesce(f.saldo_inicial, 0) + coalesce((
        select sum(case ca.tipo when 'Receita' then x.valor when 'Entrada' then x.valor when 'Despesa' then -x.valor when 'Saída' then -x.valor else 0 end)
          from public.finance_entries x
          left join (select e ->> 'id' as id, e ->> 'tipo' as tipo
                       from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e where d.path = 'config/chart_accounts') ca on ca.id = x.plan_id
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
end $$;

-- 19. Mês anterior sem fechar
create or replace function public.crm_auto_r_mes_sem_fechar(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('mes_sem_fechar'); v_dia int; v_ym text; v_ini date;
begin
  if v_cfg is null then return; end if;
  v_dia := public.crm_auto_num(v_cfg, 'dias', 5);
  if not p_force and extract(day from public.crm_auto_today()) < v_dia then return; end if;
  v_ini := (date_trunc('month', public.crm_auto_today()) - interval '1 month')::date;
  v_ym := to_char(v_ini, 'YYYY-MM');
  if exists (select 1 from public.finance_closings where ym = v_ym) then return; end if;
  if not exists (select 1 from public.finance_entries where data >= v_ini and data < (v_ini + interval '1 month')::date) then return; end if;
  perform public.crm_auto_make('mes_sem_fechar', 'fechar|' || v_ym, 'Fechar o mês ' || to_char(v_ini, 'MM/YYYY'),
    'O mês ' || to_char(v_ini, 'MM/YYYY') || ' tem lançamentos e ainda não foi fechado. Confira os lançamentos e use Financeiro → Lançamentos → Outras Opções → Fechamento de Mês.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'fature');
end $$;

-- 20. Conciliação pendente (resumo semanal)
create or replace function public.crm_auto_r_conciliacao(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('conciliacao_pendente'); v_n int;
begin
  if v_cfg is null then return; end if;
  if not p_force and extract(isodow from public.crm_auto_today()) <> 1 then return; end if;
  select count(*) into v_n from public.finance_statement_lines where entry_id is null;
  if v_n = 0 then return; end if;
  perform public.crm_auto_make('conciliacao_pendente', 'concil|' || to_char(public.crm_auto_today(), 'IYYY-"W"IW'),
    'Conciliar o extrato: ' || v_n || ' linhas pendentes',
    v_n || ' linhas do extrato ainda não foram conciliadas com um lançamento. Abra Financeiro → Conciliação.',
    public.crm_auto_today() + 2, 'normal', null, '{}'::jsonb, 'fature');
end $$;

-- 21. Tarefas recorrentes prontas (criadas uma vez; a recorrência gera as próximas ao finalizar)
create or replace function public.crm_auto_r_rotinas(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('rotinas_prontas'); v_hoje date := public.crm_auto_today(); v_sex date; v_mes date;
begin
  if v_cfg is null then return; end if;
  v_sex := v_hoje + ((5 - extract(dow from v_hoje)::int + 7) % 7);
  v_mes := (date_trunc('month', v_hoje) + interval '1 month')::date;
  perform public.crm_auto_make('rotinas_prontas', 'rotina|faltas-semana', 'Conferir faltas e remarcações da semana',
    'Toda sexta: veja os pacientes que faltaram na semana, confirme as remarcações e os atendimentos sem status. Ao finalizar a tarefa, a próxima sexta é criada sozinha.',
    v_sex, 'normal', null, '{}'::jsonb, 'agendas', jsonb_build_object('freq', 'semanal', 'dias', jsonb_build_array(5), 'nova', false, 'sempre', true));
  perform public.crm_auto_make('rotinas_prontas', 'rotina|trat-mes', 'Revisar tratamentos e convênios do mês',
    'Todo mês: confira tratamentos perto de vencer, carteirinhas, pacientes sem tratamento ativo e sessões abaixo do contratado. Ao finalizar a tarefa, a do mês seguinte é criada sozinha.',
    v_mes, 'normal', null, '{}'::jsonb, 'gestao', jsonb_build_object('freq', 'mensal', 'nova', false, 'sempre', true));
end $$;

-- 22. Plano Terapêutico vencendo
create or replace function public.crm_auto_r_plano_vencendo(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('plano_vencendo'); v_dias int; p record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for p in select * from public.therapy_plans
            where status = 'vigente' and review_date is not null and review_date <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('plano_vencendo', 'plano|' || p.id || '|' || p.review_date,
      'Revisar o Plano Terapêutico de ' || coalesce(nullif(p.patient_name, ''), public.crm_auto_patient(p.patient_id), 'paciente') || ': ' ||
        case when p.review_date < public.crm_auto_today() then 'revisão venceu em ' else 'revisão em ' end || to_char(p.review_date, 'DD/MM/YYYY'),
      'O plano vigente (versão ' || p.version || ') tem revisão marcada para ' || to_char(p.review_date, 'DD/MM/YYYY') || '. Abra Prontuário → Plano Terapêutico e use Revisar.',
      greatest(p.review_date, public.crm_auto_today()), case when p.review_date < public.crm_auto_today() then 'alta' else 'normal' end, p.patient_id, '{}'::jsonb, 'gestao');
  end loop;
end $$;

-- 23. Tarefa parada (comentário com @menção ao responsável e à coordenação)
create or replace function public.crm_auto_r_tarefa_parada(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('tarefa_parada'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 7);
  for t in select k.* from public.tasks k
            where not public.crm_status_done(k.list_id, k.status) and coalesce(k.created_by_name, '') <> 'Automação'
              and (nullif(v_cfg ->> 'listId', '') is null or k.list_id = v_cfg ->> 'listId')
              and k.updated_at < now() - make_interval(days => v_dias)
              and not exists (select 1 from public.task_events e where e.task_id = k.id and e.created_at >= now() - make_interval(days => v_dias)) loop
    perform public.crm_auto_comment('tarefa_parada', 'parada|' || t.id || '|' || to_char(t.updated_at, 'YYYYMMDD'), t.id,
      'Esta tarefa está sem movimento há mais de ' || v_dias || ' dias. Atualize o status ou comente o que falta.',
      t.assignees || (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x));
  end loop;
end $$;

-- 24. Tarefa vencida há muitos dias (escala para a coordenação)
create or replace function public.crm_auto_r_tarefa_atrasada(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('tarefa_atrasada'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 3);
  for t in select k.* from public.tasks k
            where not public.crm_status_done(k.list_id, k.status) and k.due_date is not null
              and (nullif(v_cfg ->> 'listId', '') is null or k.list_id = v_cfg ->> 'listId')
              and k.due_date < public.crm_auto_today() - v_dias loop
    perform public.crm_auto_comment('tarefa_atrasada', 'atraso|' || t.id || '|' || t.due_date, t.id,
      'Tarefa vencida há ' || (public.crm_auto_today() - t.due_date) || ' dias (vencimento ' || to_char(t.due_date, 'DD/MM/YYYY') || '). Avisando a coordenação.',
      t.assignees || (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(v_cfg -> 'assignees', '[]'::jsonb)) x));
  end loop;
end $$;

-- 25. Aniversário do paciente
create or replace function public.crm_auto_r_aniversario(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('aniversario'); v_hoje date := public.crm_auto_today(); t record;
begin
  if v_cfg is null then return; end if;
  for t in select e ->> 'id' as id, e ->> 'nome' as nome, public.crm_auto_date(e ->> 'nascimento') as nasc
             from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'patients/all' and coalesce(e ->> 'inativo', '') <> 'true'
              and public.crm_auto_date(e ->> 'nascimento') is not null
              and extract(month from public.crm_auto_date(e ->> 'nascimento')) = extract(month from v_hoje)
              and extract(day from public.crm_auto_date(e ->> 'nascimento')) = extract(day from v_hoje) loop
    perform public.crm_auto_make('aniversario', 'aniv|' || t.id || '|' || extract(year from v_hoje)::int,
      'Aniversário de ' || t.nome || ' (' || (extract(year from v_hoje)::int - extract(year from t.nasc)::int) || ' anos)',
      'Hoje é aniversário do paciente. Envie uma mensagem carinhosa à família.',
      v_hoje, 'normal', t.id, '{}'::jsonb, 'agendas');
  end loop;
end $$;

-- 26. Encaminhamento médico vencendo (grupo Saúde do paciente)
create or replace function public.crm_auto_r_encaminhamento(p_force boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('encaminhamento_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select h.patient_id as id, public.crm_auto_patient(h.patient_id) as nome, public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') as venc
             from public.patient_health h
            where public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') is not null
              and public.crm_auto_date(h.data -> 'encaminhamento' ->> 'venc') <= public.crm_auto_today() + v_dias
              and exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
                           where d.path = 'patients/all' and e ->> 'id' = h.patient_id and coalesce(e ->> 'inativo', '') <> 'true') loop
    perform public.crm_auto_make('encaminhamento_vencendo', 'enc|' || t.id || '|' || t.venc,
      'Pedir novo encaminhamento de ' || coalesce(t.nome, 'paciente') || ': ' || case when t.venc < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.venc, 'DD/MM/YYYY'),
      'O encaminhamento médico ' || case when t.venc < public.crm_auto_today() then 'está vencido' else 'está perto de vencer' end || ' (' || to_char(t.venc, 'DD/MM/YYYY') || '). Peça à família um novo encaminhamento e atualize o cadastro do paciente (grupo Saúde).',
      greatest(t.venc, public.crm_auto_today()), case when t.venc < public.crm_auto_today() then 'alta' else 'normal' end, t.id, '{}'::jsonb, 'atendimento');
  end loop;
end $$;

-- 6. Execução: todas as regras do dia, cada uma isolada. p_force = ignora dia da semana/do mês (Rodar agora).
create or replace function public.crm_auto_run(p_force boolean default false)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_start timestamptz := now(); v_fn text; v_n integer;
begin
  foreach v_fn in array array['lead_parado', 'link_segunda', 'trat_vencendo', 'trat_cancelado', 'abaixo_contratado', 'carteirinha',
                              'sem_tratamento', 'pendencias_status', 'contas', 'saldo_baixo', 'mes_sem_fechar', 'conciliacao',
                              'rotinas', 'plano_vencendo', 'tarefa_parada', 'tarefa_atrasada', 'aniversario', 'encaminhamento'] loop
    begin
      execute format('select public.crm_auto_r_%s($1)', v_fn) using p_force;
    exception when others then
      raise warning 'crm_auto_run: regra % falhou: %', v_fn, sqlerrm;
    end;
  end loop;
  select count(*) into v_n from public.crm_auto_log where created_at >= v_start;
  return v_n;
end $$;

-- Rodar agora (botão da tela): quem edita CRM. Devolve quantas ocorrências novas foram criadas.
create or replace function public.crm_auto_run_now()
returns integer language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'edit')) then
    raise exception 'Sem permissão para rodar as automações.';
  end if;
  return public.crm_auto_run(true);
end $$;

grant execute on function public.crm_auto_run_now() to authenticated;
revoke execute on function public.crm_auto_run(boolean) from public, anon, authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and (p.proname like 'crm\_auto\_%' and p.proname <> 'crm_auto_run_now'
                  or p.proname in ('tasks_auto_assign', 'tasks_auto_status', 'intake_auto', 'appointments_auto_status', 'appointments_auto_first', 'crm_status_lost', 'crm_list_is_lead')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 7. Agendamento diário: 8h10 de Brasília (11h10 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'pipo-crm-automacoes';
select cron.schedule('pipo-crm-automacoes', '10 11 * * *', $$select public.crm_auto_run(false)$$);

-- Conferência: caminho aceito | função do caminho | funções criadas | gatilhos | cron
select (select pg_get_constraintdef(oid) like '%crm_automations%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       (public.module_for_path('config/crm_automations') = 'crm_listas') as funcao_ok,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'crm\_auto\_%') as funcoes,
       (select count(*) from pg_trigger where tgname in ('tasks_auto_assign', 'tasks_auto_status', 'intake_auto', 'appointments_auto_status', 'appointments_auto_first') and not tgisinternal) as gatilhos,
       (select count(*) from cron.job where jobname = 'pipo-crm-automacoes') as cron;
