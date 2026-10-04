-- =====================================================================
-- Agenda Pipo — resumo dos atendimentos para os Tratamentos (Etapa 7, 2026-10-04)
--
--   Término, sessões usadas e "Contratado × realizado" dos tratamentos
--   precisam dos atendimentos de cada paciente. Antes o sistema baixava
--   linha por linha toda a Agenda. Esta função devolve o resumo já agrupado
--   (paciente, data, profissional, serviço, status → quantidade), bem menor.
--   Roda com as permissões de quem chama (security invoker): o Profissional
--   continua vendo só os atendimentos dele.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatment_appt_summary(p_until date)
returns table(patient text, d date, prof text, svc text, st text, n int)
language sql stable security invoker set search_path = public as $$
  select a.patient, a.date, a.professional_id, coalesce(a.service, 'sessao'), coalesce(a.status, ''), count(*)::int
  from public.appointments a
  where not a.blocked and a.date <= p_until and a.patient <> ''
  group by 1, 2, 3, 4, 5
  order by 2, 1, 3, 4, 5
$$;

grant execute on function public.treatment_appt_summary(date) to authenticated;
revoke execute on function public.treatment_appt_summary(date) from anon;

-- conferência
select count(*) as linhas_no_resumo from public.treatment_appt_summary(current_date + 31);
