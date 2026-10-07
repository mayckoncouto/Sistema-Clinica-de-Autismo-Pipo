-- 2026-10-07e — Revisão de nomes e campos, Etapa 4: nomes internos novos.
-- RODE FORA DO HORÁRIO DE ATENDIMENTO, logo depois da publicação do sistema, e faça
-- uma cópia antes (Acesso → Backup → Baixar). Na tela nada muda.
--   1. Permissões dos níveis: "agenda" (Planner) → "planner"; "agendamentos" (Agenda) →
--      "agenda"; "rh_funcionarios" → "colaboradores"; "rh_remuneracao" → "colaboradores_valores".
--      Funções e regras de acesso do banco passam a usar os nomes novos.
--   2. Tratamentos: "pacoteHoras" → "sessoesMes" e "despesas" → "descontos" (também no
--      cadastro dos pacientes e na tabela de valores treatment_finance).
--   3. Cadastro de atendimento dos profissionais: "name" → "nome".
-- Pode rodar mais de uma vez.

begin;

-- 1. Permissões dos níveis (o nível Administrador é travado; o trigger fica desligado só aqui)
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = case
     when r.permissions ? 'planner' then r.permissions - 'agendamentos' - 'rh_funcionarios' - 'rh_remuneracao'
     else (r.permissions - 'agenda' - 'agendamentos' - 'rh_funcionarios' - 'rh_remuneracao')
          || jsonb_build_object('planner', coalesce(r.permissions -> 'agenda', '{}'::jsonb))
          || jsonb_strip_nulls(jsonb_build_object(
               'agenda', r.permissions -> 'agendamentos',
               'colaboradores', r.permissions -> 'rh_funcionarios',
               'colaboradores_valores', r.permissions -> 'rh_remuneracao'))
   end;
alter table public.roles enable trigger roles_guard;

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
    when p_path = 'config/system'           then 'sistema'   -- só o Administrador
  end;
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

create or replace function public.agenda_scope_professional()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.active and not r.is_admin and p.professional_id is not null
         and not coalesce((r.permissions -> 'agenda' ->> 'edit')::boolean, false)
    then p.professional_id
  end
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$function$;

create or replace function public.set_appointment_status(p_id uuid, p_status text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.appointments;
  v_scope text := public.agenda_scope_professional();
begin
  if not public.has_perm('agenda', 'view') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if v_scope is not null and not exists (
    select 1 from public.appointments a where a.id = p_id and a.professional_id = v_scope
  ) then
    raise exception 'Você só pode mudar o status dos seus atendimentos.' using errcode = '42501';
  end if;
  update public.appointments set status = nullif(btrim(coalesce(p_status, '')), '')
  where id = p_id
  returning * into r;
  if not found then
    raise exception 'Atendimento não encontrado (talvez já tenha sido apagado).';
  end if;
  return r;
end;
$function$;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using (public.has_perm('agenda', 'view') and (public.agenda_scope_professional() is null or professional_id = public.agenda_scope_professional()));
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_perm('agenda', 'create'));
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_perm('agenda', 'edit')) with check (public.has_perm('agenda', 'edit'));
drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments for delete to authenticated
  using (public.has_perm('agenda', 'delete'));

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated using (public.has_perm('colaboradores', 'view'));
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated with check (public.has_perm('colaboradores', 'create'));
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated
  using (public.has_perm('colaboradores', 'edit')) with check (public.has_perm('colaboradores', 'edit'));
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated using (public.has_perm('colaboradores', 'delete'));

drop policy if exists staff_pay_select on public.staff_pay;
create policy staff_pay_select on public.staff_pay for select to authenticated using (public.has_perm('colaboradores_valores', 'view'));
drop policy if exists staff_pay_insert on public.staff_pay;
create policy staff_pay_insert on public.staff_pay for insert to authenticated with check (public.has_perm('colaboradores_valores', 'edit'));
drop policy if exists staff_pay_update on public.staff_pay;
create policy staff_pay_update on public.staff_pay for update to authenticated
  using (public.has_perm('colaboradores_valores', 'edit')) with check (public.has_perm('colaboradores_valores', 'edit'));
drop policy if exists staff_pay_delete on public.staff_pay;
create policy staff_pay_delete on public.staff_pay for delete to authenticated
  using (public.has_perm('colaboradores_valores', 'edit') or public.has_perm('colaboradores', 'delete'));

-- 3 (funções antes dos dados). Nome do profissional: lê "nome" (e "name" dos antigos).
create or replace function public.sync_professional_user_names()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.profiles pr
     set full_name = btrim(coalesce(item ->> 'nome', item ->> 'name'))
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) item
   where pr.professional_id = item ->> 'id'
     and coalesce(btrim(coalesce(item ->> 'nome', item ->> 'name')), '') <> ''
     and pr.full_name is distinct from btrim(coalesce(item ->> 'nome', item ->> 'name'));
  return new;
end;
$function$;

create or replace function public.profiles_professional_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  if new.professional_id is not null then
    select btrim(coalesce(item ->> 'nome', item ->> 'name')) into v_name
      from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) item
     where d.path = 'config/professionals' and item ->> 'id' = new.professional_id
     limit 1;
    if coalesce(v_name, '') <> '' then new.full_name := v_name; end if;
  end if;
  return new;
end;
$function$;

-- 2. Tratamentos e pacientes: pacoteHoras → sessoesMes, despesas → descontos
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       (x - 'pacoteHoras' - 'despesas')
       || case when x ? 'pacoteHoras' and not x ? 'sessoesMes' then jsonb_build_object('sessoesMes', x -> 'pacoteHoras') else '{}'::jsonb end
       || case when x ? 'despesas' and not x ? 'descontos' then jsonb_build_object('descontos', x -> 'despesas') else '{}'::jsonb end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(x, o)))
 where d.path in ('treatments/all', 'patients/all');

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treatment_finance' and column_name = 'despesas')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treatment_finance' and column_name = 'descontos') then
    alter table public.treatment_finance rename column despesas to descontos;
  end if;
end $$;

-- 3. Profissionais: name → nome
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when x ? 'name' then (x - 'name') || jsonb_build_object('nome', coalesce(nullif(x ->> 'nome', ''), x ->> 'name')) else x end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(x, o)))
 where d.path = 'config/professionals';

commit;

-- Conferência (deve dar 0 / 0 / 0 / 0 / descontos):
select
  (select count(*) from public.roles where not (permissions ? 'planner') or permissions ?| array['agendamentos','rh_funcionarios','rh_remuneracao']) as niveis_com_nome_antigo,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') x
    where d.path in ('treatments/all', 'patients/all') and x ?| array['pacoteHoras','despesas']) as campos_antigos_tratamento,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') x
    where d.path = 'config/professionals' and x ? 'name') as profissionais_com_name,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') x
    where d.path = 'config/professionals' and coalesce(x ->> 'nome', '') = '') as profissionais_sem_nome,
  (select string_agg(column_name, ', ') from information_schema.columns
    where table_schema = 'public' and table_name = 'treatment_finance' and column_name in ('despesas','descontos')) as coluna_de_descontos;
