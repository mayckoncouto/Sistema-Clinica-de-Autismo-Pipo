-- =====================================================================
-- Colaboradores: retirar o campo "Jornada semanal" (pedido do usuário,
-- 2026-10-10). As horas da semana passam a vir só do Horário de trabalho.
-- Só dados: apaga a chave "jornada" de public.staff.data. Pode rodar de novo.
-- =====================================================================
update public.staff set data = data - 'jornada' where data ? 'jornada';

-- Conferência: deve dar 0.
select count(*) as colaboradores_com_jornada from public.staff where data ? 'jornada';
