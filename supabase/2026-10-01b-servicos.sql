-- =====================================================================
-- Agenda Pipo — Cadastro de Serviços (2026-10-01, parte 2)
--
-- Novo documento config/services ({list:[{id,name}]}), gerenciado na tela
-- de Profissionais (botão "Serviços"), com a permissão do módulo
-- "profissionais". Já vem com os 6 serviços iniciais.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- Aceitar o novo caminho de documento.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services)|patients/all|schedule/(seg|ter|qua|qui|sex)-[1-4])$'
);

-- Serviços seguem a permissão de Profissionais.
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
  end;
$$;

-- Serviços iniciais (só se o cadastro ainda não existir).
insert into public.documents (path, data) values ('config/services', '{"list": [
  {"id": "sessao",                     "name": "Sessão"},
  {"id": "triagem",                    "name": "Triagem"},
  {"id": "avaliacao",                  "name": "Avaliação"},
  {"id": "avaliacao-neuropsicologica", "name": "Avaliação Neuropsicológica"},
  {"id": "orientacao-familiar",        "name": "Orientação Familiar"},
  {"id": "orientacao-escolar",         "name": "Orientação Escolar"}
]}'::jsonb)
on conflict (path) do nothing;

commit;

select data -> 'list' as servicos from public.documents where path = 'config/services';
