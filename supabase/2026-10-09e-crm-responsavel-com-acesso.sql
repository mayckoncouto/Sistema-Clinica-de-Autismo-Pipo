-- CRM: só pode ser responsável por uma tarefa quem tem acesso ao CRM e à lista da tarefa (2026-10-09)
--   1. crm_user_can(usuário, lista): usuário ativo, Administrador, ou nível com "ver" em CRM (crm_listas;
--      nível sem o item gravado vale se ele enxerga alguma lista, como no app) E "ver" na lista (crm_<lista>).
--   2. crm_people() passa a devolver também admin, crm e as listas que cada pessoa vê (o app filtra a
--      escolha de responsáveis pela lista da tarefa).
--   3. Gatilho tasks_assignees_guard: recusa gravar responsável novo sem acesso (os que já estavam ficam;
--      mudar a tarefa de lista confere todos).
-- Pode rodar de novo.

create or replace function public.crm_user_can(p_user uuid, p_list text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (
      coalesce(r.is_admin, false) or (
        coalesce((r.permissions -> ('crm_' || p_list) ->> 'view')::boolean, false)
        and case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                 then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                 else true end
      ))
      from public.profiles p left join public.roles r on r.id = p.role_id
     where p.id = p_user
  ), false);
$$;
grant execute on function public.crm_user_can(uuid, text) to authenticated;
revoke execute on function public.crm_user_can(uuid, text) from anon;

drop function if exists public.crm_people();
create function public.crm_people()
returns table (id uuid, full_name text, admin boolean, crm boolean, lists text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name,
         coalesce(r.is_admin, false) as admin,
         coalesce(r.is_admin, false) or (
           case when coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas'
                then coalesce((r.permissions -> 'crm_listas' ->> 'view')::boolean, false)
                else exists (select 1 from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                              where e.key like 'crm\_%' and e.key <> 'crm_listas'
                                and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)) end
         ) as crm,
         coalesce((select array_agg(substr(e.key, 5) order by e.key)
                     from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
                    where e.key like 'crm\_%' and e.key <> 'crm_listas'
                      and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)),
                  '{}'::text[]) as lists
    from public.profiles p left join public.roles r on r.id = p.role_id
   where p.active and coalesce(p.full_name, '') <> '' and public.is_active_user()
   order by p.full_name;
$$;
grant execute on function public.crm_people() to authenticated;
revoke execute on function public.crm_people() from anon;

create or replace function public.tasks_assignees_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; nm text;
begin
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
drop trigger if exists tasks_assignees_guard on public.tasks;
create trigger tasks_assignees_guard before insert or update of assignees, list_id on public.tasks
  for each row execute function public.tasks_assignees_guard();

-- Conferência: tarefas abertas com responsável que hoje não tem acesso (continuam até alguém tirar)
select t.title as tarefa, t.list_id as lista, pr.full_name as responsavel_sem_acesso
  from public.tasks t cross join lateral unnest(coalesce(t.assignees, '{}'::uuid[])) a(u)
  join public.profiles pr on pr.id = a.u
 where not public.crm_user_can(a.u, t.list_id)
 order by 1;
