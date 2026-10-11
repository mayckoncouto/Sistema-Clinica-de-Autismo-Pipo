-- 2026-10-11 — Notificações no celular/computador (Web Push)
-- Decisões do usuário: tarefas vencidas = 1 resumo por dia, às 8h de segunda a sexta, para cada
-- responsável; @menção = na hora, só para quem foi mencionado (quem escreveu não recebe); cada pessoa
-- liga no próprio aparelho em Acesso → Notificações e escolhe os avisos (vencidas, menções).
-- Quem envia é a Edge Function pipo-push. Pode rodar de novo.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) Aparelhos inscritos (um por navegador/app instalado). Cada pessoa só vê e mexe nos dela.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  prefs       jsonb not null default '{"vencidas": true, "mencoes": true}'::jsonb,
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
grant select, update, delete on public.push_subscriptions to service_role;

-- 2) Configuração privada do envio: senha interna do banco → função e chaves VAPID (criadas pela
--    própria função no primeiro uso; a chave privada nunca sai do servidor). Sem acesso pelo app.
create table if not exists public.push_config (
  id            integer primary key default 1 check (id = 1),
  secret        text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  vapid_public  text,
  vapid_private jsonb,
  updated_at    timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
grant select, update on public.push_config to service_role;
insert into public.push_config (id) values (1) on conflict (id) do nothing;

-- 3) Chama a função de envio (sem esperar a resposta; nunca impede a gravação de quem chamou).
create or replace function public.push_call(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  select secret into v_secret from public.push_config where id = 1;
  perform net.http_post(
    url := 'https://gnieydlriercezqowpqe.supabase.co/functions/v1/pipo-push',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pipo-push', v_secret),
    timeout_milliseconds := 8000);
exception when others then
  null;
end $$;
revoke execute on function public.push_call(jsonb) from public, anon, authenticated;

-- 4) @menção: comentário novo com menções → aviso na hora.
create or replace function public.task_events_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'comment' and coalesce(array_length(new.mentions, 1), 0) > 0
     and coalesce(current_setting('pipo.restore', true), '') <> '1' then
    perform public.push_call(jsonb_build_object('tipo', 'mencao', 'evento', new.id));
  end if;
  return null;
end $$;
revoke execute on function public.task_events_push() from public, anon, authenticated;
drop trigger if exists task_events_push on public.task_events;
create trigger task_events_push after insert on public.task_events
  for each row execute function public.task_events_push();

-- 5) Dados que a função usa (só a função, com a chave de serviço).
-- Quem recebe a menção: mencionado ≠ autor, ativo e com acesso à lista da tarefa.
create or replace function public.push_mention_targets(p_event uuid)
returns table (user_id uuid, task_id uuid, title text, author text)
language sql stable security definer set search_path = public as $$
  select distinct m, t.id, t.title, coalesce(e.author_name, 'Alguém')
    from public.task_events e
    join public.tasks t on t.id = e.task_id
    cross join lateral unnest(e.mentions) m
   where e.id = p_event and e.kind = 'comment'
     and m is distinct from e.author_id
     and public.crm_user_can(m, t.list_id);
$$;
revoke execute on function public.push_mention_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_mention_targets(uuid) to service_role;

-- Vencidas por responsável: abertas (status que não finaliza), vencimento antes de hoje (Brasília).
create or replace function public.push_overdue_counts()
returns table (user_id uuid, n integer)
language sql stable security definer set search_path = public as $$
  select a, count(*)::integer
    from public.tasks t
    cross join lateral unnest(t.assignees) a
   where t.due_date < (now() at time zone 'America/Sao_Paulo')::date
     and not public.crm_status_done(t.list_id, t.status)
     and public.crm_user_can(a, t.list_id)
   group by a;
$$;
revoke execute on function public.push_overdue_counts() from public, anon, authenticated;
grant execute on function public.push_overdue_counts() to service_role;

-- 6) Resumo diário: 8h de Brasília (11h UTC), segunda a sexta.
select cron.unschedule(jobid) from cron.job where jobname = 'pipo-push-vencidas';
select cron.schedule('pipo-push-vencidas', '0 11 * * 1-5', $$select public.push_call('{"tipo": "vencidas"}'::jsonb)$$);

-- Conferência (esperado: 1 | 1 | 1 | 1)
select (select count(*) from public.push_config) as config,
       (select count(*) from pg_trigger where tgname = 'task_events_push') as gatilho,
       (select count(*) from cron.job where jobname = 'pipo-push-vencidas') as agendamento,
       (select count(*) from information_schema.tables where table_name = 'push_subscriptions') as tabela;
