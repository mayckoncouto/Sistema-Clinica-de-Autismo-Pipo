-- Anexos direto no cadastro do paciente (aba Anexos da janela do paciente).
-- O anexo pode existir sem tarefa (task_id vazio). Permissão própria: pacientes_anexos (ver/incluir/editar/excluir).
alter table public.task_attachments alter column task_id drop not null;

create or replace function public.patient_attachment_can(p_kind text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not public.has_perm('pacientes_anexos', case p_action when 'view' then 'view' when 'create' then 'create' when 'delete' then 'delete' else 'edit' end) then
    return false;
  end if;
  if p_kind = 'documentos' and not public.has_perm('saude_paciente', 'view') then return false; end if;
  return true;
end $$;
revoke execute on function public.patient_attachment_can(text, text) from public, anon;
grant execute on function public.patient_attachment_can(text, text) to authenticated;

-- Sem tarefa, vale a permissão do paciente.
create or replace function public.task_attachment_can(p_task uuid, p_kind text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then return false; end if;
  if p_task is null then return public.patient_attachment_can(p_kind, p_action); end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit() then return false; end if;
  if not public.has_perm('crm_' || t.list_id, case when p_action = 'view' then 'view' else 'edit' end) then
    return false;
  end if;
  if p_kind = 'documentos' and not public.has_perm('saude_paciente', 'view') then return false; end if;
  return true;
end $$;

-- Paciente (código e nome) para a função do servidor montar a pasta e o nome do arquivo.
create or replace function public.patient_attachment_ctx(p_patient text)
returns table (patient_id text, patient_name text, unit_id text)
language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.' using errcode = '42501'; end if;
  select btrim(p ->> 'nome') into v_name
    from public.documents_u d, jsonb_array_elements(d.data -> 'list') p
   where d.path = 'patients/all' and p ->> 'id' = p_patient
   limit 1;
  if v_name is null then raise exception 'Paciente não encontrado.' using errcode = '42501'; end if;
  return query select p_patient, v_name, public.active_unit();
end $$;
revoke execute on function public.patient_attachment_ctx(text) from public, anon;
grant execute on function public.patient_attachment_ctx(text) to authenticated;

-- Quem vê os anexos do paciente também vê os que vieram das tarefas dele.
alter policy task_attachments_select on public.task_attachments
  using (public.task_attachment_can(task_id, kind, 'view') or (task_id is not null and public.patient_attachment_can(kind, 'view')));

-- Níveis que veem Pacientes passam a ver a aba Anexos (incluir/editar/excluir: o Administrador libera).
update public.roles r
   set permissions = jsonb_set(coalesce(r.permissions, '{}'::jsonb), '{pacientes_anexos}', '{"view": true}'::jsonb, true)
 where not r.is_admin
   and coalesce((r.permissions -> 'pacientes' ->> 'view')::boolean, false)
   and not (r.permissions ? 'pacientes_anexos');
