-- 2026-10-09g — Cadastros → Diagnósticos: lista CID-10 da clínica (22 códigos).
--   * Código que já existe: a descrição passa a ser a da lista (e o item volta a ficar ativo).
--   * Código que não existe: é incluído no fim.
--   * Os outros diagnósticos do cadastro ficam como estão (nada é excluído).
--   * Quem usava o nome antigo (saúde do paciente, cadastro do paciente, leads do CRM) passa a usar
--     o nome novo, ex.: "F70 Retardo mental leve" → "F70 Deficiência intelectual leve".
-- Precisa da 2026-10-09f antes. Pode rodar mais de uma vez.

begin;

create temp table cid_novos (ord int, code text, name text) on commit drop;
insert into cid_novos values
  ( 1, 'F84.0', 'Autismo infantil'),
  ( 2, 'F84.1', 'Autismo atípico'),
  ( 3, 'F84.5', 'Síndrome de Asperger'),
  ( 4, 'F84.8', 'Outros transtornos globais do desenvolvimento'),
  ( 5, 'F84.9', 'Transtorno global do desenvolvimento não especificado'),
  ( 6, 'F70',   'Deficiência intelectual leve'),
  ( 7, 'F90.0', 'Transtorno do déficit de atenção e hiperatividade (TDAH)'),
  ( 8, 'F80.1', 'Transtorno expressivo de linguagem'),
  ( 9, 'F80.2', 'Transtorno receptivo de linguagem'),
  (10, 'F80.9', 'Transtorno do desenvolvimento da fala e da linguagem não especificado'),
  (11, 'F81.9', 'Transtorno do desenvolvimento das habilidades escolares não especificado'),
  (12, 'F82',   'Transtorno específico do desenvolvimento motor'),
  (13, 'R62.0', 'Retardo de etapas do desenvolvimento'),
  (14, 'R62.9', 'Retardo do desenvolvimento fisiológico não especificado'),
  (15, 'R63.3', 'Dificuldades de alimentação'),
  (16, 'F98.2', 'Transtorno de alimentação na infância'),
  (17, 'R63.8', 'Outros sintomas e sinais relativos à ingestão de alimentos e líquidos'),
  (18, 'F88',   'Outros transtornos do desenvolvimento psicológico'),
  (19, 'F89',   'Transtorno do desenvolvimento psicológico não especificado'),
  (20, 'F91.9', 'Transtorno de conduta não especificado'),
  (21, 'F93.9', 'Transtorno emocional da infância não especificado'),
  (22, 'F98.9', 'Transtorno comportamental e emocional com início habitualmente ocorrido na infância ou adolescência, não especificado');

-- Itens atuais (com a posição) e, para cada código da lista, o 1º item do cadastro com esse código
create temp table cid_atual on commit drop as
select i, e, upper(trim(coalesce(e ->> 'code', ''))) as code
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(e, i)
 where d.path = 'config/diagnoses';

create temp table cid_alvo on commit drop as
select distinct on (n.code) a.i, n.code, n.name,
       trim(coalesce(a.e ->> 'code', '') || ' ' || coalesce(a.e ->> 'name', '')) as antigo,
       n.code || ' ' || n.name as novo
  from cid_novos n join cid_atual a on a.code = n.code
 order by n.code, a.i;

-- Nomes antigos → novos (só os que mudaram de verdade)
create temp table cid_troca on commit drop as
select lower(antigo) as de, antigo, novo as para from cid_alvo where lower(antigo) <> lower(novo);

-- 1. Grava o cadastro: altera os existentes, mantém os outros, inclui os que faltam
insert into public.documents (path, data)
select 'config/diagnoses', jsonb_build_object('list', coalesce((
  select jsonb_agg(item order by grp, pos) from (
    select 1 as grp, a.i as pos,
           case when t.i is null then a.e
                when a.e ->> 'name' is not distinct from t.name and not (a.e ? 'inativo') and a.e ->> 'code' = t.code then a.e
                else (a.e - 'inativo') || jsonb_build_object('code', t.code, 'name', t.name,
                       '_upd', jsonb_build_object('por', 'Atualização CID', 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
           end as item
      from cid_atual a left join cid_alvo t on t.i = a.i
    union all
    select 2, n.ord, jsonb_build_object('id', 'dg-' || md5(lower(n.code || ' ' || n.name)), 'code', n.code, 'name', n.name,
                       '_upd', jsonb_build_object('por', 'Atualização CID', 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      from cid_novos n where not exists (select 1 from cid_atual a where a.code = n.code)
  ) s), '[]'::jsonb))
on conflict (path) do update set data = excluded.data;

-- 2. Quem usava o nome antigo passa a usar o novo
update public.patient_health h
   set data = h.data || jsonb_build_object('cid', t.para)
  from cid_troca t
 where lower(trim(h.data ->> 'cid')) = t.de;

update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select jsonb_agg(case when t.para is null then p else p || jsonb_build_object('cid', t.para) end order by i)
       from jsonb_array_elements(d.data -> 'list') with ordinality x(p, i)
       left join cid_troca t on t.de = lower(trim(p ->> 'cid'))))
 where d.path = 'patients/all'
   and exists (select 1 from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
                 join cid_troca t on t.de = lower(trim(p ->> 'cid')));

update public.tasks k
   set lead = k.lead || jsonb_build_object('diagnostico', t.para)
  from cid_troca t
 where lower(trim(k.lead ->> 'diagnostico')) = t.de;

-- Conferência: nomes trocados
select antigo as nome_antigo, para as nome_novo from cid_troca order by para;

commit;

-- Conferência: deve mostrar 22 (todos os códigos da lista estão no cadastro e ativos)
select count(distinct upper(e ->> 'code')) as codigos_da_lista_no_cadastro
  from public.documents d, jsonb_array_elements(d.data -> 'list') e
 where d.path = 'config/diagnoses' and not (e ? 'inativo')
   and upper(e ->> 'code') in ('F84.0','F84.1','F84.5','F84.8','F84.9','F70','F90.0','F80.1','F80.2','F80.9','F81.9',
                               'F82','R62.0','R62.9','R63.3','F98.2','R63.8','F88','F89','F91.9','F93.9','F98.9');
