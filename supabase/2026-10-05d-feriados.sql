-- =====================================================================
-- Agenda Pipo — Feriados e recessos (2026-10-05)
--
--   * Novo cadastro config/holidays (Cadastros → Feriados e recessos), com
--     permissão própria "feriados" em Níveis de permissão. Os níveis que já
--     existem recebem o mesmo acesso que têm na Agenda.
--   * Já vem com os feriados nacionais (Sexta-feira Santa e Corpus Christi são
--     calculados pela Páscoa a cada ano) e o Aniversário de Blumenau (2/9).
--   * Na Agenda os horários de feriado ficam cinza e marcar só pede
--     confirmação; o "Gerar mês" do Planner pula esses horários.
--
-- PRECISA das migrações 2026-10-05 e 2026-10-05b já rodadas.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar o caminho config/holidays.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|patient_fields)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
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
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm na Agenda.
update public.roles set permissions = permissions
  || jsonb_build_object('feriados', coalesce(permissions -> 'agendamentos', '{}'::jsonb))
  where not is_admin and not (permissions ? 'feriados');

-- 4. Feriados iniciais.
insert into public.documents (path, data) values ('config/holidays', '{"list": [
  {"id": "confraternizacao", "name": "Confraternização Universal", "tipo": "nacional", "inicio": "2026-01-01", "fim": "2026-01-01", "periodo": "dia", "anual": true},
  {"id": "sexta-santa", "name": "Sexta-feira Santa", "tipo": "nacional", "periodo": "dia", "movel": "sexta-santa"},
  {"id": "tiradentes", "name": "Tiradentes", "tipo": "nacional", "inicio": "2026-04-21", "fim": "2026-04-21", "periodo": "dia", "anual": true},
  {"id": "trabalho", "name": "Dia do Trabalho", "tipo": "nacional", "inicio": "2026-05-01", "fim": "2026-05-01", "periodo": "dia", "anual": true},
  {"id": "corpus-christi", "name": "Corpus Christi", "tipo": "nacional", "periodo": "dia", "movel": "corpus-christi"},
  {"id": "blumenau", "name": "Aniversário de Blumenau", "tipo": "municipal", "inicio": "2026-09-02", "fim": "2026-09-02", "periodo": "dia", "anual": true},
  {"id": "independencia", "name": "Independência do Brasil", "tipo": "nacional", "inicio": "2026-09-07", "fim": "2026-09-07", "periodo": "dia", "anual": true},
  {"id": "aparecida", "name": "Nossa Senhora Aparecida", "tipo": "nacional", "inicio": "2026-10-12", "fim": "2026-10-12", "periodo": "dia", "anual": true},
  {"id": "finados", "name": "Finados", "tipo": "nacional", "inicio": "2026-11-02", "fim": "2026-11-02", "periodo": "dia", "anual": true},
  {"id": "republica", "name": "Proclamação da República", "tipo": "nacional", "inicio": "2026-11-15", "fim": "2026-11-15", "periodo": "dia", "anual": true},
  {"id": "consciencia-negra", "name": "Dia da Consciência Negra", "tipo": "nacional", "inicio": "2026-11-20", "fim": "2026-11-20", "periodo": "dia", "anual": true},
  {"id": "natal", "name": "Natal", "tipo": "nacional", "inicio": "2026-12-25", "fim": "2026-12-25", "periodo": "dia", "anual": true}
]}'::jsonb)
on conflict (path) do nothing;

-- conferência: quantos feriados ficaram cadastrados (deve dar 12)
select jsonb_array_length(data -> 'list') as feriados from public.documents where path = 'config/holidays';
