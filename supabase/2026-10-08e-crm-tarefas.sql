-- 2026-10-08e — CRM (Fase 1): listas, status, tarefas, comentários e histórico.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar. Pode rodar mais de uma vez.
--   1. Cadastro das listas e dos status: documento config/task_lists (só o Administrador grava;
--      todo usuário ativo lê). Nasce com Atendimento (funil), Agendas, Fature e Gestão.
--   2. Tabelas public.tasks (tarefas), public.task_events (comentários e histórico) e
--      public.task_reads (o que cada pessoa já viu, para as menções não lidas).
--   3. Permissão POR LISTA: módulo "crm_<id da lista>" (ver/incluir/editar/excluir) nos Níveis.
--      Os níveis que hoje veem a Agenda começam com tudo nas 4 listas (o Administrador ajusta).
--   4. Histórico automático (gatilho): criar tarefa, mudar status, responsáveis, vencimento,
--      prioridade, título e lista.
--   5. Função crm_people(): nome dos usuários ativos (para escolher responsável e @mencionar).

begin;

-- 1. Caminho permitido e módulo do cadastro das listas (só Administrador grava)
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
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
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

insert into public.documents (path, data)
values ('config/task_lists', jsonb_build_object('list', jsonb_build_array(
  jsonb_build_object('id', 'atendimento', 'name', 'Atendimento', 'color', '#2e7d6b', 'lead', true, 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'triagem', 'name', 'Triagem', 'color', '#e8b100'),
    jsonb_build_object('id', 'avaliacao', 'name', 'Avaliação', 'color', '#5b4bd6'),
    jsonb_build_object('id', 'pos-avaliacao', 'name', 'Pós-avaliação', 'color', '#ea6a0a'),
    jsonb_build_object('id', 'contrato', 'name', 'Contrato assinado', 'color', '#2e9d57', 'done', true),
    jsonb_build_object('id', 'cancelado', 'name', 'Cancelado', 'color', '#d64545', 'done', true, 'lost', true))),
  jsonb_build_object('id', 'agendas', 'name', 'Agendas', 'color', '#e8a400', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true))),
  jsonb_build_object('id', 'fature', 'name', 'Fature', 'color', '#64748b', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true))),
  jsonb_build_object('id', 'gestao', 'name', 'Gestão', 'color', '#2563eb', 'statuses', jsonb_build_array(
    jsonb_build_object('id', 'aberto', 'name', 'Em aberto', 'color', '#e8b100'),
    jsonb_build_object('id', 'andamento', 'name', 'Em andamento', 'color', '#3b82d6'),
    jsonb_build_object('id', 'concluido', 'name', 'Concluído', 'color', '#2e9d57', 'done', true)))
)))
on conflict (path) do nothing;

-- 2. Tabelas
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  list_id         text not null,
  status          text not null,
  title           text not null,
  description     text not null default '',
  priority        text not null default 'normal' check (priority in ('urgente', 'alta', 'normal', 'baixa')),
  due_date        date,
  assignees       uuid[] not null default '{}',
  tags            text[] not null default '{}',
  patient_id      text,
  lead            jsonb not null default '{}'::jsonb,
  position        double precision not null default 0,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists tasks_list_idx on public.tasks (list_id, status);
create index if not exists tasks_assignees_idx on public.tasks using gin (assignees);

create table if not exists public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  kind        text not null check (kind in ('comment', 'create', 'status', 'field')),
  body        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  mentions    uuid[] not null default '{}',
  author_id   uuid default auth.uid(),
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events (task_id, created_at);
create index if not exists task_events_mentions_idx on public.task_events using gin (mentions);

create table if not exists public.task_reads (
  user_id uuid not null default auth.uid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- nome de quem está logado (para autor e histórico)
create or replace function public.crm_my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), '');
$$;

-- carimbos: autor, nome, datas, fechamento
create or replace function public.tasks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); end if;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tasks_stamp on public.tasks;
create trigger tasks_stamp before insert or update on public.tasks for each row execute function public.tasks_stamp();

create or replace function public.task_events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.author_id := auth.uid(); new.author_name := public.crm_my_name(); end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists task_events_stamp on public.task_events;
create trigger task_events_stamp before insert on public.task_events for each row execute function public.task_events_stamp();

-- 4. Histórico automático
create or replace function public.tasks_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := public.crm_my_name();
begin
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
  return new;
end $$;
drop trigger if exists tasks_history on public.tasks;
create trigger tasks_history after insert or update on public.tasks for each row execute function public.tasks_history();

-- 3. Segurança (RLS): cada lista com a sua permissão "crm_<lista>"
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.task_reads enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.has_perm('crm_' || list_id, 'view'));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_perm('crm_' || list_id, 'create'));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_perm('crm_' || list_id, 'edit'))
  with check (public.has_perm('crm_' || list_id, 'edit'));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_perm('crm_' || list_id, 'delete'));

-- comentário: quem vê a tarefa pode comentar; apaga o próprio comentário (ou o Administrador)
drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and public.has_perm('crm_' || t.list_id, 'view')));
drop policy if exists task_events_insert on public.task_events;
create policy task_events_insert on public.task_events for insert to authenticated
  with check (kind = 'comment' and exists (select 1 from public.tasks t where t.id = task_id and public.has_perm('crm_' || t.list_id, 'view')));
drop policy if exists task_events_delete on public.task_events;
create policy task_events_delete on public.task_events for delete to authenticated
  using (kind = 'comment' and (author_id = auth.uid() or public.is_admin()));

drop policy if exists task_reads_own on public.task_reads;
create policy task_reads_own on public.task_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.tasks, public.task_events, public.task_reads to authenticated;

-- 5. Usuários ativos (para responsável e @menção)
create or replace function public.crm_people()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
   order by p.full_name;
$$;
grant execute on function public.crm_people() to authenticated;
revoke execute on function public.crm_people() from anon;

-- tempo real
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_events') then
    alter publication supabase_realtime add table public.task_events;
  end if;
end $$;

-- permissões iniciais: quem vê a Agenda recebe tudo nas 4 listas
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions
     || jsonb_build_object('crm_atendimento', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_agendas', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_fature', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
     || jsonb_build_object('crm_gestao', jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
 where not r.is_admin
   and coalesce((r.permissions -> 'agenda' ->> 'view')::boolean, false)
   and not (r.permissions ? 'crm_atendimento');
alter table public.roles enable trigger roles_guard;

commit;

-- Conferência: listas cadastradas, tabelas criadas e níveis com acesso ao CRM
select
  (select jsonb_array_length(data -> 'list') from public.documents where path = 'config/task_lists') as listas,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tasks', 'task_events', 'task_reads')) as tabelas,
  (select count(*) from public.roles where permissions ? 'crm_atendimento') as niveis_com_crm,
  public.module_for_path('config/task_lists') as modulo_das_listas;
