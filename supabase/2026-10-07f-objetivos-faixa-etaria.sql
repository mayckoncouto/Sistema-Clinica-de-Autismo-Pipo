-- 2026-10-07f — Objetivos: faixa etária no cadastro e plano ligado ao cadastro.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   1. Cadastro de Objetivos (config/goal_bank): o "[0–4]" (ou "[5–9]", "[10+]",
--      "[0–4, 5–9]"…) do começo do nome vira o campo Faixas etárias e sai do nome.
--      Se o objetivo já tem faixas marcadas, elas ficam. Prefixo que não é uma faixa
--      conhecida não é mexido.
--   2. Planos terapêuticos (todas as versões): cada objetivo do plano é ligado ao
--      objetivo do cadastro com o mesmo texto (sem o prefixo) na mesma habilidade
--      (campo goalId) e o texto gravado fica sem o prefixo. A faixa passa a vir do
--      cadastro, então no plano continua aparecendo "[0–4] Objetivo".
--      Objetivo do plano sem igual no cadastro fica como está.
-- Pode rodar mais de uma vez.

begin;

-- Faixas de um texto como "0–4", "0-4 anos", "5–9, 10+". Devolve null se algum pedaço
-- não for uma faixa conhecida.
create or replace function pg_temp.goal_bands(p_txt text) returns jsonb
language plpgsql immutable as $$
declare
  v jsonb := '[]'::jsonb;
  t text;
  k text;
begin
  foreach t in array regexp_split_to_array(coalesce(p_txt, ''), '\s*(,|;|/|\se\s)\s*') loop
    k := lower(regexp_replace(translate(t, '–—', '--'), '\s+|anos?', '', 'g'));
    continue when k = '';
    if k not in ('0-4', '5-9', '10+') then return null; end if;
    if not v @> to_jsonb(k) then v := v || to_jsonb(k); end if;
  end loop;
  return case when jsonb_array_length(v) = 0 then null else v end;
end $$;

create or replace function pg_temp.goal_bare(p_name text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '^\s*\[[^\]]*\]\s*', ''), '\s+', ' ', 'g'))
$$;

create or replace function pg_temp.goal_key(p_name text) returns text
language sql immutable as $$
  select lower(pg_temp.goal_bare(p_name))
$$;

-- 1. Cadastro de Objetivos
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case
         when pg_temp.goal_bands((regexp_match(g ->> 'name', '^\s*\[([^\]]+)\]'))[1]) is not null
         then g || jsonb_build_object(
                'name', pg_temp.goal_bare(g ->> 'name'),
                'faixas', case
                  when jsonb_typeof(g -> 'faixas') = 'array' and jsonb_array_length(g -> 'faixas') > 0 then g -> 'faixas'
                  else pg_temp.goal_bands((regexp_match(g ->> 'name', '^\s*\[([^\]]+)\]'))[1])
                end)
         else g
       end
       order by ord), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(g, ord)
   ))
 where d.path = 'config/goal_bank'
   and exists (
     select 1 from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) g
     where g ->> 'name' ~ '^\s*\['
   );

-- 2. Planos terapêuticos: liga cada objetivo ao cadastro (mesma habilidade, mesmo texto).
update public.therapy_plans tp
   set sections = (
     select coalesce(jsonb_agg(
       s || jsonb_build_object('objectives', (
         select coalesce(jsonb_agg(
           case
             when coalesce(o ->> 'goalId', '') <> '' then o
             else coalesce((
               select o || jsonb_build_object('goalId', g ->> 'id', 'objetivo', g ->> 'name')
                 from public.documents gb,
                      jsonb_array_elements(coalesce(gb.data -> 'list', '[]'::jsonb)) g
                where gb.path = 'config/goal_bank'
                  and g ->> 'areaId' = s ->> 'areaId'
                  and pg_temp.goal_key(g ->> 'name') = pg_temp.goal_key(o ->> 'objetivo')
                limit 1), o)
           end
           order by oi), '[]'::jsonb)
         from jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) with ordinality as y(o, oi)))
       order by si), '[]'::jsonb)
     from jsonb_array_elements(coalesce(tp.sections, '[]'::jsonb)) with ordinality as x(s, si)
   )
 where exists (
   select 1
     from jsonb_array_elements(coalesce(tp.sections, '[]'::jsonb)) s,
          jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
    where coalesce(o ->> 'goalId', '') = ''
 );

commit;

-- Conferência (só leitura): quantos ainda têm "[" no começo do nome e quantos objetivos
-- de plano ficaram sem ligação com o cadastro.
select
  (select count(*) from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) g
    where d.path = 'config/goal_bank' and g ->> 'name' ~ '^\s*\[') as objetivos_com_prefixo,
  (select count(*) from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) g
    where d.path = 'config/goal_bank' and jsonb_array_length(coalesce(g -> 'faixas', '[]'::jsonb)) > 0) as objetivos_com_faixa,
  (select count(*) from public.therapy_plans tp,
          jsonb_array_elements(coalesce(tp.sections, '[]'::jsonb)) s,
          jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
    where coalesce(o ->> 'goalId', '') <> '') as objetivos_de_plano_ligados,
  (select count(*) from public.therapy_plans tp,
          jsonb_array_elements(coalesce(tp.sections, '[]'::jsonb)) s,
          jsonb_array_elements(coalesce(s -> 'objectives', '[]'::jsonb)) o
    where coalesce(o ->> 'goalId', '') = '') as objetivos_de_plano_sem_ligacao;
