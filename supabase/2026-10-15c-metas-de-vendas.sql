-- Metas de vendas (2026-10-15)
--   public.sale_goals   meta mensal de valor e/ou de quantidade de vendas, da equipe toda (seller_id nulo) ou de um vendedor.
-- Mesma permissão das vendas ('vendas': ver / incluir / editar / excluir). Pode rodar de novo.

create table if not exists public.sale_goals (
  id         uuid primary key default gen_random_uuid(),
  seller_id  text,
  ym         text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  valor      numeric(14,2) not null default 0 check (valor >= 0),
  qtd        integer not null default 0 check (qtd >= 0),
  created_at timestamptz not null default now(),
  unit_id    text not null default 'unidade-1'
);
create unique index if not exists sale_goals_unique on public.sale_goals (unit_id, coalesce(seller_id, ''), ym);
alter table public.sale_goals enable row level security;
grant select, insert, update, delete on public.sale_goals to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sale_goals' and policyname = 'sale_goals_select') then
    create policy sale_goals_select on public.sale_goals for select to authenticated using (public.has_perm('vendas', 'view'));
    create policy sale_goals_insert on public.sale_goals for insert to authenticated with check (public.has_perm('vendas', 'create'));
    create policy sale_goals_update on public.sale_goals for update to authenticated using (public.has_perm('vendas', 'edit')) with check (public.has_perm('vendas', 'edit'));
    create policy sale_goals_delete on public.sale_goals for delete to authenticated using (public.has_perm('vendas', 'delete'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sale_goals' and policyname = 'sale_goals_unit') then
    create policy sale_goals_unit on public.sale_goals as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sale_goals_0_unit_stamp' and not tgisinternal) then
    create trigger sale_goals_0_unit_stamp before insert or update on public.sale_goals
      for each row execute function public.unit_stamp();
  end if;
end $$;

-- Conferência: tabela | RLS | políticas (5) | gatilho de unidade
select to_regclass('public.sale_goals') is not null as tabela,
       (select relrowsecurity from pg_class where oid = 'public.sale_goals'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sale_goals') as politicas,
       exists(select 1 from pg_trigger where tgname = 'sale_goals_0_unit_stamp' and not tgisinternal) as gatilho;
