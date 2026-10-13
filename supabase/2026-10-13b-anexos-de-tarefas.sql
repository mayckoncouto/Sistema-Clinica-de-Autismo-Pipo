-- Anexos das tarefas do CRM, guardados no Google Drive (2026-10-13).
--
-- O arquivo em si fica num Drive compartilhado do Google, numa pasta por paciente com as subpastas
-- "Documentos" e "Relatórios". Aqui ficam só o nome, o código do arquivo no Drive e quem enviou.
--   • task_attachments: um registro por anexo. Quem vê a tarefa vê os anexos de "Relatórios"; os de
--     "Documentos" (laudos, encaminhamentos…) só quem também vê a saúde do paciente. Anexar, renomear e
--     excluir exigem poder editar a lista da tarefa.
--   • patient_drive_folders: guarda as pastas já criadas de cada paciente. Só a função do servidor
--     (service role) mexe; ninguém lê pelo app.
--   • task_attachment_can / task_attachment_ctx: usadas pela função do servidor (api/task-files.js).
--   • Anexar, renomear e excluir viram uma linha no histórico da tarefa.
-- Pode rodar de novo.

create table if not exists public.task_attachments (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  patient_id      text,
  kind            text not null check (kind in ('documentos', 'relatorios')),
  drive_file_id   text not null,
  name            text not null check (char_length(name) between 1 and 250),
  mime            text,
  size            bigint,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  unit_id         text not null default 'unidade-1'
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id, created_at);
create index if not exists task_attachments_patient_idx on public.task_attachments (patient_id);

create table if not exists public.patient_drive_folders (
  patient_id    text not null,
  unit_id       text not null default 'unidade-1',
  folder_id     text not null,
  documentos_id text not null,
  relatorios_id text not null,
  created_at    timestamptz not null default now(),
  primary key (patient_id, unit_id)
);
alter table public.patient_drive_folders enable row level security;
revoke all on public.patient_drive_folders from public, anon, authenticated;

-- Pode ver / anexar? (view = ver e baixar; create, edit e delete = poder editar a lista da tarefa)
create or replace function public.task_attachment_can(p_task uuid, p_kind text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit() then return false; end if;
  if not public.has_perm('crm_' || t.list_id, case when p_action = 'view' then 'view' else 'edit' end) then
    return false;
  end if;
  if p_kind = 'documentos' and not public.has_perm('saude_paciente', 'view') then return false; end if;
  return true;
end $$;
revoke execute on function public.task_attachment_can(uuid, text, text) from public, anon;
grant execute on function public.task_attachment_can(uuid, text, text) to authenticated;

-- Paciente da tarefa (código e nome) para a função do servidor montar a pasta e o nome do arquivo.
create or replace function public.task_attachment_ctx(p_task uuid)
returns table (patient_id text, patient_name text, unit_id text)
language plpgsql stable security definer set search_path = public as $$
declare t public.tasks%rowtype; v_name text;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.' using errcode = '42501'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit()
     or not public.has_perm('crm_' || t.list_id, 'view') then
    raise exception 'Sem acesso a esta tarefa.' using errcode = '42501';
  end if;
  if t.patient_id is not null then
    select btrim(p ->> 'nome') into v_name
      from public.documents_u d, jsonb_array_elements(d.data -> 'list') p
     where d.path = 'patients/all' and p ->> 'id' = t.patient_id
     limit 1;
  end if;
  return query select t.patient_id, v_name, t.unit_id;
end $$;
revoke execute on function public.task_attachment_ctx(uuid) from public, anon;
grant execute on function public.task_attachment_ctx(uuid) to authenticated;

alter table public.task_attachments enable row level security;
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (public.task_attachment_can(task_id, kind, 'view'));
drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (public.task_attachment_can(task_id, kind, 'create'));
drop policy if exists task_attachments_update on public.task_attachments;
create policy task_attachments_update on public.task_attachments for update to authenticated
  using (public.task_attachment_can(task_id, kind, 'edit'))
  with check (public.task_attachment_can(task_id, kind, 'edit'));
drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (public.task_attachment_can(task_id, kind, 'delete'));
grant select, insert, update, delete on public.task_attachments to authenticated;

-- Unidade (mesma regra das outras tabelas)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'task_attachments_0_unit_stamp' and not tgisinternal) then
    create trigger task_attachments_0_unit_stamp before insert or update on public.task_attachments
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_attachments' and policyname = 'task_attachments_unit') then
    create policy task_attachments_unit on public.task_attachments as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

-- Quem enviou: sempre quem está logado
create or replace function public.task_attachments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
    select p.full_name into new.created_by_name from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists task_attachments_stamp on public.task_attachments;
create trigger task_attachments_stamp before insert on public.task_attachments
  for each row execute function public.task_attachments_stamp();

-- Histórico da tarefa
create or replace function public.task_attachments_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_task uuid; v_data jsonb;
begin
  v_task := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  if not exists (select 1 from public.tasks where id = v_task) then return null; end if;
  select p.full_name into v_name from public.profiles p where p.id = auth.uid();
  if tg_op = 'INSERT' then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'anexou', 'para', new.name, 'pasta', new.kind);
  elsif tg_op = 'DELETE' then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'excluiu', 'de', old.name, 'pasta', old.kind);
  elsif new.name is distinct from old.name then
    v_data := jsonb_build_object('campo', 'anexo', 'acao', 'renomeou', 'de', old.name, 'para', new.name, 'pasta', new.kind);
  else
    return null;
  end if;
  insert into public.task_events (task_id, kind, data, author_id, author_name)
  values (v_task, 'field', v_data, auth.uid(), v_name);
  return null;
end $$;
drop trigger if exists task_attachments_history on public.task_attachments;
create trigger task_attachments_history after insert or update or delete on public.task_attachments
  for each row execute function public.task_attachments_history();

-- Backup e restauração por quem não é usuário: a restauração do app não leva os anexos (só os registros;
-- os arquivos continuam no Drive). Nada a fazer aqui.
