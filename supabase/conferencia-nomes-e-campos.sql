-- Conferência de nomes e campos (2026-10-07) — SÓ LEITURA: não altera nada.
-- Rode no SQL Editor do Supabase e mande o resultado (uma linha por verificação).
-- Serve para planejar: 1) limpeza de campos antigos, 2) paciente por código no
-- Planner e na Agenda, 3) colaborador único, 4) renomear os nomes internos.

with
pac as (
  select p from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  where d.path = 'patients/all'
),
prof as (
  select p from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
  where d.path = 'config/professionals'
),
trat as (
  select t from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
  where d.path = 'treatments/all'
),
seats as (
  select r ->> 'name' as sala, s from public.documents d,
    jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) r,
    jsonb_array_elements(coalesce(r -> 'therapists', '[]'::jsonb)) s
  where d.path = 'config/rooms'
),
book as (
  select d.path, b.key, b.value as v from public.documents d, jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
  where d.path like 'schedule/%'
),
nomes_pac as (select lower(btrim(p ->> 'nome')) n from pac),
nomes_sala as (
  select lower(btrim(r ->> 'name')) n from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) r
  where d.path = 'config/rooms'
),
homonimos as (select n from nomes_pac group by n having count(*) > 1)

select '01 Pacientes cadastrados' as verificacao, count(*)::text as resultado from pac
union all select '02 Pacientes com campos antigos de contato (responsaveis/finOutro/telefone/email/prefContato/escolaContato)',
  count(*)::text from pac where p ?| array['responsaveis','finOutro','telefone','email','prefContato','escolaContato']
union all select '03 Pacientes com dados que hoje são do tratamento (convenio/aba/specHours/horarios/pacoteHoras)',
  count(*)::text from pac where p ?| array['convenio','convenioId','aba','specHours','horarios','pacoteHoras','plano']
union all select '04 Pacientes com dados de saúde ainda no cadastro geral (deveriam estar em patient_health)',
  count(*)::text from pac where p ?| array['cid','diagData','suporte','comunicacao','alergias','medicacoes','restricoes','medicoId']
union all select '05 Pacientes com idade gravada', count(*)::text from pac where coalesce(p ->> 'idade', '') <> ''
union all select '06 Pacientes SEM data de nascimento (ficariam sem idade)', count(*)::text from pac where coalesce(p ->> 'nascimento', '') = ''
union all select '07 Pacientes com idade gravada diferente da calculada pelo nascimento',
  count(*)::text from pac
  where coalesce(p ->> 'idade', '') ~ '^[0-9]+$' and coalesce(p ->> 'nascimento', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and (p ->> 'idade')::int <> extract(year from age(current_date, (p ->> 'nascimento')::date))::int
union all select '08 Nomes de paciente repetidos (homônimos)', coalesce(string_agg(n, ', '), '0') from homonimos
union all select '09 Pacientes sem CPF', count(*)::text from pac where coalesce(p ->> 'cpf', '') = ''

union all select '10 Planner: agendamentos com paciente/sala', count(*)::text from book
  where coalesce(v ->> 'patient', '') <> '' and coalesce((v ->> 'blocked')::boolean, false) = false
union all select '11 Planner: nomes que não são paciente nem sala do cadastro',
  count(*)::text from book
  where coalesce(v ->> 'patient', '') <> '' and coalesce((v ->> 'blocked')::boolean, false) = false
    and coalesce((v ->> 'training')::boolean, false) = false and v ->> 'patient' <> 'Reunião Clínica'
    and lower(btrim(v ->> 'patient')) not in (select n from nomes_pac)
    and lower(btrim(v ->> 'patient')) not in (select n from nomes_sala)
union all select '12 Planner: agendamentos de pacientes homônimos', count(*)::text from book
  where lower(btrim(v ->> 'patient')) in (select n from homonimos)
union all select '13 Agenda: atendimentos (total)', count(*)::text from public.appointments
union all select '14 Agenda: nomes que não são paciente nem grupo do cadastro',
  count(*)::text from public.appointments a
  where not a.blocked and coalesce(a.patient, '') <> '' and a.patient <> 'Reunião Clínica'
    and lower(btrim(a.patient)) not in (select n from nomes_pac)
    and lower(btrim(a.patient)) not in (select n from nomes_sala)
union all select '15 Agenda: atendimentos de pacientes homônimos', count(*)::text from public.appointments
  where lower(btrim(patient)) in (select n from homonimos)

union all select '16 Profissionais cadastrados', count(*)::text from prof
union all select '17 Profissionais com horário no formato antigo (horaInicio/horaFim)',
  count(*)::text from prof where p ?| array['horaInicio','horaFim']
union all select '18 Profissionais com horário de um dia sem manhã/tarde (formato antigo por dia)',
  count(*)::text from prof
  where exists (select 1 from jsonb_each(coalesce(p -> 'horarios', '{}'::jsonb)) h where h.value ? 'inicio')
union all select '19 Profissionais sem cadastro de colaborador (staff)',
  count(*)::text from prof where not exists (select 1 from public.staff s where s.professional_id = p ->> 'id')
union all select '20 Colaboradores por tipo de código (prof-/user-/outro)',
  coalesce((select string_agg(k || ': ' || c, ', ') from (
    select case when id like 'prof-%' then 'prof-' when id like 'user-%' then 'user-' else 'outro' end k, count(*)::text c
    from public.staff group by 1) x), '0')
union all select '21 Colaboradores ligados a profissional que não existe mais',
  count(*)::text from public.staff s
  where s.professional_id is not null and not exists (select 1 from prof where p ->> 'id' = s.professional_id)
union all select '22 Colaborador com nome diferente do profissional ligado',
  count(*)::text from public.staff s join prof on p ->> 'id' = s.professional_id
  where coalesce(s.data ->> 'nome', '') <> '' and lower(btrim(s.data ->> 'nome')) <> lower(btrim(p ->> 'name'))
union all select '23 Colunas das salas com nome do profissional desatualizado',
  count(*)::text from seats join prof on p ->> 'id' = s ->> 'professionalId'
  where lower(btrim(coalesce(s ->> 'name', ''))) <> lower(btrim(p ->> 'name'))
union all select '24 Colunas das salas sem profissional', count(*)::text from seats where coalesce(s ->> 'professionalId', '') = ''
union all select '25 Usuários ligados a profissional que não existe mais',
  count(*)::text from public.profiles u
  where u.professional_id is not null and not exists (select 1 from prof where p ->> 'id' = u.professional_id)

union all select '26 Tratamentos com serviço misturado nas especialidades (svc:)',
  count(*)::text from trat
  where exists (select 1 from jsonb_array_elements(coalesce(t -> 'specHours', '[]'::jsonb)) x where x ->> 'specId' like 'svc:%')
union all select '27 Tratamentos de paciente que não existe mais',
  count(*)::text from trat where not exists (select 1 from pac where p ->> 'id' = t ->> 'patientId')

union all select '28 Níveis que ainda têm a permissão antiga "profissionais"',
  coalesce((select string_agg(name, ', ') from public.roles where permissions ? 'profissionais'), '0')
union all select '29 Permissões gravadas nos níveis (nomes internos em uso)',
  (select string_agg(distinct k, ', ' order by k) from public.roles, jsonb_object_keys(permissions) k)
union all select '30 Colunas antigas sem uso em profiles (is_admin/permissions)',
  coalesce((select string_agg(column_name, ', ') from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name in ('is_admin', 'permissions')), 'nenhuma')
union all select '31 Documentos gravados (caminhos)',
  (select string_agg(path, ', ' order by path) from public.documents where path not like 'schedule/%');
