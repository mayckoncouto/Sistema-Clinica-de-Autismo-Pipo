-- =====================================================================
-- Agenda Pipo — motivo do cancelamento dos tratamentos (2026-10-03, Etapa 3)
--
--   * Novo cadastro config/cancel_reasons (Cadastros → Motivos de
--     cancelamento), com permissão própria "motivos_cancelamento" em Níveis
--     de permissão. Os níveis que já existem recebem o mesmo acesso que têm em
--     Tratamentos.
--   * Motivos iniciais: Financeiro, Mudança de cidade, Alta terapêutica,
--     Insatisfação e Outro (Outro exige observação; não pode ser excluído).
--   * O banco passa a garantir:
--       - tratamento Cancelado é definitivo (não volta a outro status);
--       - ao cancelar, o motivo é obrigatório.
--
-- ANTES DE RODAR: baixe uma cópia de segurança (menu Acesso).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Aceitar o caminho config/cancel_reasons.
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

-- 2. Qual permissão governa cada documento (+ motivos de cancelamento).
create or replace function public.module_for_path(p_path text)
returns text language sql immutable as $$
  select case
    when p_path like 'schedule/%'           then 'agenda'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'profissionais'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
  end;
$$;

-- 3. Níveis existentes: mesmo acesso que têm em Tratamentos.
update public.roles set permissions = permissions
  || jsonb_build_object('motivos_cancelamento', coalesce(permissions -> 'tratamentos', '{}'::jsonb))
  where not is_admin and not (permissions ? 'motivos_cancelamento');

-- 4. Motivos iniciais.
insert into public.documents (path, data) values ('config/cancel_reasons', '{"list": [
  {"id": "financeiro",        "name": "Financeiro"},
  {"id": "mudanca-de-cidade", "name": "Mudança de cidade"},
  {"id": "alta-terapeutica",  "name": "Alta terapêutica"},
  {"id": "insatisfacao",      "name": "Insatisfação"},
  {"id": "outro",             "name": "Outro"}
]}'::jsonb)
on conflict (path) do nothing;

-- 5. Cancelado é definitivo e precisa de motivo.
create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  -- Um tratamento que estava Cancelado não pode mudar de status.
  if tg_op = 'UPDATE' then
    select n ->> 'id' into v_bad
    from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
    join jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n on n ->> 'id' = o ->> 'id'
    where o ->> 'status' = 'cancelado' and coalesce(n ->> 'status', '') <> 'cancelado'
    limit 1;
    if v_bad is not null then
      raise exception 'Tratamento cancelado não pode voltar a outro status. Para retomar, crie um novo tratamento.';
    end if;
  end if;
  -- Quem passa a Cancelado (ou nasce Cancelado) precisa de motivo.
  select n ->> 'id' into v_bad
  from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) n
  where n ->> 'status' = 'cancelado'
    and coalesce(n ->> 'motivoCancel', '') = ''
    and (tg_op = 'INSERT' or not exists (
      select 1 from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) o
      where o ->> 'id' = n ->> 'id' and o ->> 'status' = 'cancelado'))
  limit 1;
  if v_bad is not null then
    raise exception 'Informe o motivo do cancelamento do tratamento.';
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_cancel_rules on public.documents;
create trigger treatments_cancel_rules
  before insert or update on public.documents
  for each row execute function public.treatments_cancel_rules();

-- conferência: lista de motivos cadastrados
select jsonb_array_length(data -> 'list') as motivos from public.documents where path = 'config/cancel_reasons';
