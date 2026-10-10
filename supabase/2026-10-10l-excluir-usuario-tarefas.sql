-- =====================================================================
-- Agenda Pipo — usuário excluído sai dos responsáveis das tarefas do CRM (2026-10-10)
--   * Ao excluir um usuário (Acesso → Usuários → Excluir), ele sai dos Responsáveis de
--     todas as tarefas (fica registrado na atividade de cada tarefa) e as marcas de
--     "lido" dele são apagadas.
--   * crm_user_open_tasks(usuário): quantas tarefas NÃO finalizadas têm a pessoa como
--     responsável — a janela de exclusão avisa antes de confirmar.
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.profiles_tasks_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set assignees = array_remove(assignees, old.id) where old.id = any(assignees);
  delete from public.task_reads where user_id = old.id;
  return old;
end $$;

drop trigger if exists profiles_tasks_cleanup on public.profiles;
create trigger profiles_tasks_cleanup
  after delete on public.profiles
  for each row execute function public.profiles_tasks_cleanup();

create or replace function public.crm_user_open_tasks(p_user uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_admin() or public.has_perm('usuarios', 'delete')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select count(*) into n from public.tasks
   where p_user = any(assignees) and not public.crm_status_done(list_id, status);
  return n;
end $$;
grant execute on function public.crm_user_open_tasks(uuid) to authenticated;
revoke execute on function public.crm_user_open_tasks(uuid) from anon;

-- Conferência: deve mostrar 1 | 1
select (select count(*) from pg_trigger where tgname = 'profiles_tasks_cleanup') as trava_criada,
       (select count(*) from pg_proc where proname = 'crm_user_open_tasks' and pronamespace = 'public'::regnamespace) as funcao_criada;
