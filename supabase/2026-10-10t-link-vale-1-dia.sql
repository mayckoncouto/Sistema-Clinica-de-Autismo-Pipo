-- =====================================================================
-- Link de cadastro: vale 1 dia (pedido do usuário, 2026-10-10; antes 7 dias).
--  - intake_links_stamp: link novo do paciente vence 1 dia depois (o link geral continua sem vencer).
--  - intake_remind: o lembrete no CRM ("Cobrar cadastro pelo link") sai quando o link VENCE sem
--    resposta (antes: 3 dias), pedindo para mandar um novo link.
-- Links já enviados mantêm a validade que tinham. Pode rodar de novo.
-- =====================================================================
create or replace function public.intake_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.used_at := null; new.reminded_at := null;
    new.expires_at := case when new.kind = 'geral' then null else now() + interval '1 day' end;
  else
    -- Quem usa o app só pode cancelar ou mudar telefone/nome; uso e lembrete são marcados pelas funções.
    new.token := old.token; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.intake', true), '') <> '1' then new.used_at := old.used_at; new.reminded_at := old.reminded_at; end if;
  end if;
  return new;
end $$;

create or replace function public.intake_remind()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare l public.intake_links; lst text; sts text; n integer := 0;
begin
  if not public.intake_can() then return 0; end if;
  select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
    from public.documents d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, k)
   where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
   order by (e ->> 'id' = 'atendimento') desc, k limit 1;
  if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
  for l in select * from public.intake_links
            where kind in ('novo', 'atualizacao', 'crm') and used_at is null and canceled_at is null and reminded_at is null
              and expires_at is not null and expires_at < now() for update skip locked loop
    insert into public.tasks (list_id, status, title, description, due_date, assignees, patient_id, lead)
    values (lst, coalesce(sts, 'triagem'), 'Cobrar cadastro pelo link: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
            'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || coalesce(' por ' || nullif(l.created_by_name, ''), '') || ' venceu sem ser preenchido. Cobre a família e envie um novo link.' ||
              case when l.telefone <> '' then ' Telefone: ' || l.telefone || '.' else '' end,
            current_date,
            case when l.created_by is not null and public.crm_user_can(l.created_by, lst) then array[l.created_by] else '{}'::uuid[] end,
            l.patient_id,
            case when l.patient_id is null then jsonb_strip_nulls(jsonb_build_object('nome', nullif(l.nome, ''), 'telefone', nullif(l.telefone, ''))) else '{}'::jsonb end);
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set reminded_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Conferência: as duas devem dar 1.
select (select count(*) from pg_proc where proname = 'intake_links_stamp' and prosrc like '%1 day%') as validade_1_dia,
       (select count(*) from pg_proc where proname = 'intake_remind' and prosrc like '%expires_at < now()%') as lembrete_ao_vencer;
