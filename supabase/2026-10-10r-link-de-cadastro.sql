-- =====================================================================
-- Link de cadastro rápido (pedido do usuário, 2026-10-10).
--  - intake_links: links de cadastro. kind = "novo" (paciente novo, tela Pacientes),
--    "atualizacao" (Pedir atualização de um paciente, já preenchido), "crm" (lead de
--    uma tarefa do CRM) e "geral" (link da clínica, não vence; um só ativo).
--    Individuais valem 7 dias e uma vez só.
--  - intake_submissions: o que a família enviou. Todo envio fica "pendente" até
--    alguém revisar (aprovado / descartado). Quem revisa: quem pode incluir Pacientes.
--  - intake_form / intake_send: chamadas pela página pública cadastro.html (sem login;
--    conferem o link). O link geral cria um lead novo no CRM (lista Atendimento).
--  - intake_remind: chamado pelo app; link individual não preenchido em 3 dias vira
--    tarefa no CRM (lista Atendimento) para a recepção cobrar.
-- Pode rodar de novo.
-- =====================================================================
create table if not exists public.intake_links (
  token           text primary key default replace(gen_random_uuid()::text, '-', ''),
  kind            text not null check (kind in ('novo', 'atualizacao', 'crm', 'geral')),
  patient_id      text,
  task_id         uuid references public.tasks(id) on delete set null,
  nome            text not null default '',
  telefone        text not null default '',
  prefill         jsonb not null default '{}'::jsonb,
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  used_at         timestamptz,
  canceled_at     timestamptz,
  reminded_at     timestamptz
);
create unique index if not exists intake_links_one_geral on public.intake_links (kind) where kind = 'geral' and canceled_at is null;

create table if not exists public.intake_submissions (
  id                uuid primary key default gen_random_uuid(),
  token             text references public.intake_links(token) on delete set null,
  kind              text not null,
  patient_id        text,
  task_id           uuid references public.tasks(id) on delete set null,
  data              jsonb not null default '{}'::jsonb,
  status            text not null default 'pendente' check (status in ('pendente', 'aprovado', 'descartado')),
  created_at        timestamptz not null default now(),
  reviewed_by       uuid,
  reviewed_by_name  text not null default '',
  reviewed_at       timestamptz,
  result_patient_id text
);
create index if not exists intake_submissions_status_idx on public.intake_submissions (status, created_at);

create or replace function public.intake_can()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_perm('pacientes', 'create');
$$;

create or replace function public.intake_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.used_at := null; new.reminded_at := null;
    new.expires_at := case when new.kind = 'geral' then null else now() + interval '7 days' end;
  else
    -- Quem usa o app só pode cancelar ou mudar telefone/nome; uso e lembrete são marcados pelas funções.
    new.token := old.token; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.intake', true), '') <> '1' then new.used_at := old.used_at; new.reminded_at := old.reminded_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists intake_links_stamp on public.intake_links;
create trigger intake_links_stamp before insert or update on public.intake_links for each row execute function public.intake_links_stamp();

create or replace function public.intake_submissions_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_by_name := public.crm_my_name(); new.reviewed_at := now();
  end if;
  new.data := old.data; new.kind := old.kind; new.token := old.token; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists intake_submissions_stamp on public.intake_submissions;
create trigger intake_submissions_stamp before update on public.intake_submissions for each row execute function public.intake_submissions_stamp();

alter table public.intake_links enable row level security;
alter table public.intake_submissions enable row level security;
drop policy if exists intake_links_select on public.intake_links;
create policy intake_links_select on public.intake_links for select to authenticated using (public.intake_can());
drop policy if exists intake_links_insert on public.intake_links;
create policy intake_links_insert on public.intake_links for insert to authenticated with check (public.intake_can());
drop policy if exists intake_links_update on public.intake_links;
create policy intake_links_update on public.intake_links for update to authenticated using (public.intake_can()) with check (public.intake_can());
drop policy if exists intake_submissions_select on public.intake_submissions;
create policy intake_submissions_select on public.intake_submissions for select to authenticated using (public.intake_can());
drop policy if exists intake_submissions_update on public.intake_submissions;
create policy intake_submissions_update on public.intake_submissions for update to authenticated using (public.intake_can()) with check (public.intake_can());

-- Situação de um link (para a página pública).
create or replace function public.intake_link_state(l public.intake_links)
returns text language sql stable as $$
  select case when l.token is null then 'invalido' when l.canceled_at is not null then 'cancelado'
              when l.used_at is not null then 'usado' when l.expires_at is not null and l.expires_at < now() then 'vencido' else 'ok' end;
$$;

