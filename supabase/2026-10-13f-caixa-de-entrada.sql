-- CRM → Caixa de Entrada (2026-10-13)
-- Notificações de movimentação por tarefa, por pessoa. Cada pessoa limpa, adia ou marca como não lida as SUAS linhas
-- (`task_inbox`, só ela lê e grava). A função `crm_inbox` junta as tarefas em que a pessoa é responsável, segue, criou
-- ou foi @mencionada com o resumo das últimas movimentações (security invoker: as permissões das listas continuam valendo).
-- Permissão nova `crmcaixa` (ver): os níveis que já viam o CRM começam com ela. Pode rodar de novo.

create table if not exists public.task_inbox (
  user_id        uuid not null default auth.uid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  cleared_at     timestamptz,
  snoozed_until  timestamptz,
  mark_unread    boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (user_id, task_id)
);
alter table public.task_inbox enable row level security;
drop policy if exists task_inbox_own on public.task_inbox;
create policy task_inbox_own on public.task_inbox for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.task_inbox to authenticated;

create or replace function public.crm_inbox(p_days int default 30)
returns table(task_id uuid, last_at timestamptz, total int, news int, unseen int, mentioned boolean,
              cleared_at timestamptz, snoozed_until timestamptz, mark_unread boolean, events jsonb)
language sql stable security invoker set search_path = public as $$
  with me as (select auth.uid() as u),
  mine as (
    select t.id from public.tasks t, me
     where me.u = any(t.assignees) or me.u = any(t.followers) or t.created_by = me.u
        or exists (select 1 from public.task_events m where m.task_id = t.id and me.u = any(m.mentions))
  ),
  ev as (
    select e.* from public.task_events e
     where e.task_id in (select id from mine) and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  )
  select t.id,
         max(e.created_at),
         count(*)::int,
         count(*) filter (where e.author_id is distinct from (select u from me) and e.created_at > coalesce(i.cleared_at, '-infinity'::timestamptz))::int,
         count(*) filter (where e.author_id is distinct from (select u from me) and e.created_at > coalesce(r.seen_at, '-infinity'::timestamptz))::int,
         bool_or((select u from me) = any(e.mentions)),
         i.cleared_at, i.snoozed_until, coalesce(i.mark_unread, false),
         (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'body', x.body, 'data', x.data, 'author_id', x.author_id,
                  'author_name', x.author_name, 'created_at', x.created_at, 'mine', x.author_id = (select u from me),
                  'mention', (select u from me) = any(x.mentions)) order by x.created_at desc), '[]'::jsonb)
            from (select * from ev y where y.task_id = t.id order by y.created_at desc limit 5) x)
    from public.tasks t
    join ev e on e.task_id = t.id
    left join public.task_inbox i on i.task_id = t.id and i.user_id = (select u from me)
    left join public.task_reads r on r.task_id = t.id and r.user_id = (select u from me)
   group by t.id, i.cleared_at, i.snoozed_until, i.mark_unread
$$;
grant execute on function public.crm_inbox(int) to authenticated;

update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
     || jsonb_build_object('crmcaixa', jsonb_build_object('view', coalesce((permissions -> 'crm_listas' ->> 'view')::boolean, false)))
 where not coalesce(is_admin, false)
   and permissions ? 'crm_listas'
   and not (permissions ? 'crmcaixa');

-- Conferência: tabela | função | níveis com a permissão | política
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'task_inbox') as tabela,
       (select count(*) from pg_proc where proname = 'crm_inbox') as funcao,
       (select count(*) from public.roles where permissions ? 'crmcaixa') as niveis,
       (select count(*) from pg_policies where tablename = 'task_inbox') as politica;
