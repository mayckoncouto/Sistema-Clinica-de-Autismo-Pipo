-- 2026-10-07 — Acesso → Sistema: regras com chave (Bloquear / Avisar / Desligado).
--   * Documento novo config/system {rules: {regra: "block"|"warn"|"off"}, historico: [...]}.
--     Só o Administrador grava (módulo "sistema", que nenhum nível tem).
--   * public.sys_rule(regra, padrão): modo atual da regra (sem documento = padrão).
--   * As regras que o banco também confere passam a ler a chave e só recusam no modo
--     Bloquear (no Avisar o app pergunta antes de gravar):
--       ag_final_evolucao  — Finalizado exige evolução
--       ag_final_terapeuta — Finalizado travado para o terapeuta
--       tr_cancelado_def   — Cancelado é definitivo
--       tr_cancel_motivo   — Cancelar exige motivo
--   * Um só tratamento Ativo e "atendimento com evolução não é apagado" continuam
--     sempre valendo (evitam dados duplicados ou inconsistentes).
-- Pode rodar mais de uma vez.

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'rh_funcionarios'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'rh_funcionarios'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$$;

insert into public.documents (path, data) values ('config/system', '{"rules": {}, "historico": []}'::jsonb)
on conflict (path) do nothing;

create or replace function public.sys_rule(p_id text, p_default text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select d.data -> 'rules' ->> p_id from public.documents d where d.path = 'config/system'), p_default);
$$;
grant execute on function public.sys_rule(text, text) to authenticated;

create or replace function public.appointments_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- SQL Editor / scripts
  if tg_op = 'INSERT' then
    if new.status is not null and not public.can_set_status(new.status) then
      raise exception 'Seu nível não pode usar o status "%".', new.status using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if not (public.can_set_status(old.status) and public.can_set_status(new.status)) then
      raise exception 'Seu nível não pode trocar este status.' using errcode = '42501';
    end if;
    if old.status = 'finalizado' and not public.is_admin()
       and public.sys_rule('ag_final_terapeuta', 'block') = 'block'
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.professional_id is not null) then
      raise exception 'Atendimento finalizado: o terapeuta não altera o status. A evolução é editada no Prontuário.' using errcode = '42501';
    end if;
    if new.status = 'finalizado'
       and public.sys_rule('ag_final_evolucao', 'block') = 'block'
       and exists (
         select 1 from public.documents d, jsonb_array_elements(d.data -> 'list') p
         where d.path = 'patients/all' and lower(btrim(p ->> 'nome')) = lower(btrim(new.patient))
       )
       and not exists (select 1 from public.clinical_records c where c.appointment_id = new.id)
    then
      raise exception 'Para finalizar, registre a evolução deste atendimento no prontuário.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status (regra tr_cancelado_def).
  if tg_op = 'UPDATE' and public.sys_rule('tr_cancelado_def', 'block') = 'block' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo (regra tr_cancel_motivo) —
  -- a não ser que tenha vindo da importação de planilha com o motivo pendente.
  if public.sys_rule('tr_cancel_motivo', 'block') = 'block' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
    where n ->> 'status' = 'cancelado'
      and coalesce(n ->> 'motivoCancel', '') = ''
      and coalesce(n ->> 'motivoPendente', '') <> 'true'
      and (tg_op = 'INSERT' or not exists (
        select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
        where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
    limit 1;
    if v_bad is not null then
      raise exception 'Informe o motivo do cancelamento do tratamento.';
    end if;
  end if;
  return new;
end;
$$;
