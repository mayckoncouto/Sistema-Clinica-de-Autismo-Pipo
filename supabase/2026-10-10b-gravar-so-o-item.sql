-- =====================================================================
-- Agenda Pipo — cadastros em lista gravam só o item alterado (2026-10-10)
--   * patch_list2: troca só os itens alterados/novos e tira os excluídos, numa transação
--     com trava da linha (duas pessoas mexendo em itens diferentes não se apagam mais).
--   * Confere o carimbo _upd {por, em} de cada item alterado: se mudou depois que a pessoa
--     abriu o cadastro (p_expect), ou se o item foi excluído por outra pessoa, recusa com
--     'PIPO_CONFLITO:[...]' e o app pergunta "Salvar assim mesmo" / "Recarregar"
--     (p_force = true grava mesmo assim).
--   * p_order (opcional): ordem dos itens (reordenar salas, status…); itens que a pessoa
--     ainda não via (incluídos por outra pessoa) vão para o fim, nunca se perdem.
--   * Roda com a permissão de quem chama (RLS e documents_enforce continuam valendo).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.patch_list2(
  p_path text, p_upserts jsonb, p_deletes jsonb,
  p_expect jsonb default '{}'::jsonb, p_order jsonb default null, p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
  v_list jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_ord  jsonb := '[]'::jsonb;
  v_del  text[];
  v_seen text[] := '{}';
  v_used text[] := '{}';
  v_conf jsonb := '[]'::jsonb;
  v_cur  jsonb;
  e jsonb;
  u jsonb;
  k text;
begin
  if p_path like 'schedule/%' then
    raise exception 'patch_list2 não vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then v_data := '{}'::jsonb; end if;
  v_list := coalesce(v_data -> 'list', '[]'::jsonb);

  -- Conflitos: item que a pessoa alterou mudou (ou sumiu) depois que ela o abriu.
  if not coalesce(p_force, false) then
    for k in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
      v_cur := null;
      select value into v_cur from jsonb_array_elements(v_list) where value ->> 'id' = k limit 1;
      if v_cur is null then
        select value into u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) where value ->> 'id' = k limit 1;
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k, 'excluido', true,
          'nome', coalesce(u ->> 'nome', u ->> 'name', '')));
      elsif coalesce(v_cur -> '_upd' ->> 'em', '') <> coalesce(p_expect ->> k, '') then
        v_conf := v_conf || jsonb_build_array(jsonb_build_object('id', k,
          'nome', coalesce(v_cur ->> 'nome', v_cur ->> 'name', ''),
          'por', v_cur -> '_upd' ->> 'por', 'em', v_cur -> '_upd' ->> 'em'));
      end if;
    end loop;
    if jsonb_array_length(v_conf) > 0 then
      raise exception 'PIPO_CONFLITO:%', v_conf::text using errcode = 'P0001';
    end if;
  end if;

  select coalesce(array_agg(x), '{}') into v_del
  from jsonb_array_elements_text(coalesce(p_deletes, '[]'::jsonb)) as x;

  -- Mantém a ordem: substitui no lugar os alterados e tira os excluídos.
  for e in select value from jsonb_array_elements(v_list) loop
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

  -- Ordem pedida: primeiro os da lista, na ordem dela; depois os que a pessoa não via.
  if p_order is not null and jsonb_typeof(p_order) = 'array' then
    for k in select value from jsonb_array_elements_text(p_order) loop
      select value into e from jsonb_array_elements(v_out) where value ->> 'id' = k limit 1;
      if found and not (k = any(v_used)) then
        v_ord := v_ord || jsonb_build_array(e);
        v_used := v_used || k;
      end if;
    end loop;
    for e in select value from jsonb_array_elements(v_out) loop
      if not ((e ->> 'id') = any(v_used)) then v_ord := v_ord || jsonb_build_array(e); end if;
    end loop;
    v_out := v_ord;
  end if;

  v_data := jsonb_set(v_data, '{list}', v_out, true);
  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path) do update set data = excluded.data;
  return v_data;
end $$;

grant execute on function public.patch_list2(text, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;
revoke execute on function public.patch_list2(text, jsonb, jsonb, jsonb, jsonb, boolean) from anon;

-- Conferência: deve mostrar 1
select count(*) as funcao_criada from pg_proc where proname = 'patch_list2' and pronamespace = 'public'::regnamespace;
