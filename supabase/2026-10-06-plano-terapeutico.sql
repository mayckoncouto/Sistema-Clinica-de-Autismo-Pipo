-- =====================================================================
-- Agenda Pipo — Plano terapêutico (2026-10-06)
--
--   * Tabela protegida public.therapy_plans: um plano por paciente, com
--     versões (Revisar cria a nova versão; a anterior fica "encerrado").
--     Resumo do quadro clínico (texto) + quadros por especialidade
--     (sections = [{specId, objectives:[{id, areaId, objetivo, criterio,
--     prazo, scaleId, levelId, status, statusEm, criadoEm}]}]).
--     Dado de saúde: só lê quem tem "Plano terapêutico – ver".
--   * Quem tem "editar" (Coordenador, Administrador) muda tudo. O
--     profissional (usuário ligado a um profissional, sem "editar") usa a
--     função plan_prof_update: só muda situação e status dos objetivos das
--     especialidades em que atende (principal ou complementares) e só
--     inclui objetivos novos na especialidade principal.
--   * Cadastros comuns: Escalas (config/scales, com os níveis e as cores)
--     e Habilidades/áreas (config/skill_areas), já com os valores iniciais.
--   * Permissões novas: plano_terapeutico, escalas, habilidades.
--   * Nível novo "Coordenador": as permissões do Profissional + o plano
--     terapêutico completo.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabela dos planos.
create table if not exists public.therapy_plans (
  id               uuid primary key default gen_random_uuid(),
  patient_id       text not null,
  patient_name     text not null default '',
  version          int  not null default 1,
  status           text not null default 'vigente' check (status in ('vigente', 'encerrado')),
  plan_date        date not null default current_date,
  review_date      date,
  summary          text not null default '',
  sections         jsonb not null default '[]'::jsonb,
  prev_id          uuid references public.therapy_plans(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_by_name  text not null default '',
  updated_at       timestamptz not null default now()
);
create index if not exists therapy_plans_patient on public.therapy_plans (patient_id);
-- um só plano vigente por paciente
create unique index if not exists therapy_plans_one_vigente on public.therapy_plans (patient_id) where status = 'vigente';
alter table public.therapy_plans enable row level security;
grant select, insert, update, delete on public.therapy_plans to authenticated;

create or replace function public.therapy_plans_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then          -- restauração / scripts: mantém o que veio
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), email, '') into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce(v_name, '');
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(v_name, '');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists therapy_plans_stamp on public.therapy_plans;
create trigger therapy_plans_stamp before insert or update on public.therapy_plans
  for each row execute function public.therapy_plans_stamp();

drop policy if exists therapy_plans_select on public.therapy_plans;
create policy therapy_plans_select on public.therapy_plans for select to authenticated
  using (public.has_perm('plano_terapeutico', 'view'));
drop policy if exists therapy_plans_insert on public.therapy_plans;
create policy therapy_plans_insert on public.therapy_plans for insert to authenticated
  with check (public.has_perm('plano_terapeutico', 'create'));
drop policy if exists therapy_plans_update on public.therapy_plans;
-- "editar" muda tudo; "incluir" pode encerrar o plano anterior ao revisar
create policy therapy_plans_update on public.therapy_plans for update to authenticated
  using (public.has_perm('plano_terapeutico', 'edit') or public.has_perm('plano_terapeutico', 'create'))
  with check (public.has_perm('plano_terapeutico', 'edit') or public.has_perm('plano_terapeutico', 'create'));
drop policy if exists therapy_plans_delete on public.therapy_plans;
create policy therapy_plans_delete on public.therapy_plans for delete to authenticated
  using (public.has_perm('plano_terapeutico', 'delete'));

