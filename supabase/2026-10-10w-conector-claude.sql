-- =====================================================================
-- Conector Claude (servidor MCP) — Etapa 0 (2026-10-10). Pode rodar de novo.
-- Tudo roda COMO O PRÓPRIO USUÁRIO (security invoker): valem o nível de
-- permissão, as regras de acesso (RLS) e os gatilhos de sempre. O conector
-- só chama estas funções; nada é gravado "cru" no banco.
--  1. Origem nas atividades: evento feito por um aplicativo conectado (login
--     OAuth, ex.: Claude) ganha {"origem": "conector", "app": "Claude"}.
--  2. Data de finalização (closed_at) coerente com o status, sempre (antes só a tela cuidava).
--  3. Leitura: crm_listas_mcp, crm_tarefas_listar, crm_tarefa_obter, pacientes_buscar.
--  4. Escrita: crm_tarefa_criar, crm_tarefas_alterar (status, vencimento, prioridade,
--     responsáveis, paciente; até 50 por vez; devolve antes e depois),
--     crm_comentar, pacientes_definir_inativo (pela patch_list2, como a tela).
--  5. Permissão "Conector Claude" (conector_claude.view; Administrador sempre),
--     registro das chamadas (mcp_calls, sem nomes nem textos) e limite por minuto.
-- Nada é excluído por estas funções.
-- =====================================================================

-- normalização para busca: minúsculas e sem acento (igual ao normText do app)
create or replace function public.pipo_norm(p text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(normalize(coalesce(p, ''), NFD), '[̀-ͯ]', '', 'g'));
$$;

-- 1. Aplicativo que fez o login (token OAuth traz client_id). Vazio = o próprio sistema.
create or replace function public.pipo_origem()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_claims jsonb; v_cid text; v_nome text;
begin
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
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  new.data := coalesce(new.data, '{}'::jsonb) || public.pipo_origem();
  return new;
end $$;

-- 2. Finalizado = closed_at preenchido; qualquer outro status = vazio.
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
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

-- 5. Permissão, registro e limite
create table if not exists public.mcp_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid(),
  ferramenta text not null,
  ok         boolean not null default true,
  ids        text[] not null default '{}',
  erro       text,
  app        text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_calls_user_idx on public.mcp_calls (user_id, created_at desc);
alter table public.mcp_calls enable row level security;
drop policy if exists mcp_calls_insert on public.mcp_calls;
create policy mcp_calls_insert on public.mcp_calls for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists mcp_calls_select on public.mcp_calls;
create policy mcp_calls_select on public.mcp_calls for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Pode usar o conector? {ok, motivo}. Confere usuário ativo, permissão e limite (60 por minuto).
create or replace function public.mcp_permitido()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not public.is_active_user() then
    return jsonb_build_object('ok', false, 'motivo', 'Usuário inativo ou sem login.');
  end if;
  if not (public.is_admin() or public.has_perm('conector_claude', 'view')) then
    return jsonb_build_object('ok', false, 'motivo', 'Seu nível de permissão não tem acesso ao Conector Claude (Acesso → Usuários → Níveis de permissão).');
  end if;
  select count(*) into n from public.mcp_calls where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if n >= 60 then
    return jsonb_build_object('ok', false, 'motivo', 'Muitas chamadas em pouco tempo (limite de 60 por minuto). Tente de novo em instantes.');
  end if;
  return jsonb_build_object('ok', true, 'usuario', public.crm_my_name());
end $$;

create or replace function public.mcp_registrar(p_ferramenta text, p_ok boolean, p_ids text[], p_erro text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into public.mcp_calls (ferramenta, ok, ids, erro, app)
  values (left(p_ferramenta, 60), coalesce(p_ok, true), coalesce(p_ids[1:50], '{}'), left(p_erro, 300),
          public.pipo_origem() ->> 'app');
end $$;

-- ---------------------------------------------------------------------
-- 3. Leitura
-- ---------------------------------------------------------------------
-- Listas e status que a pessoa vê (status reais do cadastro, na ordem do quadro).
create or replace function public.crm_listas_mcp()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l ->> 'id', 'nome', l ->> 'name',
           'funil', coalesce((l ->> 'lead')::boolean, false),
           'status', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s ->> 'id', 'nome', s ->> 'name',
                        'finalizado', coalesce((s ->> 'done')::boolean, false),
                        'perda', coalesce((s ->> 'lost')::boolean, false)) order by o), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality as x(s, o))
         ) order by lo), '[]'::jsonb)
    from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as y(l, lo)
   where d.path = 'config/task_lists' and (public.is_admin() or public.has_perm('crm_' || (l ->> 'id'), 'view'));
