-- Anamnese — Etapa 3 (2026-10-18): link para a família preencher + aviso de reavaliação no CRM.
--  • anamneses.family_at: a família respondeu pelo link (a equipe revisa e conclui; some quando a anamnese é concluída pelo app).
--  • anamnesis_links: link de preenchimento (vale 7 dias, uma vez só; só de anamnese em rascunho). Criar/cancelar: quem edita o tipo.
--  • anamnese_form / anamnese_send: chamadas pela página pública anamnese.html (sem login; conferem o link).
--  • crm_auto_r_anamnese: automação "Reavaliação de Anamnese Vencendo" (nasce desligada; liga em CRM ▾ Automações).
-- Pode rodar de novo.

alter table public.anamneses add column if not exists family_at timestamptz;

create table if not exists public.anamnesis_links (
  token           text primary key,
  anamnese_id     uuid not null references public.anamneses(id) on delete cascade,
  type_id         text not null default '',
  patient_id      text not null default '',
  nome            text not null default '',
  telefone        text not null default '',
  created_by      uuid default auth.uid(),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  used_at         timestamptz,
  canceled_at     timestamptz,
  unit_id         text not null default 'unidade-1'
);
create index if not exists anamnesis_links_anam_idx on public.anamnesis_links (anamnese_id);
alter table public.anamnesis_links enable row level security;
grant select, insert, update, delete on public.anamnesis_links to authenticated;

