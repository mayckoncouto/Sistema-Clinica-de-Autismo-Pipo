-- Financeiro — Fechamento de mês e anotações do Demonstrativo (2026-10-12)
--   Mês fechado trava incluir, editar, excluir e importar lançamentos dele (para todos, inclusive o Administrador).
--   Fechar / reabrir: funções finance_close_month / finance_reopen_month, conforme a permissão "Fechamento de mês"
--   (fechamento_mes: incluir = fechar, excluir = reabrir, ver = histórico). Nenhum nível recebe: só o Administrador
--   até você liberar em Níveis de permissão. Quem vê o Financeiro vê os meses fechados.
--   Anotações nas células do Fluxo de caixa e do DRE: quem vê o Financeiro lê; quem edita lançamentos escreve.
-- Pode rodar de novo.

create table if not exists public.finance_closings (
  ym             text primary key check (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at      timestamptz not null default now(),
  closed_by      uuid references auth.users(id) on delete set null,
  closed_by_name text
);
create table if not exists public.finance_closing_log (
  id       bigint generated always as identity primary key,
  ym       text not null,
  acao     text not null check (acao in ('fechou', 'reabriu')),
  em       timestamptz not null default now(),
  por      uuid references auth.users(id) on delete set null,
  por_nome text,
  motivo   text
);
create table if not exists public.finance_notes (
  chave         text primary key,                        -- tela|linha|aaaa-mm
  rotulo        text,                                    -- nome da linha, para o resumo em PDF
  texto         text not null check (length(btrim(texto)) > 0 and length(texto) <= 1000),
  autor         uuid references auth.users(id) on delete set null,
  autor_nome    text,
  atualizado_em timestamptz not null default now()
);

alter table public.finance_closings enable row level security;
alter table public.finance_closing_log enable row level security;
alter table public.finance_notes enable row level security;
grant select on public.finance_closings, public.finance_closing_log to authenticated;
grant select, insert, update, delete on public.finance_notes to authenticated;

drop policy if exists finance_closings_select on public.finance_closings;
create policy finance_closings_select on public.finance_closings
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_closing_log_select on public.finance_closing_log;
create policy finance_closing_log_select on public.finance_closing_log
  for select to authenticated using (public.has_perm('fechamento_mes', 'view'));
drop policy if exists finance_notes_select on public.finance_notes;
create policy finance_notes_select on public.finance_notes
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_notes_insert on public.finance_notes;
create policy finance_notes_insert on public.finance_notes
  for insert to authenticated with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_notes_update on public.finance_notes;
create policy finance_notes_update on public.finance_notes
  for update to authenticated using (public.has_perm('financeiro', 'edit')) with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_notes_delete on public.finance_notes;
create policy finance_notes_delete on public.finance_notes
  for delete to authenticated using (public.has_perm('financeiro', 'edit'));

create or replace function public.finance_notes_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.autor := auth.uid();
  new.autor_nome := (select full_name from public.profiles where id = auth.uid());
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists finance_notes_stamp on public.finance_notes;
create trigger finance_notes_stamp
  before insert or update on public.finance_notes
  for each row execute function public.finance_notes_stamp();

-- Fechar e reabrir (única forma de mudar finance_closings)
create or replace function public.finance_close_month(p_ym text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.has_perm('fechamento_mes', 'create') then raise exception 'Seu nível não pode fechar mês.'; end if;
  if p_ym is null or p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  if exists (select 1 from public.finance_closings where ym = p_ym) then raise exception 'Esse mês já está fechado.'; end if;
  nm := (select full_name from public.profiles where id = auth.uid());
  insert into public.finance_closings (ym, closed_by, closed_by_name) values (p_ym, auth.uid(), nm);
  insert into public.finance_closing_log (ym, acao, por, por_nome) values (p_ym, 'fechou', auth.uid(), nm);
end $$;

create or replace function public.finance_reopen_month(p_ym text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.has_perm('fechamento_mes', 'delete') then raise exception 'Seu nível não pode reabrir mês.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo para reabrir.'; end if;
  if not exists (select 1 from public.finance_closings where ym = p_ym) then raise exception 'Esse mês não está fechado.'; end if;
  nm := (select full_name from public.profiles where id = auth.uid());
  delete from public.finance_closings where ym = p_ym;
  insert into public.finance_closing_log (ym, acao, por, por_nome, motivo) values (p_ym, 'reabriu', auth.uid(), nm, btrim(p_motivo));
end $$;
revoke all on function public.finance_close_month(text) from public, anon;
revoke all on function public.finance_reopen_month(text, text) from public, anon;
grant execute on function public.finance_close_month(text) to authenticated;
grant execute on function public.finance_reopen_month(text, text) to authenticated;

-- Mês fechado não aceita incluir, alterar nem excluir lançamento (nem mudar a data para dentro dele)
create or replace function public.finance_entries_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;     -- restauração / scripts
  if tg_op in ('UPDATE', 'DELETE') then
    m := to_char(old.data, 'YYYY-MM');
    if exists (select 1 from public.finance_closings where ym = m) then raise exception 'PIPO_MES_FECHADO:%', m; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    m := to_char(new.data, 'YYYY-MM');
    if exists (select 1 from public.finance_closings where ym = m) then raise exception 'PIPO_MES_FECHADO:%', m; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists finance_entries_lock on public.finance_entries;
create trigger finance_entries_lock
  before insert or update or delete on public.finance_entries
  for each row execute function public.finance_entries_lock();

do $$ begin alter publication supabase_realtime add table public.finance_closings;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.finance_notes;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: 3 tabelas | 3 funções | gatilho de trava
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('finance_closings', 'finance_closing_log', 'finance_notes')) as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('finance_close_month', 'finance_reopen_month', 'finance_entries_lock', 'finance_notes_stamp')) as funcoes,
       exists(select 1 from pg_trigger where tgname = 'finance_entries_lock' and not tgisinternal) as gatilho;
