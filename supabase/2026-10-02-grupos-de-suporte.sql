-- =====================================================================
-- Agenda Pipo — Grupos de suporte (2026-10-02)
--
--   * Grupos de suporte ficam no mesmo cadastro das salas (config/rooms),
--     marcados com "group": true. No Planner as colunas dos grupos vêm
--     antes das salas; célula de grupo só aceita agendar SALA, célula de
--     sala só aceita PACIENTE.
--   * Este script transforma as salas "Coordenador" e "Aplicador ABA" em
--     grupos. Os atendimentos já marcados nelas continuam no lugar.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

update public.documents
set data = jsonb_set(data, '{list}', (
  select jsonb_agg(
    case when lower(btrim(e ->> 'name')) in ('coordenador', 'aplicador aba')
      then e || '{"group": true}'::jsonb
      else e
    end order by ord)
  from jsonb_array_elements(data -> 'list') with ordinality as t(e, ord)
))
where path = 'config/rooms' and jsonb_typeof(data -> 'list') = 'array';

select e ->> 'name' as nome, coalesce((e ->> 'group')::boolean, false) as grupo_de_suporte
from public.documents, jsonb_array_elements(data -> 'list') e
where path = 'config/rooms';
