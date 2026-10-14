-- CRM → Automações: "Revisão da Intervenção ABA Vencendo".
-- Tratamento ativo com data de revisão do ABA (abaRevisao) perto de vencer ou vencida: cria a tarefa de revisar.
create or replace function public.crm_auto_r_aba_revisao(p_force boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('aba_revisao_vencendo'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in select e ->> 'id' as id, e ->> 'patientId' as pid, public.crm_auto_date(e ->> 'abaRevisao') as rev
             from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
            where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
              and public.crm_auto_date(e ->> 'abaRevisao') is not null
              and public.crm_auto_date(e ->> 'abaRevisao') <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('aba_revisao_vencendo', 'abarev|' || t.id || '|' || t.rev,
      'Revisar a Intervenção ABA de ' || coalesce(public.crm_auto_patient(t.pid), 'paciente') || ': ' ||
        case when t.rev < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.rev, 'DD/MM/YYYY'),
      'A revisão da Intervenção ABA ' || case when t.rev < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end ||
        ' (' || to_char(t.rev, 'DD/MM/YYYY') || '). Faça a revisão e atualize a data no tratamento.',
      greatest(t.rev, public.crm_auto_today()), case when t.rev < public.crm_auto_today() then 'alta' else 'normal' end, t.pid, '{}'::jsonb, 'atendimento');
  end loop;
end $$;
revoke execute on function public.crm_auto_r_aba_revisao(boolean) from public, anon, authenticated;

create or replace function public.crm_auto_run(p_force boolean default false)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_start timestamptz := now(); v_fn text; v_n integer;
begin
  foreach v_fn in array array['lead_parado', 'link_segunda', 'trat_vencendo', 'trat_cancelado', 'abaixo_contratado', 'carteirinha',
                              'sem_tratamento', 'pendencias_status', 'contas', 'saldo_baixo', 'mes_sem_fechar', 'conciliacao',
                              'rotinas', 'plano_vencendo', 'tarefa_parada', 'tarefa_atrasada', 'aniversario', 'encaminhamento',
                              'aba_revisao'] loop
    begin
      execute format('select public.crm_auto_r_%s($1)', v_fn) using p_force;
    exception when others then
      raise warning 'crm_auto_run: regra % falhou: %', v_fn, sqlerrm;
    end;
  end loop;
  select count(*) into v_n from public.crm_auto_log where created_at >= v_start;
  return v_n;
end $$;
revoke execute on function public.crm_auto_run(boolean) from public, anon, authenticated;
