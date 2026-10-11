-- 2026-10-11b — Link de cadastro: todos os campos podem ser escolhidos em Campos obrigatórios
-- Pedido do usuário: no link rápido e no link permanente, Nome e Telefone também podem ser escolhidos
-- (aparece / obrigatório), como os outros campos. O envio continua precisando da autorização (LGPD) e de
-- pelo menos um dado que identifique o paciente (nome, telefone, CPF ou e-mail). Configuração gravada
-- antes desta mudança, sem nome/telefone, continua com os dois obrigatórios. Pode rodar de novo.

create or replace function public.intake_send(p_token text, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l public.intake_links; st text; k text; v text; clean jsonb := '{}'::jsonb; tid uuid; lst text; sts text; cf jsonb; fk text; miss text[] := '{}';
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
  if coalesce((p_data ->> 'consentimento')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'motivo', 'obrigatorio');
  end if;
  -- Nome e telefone podem ser escolhidos em Campos obrigatórios; o envio precisa ter pelo menos um dado que identifique.
  if coalesce(clean ->> 'nome', '') = '' and coalesce(clean ->> 'telefone', '') = '' and coalesce(clean ->> 'cpf', '') = '' and coalesce(clean ->> 'email', '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'vazio');
  end if;
  -- Obrigatórios escolhidos em Campos obrigatórios (config/patient_fields.link.individual | geral).
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  if jsonb_typeof(cf) is distinct from 'object' then cf := '{"nascimento": {"req": true}, "cpf": {"req": true}, "responsavel": {"req": true}}'::jsonb; end if;
  -- Configuração gravada antes de nome/telefone serem escolhíveis: continuam obrigatórios.
  if not cf ? 'nome' then cf := cf || '{"nome": {"req": true}}'::jsonb; end if;
  if not cf ? 'telefone' then cf := cf || '{"telefone": {"req": true}}'::jsonb; end if;
  for fk in select key from jsonb_each(cf) where coalesce((value ->> 'req')::boolean, false) loop
    if fk = 'responsavel' then
      if coalesce(clean ->> 'respNome', '') = '' or coalesce(clean ->> 'respParentesco', '') = '' then miss := miss || fk; end if;
    elsif fk = 'endereco' then
      if coalesce(clean ->> 'cep', '') = '' or coalesce(clean ->> 'numero', '') = '' or coalesce(clean ->> 'rua', '') = '' or coalesce(clean ->> 'cidade', '') = '' then miss := miss || fk; end if;
    elsif fk = any(keys) and coalesce(clean ->> fk, '') = '' then miss := miss || fk;
    end if;
  end loop;
  if array_length(miss, 1) > 0 then return jsonb_build_object('ok', false, 'motivo', 'obrigatorio', 'campos', to_jsonb(miss)); end if;
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
    values (lst, coalesce(sts, 'triagem'), 'Cadastro pelo link: ' || coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome'),
            'Cadastro enviado pelo link da clínica. Revise em Cadastros → Pacientes → Revisar cadastro.',
            jsonb_strip_nulls(jsonb_build_object('nome', clean ->> 'nome', 'telefone', regexp_replace(clean ->> 'telefone', '\D', '', 'g'),
                                                 'diagnostico', clean ->> 'diagnostico', 'convenio', clean ->> 'convenio')),
            'Link de cadastro')
    returning id into tid;
  end if;
  if tid is not null then
    insert into public.task_events (task_id, kind, data, author_name)
    values (tid, 'field', jsonb_build_object('campo', 'cadastro_link', 'para', coalesce(clean ->> 'nome', clean ->> 'telefone', clean ->> 'email', 'sem nome')), 'Família (link de cadastro)');
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
revoke all on function public.intake_send(text, jsonb) from public;
grant execute on function public.intake_send(text, jsonb) to anon, authenticated;

-- Conferência (esperado: 1)
select count(*) as funcao_nova from pg_proc where proname = 'intake_send' and prosrc like '%''vazio''%';