$$;

-- nome do paciente pelo código (documento patients/all)
create or replace function public.pipo_paciente_nome(p_id text)
returns text language sql stable security invoker set search_path = public as $$
  select p ->> 'nome' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and p ->> 'id' = p_id limit 1;
$$;

-- linha resumida de uma tarefa (usada na lista e no "antes/depois")
create or replace function public.crm_tarefa_json(t public.tasks)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'lista', t.list_id, 'status', t.status,
    'status_nome', (select s ->> 'name' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
                      jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
                     where d.path = 'config/task_lists' and l ->> 'id' = t.list_id and s ->> 'id' = t.status limit 1),
    'finalizada', t.closed_at is not null,
    'titulo', t.title, 'prioridade', case when t.priority = 'baixa' then 'normal' else t.priority end,
    'vencimento', t.due_date,
    'atrasada', t.closed_at is null and t.due_date is not null and t.due_date < current_date,
    'responsaveis', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name) order by p.full_name)
                                from public.crm_people() p where p.id = any(t.assignees)), '[]'::jsonb),
    'paciente', case when t.patient_id is not null
                     then jsonb_build_object('id', t.patient_id, 'nome', public.pipo_paciente_nome(t.patient_id)) end,
    'lead', case when t.patient_id is null and coalesce(t.lead ->> 'nome', '') <> '' then t.lead ->> 'nome' end,
    'atualizada_em', t.updated_at);
$$;

-- Lista de tarefas com filtros (jsonb):
-- {lista, status, responsavel: uuid|"eu"|"ninguem", prazo_de, prazo_ate, atrasadas, texto,
--  patient_id, incluir_finalizadas, limite (1–200, padrão 50)}
create or replace function public.crm_tarefas_listar(p_filtros jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_lim int := least(greatest(coalesce((f ->> 'limite')::int, 50), 1), 200);
  v_resp text := nullif(f ->> 'responsavel', '');
  v_txt text := public.pipo_norm(nullif(f ->> 'texto', ''));
  v_tot int; v_rows jsonb;
begin
  with base as (
    select t.* from public.tasks t
     where (nullif(f ->> 'lista', '') is null or t.list_id = f ->> 'lista')
       and (nullif(f ->> 'status', '') is null or t.status = f ->> 'status')
       and (coalesce((f ->> 'incluir_finalizadas')::boolean, false) or nullif(f ->> 'status', '') is not null or t.closed_at is null)
       and (v_resp is null
            or (v_resp = 'eu' and auth.uid() = any(t.assignees))
            or (v_resp = 'ninguem' and cardinality(t.assignees) = 0)
            or (case when v_resp ~ '^[0-9a-fA-F-]{36}$' then v_resp::uuid end) = any(t.assignees))
       and (nullif(f ->> 'prazo_de', '') is null or t.due_date >= (f ->> 'prazo_de')::date)
       and (nullif(f ->> 'prazo_ate', '') is null or t.due_date <= (f ->> 'prazo_ate')::date)
       and (not coalesce((f ->> 'atrasadas')::boolean, false) or (t.closed_at is null and t.due_date < current_date))
       and (nullif(f ->> 'patient_id', '') is null or t.patient_id = f ->> 'patient_id')
       and (v_txt is null or v_txt = '' or public.pipo_norm(t.title || ' ' || t.description || ' ' || coalesce(t.lead ->> 'nome', '')
                                   || ' ' || coalesce(public.pipo_paciente_nome(t.patient_id), '')) like '%' || v_txt || '%')
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(public.crm_tarefa_json(b) order by b.due_date nulls last, b.updated_at desc)
                     from (select * from base order by due_date nulls last, updated_at desc limit v_lim) b), '[]'::jsonb)
    into v_tot, v_rows;
  return jsonb_build_object('total', v_tot, 'mostradas', jsonb_array_length(v_rows), 'tarefas', v_rows);
end $$;

