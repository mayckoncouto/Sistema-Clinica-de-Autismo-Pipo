-- Histórico de Alterações do Planner e da Agenda (2026-10-18)
-- Quem criou, alterou ou excluiu cada atendimento. Gravado por gatilhos (nada no app muda a
-- gravação). Só registra quando há usuário logado (importações e rotinas do servidor ficam de fora).
-- Permissões: historico_planner e historico_agenda (só "ver"); nenhum nível recebe, o Administrador libera.

create table if not exists public.change_log (
  id        bigint generated always as identity primary key,
  unit_id   text not null default 'unidade-1',
  area      text not null check (area in ('planner', 'agenda')),
  at        timestamptz not null default now(),
  user_id   uuid,
  user_name text not null default '',
  acao      text not null check (acao in ('criou', 'alterou', 'excluiu', 'status')),
  tipo      text not null default 'atendimento',
  paciente  text not null default '',
  quando    text not null default '',   -- agenda: aaaa-mm-dd; planner: seg-1 (dia-semana)
  hora      text not null default '',
  sala_id   text,
  prof_id   text,                        -- agenda: professional_id; planner: id da coluna (assento)
  ref       text,                        -- agenda: id do atendimento; planner: documento#chave
  antes     jsonb,
  depois    jsonb,
  lote      text
);
create index if not exists change_log_area_idx on public.change_log (unit_id, area, at desc);
alter table public.change_log enable row level security;

create table if not exists public.change_log_read (
  user_id uuid not null default auth.uid(),
  log_id  bigint not null references public.change_log(id) on delete cascade,
  primary key (user_id, log_id)
);
alter table public.change_log_read enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'change_log_0_unit_stamp' and not tgisinternal) then
    create trigger change_log_0_unit_stamp before insert or update on public.change_log
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'change_log' and policyname = 'change_log_unit') then
    create policy change_log_unit on public.change_log as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'change_log' and policyname = 'change_log_select') then
    create policy change_log_select on public.change_log for select to authenticated
      using (public.has_perm('historico_' || area, 'view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'change_log_read' and policyname = 'change_log_read_own') then
    create policy change_log_read_own on public.change_log_read for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
grant select on public.change_log to authenticated;
grant select, insert, delete on public.change_log_read to authenticated;

-- Atendimento do Planner "vazio" (marcação limpa) conta como excluído.
create or replace function public.chg_bk_empty(v jsonb)
returns boolean language sql immutable set search_path = public as $$
  select v is null or v = 'null'::jsonb or (
    coalesce(v ->> 'patient', '') = ''
    and not coalesce((v ->> 'blocked')::boolean, false)
    and not coalesce((v ->> 'lock')::boolean, false)
    and not coalesce((v ->> 'training')::boolean, false));
$$;

create or replace function public.chg_bk_tipo(v jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce((v ->> 'lock')::boolean, false) then 'horario-bloqueado'
    when coalesce((v ->> 'blocked')::boolean, false) then 'bloqueio'
    when coalesce((v ->> 'training')::boolean, false) or v ->> 'patient' = 'Treinamento' then 'treinamento'
    when v ->> 'patient' = 'Reunião Clínica' then 'reuniao'
    else 'atendimento' end;
$$;

create or replace function public.chg_who()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), '');
$$;

-- Agenda (tabela appointments)
create or replace function public.change_log_appt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  noise text[] := array['created_by', 'updated_by', 'created_at', 'updated_at', 'unit_id'];
  o jsonb; n jsonb; r jsonb; v_acao text; v_tipo text;
begin
  if auth.uid() is null or nullif(current_setting('pipo.restore', true), '') is not null
     or nullif(current_setting('pipo.merging', true), '') is not null then
    return null;
  end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old) - noise; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - noise; end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  if tg_op = 'INSERT' then v_acao := 'criou';
  elsif tg_op = 'DELETE' then v_acao := 'excluiu';
  elsif (o - 'status') = (n - 'status') then v_acao := 'status';
  else v_acao := 'alterou'; end if;
  r := coalesce(n, o);
  v_tipo := case
    when coalesce((r ->> 'blocked')::boolean, false) then 'bloqueio'
    when r ->> 'patient' = 'Reunião Clínica' then 'reuniao'
    when r ->> 'patient' = 'Treinamento' then 'treinamento'
    when r ->> 'group_id' is not null then 'grupo'
    else 'atendimento' end;
  insert into public.change_log (unit_id, area, user_id, user_name, acao, tipo, paciente, quando, hora, sala_id, prof_id, ref, antes, depois, lote)
  values (coalesce(r ->> 'unit_id', 'unidade-1'), 'agenda', auth.uid(), public.chg_who(), v_acao, v_tipo,
          coalesce(r ->> 'patient', ''), coalesce(r ->> 'date', ''), coalesce(r ->> 'time', ''),
          r ->> 'room_id', r ->> 'professional_id', r ->> 'id', o, n, txid_current()::text);
  return null;
