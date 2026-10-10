-- =====================================================================
-- Revisão geral do sistema (2026-10-10). Pode rodar de novo sem problema.
-- 1. Backup do CRM: restaurar tarefas, comentários/histórico e links de cadastro
--    mantendo datas e autores originais (função backup_restore_crm, só para o
--    servidor — api/admin-backup.js — e os gatilhos param de carimbar durante a
--    restauração, com a marca pipo.restore).
-- 2. Apaga a tabela antiga planner_backups (cópia do Planner de 02/10, sem uso).
-- 3. Segurança: quem não fez login não pode chamar as funções internas do banco
--    (continuam liberadas só as da página do link de cadastro); 5 funções com o
--    caminho de busca fixo.
-- 4. Velocidade: 6 regras de acesso calculam o usuário uma vez por consulta.
-- =====================================================================

-- 1. Gatilhos do CRM e do link de cadastro: durante a restauração, mantêm o que veio.
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  return new;
end $$;

create or replace function public.tasks_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  v_name := public.crm_my_name();
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'create', jsonb_build_object('status', new.status), auth.uid(), v_name);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'status', jsonb_build_object('de', old.status, 'para', new.status), auth.uid(), v_name);
  end if;
  if new.list_id is distinct from old.list_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'lista', 'de', old.list_id, 'para', new.list_id), auth.uid(), v_name);
  end if;
  if new.assignees is distinct from old.assignees then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'responsaveis', 'de', to_jsonb(old.assignees), 'para', to_jsonb(new.assignees)), auth.uid(), v_name);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'vencimento', 'de', old.due_date, 'para', new.due_date), auth.uid(), v_name);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'prioridade', 'de', old.priority, 'para', new.priority), auth.uid(), v_name);
  end if;
  if new.title is distinct from old.title then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'titulo', 'de', old.title, 'para', new.title), auth.uid(), v_name);
  end if;
  if new.patient_id is not null and new.patient_id is distinct from old.patient_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'paciente', 'de', nullif(btrim(coalesce(old.lead ->> 'nome', '')), ''), 'para', new.patient_id), auth.uid(), v_name);
  end if;
  return new;
end $$;

create or replace function public.tasks_assignees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; nm text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  foreach u in array coalesce(new.assignees, '{}'::uuid[]) loop
    if tg_op = 'INSERT' or new.list_id is distinct from old.list_id
       or not (u = any(coalesce(old.assignees, '{}'::uuid[]))) then
      if not public.crm_user_can(u, new.list_id) then
        select full_name into nm from public.profiles where id = u;
        raise exception '% não tem acesso ao CRM ou a esta lista e não pode ser responsável pela tarefa.', coalesce(nm, 'Esta pessoa');
      end if;
    end if;
  end loop;
  return new;
end $$;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rec jsonb := new.recurrence;
  v_next date;
  v_st text;
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if v_rec is null or jsonb_typeof(v_rec) <> 'object' or coalesce(v_rec ->> 'freq', '') = '' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if not public.crm_status_done(new.list_id, new.status) or public.crm_status_done(old.list_id, old.status) then return new; end if;

  v_next := public.crm_rec_next(coalesce(new.due_date, old.due_date, current_date), v_rec);
  if not coalesce((v_rec ->> 'sempre')::boolean, true) and nullif(v_rec ->> 'ate', '') is not null
     and v_next > (v_rec ->> 'ate')::date then
    return new;   -- acabou a recorrência: fica finalizada
  end if;
  v_st := public.crm_rec_status(new.list_id, v_rec ->> 'status');
  if v_st is null then return new; end if;

  if coalesce((v_rec ->> 'nova')::boolean, false) then
    insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, tags, patient_id, lead, position, recurrence)
    values (new.list_id, v_st, new.title, new.description, new.priority, v_next, new.assignees, new.tags, new.patient_id, new.lead, new.position, v_rec);
    new.recurrence := null;
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', true, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
  else
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', false, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
    new.status := v_st;
    new.due_date := v_next;
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function public.task_events_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if old.kind <> 'comment' then raise exception 'Só comentários podem ser editados.'; end if;
  new.id := old.id; new.task_id := old.task_id; new.kind := old.kind; new.data := old.data;
  new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then new.edited_at := now();
  else new.edited_at := old.edited_at; end if;
  return new;
end $$;

