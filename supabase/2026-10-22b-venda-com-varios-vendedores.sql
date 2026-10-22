-- Venda com mais de um vendedor (2026-10-22, pedido do usuário)
-- treatment_sales.partes = outros vendedores da venda: [{seller, sellerName, valor}] (valor = parte do total da venda).
-- O vendedor principal (seller_id) fica com o total menos a soma das partes.
-- Cada vendedor ganha a própria comissão: sale_commissions passa a ter uma linha por venda E vendedor.
-- Pode rodar de novo.

alter table public.treatment_sales add column if not exists partes jsonb not null default '[]'::jsonb;

alter table public.sale_commissions drop constraint if exists sale_commissions_sale_id_key;
create unique index if not exists sale_commissions_sale_seller_uq on public.sale_commissions (sale_id, coalesce(seller_id, ''));

-- conferência: true | true | false
select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treatment_sales' and column_name = 'partes') as partes,
       to_regclass('public.sale_commissions_sale_seller_uq') is not null as indice_novo,
       exists(select 1 from pg_constraint where conname = 'sale_commissions_sale_id_key') as unico_antigo;
