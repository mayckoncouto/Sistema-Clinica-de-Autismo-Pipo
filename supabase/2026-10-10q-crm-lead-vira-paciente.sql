-- =====================================================================
-- CRM: o lead vira paciente (pedido do usuário, 2026-10-10).
-- 1) A Atividade da tarefa registra quando ela é ligada a um paciente
--    ("cadastrou o lead X como paciente").
-- 2) Tarefas JÁ ligadas a um paciente perdem os dados do lead (nome, telefone,
--    diagnóstico, convênio): passam a valer os do cadastro do paciente. O motivo de
--    perda (se houver) fica. Pode rodar de novo.
-- =====================================================================
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
  if new.patient_id is not null and new.patient_id is distinct from old.patient_id then
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'paciente', 'de', nullif(btrim(coalesce(old.lead ->> 'nome', '')), ''), 'para', new.patient_id), auth.uid(), v_name);
  end if;
  return new;
end $$;

update public.tasks
   set lead = case when coalesce(lead ->> 'motivoPerda', '') <> '' then jsonb_build_object('motivoPerda', lead -> 'motivoPerda') else '{}'::jsonb end
 where patient_id is not null
   and (lead - 'motivoPerda') <> '{}'::jsonb;

-- Conferência: a primeira deve dar 0; a segunda deve dar 1.
select (select count(*) from public.tasks where patient_id is not null and (lead - 'motivoPerda') <> '{}'::jsonb) as tarefas_de_paciente_com_dados_de_lead,
       (select count(*) from pg_proc where proname = 'tasks_history' and prosrc like '%''paciente''%') as atividade_do_paciente;
