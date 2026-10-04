-- =====================================================================
-- Agenda Pipo — RH: Funcionários e Prestadores (2026-10-05)
--
--   * Tabela protegida public.staff: dados de RH de cada funcionário ou
--     prestador (identificação, tipos, contato, contrato, horário de trabalho,
--     contato de emergência). Só lê/grava quem tem a permissão
--     "RH – Funcionários e Prestadores" (rh_funcionarios).
--   * Tabela protegida public.staff_pay: valor mensal contratado e formas de
--     pagamento (com dados bancários / PIX). Só quem tem
--     "RH – Remuneração" (rh_remuneracao).
--   * config/staff_types: tipos (Profissional, Coordenação, Administrativo…).
--   * profiles.staff_id: usuário ligado a um funcionário que não é profissional
--     (o profissional continua ligado por profiles.professional_id).
--   * Nível novo "Recursos Humanos"; Financeiro e Recursos Humanos recebem as
--     duas permissões de RH (o Administrador sempre tem tudo).
--   * Cada profissional que já existe vira um funcionário do tipo Profissional.
--     O horário de atendimento continua em config/professionals (a Agenda e o
--     Planner leem de lá); para profissionais ele é o próprio horário de trabalho.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabelas protegidas.
create table if not exists public.staff (
  id               text primary key,
  professional_id  text unique,
  data             jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);
create table if not exists public.staff_pay (
  staff_id    text primary key references public.staff(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.staff enable row level security;
alter table public.staff_pay enable row level security;
grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.staff_pay to authenticated;

create or replace function public.staff_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists staff_stamp on public.staff;
create trigger staff_stamp before insert or update on public.staff
  for each row execute function public.staff_stamp();
drop trigger if exists staff_pay_stamp on public.staff_pay;
create trigger staff_pay_stamp before insert or update on public.staff_pay
  for each row execute function public.staff_stamp();

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated using (public.has_perm('rh_funcionarios', 'view'));
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated with check (public.has_perm('rh_funcionarios', 'create'));
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated
  using (public.has_perm('rh_funcionarios', 'edit')) with check (public.has_perm('rh_funcionarios', 'edit'));
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated using (public.has_perm('rh_funcionarios', 'delete'));

drop policy if exists staff_pay_select on public.staff_pay;
create policy staff_pay_select on public.staff_pay for select to authenticated using (public.has_perm('rh_remuneracao', 'view'));
drop policy if exists staff_pay_insert on public.staff_pay;
create policy staff_pay_insert on public.staff_pay for insert to authenticated with check (public.has_perm('rh_remuneracao', 'edit'));
drop policy if exists staff_pay_update on public.staff_pay;
create policy staff_pay_update on public.staff_pay for update to authenticated
  using (public.has_perm('rh_remuneracao', 'edit')) with check (public.has_perm('rh_remuneracao', 'edit'));
drop policy if exists staff_pay_delete on public.staff_pay;
create policy staff_pay_delete on public.staff_pay for delete to authenticated
  using (public.has_perm('rh_remuneracao', 'edit') or public.has_perm('rh_funcionarios', 'delete'));

-- 2. Usuário ligado a um funcionário (não profissional).
alter table public.profiles add column if not exists staff_id text;
create unique index if not exists profiles_staff_id_unique on public.profiles (staff_id) where staff_id is not null;

-- 3. Tipos de funcionário (documento config/staff_types).
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;
insert into public.documents (path, data) values ('config/staff_types', '{"list": [
  {"id": "profissional", "name": "Profissional"},
  {"id": "coordenacao", "name": "Coordenação"},
  {"id": "administrativo", "name": "Administrativo"},
  {"id": "recepcao", "name": "Recepção"},
  {"id": "financeiro", "name": "Financeiro"},
  {"id": "contabil", "name": "Contábil"},
  {"id": "juridico", "name": "Jurídico"},
  {"id": "servicos-gerais", "name": "Serviços gerais"},
  {"id": "ti", "name": "TI"},
  {"id": "marketing", "name": "Marketing"}
]}'::jsonb)
on conflict (path) do nothing;

-- 4. Permissões: nível novo "Recursos Humanos" + Financeiro com acesso ao RH.
insert into public.roles (id, name, is_admin, sort, permissions)
select 'recursos-humanos', 'Recursos Humanos', false, 0, '{
  "rh_funcionarios": {"view": true, "create": true, "edit": true, "delete": true},
  "rh_remuneracao":  {"view": true, "edit": true},
  "ajuda": {"view": true}, "senha": {"view": true}
}'::jsonb
where not exists (select 1 from public.roles where id = 'recursos-humanos' or lower(btrim(name)) = 'recursos humanos');

update public.roles set permissions = permissions || '{
  "rh_funcionarios": {"view": true, "create": true, "edit": true, "delete": true},
  "rh_remuneracao":  {"view": true, "edit": true}
}'::jsonb
where (id in ('financeiro', 'recursos-humanos') or lower(btrim(name)) in ('financeiro', 'recursos humanos'))
  and not is_admin and not (permissions ? 'rh_funcionarios');

update public.roles set permissions = permissions || '{
  "rh_funcionarios": {"view": false, "create": false, "edit": false, "delete": false},
  "rh_remuneracao":  {"view": false, "edit": false}
}'::jsonb
where not is_admin and not (permissions ? 'rh_funcionarios');

-- 5. Cada profissional vira funcionário do tipo Profissional.
insert into public.staff (id, professional_id, data)
select 'prof-' || (p ->> 'id'), p ->> 'id', jsonb_strip_nulls(jsonb_build_object(
  'nome', p ->> 'name', 'nomeSocial', p ->> 'nomeSocial', 'cpf', p ->> 'cpf',
  'tipos', '["profissional"]'::jsonb, 'inativo', (p -> 'inativo')))
from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
where d.path = 'config/professionals' and coalesce(p ->> 'id', '') <> ''
on conflict do nothing;
-- usuários dos profissionais também ficam ligados ao funcionário
update public.profiles pr set staff_id = 'prof-' || pr.professional_id
where pr.professional_id is not null and pr.staff_id is null
  and exists (select 1 from public.staff s where s.id = 'prof-' || pr.professional_id);

-- conferência: funcionários criados a partir dos profissionais
select count(*) as funcionarios from public.staff;
