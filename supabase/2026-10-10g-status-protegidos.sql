-- =====================================================================
-- Agenda Pipo — status dos atendimentos protegidos (2026-10-10)
--   * Finalizado, Não compareceu e Falta justificada (as regras dependem deles) não
--     são excluídos nem renomeados; só a cor muda.
--   * Status que está em atendimentos da Agenda não é excluído (troque o status deles
--     antes).
-- Vale para todos os usuários (o SQL Editor/scripts continuam livres).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.statuses_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; v_new jsonb; n int;
begin
  if new.path <> 'config/statuses' or auth.uid() is null then return new; end if;
  for o in select x from jsonb_array_elements(coalesce(case when tg_op = 'UPDATE' then old.data -> 'list' end, '[]'::jsonb)) x loop
    v_new := null;
    select x into v_new from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) x where x ->> 'id' = o ->> 'id' limit 1;
    if o ->> 'id' in ('finalizado', 'nao-compareceu', 'falta-justificada') then
      if v_new is null then
        raise exception 'O status "%" é do sistema e não pode ser excluído.', o ->> 'name' using errcode = '42501';
      end if;
      if coalesce(v_new ->> 'name', '') is distinct from coalesce(o ->> 'name', '') then
        raise exception 'O status "%" é do sistema: só a cor pode mudar.', o ->> 'name' using errcode = '42501';
      end if;
    elsif v_new is null then
      select count(*) into n from public.appointments where status = o ->> 'id';
      if n > 0 then
        raise exception 'O status "%" está em % atendimento(s) da Agenda: troque o status deles antes de excluir.', o ->> 'name', n
          using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists statuses_guard on public.documents;
create trigger statuses_guard
  before update on public.documents
  for each row when (new.path = 'config/statuses')
  execute function public.statuses_guard();

-- Conferência: deve mostrar 1
select count(*) as trava_criada from pg_trigger where tgname = 'statuses_guard';
