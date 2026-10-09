-- CRM: editar o próprio comentário (2026-10-09)
-- Antes: o comentário só podia ser excluído (pelo autor ou pelo Administrador).
-- Agora: o AUTOR também pode editar o texto. Só mudam o texto e as menções; autor,
-- tarefa e data ficam como estavam, e edited_at guarda quando foi editado.
-- Pode rodar de novo.

alter table public.task_events add column if not exists edited_at timestamptz;

create or replace function public.task_events_edit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.kind <> 'comment' then raise exception 'Só comentários podem ser editados.'; end if;
  new.id := old.id; new.task_id := old.task_id; new.kind := old.kind; new.data := old.data;
  new.author_id := old.author_id; new.author_name := old.author_name; new.created_at := old.created_at;
  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then new.edited_at := now();
  else new.edited_at := old.edited_at; end if;
  return new;
end $$;
drop trigger if exists task_events_edit_guard on public.task_events;
create trigger task_events_edit_guard before update on public.task_events for each row execute function public.task_events_edit_guard();

drop policy if exists task_events_update on public.task_events;
create policy task_events_update on public.task_events for update to authenticated
  using (kind = 'comment' and author_id = auth.uid())
  with check (kind = 'comment' and author_id = auth.uid());

-- Conferência: deve mostrar 1 | 1 | 1
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'task_events' and column_name = 'edited_at') as coluna,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'task_events' and policyname = 'task_events_update') as politica,
  (select count(*) from pg_trigger where tgname = 'task_events_edit_guard') as gatilho;
