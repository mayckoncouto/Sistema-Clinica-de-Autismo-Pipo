-- =====================================================================
-- Agenda Pipo — Relatório financeiro (Etapa 6, 2026-10-04)
--
--   O relatório "Relatório financeiro" (Relatórios → permissão própria em
--   Níveis de permissão → Relatórios) soma o valor mensal dos tratamentos.
--   Os valores ficam em treatment_finance, que só "Tratamentos – valores: ver"
--   podia ler. Aqui a leitura passa a valer também para quem tem esse relatório.
--   (Gravar valores continua só com "Tratamentos – valores: editar".)
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

drop policy if exists treatment_finance_select on public.treatment_finance;
create policy treatment_finance_select on public.treatment_finance
  for select to authenticated
  using (public.has_perm('tratamentos_valores', 'view') or public.has_perm('relatorios', 'financeiro'));

-- conferência: níveis que têm o relatório marcado
select name, is_admin, coalesce((permissions -> 'relatorios' ->> 'financeiro')::boolean, false) as relatorio_financeiro
from public.roles order by is_admin desc, name;