create or replace function public.anamnesis_links_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.anamneses;
begin
  if tg_op = 'INSERT' then
    select * into a from public.anamneses where id = new.anamnese_id;
    if a.id is null then raise exception 'anamnese não encontrada'; end if;
    if a.status <> 'rascunho' then raise exception 'PIPO_ANAMNESE_CONCLUIDA: só anamnese em rascunho recebe link'; end if;
    new.type_id := a.type_id; new.patient_id := a.patient_id;
    new.created_by := auth.uid(); new.created_by_name := public.crm_my_name(); new.created_at := now();
    new.expires_at := now() + interval '7 days'; new.used_at := null;
  else
    new.token := old.token; new.anamnese_id := old.anamnese_id; new.type_id := old.type_id; new.patient_id := old.patient_id;
    new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
    if coalesce(current_setting('pipo.anamlink', true), '') <> '1' then new.used_at := old.used_at; end if;
  end if;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'anamnesis_links_stamp' and not tgisinternal) then
    create trigger anamnesis_links_stamp before insert or update on public.anamnesis_links
      for each row execute function public.anamnesis_links_stamp();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'anamnesis_links_0_unit_stamp' and not tgisinternal) then
    create trigger anamnesis_links_0_unit_stamp before insert or update on public.anamnesis_links
      for each row execute function public.unit_stamp();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links' and policyname = 'anamnesis_links_select') then
    create policy anamnesis_links_select on public.anamnesis_links for select to authenticated using (public.has_perm('anm_' || type_id, 'edit'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links' and policyname = 'anamnesis_links_insert') then
    create policy anamnesis_links_insert on public.anamnesis_links for insert to authenticated
      with check (exists (select 1 from public.anamneses a where a.id = anamnese_id and public.has_perm('anm_' || a.type_id, 'edit')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links' and policyname = 'anamnesis_links_update') then
    create policy anamnesis_links_update on public.anamnesis_links for update to authenticated
      using (public.has_perm('anm_' || type_id, 'edit')) with check (public.has_perm('anm_' || type_id, 'edit'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links' and policyname = 'anamnesis_links_delete') then
    create policy anamnesis_links_delete on public.anamnesis_links for delete to authenticated using (public.has_perm('anm_' || type_id, 'edit'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links' and policyname = 'anamnesis_links_unit') then
    create policy anamnesis_links_unit on public.anamnesis_links as restrictive for all to authenticated
      using (unit_id = (select public.active_unit())) with check (unit_id = (select public.active_unit()));
  end if;
end $$;

create or replace function public.anamnese_link_state(l public.anamnesis_links)
returns text language sql stable set search_path = public as $$
  select case when l.token is null then 'invalido' when l.canceled_at is not null then 'cancelado'
              when l.used_at is not null then 'usado' when l.expires_at is not null and l.expires_at < now() then 'vencido' else 'ok' end;
$$;

-- Formulário da família: perguntas da anamnese (cópia do modelo), respostas já preenchidas e a marca da clínica.
create or replace function public.anamnese_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.anamnesis_links; a public.anamneses; c jsonb; st text; t jsonb;
begin
  select * into l from public.anamnesis_links where token = p_token;
  st := public.anamnese_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select * into a from public.anamneses where id = l.anamnese_id;
  if a.id is null or a.status <> 'rascunho' then return jsonb_build_object('ok', false, 'motivo', 'cancelado'); end if;
  perform set_config('pipo.unit', l.unit_id, true);
  select data into c from public.documents_u where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select e into t from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
   where d.path = 'config/anamnesis_types' and e ->> 'id' = a.type_id limit 1;
  return jsonb_build_object('ok', true, 'nome', a.patient_name, 'tipo', a.type_name, 'descricao', coalesce(t ->> 'descricao', ''),
    'perguntas', a.perguntas, 'respostas', a.answers,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', ''),
                                  'redes', case when jsonb_typeof(c -> 'redes') = 'array' then c -> 'redes' else '[]'::jsonb end));
end $$;

-- Envio da família: grava só respostas de perguntas que existem na anamnese (rascunho continua rascunho; a equipe revisa e conclui).
create or replace function public.anamnese_send(p_token text, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l public.anamnesis_links; a public.anamneses; st text; q jsonb; k text; v jsonb; clean jsonb := '{}'::jsonb; lim int;
begin
  select * into l from public.anamnesis_links where token = p_token for update;
  st := public.anamnese_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  if jsonb_typeof(p_answers) <> 'object' or octet_length(p_answers::text) > 600000 then return jsonb_build_object('ok', false, 'motivo', 'dados'); end if;
  select * into a from public.anamneses where id = l.anamnese_id for update;
  if a.id is null or a.status <> 'rascunho' then return jsonb_build_object('ok', false, 'motivo', 'cancelado'); end if;
  for q in select x from jsonb_array_elements(a.perguntas) x loop
    k := q ->> 'id';
    if k is null or not (p_answers ? k) or (q ->> 'tipo') in ('arquivo', 'secao', 'bloco', 'separador', 'pagina') then continue; end if;
    v := p_answers -> k;
    if jsonb_typeof(v) = 'string' then
      lim := case when (q ->> 'tipo') = 'assinatura' then 150000 when (q ->> 'tipo') = 'textolongo' then 4000 else 500 end;
      clean := clean || jsonb_build_object(k, left(v #>> '{}', lim));
    elsif jsonb_typeof(v) = 'array' then
      clean := clean || jsonb_build_object(k, coalesce((select jsonb_agg(left(e, 200)) from jsonb_array_elements_text(v) e), '[]'::jsonb));
    end if;
  end loop;
  perform set_config('pipo.unit', l.unit_id, true);
  perform set_config('pipo.anamlink', '1', true);
  update public.anamneses set answers = coalesce(answers, '{}'::jsonb) || clean, family_at = now() where id = a.id;
  update public.anamnesis_links set used_at = now() where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.anamnese_form(text) from public;
revoke all on function public.anamnese_send(text, jsonb) from public;
grant execute on function public.anamnese_form(text) to anon, authenticated;
grant execute on function public.anamnese_send(text, jsonb) to anon, authenticated;
revoke execute on function public.anamnese_link_state(public.anamnesis_links) from public;
grant execute on function public.anamnese_link_state(public.anamnesis_links) to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.anamnesis_links;
exception when duplicate_object or undefined_object then null; end $$;

-- Automação do CRM: reavaliação de anamnese. A mais recente CONCLUÍDA de cada paciente + tipo, com validade em meses no tipo,
-- perto de vencer (ou vencida) e sem uma reavaliação já em andamento (rascunho mais novo): cria a tarefa de reavaliar.
create or replace function public.crm_auto_r_anamnese(p_force boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb := public.crm_auto_cfg('anamnese_reavaliacao'); v_dias int; t record;
begin
  if v_cfg is null then return; end if;
  v_dias := public.crm_auto_num(v_cfg, 'dias', 30);
  for t in
    select a.id, a.patient_id, a.type_name, a.versao, (a.data + (m.meses || ' months')::interval)::date as due
      from (select distinct on (patient_id, type_id) * from public.anamneses
             where status = 'concluida' and unit_id = (select public.active_unit())
             order by patient_id, type_id, data desc, versao desc) a
      join (select e ->> 'id' as id, coalesce(nullif(e ->> 'validadeMeses', '')::int, 0) as meses
              from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
             where d.path = 'config/anamnesis_types' and coalesce(e ->> 'inativo', '') <> 'true') m on m.id = a.type_id
     where m.meses > 0
       and not exists (select 1 from public.anamneses n where n.patient_id = a.patient_id and n.type_id = a.type_id and n.status = 'rascunho' and n.versao > a.versao)
       and exists (select 1 from public.documents_u d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) e
                    where d.path = 'patients/all' and e ->> 'id' = a.patient_id and coalesce(e ->> 'inativo', '') <> 'true')
       and (a.data + (m.meses || ' months')::interval)::date <= public.crm_auto_today() + v_dias loop
    perform public.crm_auto_make('anamnese_reavaliacao', 'anamrev|' || t.id || '|' || t.due,
      'Reavaliar ' || t.type_name || ' de ' || coalesce(public.crm_auto_patient(t.patient_id), 'paciente') || ': ' ||
        case when t.due < public.crm_auto_today() then 'venceu em ' else 'vence em ' end || to_char(t.due, 'DD/MM/YYYY'),
      'A anamnese (' || t.type_name || ', versão ' || t.versao || ') ' || case when t.due < public.crm_auto_today() then 'está vencida' else 'está perto de vencer' end ||
        ' (' || to_char(t.due, 'DD/MM/YYYY') || '). Em Prontuário ▾ Anamneses, abra a anamnese e use Reavaliar (ou envie o link para a família).',
      greatest(t.due, public.crm_auto_today()), case when t.due < public.crm_auto_today() then 'alta' else 'normal' end, t.patient_id, '{}'::jsonb, 'atendimento');
  end loop;
end $$;
revoke execute on function public.crm_auto_r_anamnese(boolean) from public, anon, authenticated;

create or replace function public.crm_auto_run(p_force boolean default false)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_start timestamptz := now(); v_fn text; v_n integer;
begin
  foreach v_fn in array array['lead_parado', 'link_segunda', 'trat_vencendo', 'trat_cancelado', 'abaixo_contratado', 'carteirinha',
                              'sem_tratamento', 'pendencias_status', 'contas', 'saldo_baixo', 'mes_sem_fechar', 'conciliacao',
                              'rotinas', 'plano_vencendo', 'tarefa_parada', 'tarefa_atrasada', 'aniversario', 'encaminhamento',
                              'aba_revisao', 'anamnese'] loop
    begin
      execute format('select public.crm_auto_r_%s($1)', v_fn) using p_force;
    exception when others then
      raise warning 'crm_auto_run: regra % falhou: %', v_fn, sqlerrm;
    end;
  end loop;
  select count(*) into v_n from public.crm_auto_log where created_at >= v_start;
  return v_n;
end $$;
revoke execute on function public.crm_auto_run(boolean) from public, anon, authenticated;

-- Conferência: coluna | tabela | 5 políticas | funções públicas e da regra
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'anamneses' and column_name = 'family_at') as coluna,
       to_regclass('public.anamnesis_links') is not null as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'anamnesis_links') as politicas,
       (select count(*) from pg_proc where proname in ('anamnese_form', 'anamnese_send', 'anamnese_link_state', 'crm_auto_r_anamnese')) as funcoes;
