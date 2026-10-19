-- 2026-10-19e — Atendimentos Especiais (Bloqueado, Reunião Clínica, Treinamento, Reserva): permissão própria de cada tipo
-- (esp_bloqueado, esp_reuniao, esp_treinamento, esp_reserva: incluir/editar/excluir), no Planner (documents) e na Agenda (appointments).
-- Os níveis que já mexiam no Planner/Agenda recebem as mesmas ações nos quatro tipos. Pode rodar mais de uma vez.

create or replace function public.special_mod(p_rec jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_rec is null then null
    when coalesce((p_rec ->> 'blocked')::boolean, false) then 'esp_bloqueado'
    when p_rec ->> 'patient' ilike 'reuni_o cl_nica' then 'esp_reuniao'
    when coalesce((p_rec ->> 'training')::boolean, false) or p_rec ->> 'patient' ilike 'treinamento' then 'esp_treinamento'
    when coalesce((p_rec ->> 'reserva')::boolean, false) or p_rec ->> 'patient' ilike 'reserva' then 'esp_reserva'
    else null end;
$function$;

create or replace function public.appt_perm(p_patient text, p_blocked boolean, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_perm(coalesce(public.special_mod(jsonb_build_object('patient', p_patient, 'blocked', coalesce(p_blocked, false))), 'agenda'), p_action);
$function$;

create or replace function public.can_write_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from unnest(case when p_path = 'config/rooms' then array['salas', 'grupos']
                              when p_path like 'schedule/%' then array['planner', 'bloqueio_horario', 'esp_bloqueado', 'esp_reuniao', 'esp_treinamento', 'esp_reserva']
                              else array[public.module_for_path(p_path)] end) m
    where public.has_perm(m, 'create') or public.has_perm(m, 'edit') or public.has_perm(m, 'delete')
  );
$function$;

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
  v_lock     text := case when public.module_for_path(new.path) = 'autoplanner' then 'autoplanner' else 'bloqueio_horario' end;
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

  if (new.path like 'schedule/%' or new.path like 'autoplan/%') and new.path not like 'autoplan/rascunho-%' then
    for r in
      select k, v_old -> 'bookings' -> k as o, new.data -> 'bookings' -> k as n
      from (select jsonb_object_keys(coalesce(v_old -> 'bookings', '{}'::jsonb)) as k
            union select jsonb_object_keys(coalesce(new.data -> 'bookings', '{}'::jsonb))) keys
    loop
      if r.o is not distinct from r.n then continue;
      -- Bloqueio de horário ({patient:"", lock:true}): permissão própria (no Auto Planner, a dele)
      elsif coalesce((r.o ->> 'lock')::boolean, false) or coalesce((r.n ->> 'lock')::boolean, false) then
        if coalesce((r.o ->> 'lock')::boolean, false) and coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, v_lock || ':edit');
        elsif coalesce((r.n ->> 'lock')::boolean, false) then v_need := array_append(v_need, v_lock || ':create');
        else
          v_need := array_append(v_need, v_lock || ':delete');
          if coalesce(btrim(r.n ->> 'patient'), '') <> '' then v_need := array_append(v_need, v_module || ':create'); end if;
        end if;
      -- Atendimentos especiais (Bloqueado, Reunião Clínica, Treinamento, Reserva): permissão própria de cada tipo (só no Planner)
      elsif v_module = 'planner' and (public.special_mod(r.o) is not null or public.special_mod(r.n) is not null) then
        if r.o is null then v_need := array_append(v_need, public.special_mod(r.n) || ':create');
        elsif r.n is null then v_need := array_append(v_need, public.special_mod(r.o) || ':delete');
        else
          v_need := array_append(v_need, coalesce(public.special_mod(r.o), v_module) || ':edit');
          v_need := array_append(v_need, coalesce(public.special_mod(r.n), v_module) || ':edit');
        end if;
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, v_module || ':edit');
      elsif r.o is null then v_need := array_append(v_need, v_module || ':create');
      elsif r.n is null then v_need := array_append(v_need, v_module || ':delete');
      else v_need := array_append(v_need, v_module || ':edit');
      end if;
    end loop;
  elsif not (coalesce(v_old, '{}'::jsonb) ? 'list') and not (new.data ? 'list') then
    -- documento que não é lista (ex.: cadastro da Clínica, rascunho do Auto Planner): mudou = editar
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

alter policy appointments_insert on public.appointments with check (public.appt_perm(patient, blocked, 'create'));
alter policy appointments_update on public.appointments using (public.appt_perm(patient, blocked, 'edit')) with check (public.appt_perm(patient, blocked, 'edit'));
alter policy appointments_delete on public.appointments using (public.appt_perm(patient, blocked, 'delete'));

-- Níveis: quem tinha incluir/editar/excluir no Planner ou na Agenda ganha o mesmo nos quatro tipos.
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions
     || (select jsonb_object_agg(m, jsonb_build_object(
            'create', coalesce((r.permissions -> 'planner' ->> 'create')::boolean, false) or coalesce((r.permissions -> 'agenda' ->> 'create')::boolean, false),
            'edit',   coalesce((r.permissions -> 'planner' ->> 'edit')::boolean, false)   or coalesce((r.permissions -> 'agenda' ->> 'edit')::boolean, false),
            'delete', coalesce((r.permissions -> 'planner' ->> 'delete')::boolean, false) or coalesce((r.permissions -> 'agenda' ->> 'delete')::boolean, false)))
         from unnest(array['esp_bloqueado','esp_reuniao','esp_treinamento','esp_reserva']) m
         where not (r.permissions ? m))
 where (r.permissions ? 'planner' or r.permissions ? 'agenda') and not (r.permissions ? 'esp_reserva');
alter table public.roles enable trigger roles_guard;

select (select count(*) from public.roles where permissions ? 'esp_reserva') as niveis_com_esp,
       (select count(*) from pg_policies where policyname = 'appointments_insert' and with_check like '%appt_perm%') as politica;