-- 2. Alteração feita pelo profissional (sem "editar").
create or replace function public.plan_prof_update(p_id uuid, p_sections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_prof text; v_principal text; v_allowed text[] := '{}'; v_old jsonb;
  s jsonb; os jsonb; o jsonb; oo jsonb; v_spec text;
begin
  select p.professional_id into v_prof from public.profiles p where p.id = auth.uid() and p.active;
  if v_prof is null or not public.has_perm('plano_terapeutico', 'view') then
    raise exception 'Sem permissão para alterar o plano terapêutico.';
  end if;
  select x ->> 'specialtyId',
         coalesce(array(select jsonb_array_elements_text(coalesce(x -> 'complementares', '[]'::jsonb))), '{}')
    into v_principal, v_allowed
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
  where d.path = 'config/professionals' and x ->> 'id' = v_prof;
  v_allowed := coalesce(v_allowed, '{}') || coalesce(v_principal, '');
  select sections into v_old from public.therapy_plans where id = p_id and status = 'vigente' for update;
  if not found then raise exception 'Plano não encontrado ou já encerrado.'; end if;
  if jsonb_typeof(p_sections) <> 'array' then raise exception 'Dados inválidos.'; end if;

  -- o que já existia: só situação/status mudam, e só nas especialidades dele
  for os in select * from jsonb_array_elements(v_old) loop
    v_spec := os ->> 'specId';
    s := (select x from jsonb_array_elements(p_sections) x where x ->> 'specId' = v_spec limit 1);
    if s is null then raise exception 'Quadros do plano não podem ser excluídos.'; end if;
    if not (v_spec = any(v_allowed)) then
      if s <> os then raise exception 'Você só pode alterar as especialidades em que atende.'; end if;
      continue;
    end if;
    for oo in select * from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) loop
      o := (select x from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = oo ->> 'id' limit 1);
      if o is null then raise exception 'Objetivos não podem ser excluídos.'; end if;
      if (o - 'levelId' - 'status' - 'statusEm') <> (oo - 'levelId' - 'status' - 'statusEm') then
        raise exception 'Você só pode alterar a situação e o status dos objetivos.';
      end if;
    end loop;
  end loop;

  -- objetivos novos: só na especialidade principal
  for s in select * from jsonb_array_elements(p_sections) loop
    v_spec := s ->> 'specId';
    os := (select x from jsonb_array_elements(v_old) x where x ->> 'specId' = v_spec limit 1);
    for o in select * from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) loop
      if os is null or not exists (select 1 from jsonb_array_elements(coalesce(os -> 'objectives', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id') then
        if v_spec is distinct from v_principal then
          raise exception 'Você só pode incluir objetivos na sua especialidade principal.';
        end if;
      end if;
    end loop;
  end loop;

  update public.therapy_plans set sections = p_sections where id = p_id;
end $$;
grant execute on function public.plan_prof_update(uuid, jsonb) to authenticated;

-- 3. Cadastros comuns: Escalas e Habilidades/áreas.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
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
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
  end;
$$;

insert into public.documents (path, data) values ('config/scales', '{"list": [
  {"id": "likert", "name": "Likert", "levels": [
    {"id": "0", "name": "0 – Não realiza", "color": "#E05A4F"},
    {"id": "1", "name": "1 – Realiza com ajuda física", "color": "#EE8A3C"},
    {"id": "2", "name": "2 – Realiza com ajuda visual", "color": "#F2B53A"},
    {"id": "3", "name": "3 – Realiza com ajuda verbal", "color": "#D7C93B"},
    {"id": "4", "name": "4 – Independente parcial (supervisão)", "color": "#8CC152"},
    {"id": "5", "name": "5 – Independente", "color": "#2E9E5B"}]},
  {"id": "aba", "name": "ABA", "levels": [
    {"id": "nao-adquirida", "name": "Não adquirida (< 60%)", "color": "#E05A4F"},
    {"id": "parcial", "name": "Parcial (60%–70%)", "color": "#F2B53A"},
    {"id": "adquirida", "name": "Adquirida (> 70%)", "color": "#2E9E5B"}]}
]}'::jsonb)
on conflict (path) do nothing;

insert into public.documents (path, data) values ('config/skill_areas', '{"list": [
  {"id": "comunicacao", "name": "Comunicação"},
  {"id": "socializacao", "name": "Socialização"},
  {"id": "autonomia", "name": "Autonomia"},
  {"id": "aprendizagem", "name": "Aprendizagem"},
  {"id": "regulacao-emocional", "name": "Regulação Emocional"},
  {"id": "regulacao-sensorial", "name": "Regulação Sensorial"},
  {"id": "desenvolvimento-motor", "name": "Desenvolvimento Motor"},
  {"id": "seletividade-alimentar", "name": "Seletividade Alimentar"}
]}'::jsonb)
on conflict (path) do nothing;

-- 4. Permissões dos níveis existentes (não mexe em quem já tem os itens).
--    Plano terapêutico: Profissional vê; os outros começam sem acesso.
--    Escalas e Habilidades: copiam o acesso de Especialidades.
update public.roles set permissions = permissions || jsonb_build_object('plano_terapeutico',
  case when id = 'profissional' or lower(btrim(name)) = 'profissional'
       then '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
       else '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb end)
where not is_admin and not (permissions ? 'plano_terapeutico');

update public.roles set permissions = permissions
  || jsonb_build_object('escalas', coalesce(permissions -> 'especialidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
  || jsonb_build_object('habilidades', coalesce(permissions -> 'especialidades', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb))
where not is_admin and not (permissions ? 'escalas');

-- 5. Nível "Coordenador": cópia do Profissional + plano terapêutico completo
--    (inclusive Escalas e Habilidades).
insert into public.roles (id, name, is_admin, sort, permissions)
select 'coordenador', 'Coordenador', false, coalesce(r.sort, 0),
  r.permissions || '{
    "plano_terapeutico": {"view": true, "create": true, "edit": true, "delete": true},
    "escalas":     {"view": true, "create": true, "edit": true, "delete": true},
    "habilidades": {"view": true, "create": true, "edit": true, "delete": true}
  }'::jsonb
from public.roles r
where r.id = 'profissional'
  and not exists (select 1 from public.roles where id = 'coordenador' or lower(btrim(name)) = 'coordenador');

-- conferência
select name as nivel, permissions -> 'plano_terapeutico' as plano_terapeutico from public.roles order by sort, name;
