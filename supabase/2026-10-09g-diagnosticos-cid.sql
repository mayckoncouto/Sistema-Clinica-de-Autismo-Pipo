-- 2026-10-09g — Cadastros → Diagnósticos: lista CID-10 da clínica (41 códigos).
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
  ( 7, 'F90.0', 'Distúrbio da atividade e da atenção (TDAH)'),
  ( 8, 'F80.0', 'Transtorno específico da articulação da fala'),
  ( 9, 'F80.1', 'Transtorno expressivo de linguagem'),
  (10, 'F80.2', 'Transtorno receptivo de linguagem'),
  (11, 'F80.8', 'Outros transtornos do desenvolvimento da fala e da linguagem'),
  (12, 'F80.9', 'Transtorno do desenvolvimento da fala e da linguagem não especificado'),
  (13, 'F81.0', 'Transtorno específico de leitura'),
  (14, 'F81.2', 'Transtorno específico da habilidade em aritmética'),
  (15, 'F81.3', 'Transtorno misto de habilidades escolares'),
  (16, 'F81.9', 'Transtorno do desenvolvimento das habilidades escolares não especificado'),
  (17, 'F82',   'Transtorno específico do desenvolvimento motor'),
  (18, 'F83',   'Transtornos específicos mistos do desenvolvimento'),
  (19, 'F88',   'Outros transtornos do desenvolvimento psicológico'),
  (20, 'F89',   'Transtorno do desenvolvimento psicológico não especificado'),
  (21, 'F93.0', 'Transtorno ligado à angústia de separação'),
  (22, 'F93.1', 'Transtorno fóbico-ansioso da infância'),
  (23, 'F94.0', 'Mutismo eletivo (seletivo)'),
  (24, 'F98.2', 'Transtorno de alimentação na infância'),
  (25, 'F98.3', 'Pica do lactente ou da criança'),
  (26, 'F98.4', 'Estereotipias motoras'),
  (27, 'F98.5', 'Gagueira (tartamudez)'),
  (28, 'F98.9', 'Transtorno comportamental e emocional com início habitualmente ocorrido na infância ou adolescência, não especificado'),
  (29, 'F50.0', 'Anorexia nervosa'),
  (30, 'F50.1', 'Anorexia nervosa atípica'),
  (31, 'F50.2', 'Bulimia nervosa'),
  (32, 'F50.3', 'Bulimia nervosa atípica'),
  (33, 'F50.4', 'Hiperfagia associada a outros distúrbios psicológicos'),
  (34, 'F50.5', 'Vômitos associados a outros distúrbios psicológicos'),
  (35, 'F50.8', 'Outros transtornos da alimentação'),
  (36, 'F50.9', 'Transtorno da alimentação não especificado'),
  (37, 'R62.0', 'Retardo de etapas do desenvolvimento'),
  (38, 'R62.5', 'Retardo do desenvolvimento fisiológico normal, não especificado em outra parte'),
  (39, 'R62.9', 'Retardo do desenvolvimento fisiológico não especificado'),
  (40, 'R63.3', 'Dificuldades de alimentação'),
  (41, 'R63.8', 'Outros sintomas e sinais relativos à ingestão de alimentos e líquidos');

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

-- Conferência: deve mostrar 41 (todos os códigos da lista estão no cadastro e ativos)
select count(distinct upper(e ->> 'code')) as codigos_da_lista_no_cadastro
  from public.documents d, jsonb_array_elements(d.data -> 'list') e
 where d.path = 'config/diagnoses' and not (e ? 'inativo')
   and upper(e ->> 'code') in ('F84.0','F84.1','F84.5','F84.8','F84.9','F70','F90.0','F80.0','F80.1','F80.2','F80.8',
                               'F80.9','F81.0','F81.2','F81.3','F81.9','F82','F83','F88','F89','F93.0','F93.1',
                               'F94.0','F98.2','F98.3','F98.4','F98.5','F98.9','F50.0','F50.1','F50.2','F50.3','F50.4',
                               'F50.5','F50.8','F50.9','R62.0','R62.5','R62.9','R63.3','R63.8');
