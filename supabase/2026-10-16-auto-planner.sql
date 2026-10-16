-- Auto Planner (2026-10-16): grade própria, separada do Planner.
-- Documentos autoplan/<dia>-<semana> (mesmo formato de schedule/*), bloqueios extras em config/autoplan_blocks,
-- módulo de permissão "autoplanner" (nenhum nível recebe: o Administrador libera).

alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|activities|system|planner_blocks|autoplan_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units|contract_templates|block_reasons)|patients/all|treatments/all|(schedule|autoplan)/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.doc_scope(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%' or p_path like 'autoplan/%' then 'unit'
    when p_path in ('patients/all', 'treatments/all', 'config/rooms', 'config/professionals', 'config/clinic', 'config/doctors',
                    'config/schools', 'config/suppliers', 'config/bank_accounts', 'config/task_lists', 'config/crm_automations',
                    'config/planner_blocks', 'config/autoplan_blocks') then 'unit'
    else 'company'
  end;
$function$;

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path like 'autoplan/%'           then 'autoplanner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/diagnoses'        then 'diagnosticos'
    when p_path = 'config/origins'          then 'origens'
    when p_path = 'config/suppliers'        then 'fornecedores'
    when p_path = 'config/supplier_categories' then 'categorias_fornecedor'
    when p_path = 'config/bank_accounts'    then 'contas_bancarias'
    when p_path = 'config/chart_accounts'   then 'plano_contas'
    when p_path = 'config/dre_views'        then 'financeiro'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/activities'       then 'atividades'
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/autoplan_blocks'  then 'autoplanner'
    when p_path = 'config/task_lists'       then 'crmlistas'
    when p_path = 'config/crm_automations'  then 'crmautomacoes'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/block_reasons'    then 'motivos_bloqueio'
    when p_path = 'config/contract_templates' then 'contratos'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

create or replace function public.can_write_path(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from unnest(case when p_path = 'config/rooms' then array['salas', 'grupos']
                              when p_path like 'schedule/%' then array['planner', 'bloqueio_horario']
                              else array[public.module_for_path(p_path)] end) m
    where public.has_perm(m, 'create') or public.has_perm(m, 'edit') or public.has_perm(m, 'delete')
  );
$function$;

create or replace function public.patch_bookings(p_path text, p_changes jsonb)
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
  if p_path not like 'schedule/%' and p_path not like 'autoplan/%' then
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

  if new.path like 'schedule/%' or new.path like 'autoplan/%' then
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
      elsif coalesce((r.o ->> 'blocked')::boolean, false) or coalesce((r.n ->> 'blocked')::boolean, false) then v_need := array_append(v_need, v_module || ':edit');
      elsif r.o is null then v_need := array_append(v_need, v_module || ':create');
      elsif r.n is null then v_need := array_append(v_need, v_module || ':delete');
      else v_need := array_append(v_need, v_module || ':edit');
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

select (select pg_get_constraintdef(oid) like '%autoplan%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       public.module_for_path('autoplan/seg-1') = 'autoplanner' as modulo,
       public.doc_scope('autoplan/seg-1') = 'unit' as unidade,
       (select prosrc like '%autoplan%' from pg_proc where proname = 'documents_enforce') as regra;
