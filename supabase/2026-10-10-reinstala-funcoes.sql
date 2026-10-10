-- =====================================================================
-- Agenda Pipo — reinstala 11 funções na versão atual (2026-10-10)
-- A conferência geral mostrou estas funções com conteúdo diferente do sistema atual
-- (algum script antigo rodado depois de um mais novo). Este script só troca o texto
-- das funções pela versão de supabase/schema.sql; não mexe em dados, tabelas nem
-- gatilhos. Pode rodar de novo sem estragar.
-- =====================================================================

-- appointments_stamp
create or replace function public.appointments_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém o que veio, completando o que faltar.
    if tg_op = 'UPDATE' then
      new.id := old.id;
      new.created_by := coalesce(new.created_by, old.created_by);
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

-- clinical_records_stamp
create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- Restauração / scripts: mantém autor e datas da cópia.
    if tg_op = 'UPDATE' then
      new.created_at := coalesce(new.created_at, old.created_at);
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
    new.updated_at := now();
  elsif coalesce(current_setting('pipo.merging', true), '') = '1' then
    -- Mesclar cadastros: muda só o paciente; autor, conteúdo e datas ficam.
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := old.created_at;
    new.updated_at := old.updated_at;
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- convenio_finance_stamp
create or replace function public.convenio_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := new.convenio_id || '|' || new.spec_id;
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- documents_enforce
create or replace function public.documents_enforce()
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
  if tg_op = 'INSERT' and exists (select 1 from public.documents where path = new.path) then
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

-- handle_new_user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles) then
    v_role := (select id from public.roles where is_admin order by sort limit 1);
  else
    select id into v_role from public.roles
      where id = new.raw_user_meta_data ->> 'role_id' and not is_admin;
    if v_role is null then
      select id into v_role from public.roles where id = 'profissional';
    end if;
    if v_role is null then
      select id into v_role from public.roles where not is_admin order by sort limit 1;
    end if;
    if v_role is null then
      raise exception 'Crie um nível de permissão antes de cadastrar usuários.';
    end if;
  end if;
  insert into public.profiles (id, email, full_name, role_id)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- patch_list
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

-- patient_health_stamp
create or replace function public.patient_health_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- profiles_nonadmin_guard
create or replace function public.profiles_nonadmin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_admin boolean;
  v_new_admin boolean;
begin
  if auth.uid() is null or public.is_admin() then
    return new;   -- Administrador, service role (API) e scripts
  end if;
  select is_admin into v_old_admin from public.roles where id = old.role_id;
  select is_admin into v_new_admin from public.roles where id = new.role_id;
  if coalesce(v_old_admin, false) then
    raise exception 'Só o Administrador altera uma conta de administrador.';
  end if;
  if coalesce(v_new_admin, false) then
    raise exception 'Só o Administrador dá o nível Administrador.';
  end if;
  if new.id = auth.uid() and new.role_id is distinct from old.role_id then
    raise exception 'Você não pode mudar o seu próprio nível.';
  end if;
  return new;
end $$;

-- roles_guard
create or replace function public.roles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_admin then
    return old;
  end if;
  new.id := old.id;
  new.is_admin := false;
  new.sort := old.sort;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;

-- therapy_plans_stamp
create or replace function public.therapy_plans_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then          -- restauração / scripts: mantém o que veio
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), email, '') into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce(v_name, '');
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce(v_name, '');
  new.updated_at := now();
  return new;
end $$;

-- treatment_finance_stamp
create or replace function public.treatment_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
