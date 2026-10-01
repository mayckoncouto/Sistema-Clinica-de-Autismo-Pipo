-- =====================================================================
-- Agenda Pipo — Nova Agenda por data real + vínculo profissional/usuário
-- (2026-10-01)
--
--   * A grade antiga (4 semanas que se repetem) passa a se chamar "Planner"
--     e continua usando a permissão "agenda".
--   * A nova "Agenda" grava cada atendimento numa data real, na tabela
--     public.appointments, com permissão própria "agendamentos".
--   * profiles.professional_id liga um usuário ao cadastro do profissional.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Atendimentos da nova Agenda (um registro por atendimento)
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  time             text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  professional_id  text not null,
  room_id          text,
  patient          text not null default '',
  note             text not null default '',
  blocked          boolean not null default false,
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Um profissional não atende dois pacientes no mesmo horário.
  constraint appointments_one_per_slot unique (date, time, professional_id)
);
create index if not exists appointments_date_idx on public.appointments (date);
alter table public.appointments enable row level security;

create or replace function public.appointments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists appointments_stamp on public.appointments;
create trigger appointments_stamp
  before insert or update on public.appointments
  for each row execute function public.appointments_stamp();

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated using (public.has_perm('agendamentos', 'view'));
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert to authenticated with check (public.has_perm('agendamentos', 'create'));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (public.has_perm('agendamentos', 'edit'))
  with check (public.has_perm('agendamentos', 'edit'));
drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete to authenticated using (public.has_perm('agendamentos', 'delete'));

revoke all on public.appointments from anon;
grant select, insert, update, delete on public.appointments to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Permissão separada "agendamentos" (nova Agenda) em cada nível.
--    Ponto de partida: Administrador e Secretária tudo; demais só ver.
-- ---------------------------------------------------------------------
update public.roles
set permissions = permissions || jsonb_build_object('agendamentos',
  case when id in ('administrador', 'secretaria')
    then '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
    else '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
  end)
where not (permissions ? 'agendamentos');

-- ---------------------------------------------------------------------
-- 3. Usuário ligado ao cadastro do profissional
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists professional_id text;
create unique index if not exists profiles_professional_unique
  on public.profiles (professional_id) where professional_id is not null;

commit;

select id, name, permissions -> 'agendamentos' as nova_agenda from public.roles order by sort;