create or replace function public.intake_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.used_at := null; new.reminded_at := null;
    new.expires_at := case when new.kind = 'geral' then null else now() + interval '1 day' end;
  else
    -- Quem usa o app só pode cancelar ou mudar telefone/nome; uso e lembrete são marcados pelas funções.
    new.token := old.token; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.intake', true), '') <> '1' then new.used_at := old.used_at; new.reminded_at := old.reminded_at; end if;
  end if;
  return new;
end $$;

create or replace function public.intake_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return new; end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_by_name := public.crm_my_name(); new.reviewed_at := now();
  end if;
  new.data := old.data; new.kind := old.kind; new.token := old.token; new.created_at := old.created_at;
  return new;
end $$;

-- Restauração do CRM e dos links (chamada só pelo servidor, com a chave secreta).
-- Acrescenta ou sobrescreve pelo código; nada criado depois do backup é apagado.
create or replace function public.backup_restore_crm(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  perform set_config('pipo.restore', '1', true);
  if p_table = 'tasks' then
    insert into public.tasks (id, list_id, status, title, description, priority, due_date, assignees, tags, patient_id,
                              lead, position, created_by, created_by_name, created_at, updated_at, closed_at, recurrence)
    select r.id, r.list_id, r.status, r.title, coalesce(r.description, ''), coalesce(r.priority, 'normal'), r.due_date,
           coalesce(r.assignees, '{}'), coalesce(r.tags, '{}'), r.patient_id, coalesce(r.lead, '{}'::jsonb),
           coalesce(r.position, 0), r.created_by, r.created_by_name, coalesce(r.created_at, now()),
           coalesce(r.updated_at, now()), r.closed_at, r.recurrence
      from jsonb_populate_recordset(null::public.tasks, p_rows) r
     where r.id is not null and r.list_id is not null and r.status is not null and r.title is not null
    on conflict (id) do update set
      list_id = excluded.list_id, status = excluded.status, title = excluded.title, description = excluded.description,
      priority = excluded.priority, due_date = excluded.due_date, assignees = excluded.assignees, tags = excluded.tags,
      patient_id = excluded.patient_id, lead = excluded.lead, position = excluded.position, created_by = excluded.created_by,
      created_by_name = excluded.created_by_name, created_at = excluded.created_at, updated_at = excluded.updated_at,
      closed_at = excluded.closed_at, recurrence = excluded.recurrence;
  elsif p_table = 'task_events' then
    insert into public.task_events (id, task_id, kind, body, data, mentions, author_id, author_name, created_at, edited_at)
    select r.id, r.task_id, r.kind, coalesce(r.body, ''), coalesce(r.data, '{}'::jsonb), coalesce(r.mentions, '{}'),
           r.author_id, r.author_name, coalesce(r.created_at, now()), r.edited_at
      from jsonb_populate_recordset(null::public.task_events, p_rows) r
     where r.id is not null and r.kind is not null and exists (select 1 from public.tasks t where t.id = r.task_id)
    on conflict (id) do update set
      task_id = excluded.task_id, kind = excluded.kind, body = excluded.body, data = excluded.data, mentions = excluded.mentions,
      author_id = excluded.author_id, author_name = excluded.author_name, created_at = excluded.created_at, edited_at = excluded.edited_at;
  elsif p_table = 'intake_links' then
    insert into public.intake_links (token, kind, patient_id, task_id, nome, telefone, prefill, created_by, created_by_name,
                                     created_at, expires_at, used_at, canceled_at, reminded_at)
    select r.token, r.kind, r.patient_id, (select t.id from public.tasks t where t.id = r.task_id), coalesce(r.nome, ''),
           coalesce(r.telefone, ''), coalesce(r.prefill, '{}'::jsonb), r.created_by, coalesce(r.created_by_name, ''),
           coalesce(r.created_at, now()), r.expires_at, r.used_at,
           -- um link geral antigo não pode tirar o lugar do link geral ativo de hoje
           case when r.kind = 'geral' and r.canceled_at is null
                     and exists (select 1 from public.intake_links g where g.kind = 'geral' and g.canceled_at is null and g.token <> r.token)
                then now() else r.canceled_at end,
           r.reminded_at
      from jsonb_populate_recordset(null::public.intake_links, p_rows) r
     where r.token is not null and r.kind is not null
    on conflict (token) do update set
      patient_id = excluded.patient_id, task_id = excluded.task_id, nome = excluded.nome, telefone = excluded.telefone,
      prefill = excluded.prefill, created_by = excluded.created_by, created_by_name = excluded.created_by_name,
      created_at = excluded.created_at, expires_at = excluded.expires_at, used_at = excluded.used_at,
      canceled_at = excluded.canceled_at, reminded_at = excluded.reminded_at;
  elsif p_table = 'intake_submissions' then
    insert into public.intake_submissions (id, token, kind, patient_id, task_id, data, status, created_at, reviewed_by,
                                           reviewed_by_name, reviewed_at, result_patient_id)
    select r.id, (select l.token from public.intake_links l where l.token = r.token), r.kind, r.patient_id,
           (select t.id from public.tasks t where t.id = r.task_id), coalesce(r.data, '{}'::jsonb), coalesce(r.status, 'pendente'),
           coalesce(r.created_at, now()), r.reviewed_by, coalesce(r.reviewed_by_name, ''), r.reviewed_at, r.result_patient_id
      from jsonb_populate_recordset(null::public.intake_submissions, p_rows) r
     where r.id is not null and r.kind is not null
    on conflict (id) do update set
      token = excluded.token, kind = excluded.kind, patient_id = excluded.patient_id, task_id = excluded.task_id,
      data = excluded.data, status = excluded.status, created_at = excluded.created_at, reviewed_by = excluded.reviewed_by,
      reviewed_by_name = excluded.reviewed_by_name, reviewed_at = excluded.reviewed_at, result_patient_id = excluded.result_patient_id;
  else
    raise exception 'Tabela inválida para restaurar: %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.backup_restore_crm(text, jsonb) from public, anon, authenticated;
grant execute on function public.backup_restore_crm(text, jsonb) to service_role;

-- 2. Cópia antiga do Planner (02/10/2026), sem uso no sistema.
drop table if exists public.planner_backups;

-- 3a. Quem não fez login não chama as funções internas. A página pública do link de
--     cadastro usa só intake_form e intake_send (e intake_link_state por dentro).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and pg_get_userbyid(p.proowner) = current_user
              and p.proname not in ('intake_form', 'intake_send', 'intake_link_state', 'backup_restore_crm')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- funções criadas daqui em diante também nascem fechadas para quem não fez login
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- 3b. Caminho de busca fixo (aviso de segurança do Supabase).
alter function public.treatments_one_active() set search_path = public;
alter function public.treatments_cancel_rules() set search_path = public;
alter function public.module_for_path(text) set search_path = public;
alter function public.crm_rec_next(date, jsonb) set search_path = public;
alter function public.intake_link_state(public.intake_links) set search_path = public;

-- 4. Velocidade: (select auth.uid()) é calculado uma vez por consulta.
drop policy if exists clinical_records_update on public.clinical_records;
create policy clinical_records_update on public.clinical_records
  for update to authenticated
  using (public.has_perm('prontuario', 'edit') and author_id = (select auth.uid()))
  with check (public.has_perm('prontuario', 'edit') and author_id = (select auth.uid()));
drop policy if exists clinical_records_delete on public.clinical_records;
create policy clinical_records_delete on public.clinical_records
  for delete to authenticated
  using (public.is_admin() or (public.has_perm('prontuario', 'delete') and author_id = (select auth.uid())));
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin() or public.has_perm('usuarios', 'view'));
drop policy if exists task_events_delete on public.task_events;
create policy task_events_delete on public.task_events for delete to authenticated
  using (kind = 'comment' and (author_id = (select auth.uid()) or public.is_admin()));
drop policy if exists task_reads_own on public.task_reads;
create policy task_reads_own on public.task_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists task_events_update on public.task_events;
create policy task_events_update on public.task_events for update to authenticated
  using (kind = 'comment' and author_id = (select auth.uid()))
  with check (kind = 'comment' and author_id = (select auth.uid()));

-- Conferência: 1 | 0 | 0 | 1
select
  (select count(*) from pg_proc where proname = 'backup_restore_crm') as funcao_restaurar_crm,
  (select count(*) from pg_class where relname = 'planner_backups' and relnamespace = 'public'::regnamespace) as copia_antiga,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and pg_get_userbyid(p.proowner) = current_user
      and p.proname not in ('intake_form', 'intake_send', 'intake_link_state')
      and has_function_privilege('anon', p.oid, 'execute')) as funcoes_abertas_sem_login,
  (select count(*) from pg_policies where policyname = 'task_reads_own' and qual like '%SELECT auth.uid()%') as regra_rapida;
