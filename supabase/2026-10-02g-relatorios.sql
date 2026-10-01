-- =====================================================================
-- Agenda Pipo — Relatórios (2026-10-02, parte 7)
--
--   * Aba "Relatórios": cada nível de permissão diz quais relatórios pode
--     usar (roles.permissions -> "relatorios" -> {tipo: true, view: true}).
--     Tipos: lista, produtividade, frequencia, convenios, pacote, pendentes,
--     ocupacao, bloqueios, sem-atendimento. Administrador: todos.
--   * Os relatórios leem os atendimentos da Agenda com as regras de sempre
--     (o Profissional só vê os dele — migração 2026-10-02f).
--   * "Evoluções pendentes" precisa saber quais atendimentos já têm
--     evolução sem mostrar o texto do prontuário: função
--     report_appointments_with_records.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "convenios": true, "pacote": true, "pendentes": true, "ocupacao": true, "bloqueios": true, "sem-atendimento": true}}'::jsonb
  where id = 'secretaria' and not (permissions ? 'relatorios');
update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "convenios": true, "pacote": true, "sem-atendimento": true}}'::jsonb
  where id = 'financeiro' and not (permissions ? 'relatorios');
update public.roles set permissions = permissions || '{"relatorios": {"view": true, "lista": true, "produtividade": true, "frequencia": true, "pendentes": true, "bloqueios": true}}'::jsonb
  where id = 'profissional' and not (permissions ? 'relatorios');

create or replace function public.has_report(p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and (r.is_admin or coalesce((r.permissions -> 'relatorios' ->> p_type)::boolean, false))
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

-- Ids dos atendimentos do período que já têm evolução no prontuário.
create or replace function public.report_appointments_with_records(p_from date, p_to date)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_report('pendentes') then
    raise exception 'Sem permissão para este relatório.' using errcode = '42501';
  end if;
  return query
    select distinct cr.appointment_id
    from public.clinical_records cr
    join public.appointments a on a.id = cr.appointment_id
    where a.date between p_from and p_to
      and (v_scope is null or a.professional_id = v_scope);
end;
$$;

revoke all on function public.report_appointments_with_records(date, date) from public, anon;
grant execute on function public.report_appointments_with_records(date, date) to authenticated;

commit;

select id, permissions -> 'relatorios' as relatorios from public.roles order by sort;
