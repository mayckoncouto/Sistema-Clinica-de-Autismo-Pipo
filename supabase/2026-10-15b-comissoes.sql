-- Comissões de venda (2026-10-15)
--   public.commission_rules   regras: percentual por tipo de venda (nova, renovação, aditivo ou todas), vendedor opcional,
--                             subcategoria da despesa, conta bancária e dia do pagamento da conta a pagar.
--   public.sale_commissions   uma comissão por venda (sale_id único), gerada no 1º atendimento FINALIZADO do tratamento;
--                             payable_id aponta a conta a pagar do vendedor; 'estornada' quando a venda é cancelada.
-- Permissão própria 'comissoes' (ver / incluir / editar / excluir): nenhum nível recebe, só o Administrador libera.
-- Pode rodar de novo.

create table if not exists public.commission_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  tipo        text not null default 'todas' check (tipo in ('todas', 'nova', 'renovacao', 'aditivo')),
  percentual  numeric(6,2) not null default 0 check (percentual >= 0 and percentual <= 100),
  seller_id   text,
  plan_id     text,
  account_id  text,
  pay_day     integer not null default 10 check (pay_day between 1 and 28),
  inativo     boolean not null default false,
  created_at  timestamptz not null default now(),
  unit_id     text not null default 'unidade-1'
);
create table if not exists public.sale_commissions (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null unique,
  treatment_id  text not null,
  patient_id    text not null,
  seller_id     text,
  seller_name   text,
  rule_id       uuid,
  base          numeric(14,2) not null default 0,
  percentual    numeric(6,2) not null default 0,
  valor         numeric(14,2) not null default 0,
  status        text not null default 'gerada' check (status in ('gerada', 'estornada')),
  payable_id    uuid,
  obs           text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  unit_id       text not null default 'unidade-1'
);
create index if not exists sale_commissions_seller_idx on public.sale_commissions (seller_id, created_at);
create index if not exists sale_commissions_treatment_idx on public.sale_commissions (treatment_id);
alter table public.commission_rules enable row level security;
alter table public.sale_commissions enable row level security;
grant select, insert, update, delete on public.commission_rules to authenticated;
grant select, insert, update, delete on public.sale_commissions to authenticated;

do $$
declare t text;
begin
  foreach t in array array['commission_rules', 'sale_commissions'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.has_perm(''comissoes'', ''view''))', t || '_select', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(''comissoes'', ''create''))', t || '_insert', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(''comissoes'', ''edit'')) with check (public.has_perm(''comissoes'', ''edit''))', t || '_update', t);
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_perm(''comissoes'', ''delete''))', t || '_delete', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_unit') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()))', t || '_unit', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = t || '_0_unit_stamp' and not tgisinternal) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.unit_stamp()', t || '_0_unit_stamp', t);
    end if;
  end loop;
end $$;

-- Quem gerou a comissão: sempre quem está logado (restauração sem usuário mantém o que veio)
create or replace function public.sale_commissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.created_at := coalesce(new.created_at, now());
    return new;
  end if;
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := auth.uid();
  else new.created_at := old.created_at; new.created_by := old.created_by; end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'sale_commissions_stamp' and not tgisinternal) then
    create trigger sale_commissions_stamp before insert or update on public.sale_commissions
      for each row execute function public.sale_commissions_stamp();
  end if;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.sale_commissions;
exception when duplicate_object or undefined_object then null; end $$;

-- Conferência: duas tabelas | RLS | políticas (5 + 5) | gatilho
select to_regclass('public.commission_rules') is not null as regras,
       to_regclass('public.sale_commissions') is not null as comissoes,
       (select count(*) from pg_policies where schemaname = 'public' and tablename in ('commission_rules', 'sale_commissions')) as politicas,
       exists(select 1 from pg_trigger where tgname = 'sale_commissions_stamp' and not tgisinternal) as gatilho;
