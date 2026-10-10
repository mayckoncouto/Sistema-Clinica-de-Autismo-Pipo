-- =====================================================================
-- Agenda Pipo — CRM: lista ou status com tarefas não é excluído (2026-10-10)
--   * CRM → Listas e status: tirar uma lista que tem tarefas, ou um status que tem
--     tarefas, é recusado — contando TODAS as tarefas (também as que a pessoa não vê).
--   * crm_task_usage(): quantas tarefas há em cada lista/status (só os números, sem o
--     conteúdo), para a janela avisar antes de salvar.
-- Vale para todos os usuários (o SQL Editor/scripts continuam livres).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.task_lists_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; v_new jsonb; st jsonb; n int;
begin
  if new.path <> 'config/task_lists' or auth.uid() is null then return new; end if;
  for o in select x from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) x loop
    v_new := null;
    select x into v_new from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id' limit 1;
    if v_new is null then
      select count(*) into n from public.tasks where list_id = o ->> 'id';
      if n > 0 then
        raise exception 'A lista "%" tem % tarefa(s): exclua ou mova as tarefas antes de excluir a lista.', o ->> 'name', n
          using errcode = '42501';
      end if;
    else
      for st in select y from jsonb_array_elements(coalesce(o -> 'statuses', '[]'::jsonb)) y loop
        if not exists (select 1 from jsonb_array_elements(coalesce(v_new -> 'statuses', '[]'::jsonb)) z where z ->> 'id' = st ->> 'id') then
          select count(*) into n from public.tasks where list_id = o ->> 'id' and status = st ->> 'id';
          if n > 0 then
            raise exception 'O status "%" da lista "%" tem % tarefa(s): mude o status delas antes de excluir.', st ->> 'name', o ->> 'name', n
              using errcode = '42501';
          end if;
        end if;
      end loop;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists task_lists_guard on public.documents;
create trigger task_lists_guard
  before update on public.documents
  for each row when (new.path = 'config/task_lists')
  execute function public.task_lists_guard();

create or replace function public.crm_task_usage()
returns table(list_id text, status text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('crm_listas', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query select t.list_id, t.status, count(*) from public.tasks t group by t.list_id, t.status;
end $$;
grant execute on function public.crm_task_usage() to authenticated;
revoke execute on function public.crm_task_usage() from anon;

-- Conferência: deve mostrar 1 | 1
select (select count(*) from pg_trigger where tgname = 'task_lists_guard') as trava_criada,
       (select count(*) from pg_proc where proname = 'crm_task_usage' and pronamespace = 'public'::regnamespace) as funcao_criada;