-- Lista de nomes de um cadastro em lista (ativos), para a página pública.
create or replace function public.intake_names(p_path text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) from (
    select distinct btrim(coalesce(e ->> 'name', e ->> 'nome', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = p_path and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
$$;

create or replace function public.intake_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.intake_links; c jsonb; st text; org jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select data into c from public.documents where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org);
end $$;

create or replace function public.intake_send(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l public.intake_links; st text; k text; v text; clean jsonb := '{}'::jsonb; tid uuid; lst text; sts text;
  keys text[] := array['nome', 'nascimento', 'cpf', 'sexo', 'respNome', 'respParentesco', 'telefone', 'email', 'cep', 'rua', 'numero',
                       'compl', 'bairro', 'cidade', 'uf', 'convenio', 'diagnostico', 'laudo', 'escola', 'escolaTurno', 'comoConheceu', 'obs'];
begin
  select * into l from public.intake_links where token = p_token for update;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 30000 then return jsonb_build_object('ok', false, 'motivo', 'dados'); end if;
  foreach k in array keys loop
    v := left(btrim(coalesce(p_data ->> k, '')), case when k = 'obs' then 2000 else 300 end);
    if v <> '' then clean := clean || jsonb_build_object(k, v); end if;
  end loop;
  if coalesce(clean ->> 'nome', '') = '' or coalesce(clean ->> 'telefone', '') = '' or coalesce((p_data ->> 'consentimento')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'motivo', 'obrigatorio');
  end if;
  clean := clean || jsonb_build_object('consentimento', true, 'consentimentoEm', now());
  if l.kind = 'geral' and (select count(*) from public.intake_submissions where kind = 'geral' and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  tid := l.task_id;
  if l.kind = 'geral' then
    -- Lead novo no CRM: lista Atendimento (ou a primeira lista de atendimento), primeiro status.
    select e ->> 'id', e -> 'statuses' -> 0 ->> 'id' into lst, sts
      from public.documents d, jsonb_array_elements(d.data -> 'list') with ordinality x(e, n)
     where d.path = 'config/task_lists' and (e ->> 'id' = 'atendimento' or coalesce((e ->> 'lead')::boolean, false))
     order by (e ->> 'id' = 'atendimento') desc, n limit 1;
    if lst is null then lst := 'atendimento'; sts := 'triagem'; end if;
    insert into public.tasks (list_id, status, title, description, lead, created_by_name)
    values (lst, coalesce(sts, 'triagem'), 'Cadastro pelo link: ' || (clean ->> 'nome'),
            'Cadastro enviado pelo link da clínica. Revise em Cadastros → Pacientes → Revisar cadastro.',
            jsonb_strip_nulls(jsonb_build_object('nome', clean ->> 'nome', 'telefone', regexp_replace(clean ->> 'telefone', '\D', '', 'g'),
                                                 'diagnostico', clean ->> 'diagnostico', 'convenio', clean ->> 'convenio')),
            'Link de cadastro')
    returning id into tid;
  end if;
  if tid is not null then
    insert into public.task_events (task_id, kind, data, author_name)
    values (tid, 'field', jsonb_build_object('campo', 'cadastro_link', 'para', clean ->> 'nome'), 'Família (link de cadastro)');
  end if;
  insert into public.intake_submissions (token, kind, patient_id, task_id, data)
  values (l.token, l.kind, l.patient_id, tid, clean);
  if l.kind <> 'geral' then
    perform set_config('pipo.intake', '1', true);
    update public.intake_links set used_at = now() where token = l.token;
    perform set_config('pipo.intake', '', true);
  end if;
  return jsonb_build_object('ok', true);
end $$;
-- Lembrete: link individual não preenchido em 3 dias → tarefa no CRM (uma vez por link).
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
              and created_at < now() - interval '3 days' for update skip locked loop
    insert into public.tasks (list_id, status, title, description, due_date, assignees, patient_id, lead)
    values (lst, coalesce(sts, 'triagem'), 'Cobrar cadastro pelo link: ' || coalesce(nullif(l.nome, ''), 'sem nome'),
            'O link de cadastro enviado em ' || to_char(l.created_at, 'DD/MM/YYYY') || coalesce(' por ' || nullif(l.created_by_name, ''), '') || ' ainda não foi preenchido.' ||
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

revoke all on function public.intake_form(text) from public;
revoke all on function public.intake_send(text, jsonb) from public;
grant execute on function public.intake_form(text) to anon, authenticated;
grant execute on function public.intake_send(text, jsonb) to anon, authenticated;
grant execute on function public.intake_remind() to authenticated;

-- Tempo real: o aviso no botão Cadastros acompanha os envios.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intake_submissions') then
    alter publication supabase_realtime add table public.intake_submissions;
  end if;
end $$;

-- Conferência: deve mostrar 2 tabelas e 3 funções.
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('intake_links', 'intake_submissions')) as tabelas,
       (select count(*) from pg_proc where proname in ('intake_form', 'intake_send', 'intake_remind')) as funcoes;
