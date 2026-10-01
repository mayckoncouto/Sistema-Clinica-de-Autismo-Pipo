-- =====================================================================
-- Agenda Pipo — Prontuário (2026-10-02, parte 5)
--
--   * Tabela clinical_records: cada linha é uma evolução de atendimento
--     (texto formatado em HTML, com tabelas), ligada ao paciente e, quando
--     vem do botão "Atendimento" da Agenda, ao atendimento.
--   * Novo módulo de permissão "prontuario" (ver / incluir / editar / excluir)
--     nos Níveis de permissão. Já vem: Profissional ver + incluir + editar;
--     Secretária e Financeiro sem acesso; Administrador tudo.
--   * Só o AUTOR edita a própria evolução (a qualquer momento). Excluir: o
--     autor (com permissão de excluir) ou o Administrador.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

create table if not exists public.clinical_records (
  id               uuid primary key default gen_random_uuid(),
  patient_id       text not null,                -- id do paciente (patients/all)
  patient_name     text not null default '',     -- nome na hora em que foi escrito
  appointment_id   uuid references public.appointments(id) on delete set null,
  appointment_date date,                         -- data/hora do atendimento (ou da escrita)
  appointment_time text,
  professional_id  text,                         -- profissional (config/professionals)
  author_id        uuid references auth.users(id) on delete set null,
  author_name      text not null default '',
  content          text not null default '',     -- HTML (o app limpa antes de salvar e de mostrar)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists clinical_records_patient_idx on public.clinical_records (patient_id, created_at desc);
create index if not exists clinical_records_appt_idx on public.clinical_records (appointment_id);
alter table public.clinical_records enable row level security;

-- Autor e datas são sempre do banco (ninguém escreve em nome de outro).
create or replace function public.clinical_records_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.patient_id := old.patient_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists clinical_records_stamp on public.clinical_records;
create trigger clinical_records_stamp
  before insert or update on public.clinical_records
  for each row execute function public.clinical_records_stamp();

drop policy if exists clinical_records_select on public.clinical_records;
create policy clinical_records_select on public.clinical_records
  for select to authenticated using (public.has_perm('prontuario', 'view'));
drop policy if exists clinical_records_insert on public.clinical_records;
create policy clinical_records_insert on public.clinical_records
  for insert to authenticated with check (public.has_perm('prontuario', 'create'));
drop policy if exists clinical_records_update on public.clinical_records;
create policy clinical_records_update on public.clinical_records
  for update to authenticated
  using (public.has_perm('prontuario', 'edit') and author_id = auth.uid())
  with check (public.has_perm('prontuario', 'edit') and author_id = auth.uid());
drop policy if exists clinical_records_delete on public.clinical_records;
create policy clinical_records_delete on public.clinical_records
  for delete to authenticated
  using (public.is_admin() or (public.has_perm('prontuario', 'delete') and author_id = auth.uid()));

revoke all on public.clinical_records from anon;
grant select, insert, update, delete on public.clinical_records to authenticated;

-- Permissões iniciais do novo módulo (só se o nível ainda não tiver).
update public.roles set permissions = permissions || '{"prontuario": {"view": true, "create": true, "edit": true, "delete": true}}'::jsonb
  where id = 'administrador' and not (permissions ? 'prontuario');
update public.roles set permissions = permissions || '{"prontuario": {"view": true, "create": true, "edit": true, "delete": false}}'::jsonb
  where id = 'profissional' and not (permissions ? 'prontuario');
update public.roles set permissions = permissions || '{"prontuario": {"view": false, "create": false, "edit": false, "delete": false}}'::jsonb
  where id in ('secretaria', 'financeiro') and not (permissions ? 'prontuario');

commit;

select id, permissions -> 'prontuario' as prontuario from public.roles order by sort;
