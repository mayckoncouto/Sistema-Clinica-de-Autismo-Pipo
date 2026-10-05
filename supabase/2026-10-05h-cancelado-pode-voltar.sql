-- =====================================================================
-- Agenda Pipo — tratamento cancelado pode voltar a outro status (2026-10-05)
--
--   Pedido do usuário: tira a regra "tratamento Cancelado não pode mudar de
--   status". Continua valendo: passar a Cancelado (ou nascer Cancelado) exige
--   o motivo do cancelamento. A regra "só um Ativo por paciente" (trigger
--   treatments_one_active) não muda.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatments_cancel_rules()
returns trigger language plpgsql as $$
declare
  v_bad text;
begin
  if new.path <> 'treatments/all' then return new; end if;
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
