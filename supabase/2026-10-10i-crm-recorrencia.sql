-- 2026-10-10i — CRM: tarefa recorrente.
--   tasks.recurrence (jsonb, vazio = não repete):
--     {freq: "diaria"|"semanal"|"mensal"|"anual", dias: [0..6] (semanal; 0 = domingo),
--      nova: true|false, sempre: true|false, ate: "aaaa-mm-dd"|null, status: "<id do status da próxima>"}
--   Ao FINALIZAR a tarefa (ir para um status com "done" em CRM ▾ → Listas e status):
--     * calcula a próxima data a partir do vencimento (sem vencimento: a partir de hoje);
--     * passou do "ate" (quando não é "sempre"): não repete mais;
--     * nova = false: a mesma tarefa volta para o status escolhido com a nova data;
--     * nova = true: a finalizada fica como histórico e nasce uma tarefa igual, no status escolhido
--       e com a nova data (a recorrência passa para a nova).
--   Feito no banco (gatilho), então vale de qualquer lugar: lista, quadro, janela da tarefa, celular.
-- Precisa da 2026-10-08e antes. Pode rodar mais de uma vez.

begin;

alter table public.tasks add column if not exists recurrence jsonb;

-- Próxima data de uma recorrência a partir de uma data
create or replace function public.crm_rec_next(p_from date, p_rec jsonb)
returns date language plpgsql immutable as $$
declare v_dias int[]; k int;
begin
  if p_rec ->> 'freq' = 'diaria' then return p_from + 1; end if;
  if p_rec ->> 'freq' = 'mensal' then return (p_from + interval '1 month')::date; end if;
  if p_rec ->> 'freq' = 'anual'  then return (p_from + interval '1 year')::date; end if;
  -- semanal: próximo dia da semana marcado (sem dias marcados: 7 dias depois)
  select coalesce(array_agg(x::int), '{}') into v_dias from jsonb_array_elements_text(coalesce(p_rec -> 'dias', '[]'::jsonb)) x;
  if coalesce(array_length(v_dias, 1), 0) = 0 then return p_from + 7; end if;
  for k in 1..7 loop
    if extract(dow from p_from + k)::int = any(v_dias) then return p_from + k; end if;
  end loop;
  return p_from + 7;
end $$;

-- status "done" de uma lista (config/task_lists)
create or replace function public.crm_status_done(p_list text, p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((s ->> 'done')::boolean, false)), false)
    from public.documents d,
         jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
         jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
   where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_status;
$$;

-- status da próxima: o escolhido, se ainda existir e não for finalizado; senão o 1º não finalizado da lista
create or replace function public.crm_rec_status(p_list text, p_want text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) s
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and s ->> 'id' = p_want
        and not coalesce((s ->> 'done')::boolean, false) limit 1),
    (select s ->> 'id' from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) l,
            jsonb_array_elements(coalesce(l -> 'statuses', '[]'::jsonb)) with ordinality s(s, i)
      where d.path = 'config/task_lists' and l ->> 'id' = p_list and not coalesce((s ->> 'done')::boolean, false)
      order by i limit 1));
$$;

create or replace function public.tasks_recur()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rec jsonb := new.recurrence;
  v_next date;
  v_st text;
begin
  if v_rec is null or jsonb_typeof(v_rec) <> 'object' or coalesce(v_rec ->> 'freq', '') = '' then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if not public.crm_status_done(new.list_id, new.status) or public.crm_status_done(old.list_id, old.status) then return new; end if;

  v_next := public.crm_rec_next(coalesce(new.due_date, old.due_date, current_date), v_rec);
  if not coalesce((v_rec ->> 'sempre')::boolean, true) and nullif(v_rec ->> 'ate', '') is not null
     and v_next > (v_rec ->> 'ate')::date then
    return new;   -- acabou a recorrência: fica finalizada
  end if;
  v_st := public.crm_rec_status(new.list_id, v_rec ->> 'status');
  if v_st is null then return new; end if;

  if coalesce((v_rec ->> 'nova')::boolean, false) then
    insert into public.tasks (list_id, status, title, description, priority, due_date, assignees, tags, patient_id, lead, position, recurrence)
    values (new.list_id, v_st, new.title, new.description, new.priority, v_next, new.assignees, new.tags, new.patient_id, new.lead, new.position, v_rec);
    new.recurrence := null;
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', true, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
  else
    insert into public.task_events (task_id, kind, data, author_id, author_name)
    values (new.id, 'field', jsonb_build_object('campo', 'recorrencia', 'nova', false, 'de', new.due_date, 'para', v_next), auth.uid(), public.crm_my_name());
    new.status := v_st;
    new.due_date := v_next;
    new.closed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_recur on public.tasks;
create trigger tasks_recur before update of status on public.tasks
  for each row execute function public.tasks_recur();

commit;

-- Conferência: deve mostrar 1 | 1 (coluna e gatilho existem)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'recurrence') as coluna_recorrencia,
       (select count(*) from pg_trigger where tgname = 'tasks_recur' and not tgisinternal) as gatilho_recorrencia;
