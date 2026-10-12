-- Unidades (nível de organização) — Fase 1 (2026-10-12)
-- Cadastro de Unidades, nível Gestão, vínculo usuário↔unidade e lista de unidades da tela de login.
-- Nada muda para quem usa hoje: tudo vira "Unidade 1" e o Administrador atual passa a ser Gestão.
--   config/units  Cadastros → Unidades (só a Gestão)  {list:[{id, name, fantasia, cnpj, telefone, email, endereco, cidade, inativo}]}
--   roles.is_manager   nível Gestão (acesso total a todas as unidades; Administrador = total só na própria unidade)
--   profiles.unit_id   unidade do usuário (id do item de config/units)
-- Pode rodar de novo.

-- 1. Caminho permitido e módulo do caminho
alter table public.documents drop constraint if exists documents_path_valid;
alter table public.documents add constraint documents_path_valid check (
  path ~ '^(config/(rooms|specialties|convenios|professionals|services|statuses|clinic|cancel_reasons|doctors|schools|cbo|councils|holidays|staff_types|patient_fields|scales|skill_areas|goal_bank|system|planner_blocks|task_lists|diagnoses|origins|suppliers|supplier_categories|bank_accounts|chart_accounts|dre_views|crm_automations|units)|patients/all|treatments/all|schedule/(seg|ter|qua|qui|sex|sab|dom)-[1-4])$'
);

create or replace function public.module_for_path(p_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_path like 'schedule/%'           then 'planner'
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
    when p_path = 'config/planner_blocks'   then 'bloqueio_horario'
    when p_path = 'config/task_lists'       then 'crm_listas'
    when p_path = 'config/crm_automations'  then 'crm_listas'
    when p_path = 'config/system'           then 'sistema'
    when p_path = 'config/units'            then 'unidades'   -- nenhum nível tem: só a Gestão grava
  end;
$function$;

-- 2. Coluna do nível Gestão e unidade do usuário
alter table public.roles add column if not exists is_manager boolean not null default false;
alter table public.profiles add column if not exists unit_id text not null default 'unidade-1';

-- 3. Nível Gestão (administrador total + todas as unidades; travado como o Administrador)
alter table public.roles disable trigger roles_before_insert;
insert into public.roles (id, name, is_admin, is_manager, sort, permissions)
values ('gestao', 'Gestão', true, true, 0, '{}'::jsonb)
on conflict (id) do nothing;
alter table public.roles enable trigger roles_before_insert;

-- 4. Unidade 1 com os dados da clínica de hoje
insert into public.documents (path, data)
select 'config/units',
       jsonb_build_object('list', jsonb_build_array(jsonb_build_object(
         'id', 'unidade-1', 'name', 'Unidade 1',
         'fantasia', coalesce(c.data ->> 'nome', ''), 'cnpj', coalesce(c.data ->> 'cnpj', ''),
         'telefone', coalesce(c.data ->> 'telefone', ''), 'email', coalesce(c.data ->> 'email', ''),
         'endereco', coalesce(c.data ->> 'endereco', ''), 'cidade', coalesce(c.data ->> 'cidade', ''))))
  from (select 1) x
  left join public.documents c on c.path = 'config/clinic'
on conflict (path) do nothing;

-- 5. Funções
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.active and r.is_manager
    from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.my_unit()
returns text language sql stable security definer set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid();
$$;

-- A unidade existe no cadastro? (sem cadastro ainda = aceita)
create or replace function public.unit_exists(p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.documents where path = 'config/units') then true
    else exists (
      select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) i
      where d.path = 'config/units' and i ->> 'id' = p_unit)
  end;
$$;

-- Lista de unidades da tela de login (antes de entrar): só id e nome, só as ativas.
create or replace function public.login_units()
returns table (id text, name text) language sql stable security definer set search_path = public as $$
  select i ->> 'id', coalesce(nullif(btrim(i ->> 'name'), ''), i ->> 'id')
    from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as t(i, n)
   where d.path = 'config/units'
     and coalesce(i ->> 'inativo', 'false') <> 'true'
   order by n;
$$;
revoke all on function public.login_units() from public;
grant execute on function public.login_units() to anon, authenticated;

