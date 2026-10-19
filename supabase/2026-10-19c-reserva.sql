-- Novo agendamento especial "Reserva" (mesmas regras do Treinamento): o Histórico de Alterações
-- passa a reconhecer o tipo. Só reinstala 3 funções; não mexe em dados.

create or replace function public.chg_bk_empty(v jsonb)
returns boolean language sql immutable set search_path = public as $$
  select v is null or v = 'null'::jsonb or (
    coalesce(v ->> 'patient', '') = ''
    and not coalesce((v ->> 'blocked')::boolean, false)
    and not coalesce((v ->> 'lock')::boolean, false)
    and not coalesce((v ->> 'training')::boolean, false)
    and not coalesce((v ->> 'reserva')::boolean, false));
$$;
create or replace function public.chg_bk_tipo(v jsonb)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce((v ->> 'lock')::boolean, false) then 'horario-bloqueado'
    when coalesce((v ->> 'blocked')::boolean, false) then 'bloqueio'
    when coalesce((v ->> 'training')::boolean, false) or v ->> 'patient' = 'Treinamento' then 'treinamento'
    when coalesce((v ->> 'reserva')::boolean, false) or v ->> 'patient' = 'Reserva' then 'reserva'
    when v ->> 'patient' = 'Reunião Clínica' then 'reuniao'
    else 'atendimento' end;
$$;
create or replace function public.change_log_appt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  noise text[] := array['created_by', 'updated_by', 'created_at', 'updated_at', 'unit_id'];
  o jsonb; n jsonb; r jsonb; v_acao text; v_tipo text;
begin
  if auth.uid() is null or nullif(current_setting('pipo.restore', true), '') is not null
     or nullif(current_setting('pipo.merging', true), '') is not null then
    return null;
  end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old) - noise; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - noise; end if;
  if tg_op = 'UPDATE' and o = n then return null; end if;
  if tg_op = 'INSERT' then v_acao := 'criou';
  elsif tg_op = 'DELETE' then v_acao := 'excluiu';
  elsif (o - 'status') = (n - 'status') then v_acao := 'status';
  else v_acao := 'alterou'; end if;
  r := coalesce(n, o);
  v_tipo := case
    when coalesce((r ->> 'blocked')::boolean, false) then 'bloqueio'
    when r ->> 'patient' = 'Reunião Clínica' then 'reuniao'
    when r ->> 'patient' = 'Treinamento' then 'treinamento'
    when r ->> 'patient' = 'Reserva' then 'reserva'
    when r ->> 'group_id' is not null then 'grupo'
    else 'atendimento' end;
  insert into public.change_log (unit_id, area, user_id, user_name, acao, tipo, paciente, quando, hora, sala_id, prof_id, ref, antes, depois, lote)
  values (coalesce(r ->> 'unit_id', 'unidade-1'), 'agenda', auth.uid(), public.chg_who(), v_acao, v_tipo,
          coalesce(r ->> 'patient', ''), coalesce(r ->> 'date', ''), coalesce(r ->> 'time', ''),
          r ->> 'room_id', r ->> 'professional_id', r ->> 'id', o, n, txid_current()::text);
  return null;
end $$;
