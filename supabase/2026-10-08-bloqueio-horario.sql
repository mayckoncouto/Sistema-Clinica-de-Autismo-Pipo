-- 2026-10-08 — Planner: Bloqueio de horário.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   1. Nova permissão "Bloqueio de horário" (bloqueio_horario): quem hoje pode bloquear no
--      Planner (Planner → editar) recebe ver/incluir/editar/excluir.
--   2. Novo cadastro config/planner_blocks (Outras opções → Bloquear horário) com a permissão nova.
--   3. Gravar no Planner: quem só tem Bloqueio de horário também pode gravar os dias do Planner,
--      mas só os bloqueios ({patient:"", lock:true}) — o resto continua exigindo Planner.
--   4. Apaga os agendamentos "Bloqueado" antigos do Planner (a Agenda não muda). Na segunda às
--      11:20 fica a marcação vazia (senão a Reunião Clínica padrão voltaria).
-- Pode rodar mais de uma vez.

begin;

-- 1. Permissão nova nos níveis
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions || jsonb_build_object('bloqueio_horario',
         jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true))
 where coalesce((r.permissions -> 'planner' ->> 'edit')::boolean, false)
   and not (r.permissions ? 'bloqueio_horario');
alter table public.roles enable trigger roles_guard;

-- 2. Cadastro dos bloqueios
create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
    when p_path = 'patients/all'            then 'pacientes'
    when p_path = 'treatments/all'          then 'tratamentos'
    when p_path = 'config/specialties'      then 'especialidades'
    when p_path = 'config/convenios'        then 'convenios'
    when p_path = 'config/professionals'    then 'colaboradores'   -- profissional = colaborador
    when p_path = 'config/services'         then 'servicos'
    when p_path = 'config/rooms'            then 'salas'   -- itens com "group": true usam 'grupos'
    when p_path = 'config/statuses'         then 'cadastro_status'
    when p_path = 'config/clinic'           then 'clinica'
    when p_path = 'config/cancel_reasons'   then 'motivos_cancelamento'
    when p_path = 'config/doctors'          then 'medicos'
    when p_path = 'config/schools'          then 'escolas'
    when p_path = 'config/cbo'              then 'cbo'
    when p_path = 'config/councils'         then 'conselhos'
    when p_path = 'config/holidays'         then 'feriados'
    when p_path = 'config/staff_types'      then 'colaboradores'
    when p_path = 'config/patient_fields'   then 'campos_paciente'
    when p_path = 'config/scales'           then 'escalas'
    when p_path = 'config/skill_areas'      then 'habilidades'
    when p_path = 'config/goal_bank'        then 'objetivos'
    when p_path = 'config/planner_blocks'  then 'bloqueio_horario'
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
$function$;

-- 3. Dias do Planner: Planner ou Bloqueio de horário
create or replace function public.can_write_path(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from unnest(case when p_path = 'config/rooms' then array['salas', 'grupos']
                              when p_path like 'schedule/%' then array['planner', 'bloqueio_horario']
                              else array[public.module_for_path(p_path)] end) m
    where public.has_perm(m, 'create') or public.has_perm(m, 'edit') or public.has_perm(m, 'delete')
  );
$$;

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

-- 4. Apaga os "Bloqueado" antigos do Planner
update public.documents d
   set data = jsonb_set(d.data, '{bookings}', coalesce((
     select jsonb_object_agg(b.key,
              case when d.path like 'schedule/seg-%' and split_part(b.key, '|', 1) = '11:20'
                        and (coalesce((b.value ->> 'blocked')::boolean, false)
                             or lower(btrim(coalesce(case when jsonb_typeof(b.value) = 'string' then b.value #>> '{}' else b.value ->> 'patient' end, ''))) = 'bloqueado')
                   then '{"patient": "", "note": ""}'::jsonb else b.value end)
       from jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
      where not (
              (coalesce((case when jsonb_typeof(b.value) = 'object' then b.value ->> 'blocked' end)::boolean, false)
               or lower(btrim(coalesce(case when jsonb_typeof(b.value) = 'string' then b.value #>> '{}' else b.value ->> 'patient' end, ''))) = 'bloqueado')
              and not (d.path like 'schedule/seg-%' and split_part(b.key, '|', 1) = '11:20'))
   ), '{}'::jsonb), true)
 where d.path like 'schedule/%';

commit;

-- Conferência (deve dar: bloqueados_antigos 0; niveis_com_permissao = níveis que editam o Planner):
select
  (select count(*) from public.documents d, jsonb_each(coalesce(d.data -> 'bookings', '{}'::jsonb)) b
    where d.path like 'schedule/%'
      and (coalesce((case when jsonb_typeof(b.value) = 'object' then b.value ->> 'blocked' end)::boolean, false)
           or lower(btrim(coalesce(case when jsonb_typeof(b.value) = 'string' then b.value #>> '{}' else b.value ->> 'patient' end, ''))) = 'bloqueado')) as bloqueados_antigos,
  (select count(*) from public.roles where permissions ? 'bloqueio_horario') as niveis_com_permissao,
  public.module_for_path('config/planner_blocks') as modulo_do_cadastro;
