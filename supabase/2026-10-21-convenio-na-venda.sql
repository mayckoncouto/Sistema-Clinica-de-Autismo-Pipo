-- Convênio gravado na venda (2026-10-21, pedido do usuário).
-- A venda passa a guardar o convênio do momento em que foi registrada (o do tratamento; sem ele, o do cadastro do paciente).
-- O Painel de Vendas usa o convênio gravado. As vendas que já existem recebem o convênio do tratamento delas.
alter table public.treatment_sales add column if not exists convenio_id   text;
alter table public.treatment_sales add column if not exists convenio_name text;

with t as (
  select d.unit_id, x->>'id' as tid, nullif(x->>'convenioId', '') as cid, nullif(x->>'convenio', '') as cname
  from public.documents d, jsonb_array_elements(coalesce(d.data->'list', '[]'::jsonb)) x
  where d.path = 'treatments/all'
), c as (
  select x->>'id' as id, x->>'name' as name
  from public.documents d, jsonb_array_elements(coalesce(d.data->'list', '[]'::jsonb)) x
  where d.path = 'config/convenios'
)
update public.treatment_sales s
   set convenio_id = t.cid,
       convenio_name = coalesce((select c.name from c where c.id = t.cid limit 1), t.cname)
  from t
 where t.tid = s.treatment_id and t.unit_id = s.unit_id
   and s.convenio_id is null and s.convenio_name is null
   and (t.cid is not null or t.cname is not null);

-- conferência: vendas sem convênio gravado
select count(*) as vendas, count(*) filter (where convenio_name is not null) as com_convenio from public.treatment_sales;
