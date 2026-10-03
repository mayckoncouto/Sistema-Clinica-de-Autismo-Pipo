-- =====================================================================
-- Agenda Pipo — valores dos tratamentos protegidos (2026-10-03, Etapa 1)
--
--   * Valor e despesas saem do documento treatments/all (que todo usuário
--     ativo consegue ler) e vão para a tabela treatment_finance, que só
--     libera para quem tem a permissão "Tratamentos – valores"
--     (tratamentos_valores: ver / editar) no nível.
--   * Nenhum nível (além do Administrador) começa com essa permissão:
--     marque em Usuários → Níveis de permissão quem pode ver/editar.
--   * Os valores que já existem são copiados para a tabela nova e depois
--     tirados do documento. Nada é perdido.
--
-- ANTES DE RODAR: baixe uma cópia de segurança (menu Acesso).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

-- 1. Tabela dos valores (um registro por tratamento).
create table if not exists public.treatment_finance (
  treatment_id  text primary key,
  valor         numeric(12,2) not null default 0,
  despesas      numeric(12,2) not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
alter table public.treatment_finance enable row level security;
grant select, insert, update, delete on public.treatment_finance to authenticated;

create or replace function public.treatment_finance_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.updated_at := coalesce(new.updated_at, now());   -- restauração / scripts
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists treatment_finance_stamp on public.treatment_finance;
create trigger treatment_finance_stamp
  before insert or update on public.treatment_finance
  for each row execute function public.treatment_finance_stamp();

-- 2. Quem vê / grava (o Administrador sempre; os outros pela permissão do nível).
drop policy if exists treatment_finance_select on public.treatment_finance;
create policy treatment_finance_select on public.treatment_finance
  for select to authenticated using (public.has_perm('tratamentos_valores', 'view'));
drop policy if exists treatment_finance_insert on public.treatment_finance;
create policy treatment_finance_insert on public.treatment_finance
  for insert to authenticated with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists treatment_finance_update on public.treatment_finance;
create policy treatment_finance_update on public.treatment_finance
  for update to authenticated
  using (public.has_perm('tratamentos_valores', 'edit'))
  with check (public.has_perm('tratamentos_valores', 'edit'));
drop policy if exists treatment_finance_delete on public.treatment_finance;
create policy treatment_finance_delete on public.treatment_finance
  for delete to authenticated
  using (public.has_perm('tratamentos_valores', 'edit') or public.has_perm('tratamentos', 'delete'));

-- 3. Copia os valores atuais para a tabela nova.
insert into public.treatment_finance (treatment_id, valor, despesas)
select e ->> 'id',
       coalesce(nullif(e ->> 'valor', '')::numeric, 0),
       coalesce(nullif(e ->> 'despesas', '')::numeric, 0)
from public.documents d, jsonb_array_elements(d.data -> 'list') e
where d.path = 'treatments/all' and coalesce(e ->> 'id', '') <> ''
on conflict (treatment_id) do nothing;

-- 4. Tira valor e despesas do documento (que todos leem), mantendo a ordem.
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg((x.e - 'valor' - 'despesas') order by x.i), '[]'::jsonb)
  from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, i)
))
where d.path = 'treatments/all';

-- 5. Níveis existentes: começam SEM ver os valores (o Administrador escolhe).
update public.roles set permissions = permissions
  || '{"tratamentos_valores": {"view": false, "edit": false}}'::jsonb
  where not is_admin and not (permissions ? 'tratamentos_valores');

-- conferência: quantos tratamentos têm valores guardados e se o documento ficou sem valores
select (select count(*) from public.treatment_finance) as tratamentos_com_valores,
       (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
         where d.path = 'treatments/all' and (e ? 'valor' or e ? 'despesas')) as valores_ainda_no_documento;
