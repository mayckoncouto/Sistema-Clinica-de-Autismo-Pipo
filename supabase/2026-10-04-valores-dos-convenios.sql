-- =====================================================================
-- Agenda Pipo — valor por sessão de cada especialidade nos convênios (2026-10-04)
--
--   * O convênio (documento config/convenios) guarda só QUAIS especialidades
--     cobre. O valor por sessão de cada uma fica nesta tabela protegida, com a
--     mesma permissão dos valores dos tratamentos ("Tratamentos – valores":
--     ver / editar). O Administrador sempre vê.
--   * "Especialidade que libera outras" fica no cadastro de Especialidades
--     (config/specialties, campo libera) e não precisa de banco novo.
--
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create table if not exists public.convenio_finance (
  id           text primary key,              -- "<convenio_id>|<spec_id>"
  convenio_id  text not null,
  spec_id      text not null,
  valor        numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  unique (convenio_id, spec_id)
);
alter table public.convenio_finance enable row level security;
grant select, insert, update, delete on public.convenio_finance to authenticated;

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
drop trigger if exists convenio_finance_stamp on public.convenio_finance;
create trigger convenio_finance_stamp
  before insert or update on public.convenio_finance
  for each row execute function public.convenio_finance_stamp();

drop policy if exists convenio_finance_select on public.convenio_finance;
create policy convenio_finance_select on public.convenio_finance
  for select to authenticated using (public.has_perm('tratamentos_valores', 'view'));
drop policy if exists convenio_finance_insert on public.convenio_finance;
create policy convenio_finance_insert on public.convenio_finance
  for insert to authenticated with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists convenio_finance_update on public.convenio_finance;
create policy convenio_finance_update on public.convenio_finance
  for update to authenticated
  using (public.has_perm('tratamentos_valores', 'edit'))
  with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists convenio_finance_delete on public.convenio_finance;
create policy convenio_finance_delete on public.convenio_finance
  for delete to authenticated
  using (public.has_perm('tratamentos_valores', 'edit') or public.has_perm('convenios', 'delete'));

-- conferência
select count(*) as valores_cadastrados from public.convenio_finance;
