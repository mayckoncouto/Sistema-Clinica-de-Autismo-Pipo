-- =====================================================================
-- Agenda Pipo — Tratamentos (2026-10-03)
--
--   * Novo documento treatments/all (cadastro de Tratamentos), com permissão
--     própria "tratamentos" (ver/incluir/editar/excluir) em Níveis de permissão.
--     Os níveis que já existem recebem o mesmo acesso que têm em Pacientes.
--   * Convênio, plano, pacote, ABA, especialidades/serviços e horário de
--     atendimento passam do paciente para o tratamento.
--   * Cria UM tratamento Ativo (tipo Novo) para cada paciente, com os dados que
--     estão hoje no cadastro dele. Início = primeiro atendimento dele na Agenda
--     (ou hoje, se ainda não tem). Valor e despesas ficam em 0 para preencher.
--     Os campos antigos continuam guardados no paciente (nada é apagado).
--
-- Rode UMA vez no SQL Editor do Supabase. Pode rodar de novo sem estragar: se
-- treatments/all já existir, os tratamentos NÃO são recriados.
-- =====================================================================

-- 1. Aceitar o caminho treatments/all.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento (+ tratamentos).
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'          then 'agenda'
    when p_path = 'patients/all'           then 'pacientes'
    when p_path = 'treatments/all'         then 'tratamentos'
    when p_path = 'config/specialties'     then 'especialidades'
    when p_path = 'config/convenios'       then 'convenios'
    when p_path = 'config/professionals'   then 'profissionais'
    when p_path = 'config/services'        then 'servicos'
    when p_path = 'config/rooms'           then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'        then 'cadastro_status'
    when p_path = 'config/clinic'          then 'clinica'
  end;
$$;

-- 3. Níveis existentes: Tratamentos com o mesmo acesso de Pacientes.
--    O relatório "Tratamentos novos e renegociados" começa liberado só para o
--    Administrador (libere para outros níveis em Níveis de permissão).
update public.roles set permissions = permissions
  || jsonb_build_object('tratamentos', coalesce(permissions -> 'pacientes', '{}'::jsonb))
  where not is_admin and not (permissions ? 'tratamentos');

-- 4. Um tratamento por paciente, com os dados de hoje do cadastro dele.
insert into public.documents (path, data)
select 'treatments/all', jsonb_build_object('list', coalesce(jsonb_agg(t order by t ->> 'patientId'), '[]'::jsonb))
from (
  select jsonb_strip_nulls(jsonb_build_object(
    'id',          'tr-' || (p ->> 'id'),
    'patientId',   p ->> 'id',
    'inicio',      coalesce(
                     (select to_char(min(a.date), 'YYYY-MM-DD') from public.appointments a
                       where not a.blocked and lower(btrim(a.patient)) = lower(btrim(p ->> 'nome'))),
                     to_char(current_date, 'YYYY-MM-DD')),
    'valor',       0,
    'despesas',    0,
    'tipo',        'novo',
    'status',      'ativo',
    'statusEm',    to_char(current_date, 'YYYY-MM-DD'),
    'obs',         'Criado automaticamente a partir do cadastro do paciente.',
    'convenioId',  p -> 'convenioId',
    'convenio',    p -> 'convenio',
    'plano',       p -> 'plano',
    'pacoteHoras', p -> 'pacoteHoras',
    'aba',         p -> 'aba',
    'specHours',   p -> 'specHours',
    'horarios',    p -> 'horarios',
    'criadoEm',    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )) as t
  from jsonb_array_elements(coalesce((select data -> 'list' from public.documents where path = 'patients/all'), '[]'::jsonb)) p
  where coalesce(p ->> 'id', '') <> ''
) x
on conflict (path) do nothing;

-- conferência: quantos tratamentos foram criados
select jsonb_array_length(data -> 'list') as tratamentos from public.documents where path = 'treatments/all';
