-- =====================================================================
-- Agenda Pipo — cadastro completo do paciente, Médicos, Escolas e CBO (2026-10-05)
--
--   * Novos cadastros (documentos):
--       config/doctors        Cadastros → Médicos        (permissão "medicos")
--       config/schools        Cadastros → Escolas        (permissão "escolas")
--       config/cbo            Cadastros → CBO            (permissão "cbo")
--       config/patient_fields Pacientes → botão "Campos" (permissão "campos_paciente":
--                             quais campos do paciente aparecem e quais são obrigatórios)
--   * Níveis que já existem: Médicos e Escolas recebem o mesmo acesso que têm em
--     Pacientes; CBO o mesmo de Profissionais; "Campos do paciente" começa
--     desligado (o Administrador marca em Níveis de permissão; ele sempre pode).
--   * CBO já vem preenchido com as sugestões do sistema + todo CBO que já está
--     gravado no cadastro dos profissionais.
--   * Os campos novos do paciente (responsáveis, endereço, documentos, dados
--     clínicos, médico, escola…) ficam no próprio documento patients/all:
--     não precisam de mudança no banco.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar os caminhos novos.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
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
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes.
update public.roles set permissions = permissions
  || jsonb_build_object('medicos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'medicos');
update public.roles set permissions = permissions
  || jsonb_build_object('escolas', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'escolas');
update public.roles set permissions = permissions
  || jsonb_build_object('cbo', coalesce(permissions -> 'profissionais', '{}'::jsonb))
  where not is_admin and not (permissions ? 'cbo');
update public.roles set permissions = permissions
  || '{"campos_paciente": {"view": false, "edit": false}}'::jsonb
  where not is_admin and not (permissions ? 'campos_paciente');

-- 4. CBO: sugestões do sistema + os que já estão nos profissionais.
insert into public.documents (path, data) values ('config/cbo', '{"list": [
  {"id": "251510", "code": "2515-10", "name": "Psicólogo clínico"},
  {"id": "223810", "code": "2238-10", "name": "Fonoaudiólogo"},
  {"id": "223905", "code": "2239-05", "name": "Terapeuta ocupacional"},
  {"id": "223605", "code": "2236-05", "name": "Fisioterapeuta geral"},
  {"id": "223710", "code": "2237-10", "name": "Nutricionista"},
  {"id": "226305", "code": "2263-05", "name": "Musicoterapeuta"},
  {"id": "239425", "code": "2394-25", "name": "Psicopedagogo"}
]}'::jsonb)
on conflict (path) do nothing;

with usados as (
  select distinct on (regexp_replace(p ->> 'cbos', '\D', '', 'g'))
         regexp_replace(p ->> 'cbos', '\D', '', 'g') as id,
         trim(p ->> 'cbos') as code,
         coalesce(nullif(trim(s ->> 'name'), ''), 'Sem descrição') as name
  from public.documents d
  cross join jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  left join public.documents ds on ds.path = 'config/specialties'
  left join lateral (
    select x from jsonb_array_elements(coalesce(ds.data -> 'list', '[]'::jsonb)) x
    where x ->> 'id' = p ->> 'specialtyId' limit 1
  ) sp(s) on true
  where d.path = 'config/professionals'
    and regexp_replace(coalesce(p ->> 'cbos', ''), '\D', '', 'g') <> ''
),
faltam as (
  select u.* from usados u, public.documents c
  where c.path = 'config/cbo'
    and not exists (select 1 from jsonb_array_elements(coalesce(c.data -> 'list', '[]'::jsonb)) e
                    where regexp_replace(coalesce(e ->> 'code', ''), '\D', '', 'g') = u.id)
)
update public.documents c
set data = jsonb_set(c.data, '{list}', coalesce(c.data -> 'list', '[]'::jsonb) ||
  coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name)) from faltam), '[]'::jsonb))
where c.path = 'config/cbo';

-- conferência: quantos CBO ficaram cadastrados
select jsonb_array_length(data -> 'list') as cbo_cadastrados from public.documents where path = 'config/cbo';