-- 6. Só a Gestão altera o cadastro de unidades; a Unidade 1 e unidade com usuários não saem
create or replace function public.units_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if auth.uid() is null then return new; end if;
  if not public.is_manager() then
    raise exception 'Só a Gestão altera as unidades.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    for r in
      select i ->> 'id' as id
        from jsonb_array_elements(coalesce(old.data -> 'list', '[]'::jsonb)) i
       where not exists (
         select 1 from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) j where j ->> 'id' = i ->> 'id')
    loop
      if r.id = 'unidade-1' then
        raise exception 'A Unidade 1 não pode ser excluída.' using errcode = '42501';
      end if;
      if exists (select 1 from public.profiles where unit_id = r.id) then
        raise exception 'Esta unidade ainda tem usuários. Mude-os de unidade antes de excluir.' using errcode = '23503';
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists documents_a_units_guard on public.documents;
create trigger documents_a_units_guard
  before insert or update on public.documents
  for each row when (new.path = 'config/units')
  execute function public.units_guard();

-- 7. Usuários: unidade existente; Administrador só mexe na própria unidade e não dá nível de Gestão/Administrador
create or replace function public.profiles_unit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_mgr boolean := false;
  v_new_mgr boolean;
  v_old_adm boolean := false;
  v_new_adm boolean;
begin
  if tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id then
    if not public.unit_exists(new.unit_id) then
      raise exception 'Unidade não encontrada.' using errcode = '23503';
    end if;
  end if;
  if auth.uid() is null or public.is_manager() then
    return new;   -- Gestão, service role (API) e scripts
  end if;
  select coalesce(is_manager, false), coalesce(is_admin, false) into v_new_mgr, v_new_adm from public.roles where id = new.role_id;
  if tg_op = 'UPDATE' then
    select coalesce(is_manager, false), coalesce(is_admin, false) into v_old_mgr, v_old_adm from public.roles where id = old.role_id;
    if new.unit_id is distinct from old.unit_id then
      raise exception 'Só a Gestão muda o usuário de unidade.' using errcode = '42501';
    end if;
    if old.unit_id is distinct from public.my_unit() then
      raise exception 'Este usuário é de outra unidade.' using errcode = '42501';
    end if;
    if v_old_mgr then
      raise exception 'Só a Gestão altera uma conta de Gestão.' using errcode = '42501';
    end if;
    if v_old_adm and old.id <> auth.uid() then
      raise exception 'Só a Gestão altera uma conta de Administrador.' using errcode = '42501';
    end if;
    if new.role_id is distinct from old.role_id and (v_new_mgr or v_new_adm) then
      raise exception 'Só a Gestão dá o nível Administrador ou Gestão.' using errcode = '42501';
    end if;
  else
    if v_new_mgr or v_new_adm then
      raise exception 'Só a Gestão cria usuários Administrador ou Gestão.' using errcode = '42501';
    end if;
    if new.unit_id is distinct from public.my_unit() then
      raise exception 'Só a Gestão cria usuários em outra unidade.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_unit_guard on public.profiles;
create trigger profiles_unit_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_unit_guard();

-- 8. Quem lê e edita usuários: a Gestão vê todos; os demais, só a própria unidade (e a si mesmos)
alter policy profiles_select on public.profiles
  using (id = (select auth.uid()) or public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'view')) and unit_id = public.my_unit()));
alter policy profiles_update on public.profiles
  using (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.my_unit()))
  with check (public.is_manager()
         or ((public.is_admin() or public.has_perm('usuarios', 'edit')) and unit_id = public.my_unit()));

-- 9. O Administrador mais antigo passa a ser Gestão (só se ainda não houver nenhuma Gestão ativa)
update public.profiles
   set role_id = 'gestao'
 where id = (select p.id from public.profiles p join public.roles r on r.id = p.role_id
              where r.is_admin and not r.is_manager and p.active order by p.created_at limit 1)
   and not exists (select 1 from public.profiles p2 join public.roles r2 on r2.id = p2.role_id where r2.is_manager);

-- Conferência: caminho aceito | nível Gestão | unidades cadastradas | usuários sem unidade válida | gestores
select (select pg_get_constraintdef(oid) like '%units%' from pg_constraint where conname = 'documents_path_valid') as caminho_aceito,
       exists (select 1 from public.roles where id = 'gestao' and is_manager and is_admin) as nivel_gestao,
       (select jsonb_array_length(data -> 'list') from public.documents where path = 'config/units') as unidades,
       (select count(*) from public.profiles where not public.unit_exists(unit_id)) as usuarios_sem_unidade,
       (select count(*) from public.profiles p join public.roles r on r.id = p.role_id where r.is_manager) as gestores;
