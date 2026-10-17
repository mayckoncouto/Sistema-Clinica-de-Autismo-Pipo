-- Anamneses preenchidas por paciente (2026-10-18)
--   Prontuário ▾ → Anamneses. Cada linha = uma anamnese de um paciente, preenchida a partir de um Tipo de Anamnese.
--   Dados de saúde: tabela protegida. Permissão POR TIPO: has_perm('anm_' || type_id, ver/incluir/editar/excluir)
--   (Níveis de Permissão mostra uma linha por tipo; só o Administrador tem acesso até liberar).
--   perguntas = cópia do modelo no momento em que a anamnese foi criada (mudar o modelo depois não altera a anamnese).
--   status: rascunho (edita) | concluida (travada; só o Administrador reabre). versao/prev_id: "Reavaliar" cria a próxima a partir da anterior.
-- Pode rodar de novo.

create table if not exists public.anamneses (
  id              uuid primary key default gen_random_uuid(),
  patient_id      text not null,
  patient_name    text,
  type_id         text not null,
  type_name       text,
  type_version    integer not null default 1,
  perguntas       jsonb not null default '[]'::jsonb,
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'rascunho' check (status in ('rascunho', 'concluida')),
  data            date not null default current_date,
  versao          integer not null default 1,
  prev_id         uuid,
  done_at         timestamptz,
  done_by_name    text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_by_name text,
  unit_id         text not null default 'unidade-1'
);
create index if not exists anamneses_patient_idx on public.anamneses (patient_id, data desc);
create index if not exists anamneses_type_idx on public.anamneses (type_id);
alter table public.anamneses enable row level security;
grant select, insert, update, delete on public.anamneses to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamneses' and policyname = 'anamneses_select') then
    create policy anamneses_select on public.anamneses for select to authenticated using (public.has_perm('anm_' || type_id, 'view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamneses' and policyname = 'anamneses_insert') then
    create policy anamneses_insert on public.anamneses for insert to authenticated with check (public.has_perm('anm_' || type_id, 'create'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamneses' and policyname = 'anamneses_update') then
    create policy anamneses_update on public.anamneses for update to authenticated
      using (public.has_perm('anm_' || type_id, 'edit')) with check (public.has_perm('anm_' || type_id, 'edit'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamneses' and policyname = 'anamneses_delete') then
    create policy anamneses_delete on public.anamneses for delete to authenticated using (public.has_perm('anm_' || type_id, 'delete'));
  end if;
end $$;

-- Carimbos (quem criou / alterou / concluiu) e travas
create or replace function public.anamneses_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid(); new.created_by_name := public.crm_my_name();
    new.status := 'rascunho'; new.done_at := null; new.done_by_name := null;
  else
    -- anamnese concluída fica travada; só o Administrador reabre (volta a rascunho)
    if old.status = 'concluida' and not (public.is_admin() and new.status = 'rascunho') then
      raise exception 'PIPO_ANAMNESE_CONCLUIDA: anamnese concluída não pode ser alterada';
    end if;
    new.created_at := old.created_at; new.created_by := old.created_by; new.created_by_name := old.created_by_name;
    new.patient_id := old.patient_id; new.type_id := old.type_id; new.perguntas := old.perguntas;
    new.prev_id := old.prev_id; new.versao := old.versao;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid(); new.updated_by_name := public.crm_my_name();
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') then
    new.done_at := now(); new.done_by_name := public.crm_my_name();
  elsif new.status = 'rascunho' then
    new.done_at := null; new.done_by_name := null;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'anamneses_stamp' and not tgisinternal) then
    create trigger anamneses_stamp before insert or update on public.anamneses
      for each row execute function public.anamneses_stamp();
  end if;
end $$;

-- Excluir: rascunho (com permissão de excluir do tipo) ou, se concluída, só o Administrador
create or replace function public.anamneses_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.status = 'concluida' and not public.is_admin() then
    raise exception 'PIPO_ANAMNESE_CONCLUIDA: anamnese concluída só pode ser excluída pelo Administrador';
  end if;
  return old;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'anamneses_delete_guard' and not tgisinternal) then
    create trigger anamneses_delete_guard before delete on public.anamneses
      for each row execute function public.anamneses_delete_guard();
  end if;
  -- Unidade (mesma regra das outras tabelas)
  if not exists (select 1 from pg_trigger where tgname = 'anamneses_0_unit_stamp' and not tgisinternal) then
    create trigger anamneses_0_unit_stamp before insert or update on public.anamneses
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamneses' and policyname = 'anamneses_unit') then
    create policy anamneses_unit on public.anamneses as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.anamneses;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: tabela | RLS | políticas (4 + unidade) | gatilhos (carimbo, exclusão, unidade)
select to_regclass('public.anamneses') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.anamneses'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'anamneses') as politicas,
       (select count(*) from pg_trigger where tgrelid = 'public.anamneses'::regclass and not tgisinternal) as gatilhos;
