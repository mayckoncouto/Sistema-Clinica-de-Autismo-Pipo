-- Prontuário mais rápido (2026-10-18): o resumo por paciente (registros, último atendimento, profissionais)
-- vem agrupado do banco em vez de o navegador baixar todas as evoluções (eram 9.460 em 10 páginas).
create or replace function public.clinical_records_summary()
returns table (patient_id text, n integer, ultimo text, profs jsonb)
language sql stable security invoker set search_path = public as $$
  select c.patient_id, count(*)::integer, max(coalesce(c.appointment_date::text, left(c.created_at::text, 10))),
         jsonb_agg(distinct jsonb_build_object('professional_id', c.professional_id, 'author_name', c.author_name))
    from public.clinical_records c
   group by c.patient_id;
$$;
grant execute on function public.clinical_records_summary() to authenticated;
revoke execute on function public.clinical_records_summary() from anon, public;
