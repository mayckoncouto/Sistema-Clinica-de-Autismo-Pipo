-- =====================================================================
-- Agenda Pipo — cadastro de Conselhos profissionais (2026-10-05)
--
--   * Novo cadastro config/councils (Cadastros → Conselhos), permissão própria
--     "conselhos" em Níveis de permissão. Os níveis que já existem recebem o
--     mesmo acesso que têm em Profissionais.
--   * Já vem com CRP, CRFa, CREFITO, CRN, CRM, CREF, CRESS e ABPp + todo
--     conselho que já está gravado no cadastro dos profissionais.
--   * No cadastro do profissional o campo Conselho vira uma lista desse cadastro
--     (o valor gravado continua sendo a sigla).
--
-- PRECISA da migração 2026-10-05-cadastro-do-paciente.sql já rodada.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar o caminho config/councils.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento.
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
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm em Profissionais.
update public.roles set permissions = permissions
  || jsonb_build_object('conselhos', coalesce(permissions -> 'profissionais', '{}'::jsonb))
  where not is_admin and not (permissions ? 'conselhos');

-- 4. Conselhos iniciais + os que já estão nos profissionais.
insert into public.documents (path, data) values ('config/councils', '{"list": [
  {"id": "crp",     "sigla": "CRP",     "name": "Conselho Regional de Psicologia"},
  {"id": "crfa",    "sigla": "CRFa",    "name": "Conselho Regional de Fonoaudiologia"},
  {"id": "crefito", "sigla": "CREFITO", "name": "Conselho Regional de Fisioterapia e Terapia Ocupacional"},
  {"id": "crn",     "sigla": "CRN",     "name": "Conselho Regional de Nutricionistas"},
  {"id": "crm",     "sigla": "CRM",     "name": "Conselho Regional de Medicina"},
  {"id": "cref",    "sigla": "CREF",    "name": "Conselho Regional de Educação Física"},
  {"id": "cress",   "sigla": "CRESS",   "name": "Conselho Regional de Serviço Social"},
  {"id": "abpp",    "sigla": "ABPp",    "name": "Associação Brasileira de Psicopedagogia"}
]}'::jsonb)
on conflict (path) do nothing;

with usados as (
  select distinct on (lower(regexp_replace(p ->> 'conselho', '[^A-Za-z0-9]', '', 'g')))
         lower(regexp_replace(p ->> 'conselho', '[^A-Za-z0-9]', '', 'g')) as id,
         trim(p ->> 'conselho') as sigla
  from public.documents d
  cross join jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  where d.path = 'config/professionals'
    and regexp_replace(coalesce(p ->> 'conselho', ''), '[^A-Za-z0-9]', '', 'g') <> ''
),
faltam as (
  select u.* from usados u, public.documents c
  where c.path = 'config/councils'
    and not exists (select 1 from jsonb_array_elements(coalesce(c.data -> 'list', '[]'::jsonb)) e
                    where lower(regexp_replace(coalesce(e ->> 'sigla', ''), '[^A-Za-z0-9]', '', 'g')) = u.id)
)
update public.documents c
set data = jsonb_set(c.data, '{list}', coalesce(c.data -> 'list', '[]'::jsonb) ||
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'sigla', sigla, 'name', sigla)) from faltam), '[]'::jsonb))
where c.path = 'config/councils';

-- conferência: quantos conselhos ficaram cadastrados
select jsonb_array_length(data -> 'list') as conselhos_cadastrados from public.documents where path = 'config/councils';
