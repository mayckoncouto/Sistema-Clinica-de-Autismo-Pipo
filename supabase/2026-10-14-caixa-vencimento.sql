-- CRM → Caixa de Entrada: aviso de vencimento (2026-10-14)
-- Tarefa em aberto, da qual a pessoa é responsável ou seguidora, que chega na data de vencimento (8h de Brasília) entra na Caixa
-- como movimentação "Vencimento" (aparece na Principal; Limpar/Adiar funcionam; nova data = novo aviso). Pode rodar de novo.

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
    select e.id, e.task_id, e.kind, e.body, e.data, e.mentions, e.author_id, e.author_name, e.created_at
      from public.task_events e
     where e.task_id in (select id from mine) and e.created_at > now() - make_interval(days => greatest(p_days, 1))
    union all
    -- Vencimento: tarefa em aberto que a pessoa responde ou segue e que chegou na data (às 8h de Brasília do dia).
    select null::uuid, t.id, 'field', '', jsonb_build_object('campo', 'vencimento', 'due', true, 'due_date', t.due_date),
           '{}'::uuid[], null::uuid, 'Vencimento',
           ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo')
      from public.tasks t, me
     where t.due_date is not null
       and (me.u = any(t.assignees) or me.u = any(t.followers))
       and not public.crm_status_done(t.list_id, t.status)
       and ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo') <= now()
       and ((t.due_date::timestamp + interval '8 hours') at time zone 'America/Sao_Paulo') > now() - make_interval(days => greatest(p_days, 1))
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
            from (select y.* from ev y where y.task_id = t.id order by y.created_at desc limit 5) x)
    from public.tasks t
    join ev e on e.task_id = t.id
    left join public.task_inbox i on i.task_id = t.id and i.user_id = (select u from me)
    left join public.task_reads r on r.task_id = t.id and r.user_id = (select u from me)
   group by t.id, i.cleared_at, i.snoozed_until, i.mark_unread
$$;
grant execute on function public.crm_inbox(int) to authenticated;

select (select position('Vencimento' in pg_get_functiondef('public.crm_inbox(int)'::regprocedure)) > 0) as funcao_nova;
