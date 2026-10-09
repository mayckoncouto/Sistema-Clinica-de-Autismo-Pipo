-- =====================================================================
-- Agenda Pipo — acerto das migrações que a conferência mostrou como "NÃO" (2026-10-09)
-- Junta SÓ o que faltava de quatro scripts antigos, sem recriar funções que foram
-- atualizadas depois (por isso a 30b não deve ser rodada inteira):
--   1. 2026-09-30b: trava de exclusão de nível (Administrador nunca; nível com usuários não)
--      + nome único / formatos do nível (só se ainda não existem).
--   2. 2026-10-02m: atendimento com evolução só é excluído pelo Administrador.
--   3. 2026-10-03c: um só tratamento Ativo por paciente, conferido no banco.
--   4. 2026-10-08c: "Visão geral" para os níveis que veem a Agenda e ainda não têm o item.
-- Pode rodar de novo sem estragar.
-- =====================================================================

-- 1. Níveis (parte que faltava da 2026-09-30b) --------------------------------
create or replace function public.roles_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if old.is_admin then
    raise exception 'O nível Administrador não pode ser excluído.' using errcode = '42501';
  end if;
  select count(*) into n from public.profiles where role_id = old.id;
  if n > 0 then
    raise exception 'Este nível ainda tem % usuário(s). Mude-os de nível antes de excluir.', n using errcode = '23503';
  end if;
  return old;
end $$;

drop trigger if exists roles_before_delete on public.roles;
create trigger roles_before_delete
  before delete on public.roles
  for each row execute function public.roles_before_delete();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'roles_id_format') then
    alter table public.roles add constraint roles_id_format check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'roles_name_not_blank') then
    alter table public.roles add constraint roles_name_not_blank check (length(btrim(name)) > 0) not valid;
  end if;
  begin
    create unique index if not exists roles_name_unique on public.roles (lower(btrim(name)));
  exception when unique_violation then
    raise notice 'Há dois níveis com o mesmo nome: o índice de nome único ficou de fora.';
  end;
end $$;

-- 2. Atendimento com evolução (2026-10-02m) -----------------------------------
create or replace function public.appointments_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return old; end if;
  if exists (select 1 from public.clinical_records c where c.appointment_id = old.id) then
    raise exception 'Este atendimento tem evolução no prontuário: apague a evolução antes de excluir o atendimento (ou peça ao Administrador).'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists appointments_delete_guard on public.appointments;
create trigger appointments_delete_guard
  before delete on public.appointments
  for each row execute function public.appointments_delete_guard();

-- 3. Um só tratamento Ativo por paciente (2026-10-03c) -------------------------
create or replace function public.treatments_one_active()
returns trigger language plpgsql as $$
declare
  v_dup text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  select x.pid into v_dup
  from (
    select e ->> 'patientId' as pid, count(*) as n
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e
    where e ->> 'status' = 'ativo'
    group by 1
  ) x
  where x.n > 1
  limit 1;
  if v_dup is not null then
    raise exception 'Cada paciente só pode ter um tratamento ativo (paciente %). Recarregue a página e tente de novo.', v_dup;
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_one_active on public.documents;
create trigger treatments_one_active
  before insert or update on public.documents
  for each row execute function public.treatments_one_active();

-- 4. Visão geral para quem vê a Agenda (2026-10-08c) ---------------------------
alter table public.roles disable trigger roles_guard;
update public.roles r
   set permissions = r.permissions || jsonb_build_object('visao_geral', jsonb_build_object('view', true))
 where coalesce((r.permissions -> 'agenda' ->> 'view')::boolean, false)
   and not (r.permissions ? 'visao_geral');
alter table public.roles enable trigger roles_guard;

-- Conferência -----------------------------------------------------------------
select
  (select count(*) from (
     select e ->> 'patientId', count(*)
       from public.documents d, jsonb_array_elements(d.data -> 'list') e
      where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
      group by 1 having count(*) > 1) x)                                        as pacientes_com_2_ativos_deve_ser_0,
  (select count(*) from public.roles
    where coalesce((permissions -> 'agenda' ->> 'view')::boolean, false)
      and not (permissions ? 'visao_geral'))                                    as niveis_pendentes_visao_geral_deve_ser_0,
  (select count(*) from pg_proc where proname in ('roles_before_delete', 'appointments_delete_guard', 'treatments_one_active')
      and pronamespace = 'public'::regnamespace)                                as travas_criadas_deve_ser_3;
