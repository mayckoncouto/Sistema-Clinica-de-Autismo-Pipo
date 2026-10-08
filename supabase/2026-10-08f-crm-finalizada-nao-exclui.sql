-- 2026-10-08f — CRM: tarefa num status "Finalizado" não pode ser excluída (vale para todos,
-- inclusive o Administrador). Os status finalizados são os marcados em CRM ▾ → Listas e status
-- (config/task_lists, "done": true). Precisa da 2026-10-08e antes. Pode rodar mais de uma vez.

begin;

create or replace function public.tasks_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
      from public.documents d,
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
end $$;

drop trigger if exists tasks_delete_guard on public.tasks;
create trigger tasks_delete_guard before delete on public.tasks
  for each row execute function public.tasks_delete_guard();

commit;

-- Conferência: deve mostrar 1 (o gatilho existe)
select count(*) as gatilho_finalizada_nao_exclui
  from pg_trigger where tgname = 'tasks_delete_guard' and not tgisinternal;
