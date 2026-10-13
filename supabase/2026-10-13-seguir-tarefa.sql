-- Seguir tarefa (2026-10-13): quem não é responsável recebe aviso dos comentários e das mudanças.
alter table public.tasks add column if not exists followers uuid[] not null default '{}';

-- Seguir / deixar de seguir: qualquer pessoa que vê a lista (não precisa poder editar a tarefa).
create or replace function public.task_follow(p_task uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then raise exception 'Entre no sistema.' using errcode = '42501'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or t.unit_id is distinct from public.active_unit()
     or not public.crm_user_can(auth.uid(), t.list_id) then
    raise exception 'Sem acesso a esta tarefa.' using errcode = '42501';
  end if;
  update public.tasks
     set followers = case when p_on then (select coalesce(array_agg(distinct f), '{}') from unnest(followers || auth.uid()) f)
                          else array_remove(followers, auth.uid()) end
   where id = p_task;
end $$;
revoke execute on function public.task_follow(uuid, boolean) from public, anon;
grant execute on function public.task_follow(uuid, boolean) to authenticated;

-- Gatilho: além da menção, avisa quem segue a tarefa (comentário, status ou campo alterado).
create or replace function public.task_events_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('pipo.restore', true), '') = '1' then return null; end if;
  if new.kind = 'comment' and coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform public.push_call(jsonb_build_object('tipo', 'mencao', 'evento', new.id));
  end if;
  if new.kind in ('comment', 'status', 'field')
     and exists (select 1 from public.tasks where id = new.task_id and coalesce(array_length(followers, 1), 0) > 0) then
    perform public.push_call(jsonb_build_object('tipo', 'seguindo', 'evento', new.id));
  end if;
  return null;
end $$;
revoke execute on function public.task_events_push() from public, anon, authenticated;

-- Quem recebe: seguidor ≠ autor, com acesso à lista, que não foi mencionado (esse já recebe o aviso de menção).
create or replace function public.push_follow_targets(p_event uuid)
returns table (user_id uuid, task_id uuid, title text, author text, acao text)
language sql stable security definer set search_path = public as $$
  select distinct f, t.id, t.title, coalesce(e.author_name, 'Alguém'),
         case e.kind when 'comment' then 'comentou' when 'status' then 'mudou o status' else 'alterou a tarefa' end
    from public.task_events e
    join public.tasks t on t.id = e.task_id
    cross join lateral unnest(t.followers) f
   where e.id = p_event
     and f is distinct from e.author_id
     and not (f = any(coalesce(e.mentions, '{}')))
     and public.crm_user_can(f, t.list_id);
$$;
revoke execute on function public.push_follow_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_follow_targets(uuid) to service_role;
