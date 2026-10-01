-- =====================================================================
-- Agenda Pipo — Origem dos atendimentos (2026-10-02, parte 3)
--
--   * Coluna "source" em appointments: "planner" quando o atendimento veio
--     do botão "Enviar para a Agenda" do Planner; vazio quando foi marcado
--     direto na Agenda.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

alter table public.appointments add column if not exists source text;
