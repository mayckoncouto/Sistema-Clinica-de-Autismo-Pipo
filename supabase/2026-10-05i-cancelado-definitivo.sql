-- =====================================================================
-- Agenda Pipo — volta a regra "tratamento Cancelado é definitivo" (2026-10-05)
--
--   Desfaz a migração 2026-10-05h-cancelado-pode-voltar.sql: o banco volta a
--   recusar que um tratamento Cancelado mude de status, e cancelar continua
--   exigindo o motivo. Só precisa rodar se a 2026-10-05h foi rodada (rodar de
--   novo não estraga nada).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- =====================================================================

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
