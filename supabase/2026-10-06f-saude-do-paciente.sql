-- =====================================================================
-- Agenda Pipo — dados de saúde do paciente protegidos por nível (2026-10-06)
--
--   * Médico, CID, data do diagnóstico, nível de suporte, comunicação,
--     alergias, medicações e restrições alimentares saem do cadastro de
--     pacientes (que todo usuário ativo consegue ler) e vão para a tabela
--     patient_health, liberada pela permissão "Pacientes – saúde"
--     (saude_paciente: ver / editar) do nível.
--   * Cada nível começa com o mesmo acesso que já tem em Pacientes
--     (ver → ver, editar → editar). Ajuste em Usuários → Níveis de permissão.
--   * Os dados que já existem são copiados para a tabela nova e depois
--     tirados do cadastro. Nada é perdido.
--
-- ANTES DE RODAR: baixe uma cópia de segurança (menu Acesso → Backup).
-- Pode rodar de novo sem estragar (também serve depois de restaurar uma
-- cópia antiga, que traz a saúde de volta para o cadastro).
-- =====================================================================

-- 1. Tabela (um registro por paciente).
create table if not exists public.patient_health (
  patient_id  text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.patient_health enable row level security;
grant select, insert, update, delete on public.patient_health to authenticated;

create or replace function public.patient_health_stamp()
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
drop trigger if exists patient_health_stamp on public.patient_health;
create trigger patient_health_stamp
  before insert or update on public.patient_health
  for each row execute function public.patient_health_stamp();

-- 2. Quem vê / grava (o Administrador sempre; os outros pela permissão do nível).
drop policy if exists patient_health_select on public.patient_health;
create policy patient_health_select on public.patient_health
  for select to authenticated using (public.has_perm('saude_paciente', 'view'));
drop policy if exists patient_health_insert on public.patient_health;
create policy patient_health_insert on public.patient_health
  for insert to authenticated with check (public.has_perm('saude_paciente', 'edit'));
drop policy if exists patient_health_update on public.patient_health;
create policy patient_health_update on public.patient_health
  for update to authenticated
  using (public.has_perm('saude_paciente', 'edit'))
  with check (public.has_perm('saude_paciente', 'edit'));
drop policy if exists patient_health_delete on public.patient_health;
create policy patient_health_delete on public.patient_health
  for delete to authenticated
  using (public.has_perm('saude_paciente', 'edit') or public.has_perm('pacientes', 'delete'));

-- 3. Copia a saúde que está no cadastro para a tabela (o que já está na tabela vale mais).
insert into public.patient_health (patient_id, data)
select e ->> 'id',
       jsonb_strip_nulls(jsonb_build_object(
         'medicoId', e -> 'medicoId', 'cid', e -> 'cid', 'diagData', e -> 'diagData',
         'suporte', e -> 'suporte', 'comunicacao', e -> 'comunicacao', 'alergias', e -> 'alergias',
         'medicacoes', e -> 'medicacoes', 'restricoes', e -> 'restricoes'))
from public.documents d, jsonb_array_elements(d.data -> 'list') e
where d.path = 'patients/all' and coalesce(e ->> 'id', '') <> ''
  and (e ?| array['medicoId','cid','diagData','suporte','comunicacao','alergias','medicacoes','restricoes'])
on conflict (patient_id) do update set data = excluded.data || public.patient_health.data;

-- 4. Tira esses campos do cadastro (que todos leem), mantendo a ordem.
update public.documents d
set data = jsonb_set(d.data, '{list}', (
  select coalesce(jsonb_agg((x.e - 'medicoId' - 'cid' - 'diagData' - 'suporte' - 'comunicacao'
                                 - 'alergias' - 'medicacoes' - 'restricoes') order by x.i), '[]'::jsonb)
  from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, i)
))
where d.path = 'patients/all';

-- 5. Níveis existentes: o mesmo acesso que têm em Pacientes (ver / editar).
update public.roles set permissions = permissions || jsonb_build_object('saude_paciente', jsonb_build_object(
    'view', coalesce((permissions -> 'pacientes' ->> 'view')::boolean, false),
    'edit', coalesce((permissions -> 'pacientes' ->> 'edit')::boolean, false)))
  where not is_admin and not (permissions ? 'saude_paciente');

-- conferência: pacientes com dados de saúde guardados e se o cadastro ficou sem eles
select (select count(*) from public.patient_health) as pacientes_com_saude,
       (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
         where d.path = 'patients/all'
           and (e ?| array['medicoId','cid','diagData','suporte','comunicacao','alergias','medicacoes','restricoes'])) as ainda_no_cadastro;