end $$;

drop trigger if exists appointments_change_log on public.appointments;
create trigger appointments_change_log after insert or update or delete on public.appointments
  for each row execute function public.change_log_appt();

-- Planner (documentos schedule/<dia>-<semana>, chave hora|sala|coluna)
create or replace function public.change_log_planner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ob jsonb; nb jsonb; k text; ov jsonb; nv jsonb; v_acao text; r jsonb; parts text[]; n int := 0;
begin
  if new.path not like 'schedule/%' then return null; end if;
  if auth.uid() is null or nullif(current_setting('pipo.restore', true), '') is not null then return null; end if;
  ob := case when tg_op = 'UPDATE' then coalesce(old.data -> 'bookings', '{}'::jsonb) else '{}'::jsonb end;
  nb := coalesce(new.data -> 'bookings', '{}'::jsonb);
  if ob = nb then return null; end if;
  for k in select key from (select jsonb_object_keys(ob) as key union select jsonb_object_keys(nb)) s loop
    ov := case when public.chg_bk_empty(ob -> k) then null else ob -> k end;
    nv := case when public.chg_bk_empty(nb -> k) then null else nb -> k end;
    continue when ov is not distinct from nv;
    -- só a marca do Auto Planner mudou: não é alteração do usuário
    continue when ov is not null and nv is not null and (ov - 'auto' - 'via' - 'porque') = (nv - 'auto' - 'via' - 'porque');
    v_acao := case when ov is null then 'criou' when nv is null then 'excluiu' else 'alterou' end;
    r := coalesce(nv, ov);
    parts := string_to_array(k, '|');
    insert into public.change_log (unit_id, area, user_id, user_name, acao, tipo, paciente, quando, hora, sala_id, prof_id, ref, antes, depois, lote)
    values (new.unit_id, 'planner', auth.uid(), public.chg_who(), v_acao, public.chg_bk_tipo(r),
            coalesce(r ->> 'patient', ''), substr(new.path, 10), coalesce(parts[1], ''), parts[2], parts[3],
            new.path || '#' || k, ov, nv, txid_current()::text);
    n := n + 1;
    exit when n >= 1500;
  end loop;
  return null;
end $$;

drop trigger if exists documents_change_log on public.documents;
create trigger documents_change_log after insert or update on public.documents
  for each row when (new.path like 'schedule/%') execute function public.change_log_planner();

-- Lista de uma área com a marca "lida" da pessoa (movimentos próprios nunca ficam na Principal).
create or replace function public.change_log_list(p_area text, p_days int default 30)
returns table (id bigint, at timestamptz, user_id uuid, user_name text, acao text, tipo text, paciente text,
               quando text, hora text, sala_id text, prof_id text, ref text, antes jsonb, depois jsonb, lote text, lida boolean)
language sql stable security invoker set search_path = public as $$
  select c.id, c.at, c.user_id, c.user_name, c.acao, c.tipo, c.paciente, c.quando, c.hora, c.sala_id, c.prof_id, c.ref,
         c.antes, c.depois, c.lote,
         (c.user_id is not distinct from auth.uid() or exists (select 1 from public.change_log_read r where r.log_id = c.id and r.user_id = auth.uid()))
    from public.change_log c
   where c.area = p_area and c.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
   order by c.at desc, c.id desc
   limit 4000;
$$;
grant execute on function public.change_log_list(text, int) to authenticated;
revoke execute on function public.change_log_list(text, int) from anon, public;

-- Limpeza: guarda 180 dias.
create or replace function public.change_log_prune()
returns void language sql security definer set search_path = public as $$
  delete from public.change_log where at < now() - interval '180 days';
$$;
revoke execute on function public.change_log_prune() from anon, authenticated, public;
select cron.schedule('pipo-change-log-prune', '30 6 * * *', $$select public.change_log_prune()$$);
