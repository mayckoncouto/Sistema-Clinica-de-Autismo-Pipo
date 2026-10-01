-- =====================================================================
-- Agenda Pipo — Vários atendimentos no mesmo horário (2026-10-02, parte 2)
--
--   * A Agenda (por data) passa a aceitar mais de um atendimento no mesmo
--     dia/horário/profissional; eles aparecem lado a lado na célula.
--   * Remove a regra "um atendimento por horário do profissional".
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

alter table public.appointments drop constraint if exists appointments_one_per_slot;

create index if not exists appointments_slot_idx on public.appointments (date, time, professional_id);
