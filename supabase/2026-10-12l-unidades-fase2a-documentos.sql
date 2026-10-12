-- Unidades — Fase 2A: documentos por unidade (2026-10-12)
-- Cada documento do sistema passa a ter a unidade a que pertence (`documents.unit_id`):
--   • 'empresa'  = cadastros únicos da empresa (convênios, diagnósticos, plano de contas, níveis…), iguais em todas as unidades;
--   • uma unidade = dados da unidade (pacientes, tratamentos, Planner, salas, colaboradores, clínica, fornecedores, contas bancárias,
--     médicos, escolas, listas do CRM…). Os que já existem ficam na 'unidade-1'.
-- `active_unit()` diz qual unidade a pessoa está usando: a dela (profiles.unit_id) ou, para a Gestão, a escolhida no login/topo,
-- guardada no token (user_metadata.active_unit). Uma regra RESTRITIVA em `documents` deixa passar só 'empresa' + a unidade ativa;
-- um gatilho carimba a unidade em todo documento novo (a pessoa nunca escolhe). Nada muda para quem usa só a Unidade 1.
-- A chave antiga (path) continua até a segunda unidade começar a ser usada; já existe a chave nova (path, unit_id).
-- Pode rodar de novo.

-- 1. Coluna e índice
alter table public.documents add column if not exists unit_id text not null default 'unidade-1';

-- 2. O que é da empresa e o que é da unidade (por caminho)
create or replace function public.doc_scope(p_path text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_path like 'schedule/%' then 'unit'
    when p_path in ('patients/all', 'treatments/all', 'config/rooms', 'config/professionals', 'config/clinic', 'config/doctors',
                    'config/schools', 'config/suppliers', 'config/bank_accounts', 'config/task_lists', 'config/crm_automations',
                    'config/planner_blocks') then 'unit'
    else 'company'
  end;
$$;

update public.documents set unit_id = 'empresa' where public.doc_scope(path) = 'company' and unit_id <> 'empresa';

create unique index if not exists documents_path_unit_key on public.documents (path, unit_id);

-- 3. Unidade ativa da sessão
--   • sem usuário (cron, link público, restauração): a unidade posta em `pipo.unit` (set_config) ou a Unidade 1;
--   • Gestão: a escolhida (token), se existir; • os demais: a do próprio perfil (nunca vale o que vem no token).
create or replace function public.active_unit()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if auth.uid() is null then
    return coalesce(nullif(current_setting('pipo.unit', true), ''), 'unidade-1');
  end if;
  if public.is_manager() then
    v := nullif(auth.jwt() -> 'user_metadata' ->> 'active_unit', '');
    if v is not null and public.unit_exists(v) then return v; end if;
  end if;
  return coalesce(public.my_unit(), 'unidade-1');
end $$;

-- 4. Carimbo da unidade nos documentos (roda antes dos outros gatilhos: nome com "0")
create or replace function public.documents_unit_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.unit_id := old.unit_id;
  elsif public.doc_scope(new.path) = 'company' then
    new.unit_id := 'empresa';
  elsif auth.uid() is not null then
    new.unit_id := public.active_unit();
  elsif nullif(current_setting('pipo.unit', true), '') is not null then
    new.unit_id := current_setting('pipo.unit', true);
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'documents_0_unit_stamp' and not tgisinternal) then
    create trigger documents_0_unit_stamp
      before insert or update on public.documents
      for each row execute function public.documents_unit_stamp();
  end if;
end $$;

-- 5. Regra restritiva: só 'empresa' + a unidade ativa (soma-se às regras de permissão que já existem)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_unit') then
    create policy documents_unit on public.documents as restrictive for all to authenticated
      using (unit_id = 'empresa' or unit_id = (select public.active_unit()))
      with check (unit_id = 'empresa' or unit_id = (select public.active_unit()));
  end if;
end $$;

