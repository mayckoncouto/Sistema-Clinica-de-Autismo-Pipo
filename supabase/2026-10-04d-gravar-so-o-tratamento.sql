-- =====================================================================
-- Agenda Pipo — gravar só o tratamento alterado (Etapa 7, 2026-10-04)
--
--   Antes, salvar um tratamento regravava a lista inteira (treatments/all):
--   duas pessoas salvando tratamentos diferentes ao mesmo tempo podiam apagar
--   a alteração uma da outra. A função patch_list aplica só os itens
--   alterados/novos e tira os excluídos, numa transação com trava de linha
--   (igual ao patch_bookings da agenda). Roda com as permissões de quem chama
--   (security invoker): as regras de sempre continuam valendo (documents_enforce,
--   um só tratamento ativo, regras do cancelamento).
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.patch_list(p_path text, p_upserts jsonb, p_deletes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_del  text[];
  v_seen text[] := '{}';
  e jsonb;
  u jsonb;
begin
  if p_path like 'schedule/%' then
    raise exception 'patch_list não vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then v_data := '{}'::jsonb; end if;

  select coalesce(array_agg(x), '{}') into v_del
  from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)) as x;

  -- Mantém a ordem: substitui no lugar os alterados e tira os excluídos.
  for e in select value from jsonb_array_elements(coalesce(v_data -> 'list', '[]'::jsonb)) loop
    if (e ->> 'id') = any(v_del) then continue; end if;
    u := null;
    select value into u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb))
      where value ->> 'id' = e ->> 'id' limit 1;
    if u is not null then
      v_out := v_out || jsonb_build_array(u);
      v_seen := v_seen || (e ->> 'id');
    else
      v_out := v_out || jsonb_build_array(e);
    end if;
  end loop;
  -- Novos vão para o fim.
  for u in select value from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    if not ((u ->> 'id') = any(v_seen)) then v_out := v_out || jsonb_build_array(u); end if;
  end loop;

  v_data := jsonb_set(v_data, '{list}', v_out, true);
  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path) do update set data = excluded.data;
  return v_data;
end $$;

grant execute on function public.patch_list(text, jsonb, jsonb) to authenticated;
revoke execute on function public.patch_list(text, jsonb, jsonb) from anon;

-- conferência
select 'patch_list criada' as ok;