-- Uma tarefa com descrição, dados do lead, comentários e histórico (até 300 eventos).
create or replace function public.crm_tarefa_obter(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_id;
  if not found then raise exception 'Tarefa não encontrada ou sem acesso.'; end if;
  return public.crm_tarefa_json(t) || jsonb_build_object(
    'descricao', t.description,
    'dados_lead', case when t.patient_id is null then t.lead - 'clickup' end,
    'recorrencia', t.recurrence,
    'criada_por', t.created_by_name, 'criada_em', t.created_at, 'finalizada_em', t.closed_at,
    'atividade', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'tipo', e.kind, 'texto', nullif(e.body, ''), 'dados', e.data,
        'mencoes', (select coalesce(jsonb_agg(p.full_name), '[]'::jsonb) from public.crm_people() p where p.id = any(e.mentions)),
        'autor', e.author_name, 'em', e.created_at, 'editado_em', e.edited_at) order by e.created_at)
      from (select * from public.task_events where task_id = p_id order by created_at desc limit 300) e), '[]'::jsonb));
end $$;

-- Busca de paciente por nome (sem acento/maiúscula). Exige "ver" em Pacientes.
create or replace function public.pacientes_buscar(p_texto text, p_limite int default 20, p_incluir_inativos boolean default true)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_q text := public.pipo_norm(p_texto);
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'view')) then
    raise exception 'Seu nível de permissão não pode ver Pacientes.';
  end if;
  if length(v_q) < 2 then raise exception 'Digite pelo menos 2 letras do nome.'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'nome') from (
      select jsonb_build_object(
        'id', p ->> 'id', 'nome', p ->> 'nome',
        'inativo', coalesce((p ->> 'inativo')::boolean, false),
        'nascimento', p ->> 'nascimento',
        'telefones', coalesce((select jsonb_agg(jsonb_build_object('numero', tl ->> 'numero', 'nome', tl ->> 'nome', 'via', tl ->> 'via'))
                                 from jsonb_array_elements(coalesce(p -> 'telefones', '[]'::jsonb)) tl), '[]'::jsonb),
        'emails', coalesce((select jsonb_agg(em ->> 'email') from jsonb_array_elements(coalesce(p -> 'emails', '[]'::jsonb)) em), '[]'::jsonb),
        'mae', p -> 'mae' ->> 'nome', 'pai', p -> 'pai' ->> 'nome') as x
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
      where d.path = 'patients/all'
        and public.pipo_norm(p ->> 'nome') like '%' || v_q || '%'
        and (coalesce(p_incluir_inativos, true) or not coalesce((p ->> 'inativo')::boolean, false))
      limit least(greatest(coalesce(p_limite, 20), 1), 50)) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Escrita
