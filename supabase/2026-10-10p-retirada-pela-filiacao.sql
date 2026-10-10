-- =====================================================================
-- Responsáveis pela retirada pela Filiação (pedido do usuário, 2026-10-10).
-- Mãe e Pai não ficam mais gravados na lista de retirada ("rotina"): vêm da
-- Filiação, com "retira": false quando não podem retirar. A lista fica só com
-- outras pessoas. Medida protetiva ganha "quem" ("mae" | "pai" | "").
-- Só dados, em patients/all:
--  1) Mãe/Pai tirados da lista antes (rotinaOff) → mae/pai.retira = false;
--  2) apaga da lista as entradas da Mãe/Pai (src) e a chave rotinaOff;
--  3) medida protetiva com o mesmo nome da Mãe/Pai → quem = "mae"/"pai".
-- ANTES DE RODAR: baixe um Backup (menu Acesso → Backup). Pode rodar de novo.
-- =====================================================================
create or replace function pg_temp.pipo_retirada(e jsonb) returns jsonb language plpgsql as $$
declare r text; mnome text; pnome text;
begin
  if jsonb_typeof(e) <> 'object' then return e; end if;
  foreach r in array array['mae', 'pai'] loop
    if coalesce((e -> 'rotinaOff' ->> r)::boolean, false) and jsonb_typeof(e -> r) = 'object' then
      e := jsonb_set(e, array[r, 'retira'], 'false'::jsonb);
    end if;
  end loop;
  if jsonb_typeof(e -> 'rotina') = 'array' then
    e := jsonb_set(e, '{rotina}', coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(e -> 'rotina') with ordinality t(x, n)
                                             where coalesce(x ->> 'src', '') = ''), '[]'::jsonb));
  end if;
  e := e - 'rotinaOff';
  mnome := lower(btrim(coalesce(e -> 'mae' ->> 'nome', '')));
  pnome := lower(btrim(coalesce(e -> 'pai' ->> 'nome', '')));
  if jsonb_typeof(e -> 'protetiva') = 'array' then
    e := jsonb_set(e, '{protetiva}', coalesce((select jsonb_agg(
           case when jsonb_typeof(x) <> 'object' or coalesce(x ->> 'quem', '') <> '' then x
                when mnome <> '' and lower(btrim(coalesce(x ->> 'nome', ''))) = mnome then x || '{"quem": "mae", "rel": "Mãe"}'::jsonb
                when pnome <> '' and lower(btrim(coalesce(x ->> 'nome', ''))) = pnome then x || '{"quem": "pai", "rel": "Pai"}'::jsonb
                else x end order by n) from jsonb_array_elements(e -> 'protetiva') with ordinality t(x, n)), '[]'::jsonb));
  end if;
  return e;
end $$;

update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
         select jsonb_agg(pg_temp.pipo_retirada(e) order by n)
           from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, n)), '[]'::jsonb))
 where d.path = 'patients/all'
   and jsonb_typeof(d.data -> 'list') = 'array'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') e
                where e ? 'rotinaOff'
                   or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e -> 'rotina') = 'array' then e -> 'rotina' else '[]' end) x
                               where coalesce(x ->> 'src', '') <> '')
                   or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e -> 'protetiva') = 'array' then e -> 'protetiva' else '[]' end) x
                               where coalesce(x ->> 'quem', '') = ''
                                 and lower(btrim(coalesce(x ->> 'nome', ''))) in (lower(btrim(coalesce(e -> 'mae' ->> 'nome', '-'))), lower(btrim(coalesce(e -> 'pai' ->> 'nome', '-'))))));

-- Conferência: as duas primeiras devem dar 0; a terceira mostra quantos pacientes ficaram com
-- Mãe ou Pai marcados como "não pode retirar".
select
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'patients/all' and (e ? 'rotinaOff' or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e -> 'rotina') = 'array' then e -> 'rotina' else '[]' end) x where coalesce(x ->> 'src', '') <> ''))) as pacientes_no_formato_antigo,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e, jsonb_array_elements(case when jsonb_typeof(e -> 'protetiva') = 'array' then e -> 'protetiva' else '[]' end) x
    where d.path = 'patients/all' and coalesce(x ->> 'quem', '') = ''
      and lower(btrim(coalesce(x ->> 'nome', ''))) in (lower(btrim(coalesce(e -> 'mae' ->> 'nome', '-'))), lower(btrim(coalesce(e -> 'pai' ->> 'nome', '-'))))) as medidas_da_mae_ou_pai_sem_quem,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'patients/all' and ((e -> 'mae' ->> 'retira') = 'false' or (e -> 'pai' ->> 'retira') = 'false')) as pacientes_com_mae_ou_pai_sem_retirar;