-- 6. Funções que gravam documentos passam a usar a chave (path, unit_id)
CREATE OR REPLACE FUNCTION public.patch_bookings(p_path text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_data jsonb;
  v_bookings jsonb;
  k text;
  v jsonb;
begin
  if p_path not like 'schedule/%' then
    raise exception 'patch_bookings só vale para documentos da agenda';
  end if;

  select data into v_data from public.documents where path = p_path for update;
  if not found then
    v_data := '{}'::jsonb;
  end if;

  v_bookings := coalesce(v_data -> 'bookings', '{}'::jsonb);
  for k, v in select * from jsonb_each(coalesce(p_changes, '{}'::jsonb)) loop
    if v is null or v = 'null'::jsonb then
      v_bookings := v_bookings - k;
    else
      v_bookings := v_bookings || jsonb_build_object(k, v);
    end if;
  end loop;
  v_data := jsonb_set(v_data, '{bookings}', v_bookings, true);

  insert into public.documents (path, data) values (p_path, v_data)
  on conflict (path, unit_id) do update set data = excluded.data;

  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.patch_list(p_path text, p_upserts jsonb, p_deletes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  on conflict (path, unit_id) do update set data = excluded.data;
  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.patch_list2(p_path text, p_upserts jsonb, p_deletes jsonb, p_expect jsonb DEFAULT '{}'::jsonb, p_order jsonb DEFAULT NULL::jsonb, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  on conflict (path, unit_id) do update set data = excluded.data;
  return v_data;
end $function$;

CREATE OR REPLACE FUNCTION public.documents_enforce()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_module   text := public.module_for_path(new.path);
  v_old      jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
  v_need     text[] := '{}';  -- 'modulo:acao' exigidos
  v_old_ids  text[];
  v_new_ids  text[];
  v_mod      text;
  v_item     jsonb;
  v_x        text;
  r record;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();

  -- Sem usuário logado = SQL Editor ou service role (migração, scripts).
  if auth.uid() is null then return new; end if;
  if public.is_admin() then return new; end if;

  -- Num upsert, o BEFORE INSERT dispara mesmo com o documento existente;
  -- quem confere é o BEFORE UPDATE que vem em seguida.
  if tg_op = 'INSERT' and exists (select 1 from public.documents where path = new.path and unit_id = new.unit_id) then
    return new;
  end if;

  if v_module = 'planner' then
    for r in
      select k, v_old -> 'bookings' -> k as o, new.data -> 'bookings' -> k as n
      from (select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
            union select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))) keys
    loop
      if r.o is not distinct from r.n then continue;
      -- Bloqueio de horário ({patient:"", lock:true}): permissão própria
      elsif coalesce((r.o ->> 'lock')::boolean, false) or coalesce((r.n ->> 'lock')::boolean, false) then
        if coalesce((r.o ->> 'lock')::boolean, false) and coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, 'bloqueio_horario:edit');
        elsif coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, 'bloqueio_horario:create');
        else
          v_need := array_append(v_need, 'bloqueio_horario:delete');
          if coalesce(btrim(r.n ->> 'patient'), '') <> '' then v_need := array_append(v_need, 'planner:create'); end if;
        end if;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, 'planner:edit');
      elsif r.o is null then v_need := array_append(v_need, 'planner:create');
      elsif r.n is null then v_need := array_append(v_need, 'planner:delete');
      else v_need := array_append(v_need, 'planner:edit');
      end if;
    end loop;
  elsif not (coalesce(v_old, '{}'::jsonb) ? 'list') and not (new.data ? 'list') then
    -- documento que não é lista (ex.: cadastro da Clínica): mudou = editar
    if v_old is distinct from new.data then v_need := array_append(v_need, v_module || ':edit'); end if;
  else
    for r in
      select o.e as o, n.e as n
      from (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) e) o
      full join
           (select e, e ->> 'id' as id from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e) n
        on o.id = n.id
    loop
      if r.o is not distinct from r.n then continue; end if;
      v_item := coalesce(r.n, r.o);
      v_mod := case when new.path = 'config/rooms' and coalesce((v_item ->> 'group')::boolean, false) then 'grupos' else v_module end;
      if r.o is null then v_need := array_append(v_need, v_mod || ':create');
      elsif r.n is null then v_need := array_append(v_need, v_mod || ':delete');
      else v_need := array_append(v_need, v_mod || ':edit');
      end if;
    end loop;

    -- mesma lista em outra ordem (ex.: reordenar salas) = editar
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_old_ids
      from jsonb_array_elements(coalesce(v_old -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);
    select coalesce(array_agg(e ->> 'id' order by ord), '{}') into v_new_ids
      from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) with ordinality as t(e, ord);
    if (select array_agg(x order by i) from unnest(v_old_ids) with ordinality u(x, i) where x = any(v_new_ids))
       is distinct from
       (select array_agg(x order by i) from unnest(v_new_ids) with ordinality u(x, i) where x = any(v_old_ids))
    then
      if new.path = 'config/rooms' then
        if not (public.has_perm('salas', 'edit') or public.has_perm('grupos', 'edit')) then
          raise exception 'Sem permissão para editar em salas' using errcode = '42501';
        end if;
      else
        v_need := array_append(v_need, v_module || ':edit');
      end if;
    end if;
  end if;

  foreach v_x in array v_need loop
    if not public.has_perm(split_part(v_x, ':', 1), split_part(v_x, ':', 2)) then
      raise exception 'Sem permissão para % em %',
        case split_part(v_x, ':', 2) when 'create' then 'incluir' when 'edit' then 'editar' else 'excluir' end,
        split_part(v_x, ':', 1) using errcode = '42501';
    end if;
  end loop;

  return new;
end $function$;

-- Conferência: coluna | índice | regra | documentos da empresa | documentos da Unidade 1 | função
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'unit_id') as coluna,
       to_regclass('public.documents_path_unit_key') is not null as indice,
       exists (select 1 from pg_policies where tablename = 'documents' and policyname = 'documents_unit') as regra,
       (select count(*) from public.documents where unit_id = 'empresa') as da_empresa,
       (select count(*) from public.documents where unit_id = 'unidade-1') as da_unidade_1,
       public.active_unit() as unidade_ativa_sem_login;