-- ---------------------------------------------------------------------
-- status da lista (null = não existe)
create or replace function public.crm_status_info(p_list text, p_status text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select s from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status limit 1;
$$;

-- Nova tarefa. p: {lista, titulo, descricao, status (padrão: 1º da lista), prioridade, vencimento,
-- responsaveis: [uuid], patient_id, lead_nome}
create or replace function public.crm_tarefa_criar(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_list text := nullif(p ->> 'lista', '');
  v_st text := nullif(p ->> 'status', '');
  v_pr text := coalesce(nullif(p ->> 'prioridade', ''), 'normal');
  v_tit text := btrim(coalesce(p ->> 'titulo', ''));
  v_ass uuid[] := '{}';
  v_pid text := nullif(p ->> 'patient_id', '');
  v_due date;
  t public.tasks;
begin
  if v_list is null or not exists (select 1 from jsonb_array_elements(public.crm_listas_mcp()) l where l ->> 'id' = v_list) then
    raise exception 'Lista inexistente ou sem acesso: %', coalesce(v_list, '(vazia)');
  end if;
  if v_tit = '' then raise exception 'O título é obrigatório.'; end if;
  if length(v_tit) > 300 then raise exception 'Título longo demais (máximo 300 caracteres).'; end if;
  if v_st is null then
    select s ->> 'id' into v_st from public.documents d, jsonb_array_elements(d.data -> 'list') l,
           jsonb_array_elements(l -> 'statuses') with ordinality as x(s, o)
     where d.path = 'config/task_lists' and l ->> 'id' = v_list order by o limit 1;
  elsif public.crm_status_info(v_list, v_st) is null then
    raise exception 'Status "%" não existe na lista %.', v_st, v_list;
  end if;
  if v_pr not in ('urgente', 'alta', 'normal') then raise exception 'Prioridade inválida: % (use urgente, alta ou normal).', v_pr; end if;
  if nullif(p ->> 'vencimento', '') is not null then
    begin v_due := (p ->> 'vencimento')::date; exception when others then raise exception 'Data de vencimento inválida: % (use AAAA-MM-DD).', p ->> 'vencimento'; end;
  end if;
  if jsonb_typeof(p -> 'responsaveis') = 'array' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_ass from jsonb_array_elements_text(p -> 'responsaveis') x;
  end if;
  if v_pid is not null and public.pipo_paciente_nome(v_pid) is null then raise exception 'Paciente não encontrado: %', v_pid; end if;
  insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, patient_id, lead)
  values (v_list, v_st, v_tit, left(coalesce(p ->> 'descricao', ''), 20000), v_pr, v_due, v_ass, v_pid,
          case when v_pid is null and nullif(btrim(coalesce(p ->> 'lead_nome', '')), '') is not null
               then jsonb_build_object('nome', btrim(p ->> 'lead_nome')) else '{}'::jsonb end)
  returning * into t;
  return jsonb_build_object('criada', public.crm_tarefa_json(t));
end $$;

-- Alteração em lote (até 50). p_campo: status | vencimento | prioridade | responsaveis | paciente.
-- p_valor: status = "id"; vencimento = "AAAA-MM-DD" ou null; prioridade = "urgente|alta|normal";
-- responsaveis = {"modo": "definir|adicionar|remover", "ids": [uuid]}; paciente = "id do paciente".
-- p_motivo: obrigatório ao ir para um status de perda (ex.: Cancelado) numa lista de funil.
-- Devolve {alteradas: [{id, titulo, antes, depois}], sem_mudanca: [...], erros: [{id, erro}]}.
create or replace function public.crm_tarefas_alterar(p_ids uuid[], p_campo text, p_valor jsonb, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid; t public.tasks; n public.tasks;
  v_ok jsonb := '[]'::jsonb; v_same jsonb := '[]'::jsonb; v_err jsonb := '[]'::jsonb;
  v_st jsonb; v_due date; v_pr text; v_modo text; v_ids uuid[]; v_new uuid[]; v_pid text; v_lead jsonb;
  v_antes jsonb; v_depois jsonb; v_cnt int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Informe pelo menos uma tarefa.'; end if;
  if cardinality(p_ids) > 50 then raise exception 'No máximo 50 tarefas por vez (recebidas %).', cardinality(p_ids); end if;
  if p_campo not in ('status', 'vencimento', 'prioridade', 'responsaveis', 'paciente') then
    raise exception 'Campo inválido: %', p_campo;
  end if;
  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    begin
      select * into t from public.tasks where id = v_id;
      if not found then raise exception 'tarefa não encontrada ou sem acesso'; end if;
      n := t;
      if p_campo = 'status' then
        v_st := public.crm_status_info(t.list_id, p_valor #>> '{}');
        if v_st is null then raise exception 'status "%" não existe na lista %', p_valor #>> '{}', t.list_id; end if;
        n.status := v_st ->> 'id';
        if coalesce((v_st ->> 'lost')::boolean, false) and exists (
             select 1 from jsonb_array_elements(public.crm_listas_mcp()) l where l ->> 'id' = t.list_id and (l ->> 'funil')::boolean) then
          if nullif(btrim(coalesce(p_motivo, '')), '') is null and nullif(t.lead ->> 'motivoPerda', '') is null then
            raise exception 'informe o motivo da perda para o status "%"', v_st ->> 'name';
          end if;
          if nullif(btrim(coalesce(p_motivo, '')), '') is not null then
            n.lead := coalesce(t.lead, '{}'::jsonb) || jsonb_build_object('motivoPerda', left(btrim(p_motivo), 500));
          end if;
        end if;
        v_antes := jsonb_build_object('status', t.status); v_depois := jsonb_build_object('status', n.status);
      elsif p_campo = 'vencimento' then
        if p_valor is null or jsonb_typeof(p_valor) = 'null' or (p_valor #>> '{}') = '' then v_due := null;
        else begin v_due := (p_valor #>> '{}')::date; exception when others then raise exception 'data inválida (use AAAA-MM-DD)'; end;
        end if;
        n.due_date := v_due;
        v_antes := jsonb_build_object('vencimento', t.due_date); v_depois := jsonb_build_object('vencimento', v_due);
      elsif p_campo = 'prioridade' then
        v_pr := p_valor #>> '{}';
        if v_pr not in ('urgente', 'alta', 'normal') then raise exception 'prioridade inválida (use urgente, alta ou normal)'; end if;
        n.priority := v_pr;
        v_antes := jsonb_build_object('prioridade', t.priority); v_depois := jsonb_build_object('prioridade', v_pr);
      elsif p_campo = 'responsaveis' then
        v_modo := coalesce(p_valor ->> 'modo', 'definir');
        select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_valor -> 'ids', '[]'::jsonb)) x;
        if v_modo = 'definir' then v_new := v_ids;
        elsif v_modo = 'adicionar' then select coalesce(array_agg(distinct x), '{}') into v_new from unnest(t.assignees || v_ids) x;
        elsif v_modo = 'remover' then select coalesce(array_agg(x), '{}') into v_new from unnest(t.assignees) x where not (x = any(v_ids));
        else raise exception 'modo inválido (use definir, adicionar ou remover)'; end if;
        n.assignees := v_new;
        v_antes := jsonb_build_object('responsaveis', to_jsonb(t.assignees)); v_depois := jsonb_build_object('responsaveis', to_jsonb(v_new));
      else -- paciente
        v_pid := nullif(p_valor #>> '{}', '');
        if v_pid is null or public.pipo_paciente_nome(v_pid) is null then raise exception 'paciente não encontrado'; end if;
        n.patient_id := v_pid;
        v_antes := jsonb_build_object('patient_id', t.patient_id, 'lead', t.lead ->> 'nome');
        v_depois := jsonb_build_object('patient_id', v_pid, 'paciente', public.pipo_paciente_nome(v_pid));
      end if;
      if v_antes = v_depois and n.lead is not distinct from t.lead then
        v_same := v_same || jsonb_build_array(jsonb_build_object('id', t.id, 'titulo', t.title));
        continue;
      end if;
      update public.tasks set status = n.status, due_date = n.due_date, priority = n.priority,
                              assignees = n.assignees, patient_id = n.patient_id, lead = n.lead
       where id = t.id returning * into n;
      get diagnostics v_cnt = row_count;
      if v_cnt = 0 then raise exception 'sem permissão para editar tarefas da lista %', t.list_id; end if;
      v_ok := v_ok || jsonb_build_array(jsonb_build_object('id', t.id, 'titulo', t.title, 'antes', v_antes, 'depois', v_depois,
                                        'tarefa', public.crm_tarefa_json(n)));
    exception when others then
      v_err := v_err || jsonb_build_array(jsonb_build_object('id', v_id, 'erro', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('alteradas', v_ok, 'sem_mudanca', v_same, 'erros', v_err);
end $$;

-- Comentário (até 5000 caracteres; menções = ids de usuários ativos).
create or replace function public.crm_comentar(p_task uuid, p_texto text, p_mencoes uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_txt text := btrim(coalesce(p_texto, '')); v_men uuid[]; e public.task_events;
begin
  if v_txt = '' then raise exception 'O comentário está vazio.'; end if;
  if length(v_txt) > 5000 then raise exception 'Comentário longo demais (máximo 5000 caracteres).'; end if;
  if not exists (select 1 from public.tasks where id = p_task) then raise exception 'Tarefa não encontrada ou sem acesso.'; end if;
  select coalesce(array_agg(distinct p.id), '{}') into v_men from public.crm_people() p where p.id = any(coalesce(p_mencoes, '{}'));
  insert into public.task_events (task_id, kind, body, mentions) values (p_task, 'comment', v_txt, v_men) returning * into e;
  return jsonb_build_object('comentario_id', e.id, 'tarefa', p_task, 'autor', e.author_name, 'em', e.created_at,
                            'mencoes', (select coalesce(jsonb_agg(p.full_name), '[]'::jsonb) from public.crm_people() p where p.id = any(v_men)));
end $$;

-- Ativar/inativar pacientes (até 50): só o campo "inativo" (booleano), pela patch_list2 (mesmo
-- caminho da tela: confere "editar" em Pacientes e carimba quem mudou). Avisa tratamento ativo.
create or replace function public.pacientes_definir_inativo(p_ids text[], p_inativo boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_list jsonb; p jsonb; v_ups jsonb := '[]'::jsonb; v_ok jsonb := '[]'::jsonb; v_same jsonb := '[]'::jsonb;
  v_err jsonb := '[]'::jsonb; v_id text; v_old boolean; v_trat boolean;
  v_upd jsonb := jsonb_build_object('por', public.crm_my_name(), 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                 || public.pipo_origem();
begin
  if p_inativo is null then raise exception 'Informe inativo = true ou false.'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Informe pelo menos um paciente.'; end if;
  if cardinality(p_ids) > 50 then raise exception 'No máximo 50 pacientes por vez.'; end if;
  if not (public.is_admin() or public.has_perm('pacientes', 'edit')) then
    raise exception 'Seu nível de permissão não pode editar Pacientes.';
  end if;
  select coalesce(data -> 'list', '[]'::jsonb) into v_list from public.documents where path = 'patients/all';
  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    select value into p from jsonb_array_elements(coalesce(v_list, '[]'::jsonb)) where value ->> 'id' = v_id limit 1;
    if p is null then v_err := v_err || jsonb_build_array(jsonb_build_object('id', v_id, 'erro', 'paciente não encontrado')); continue; end if;
    v_old := coalesce((p ->> 'inativo')::boolean, false);
    if v_old = p_inativo then v_same := v_same || jsonb_build_array(jsonb_build_object('id', v_id, 'nome', p ->> 'nome')); continue; end if;
    v_ups := v_ups || jsonb_build_array(p || jsonb_build_object('inativo', p_inativo, '_upd', v_upd));
    select exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
                    where d.path = 'treatments/all' and t ->> 'patientId' = v_id and t ->> 'status' = 'ativo') into v_trat;
    v_ok := v_ok || jsonb_build_array(jsonb_build_object('id', v_id, 'nome', p ->> 'nome',
              'antes', jsonb_build_object('inativo', v_old), 'depois', jsonb_build_object('inativo', p_inativo),
              'aviso', case when p_inativo and v_trat then 'O paciente tem tratamento ATIVO. O tratamento não foi alterado; cancele pelo sistema se for o caso.' end));
  end loop;
  if jsonb_array_length(v_ups) > 0 then
    perform public.patch_list2('patients/all', v_ups, '[]'::jsonb, '{}'::jsonb, null, true);
  end if;
  return jsonb_build_object('alterados', v_ok, 'sem_mudanca', v_same, 'erros', v_err);
end $$;

-- quem pode chamar
do $$
declare f text;
begin
  foreach f in array array[
    'public.pipo_norm(text)', 'public.pipo_origem()', 'public.mcp_permitido()', 'public.mcp_registrar(text, boolean, text[], text)',
    'public.crm_listas_mcp()', 'public.pipo_paciente_nome(text)', 'public.crm_tarefa_json(public.tasks)',
    'public.crm_tarefas_listar(jsonb)', 'public.crm_tarefa_obter(uuid)', 'public.pacientes_buscar(text, integer, boolean)',
    'public.crm_status_info(text, text)', 'public.crm_tarefa_criar(jsonb)', 'public.crm_tarefas_alterar(uuid[], text, jsonb, text)',
    'public.crm_comentar(uuid, text, uuid[])', 'public.pacientes_definir_inativo(text[], boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Conferência: 1 | 1 | 15
select
  (select count(*) from pg_class where relname = 'mcp_calls' and relnamespace = 'public'::regnamespace) as tabela_registro,
  (select count(*) from pg_proc where proname = 'pipo_origem' and pronamespace = 'public'::regnamespace) as funcao_origem,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
     'pipo_norm', 'pipo_origem', 'mcp_permitido', 'mcp_registrar', 'crm_listas_mcp', 'pipo_paciente_nome', 'crm_tarefa_json',
     'crm_tarefas_listar', 'crm_tarefa_obter', 'pacientes_buscar', 'crm_status_info', 'crm_tarefa_criar', 'crm_tarefas_alterar',
     'crm_comentar', 'pacientes_definir_inativo')) as funcoes;
