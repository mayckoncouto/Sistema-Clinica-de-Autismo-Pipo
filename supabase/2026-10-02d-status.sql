-- =====================================================================
-- Agenda Pipo — Status dos atendimentos (2026-10-02, parte 4)
--
--   * Cadastro de Status (documento config/statuses: {list:[{id,name,color}]}),
--     aberto pelo menu "Acesso" e alterado só pelo Administrador. Já vem com
--     Finalizado, Não compareceu e Falta Justificada.
--   * Coluna "status" em appointments (id do status).
--   * Cada nível de permissão diz quais status pode usar
--     (roles.permissions -> "status" -> {id: true}). Secretária: os três;
--     Profissional: Finalizado e Não compareceu. Administrador: todos.
--   * O banco confere: só troca de um status permitido para outro permitido.
--     Quem não tem "editar" na Agenda (ex.: Profissional) muda o status pela
--     função set_appointment_status.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- 1. Novo documento config/statuses (só o Administrador altera).
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses)|patients/all|schedule/(seg|ter|qua|qui|sex)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'config/specialties'     then 'pacientes'
    when p_path = 'config/convenios'       then 'pacientes'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'profissionais'
    when p_path = 'config/rooms'           then 'salas'
    when p_path = 'config/statuses'        then 'cadastro_status' -- nenhum nível tem: só Administrador
  end;
$$;

insert into public.documents (path, data) values ('config/statuses', '{"list": [
  {"id": "finalizado",        "name": "Finalizado",        "color": "#2e7d4f"},
  {"id": "nao-compareceu",    "name": "Não compareceu",    "color": "#b6403a"},
  {"id": "falta-justificada", "name": "Falta Justificada", "color": "#c77d14"}
]}'::jsonb)
on conflict (path) do nothing;

-- 2. Status em cada atendimento da Agenda.
alter table public.appointments add column if not exists status text;

-- 3. Status que cada nível pode usar.
update public.roles
set permissions = permissions || '{"status": {"finalizado": true, "nao-compareceu": true, "falta-justificada": true}}'::jsonb
where id = 'secretaria' and not (permissions ? 'status');
update public.roles
set permissions = permissions || '{"status": {"finalizado": true, "nao-compareceu": true}}'::jsonb
where id = 'profissional' and not (permissions ? 'status');

create or replace function public.can_set_status(p_status text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_status is null or btrim(p_status) = '' or coalesce((
    select p.active and (r.is_admin or coalesce((r.permissions -> 'status' ->> p_status)::boolean, false))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- 4. Guarda: criar/alterar status só entre status permitidos ao nível.
create or replace function public.appointments_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_status_guard on public.appointments;
create trigger appointments_status_guard
  before insert or update on public.appointments
  for each row execute function public.appointments_status_guard();

-- 5. Trocar só o status (para quem pode ver a Agenda, mesmo sem "editar").
create or replace function public.set_appointment_status(p_id uuid, p_status text)
returns public.appointments language plpgsql security definer set search_path = public as $$
declare
  r public.appointments;
begin
  if not public.has_perm('agendamentos', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update public.appointments set status = nullif(btrim(coalesce(p_status, '')), '')
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'Atendimento não encontrado (talvez já tenha sido apagado).';
  end if;
  return r;
end;
$$;

revoke all on function public.set_appointment_status(uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text) to authenticated;

commit;

select data -> 'list' as status from public.documents where path = 'config/statuses';
