-- Financeiro, Fase 2 (2026-10-11): lançamentos (movimentação das contas)
--   public.finance_entries  uma linha por lançamento: conta, data, descrição, subcategoria do Plano de contas,
--                           valor (o que entra na DRE) e valor/data do extrato (o que passou de fato no banco).
-- Permissão própria "Financeiro" (financeiro: ver / incluir / editar / excluir). Nenhum nível recebe:
-- só o Administrador vê e altera até você liberar em Níveis de permissão.
-- O sinal vem do tipo da subcategoria no Plano de contas (Receita/Entrada somam, Despesa/Saída subtraem);
-- por isso o valor é sempre positivo.
-- origem_key: chave da importação da planilha (conta|data|descrição|valor|subcategoria|nº da repetição);
-- importar a mesma planilha de novo não duplica nada.
-- Pode rodar de novo.

create table if not exists public.finance_entries (
  id            uuid primary key default gen_random_uuid(),
  account_id    text not null,                           -- id da conta em config/bank_accounts
  data          date not null,
  descricao     text not null default '',
  plan_id       text,                                    -- id da subcategoria em config/chart_accounts
  valor         numeric(14,2) not null check (valor >= 0),
  data_extrato  date,
  valor_extrato numeric(14,2) check (valor_extrato is null or valor_extrato >= 0),
  obs           text,
  origem_key    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
create unique index if not exists finance_entries_origem_key on public.finance_entries (origem_key) where origem_key is not null;
create index if not exists finance_entries_data on public.finance_entries (data);
create index if not exists finance_entries_conta_data on public.finance_entries (account_id, data);

alter table public.finance_entries enable row level security;
grant select, insert, update, delete on public.finance_entries to authenticated;

create or replace function public.finance_entries_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then                 -- restauração / scripts: mantém o que veio
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists finance_entries_stamp on public.finance_entries;
create trigger finance_entries_stamp
  before insert or update on public.finance_entries
  for each row execute function public.finance_entries_stamp();

drop policy if exists finance_entries_select on public.finance_entries;
create policy finance_entries_select on public.finance_entries
  for select to authenticated using (public.has_perm('financeiro', 'view'));
drop policy if exists finance_entries_insert on public.finance_entries;
create policy finance_entries_insert on public.finance_entries
  for insert to authenticated with check (public.has_perm('financeiro', 'create'));
drop policy if exists finance_entries_update on public.finance_entries;
create policy finance_entries_update on public.finance_entries
  for update to authenticated
  using (public.has_perm('financeiro', 'edit'))
  with check (public.has_perm('financeiro', 'edit'));
drop policy if exists finance_entries_delete on public.finance_entries;
create policy finance_entries_delete on public.finance_entries
  for delete to authenticated using (public.has_perm('financeiro', 'delete'));

do $$ begin
  alter publication supabase_realtime add table public.finance_entries;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: tabela | RLS ligada | políticas (esperado 4) | gatilho
select to_regclass('public.finance_entries') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.finance_entries'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'finance_entries') as politicas,
       exists(select 1 from pg_trigger where tgname = 'finance_entries_stamp' and not tgisinternal) as gatilho;
