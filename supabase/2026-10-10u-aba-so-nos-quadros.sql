-- =====================================================================
-- ABA só nos quadros do tratamento (pedido do usuário, 2026-10-10).
-- O campo único "ABA" do tratamento saiu da tela. Para cada tratamento que tinha
-- o campo "aba":
--   * o valor (Sim/Não; vazio = Sim, como o app já lia) passa para "abaAntigo":
--     enquanto o tratamento não tiver quadros, vale ele, e o 1º quadro já vem com ele;
--   * quadro (specHours) sem ABA recebe esse valor;
--   * o fim das Observações ganha a linha "ABA (antigo): Sim" ou "ABA (antigo): Não";
--   * a chave "aba" é apagada.
-- No cadastro dos pacientes (patients/all) a chave "aba" antiga também é apagada.
-- Sem quadro (e sem ABA antigo) vale a regra automática do app: Sim para todos,
-- Não com nível de suporte 3 ou 17 anos ou mais.
-- ANTES DE RODAR: baixe um Backup (menu Acesso → Backup).
-- Pode rodar de novo (não faz nada na 2ª vez).
-- =====================================================================
update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
         select jsonb_agg(
           case when jsonb_typeof(e) = 'object' and e ? 'aba' then (
             with v as (
               select coalesce(nullif(e ->> 'abaAntigo', ''),
                        case when lower(coalesce(e ->> 'aba', '')) in ('não', 'nao') then 'Não' else 'Sim' end) as aba
             )
             select (e - 'aba')
               || jsonb_build_object('abaAntigo', v.aba)
               || jsonb_build_object('specHours', coalesce((
                    select jsonb_agg(case when jsonb_typeof(q) = 'object' and coalesce(q ->> 'aba', '') = ''
                                          then q || jsonb_build_object('aba', v.aba) else q end order by k)
                      from jsonb_array_elements(case when jsonb_typeof(e -> 'specHours') = 'array' then e -> 'specHours' else '[]'::jsonb end)
                           with ordinality as y(q, k)), '[]'::jsonb))
               || jsonb_build_object('obs',
                    case when coalesce(e ->> 'obs', '') like '%ABA (antigo):%' then coalesce(e ->> 'obs', '')
                         when btrim(coalesce(e ->> 'obs', '')) = '' then 'ABA (antigo): ' || v.aba
                         else rtrim(e ->> 'obs') || E'\n' || 'ABA (antigo): ' || v.aba end)
               from v)
           else e end order by n)
           from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, n)), '[]'::jsonb))
 where d.path = 'treatments/all'
   and jsonb_typeof(d.data -> 'list') = 'array'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') e where jsonb_typeof(e) = 'object' and e ? 'aba');

update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
         select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'aba' else e end order by n)
           from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, n)), '[]'::jsonb))
 where d.path = 'patients/all'
   and jsonb_typeof(d.data -> 'list') = 'array'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') e where jsonb_typeof(e) = 'object' and e ? 'aba');

-- Conferência: as duas primeiras devem dar 0; as outras mostram quantos ficaram com o ABA antigo Sim / Não.
select
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'treatments/all' and e ? 'aba') as tratamentos_com_aba_antigo_no_campo,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'patients/all' and e ? 'aba') as pacientes_com_aba,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'treatments/all' and e ->> 'abaAntigo' = 'Sim') as aba_antigo_sim,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'treatments/all' and e ->> 'abaAntigo' = 'Não') as aba_antigo_nao;
