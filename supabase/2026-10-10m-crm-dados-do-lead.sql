-- =====================================================================
-- CRM: "Dados do lead" só com Paciente ou Lead, Telefone, Diagnóstico e
-- Convênio (pedido do usuário, 2026-10-10). Tira das tarefas os campos que
-- saíram da janela: nascimento, responsável, origem, e-mail e plano.
-- Para nada se perder, o que estava preenchido nesses campos e ainda não
-- aparece na Descrição é acrescentado no fim dela, numa linha
-- "Dados do lead (campos retirados): ...". Pode rodar de novo (não repete).
-- =====================================================================
with alvo as (
  select t.id,
         concat_ws(' · ',
           case when n.nasc <> '' and t.description not ilike '%' || n.nasc || '%' then 'Nascimento: ' || n.nasc end,
           case when coalesce(btrim(t.lead ->> 'responsavel'), '') <> '' and t.description not ilike '%' || btrim(t.lead ->> 'responsavel') || '%'
                then 'Responsável: ' || btrim(t.lead ->> 'responsavel') end,
           case when coalesce(btrim(t.lead ->> 'origem'), '') <> '' and t.description not ilike '%' || btrim(t.lead ->> 'origem') || '%'
                then 'Origem: ' || btrim(t.lead ->> 'origem') end,
           case when coalesce(btrim(t.lead ->> 'email'), '') <> '' and t.description not ilike '%' || btrim(t.lead ->> 'email') || '%'
                then 'E-mail: ' || btrim(t.lead ->> 'email') end,
           case when coalesce(btrim(t.lead ->> 'plano'), '') <> '' and t.description not ilike '%' || btrim(t.lead ->> 'plano') || '%'
                then 'Plano: ' || btrim(t.lead ->> 'plano') end
         ) as extra
  from public.tasks t
  cross join lateral (select case when coalesce(t.lead ->> 'nascimento', '') ~ '^\d{4}-\d{2}-\d{2}$'
                                  then to_char((t.lead ->> 'nascimento')::date, 'DD/MM/YYYY')
                                  else btrim(coalesce(t.lead ->> 'nascimento', '')) end as nasc) n
  where t.lead ?| array['nascimento', 'responsavel', 'origem', 'email', 'plano']
)
update public.tasks t
   set description = case when a.extra = '' then t.description
                          when btrim(t.description, E' \r\n\t') = '' then 'Dados do lead (campos retirados): ' || a.extra
                          else rtrim(t.description, E' \r\n\t') || E'\n\nDados do lead (campos retirados): ' || a.extra end,
       lead = t.lead - array['nascimento', 'responsavel', 'origem', 'email', 'plano']
  from alvo a
 where a.id = t.id;

-- Conferência: deve dar 0
select count(*) as tarefas_com_campos_antigos
  from public.tasks where lead ?| array['nascimento', 'responsavel', 'origem', 'email', 'plano'];
