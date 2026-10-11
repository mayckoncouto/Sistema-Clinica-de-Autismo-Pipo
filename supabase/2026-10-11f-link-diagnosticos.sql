-- Link de cadastro: lista de diagnósticos para "Possui diagnóstico? / Qual diagnóstico?" (2026-10-11)
-- A página pública passa a receber os diagnósticos cadastrados (Cadastros → Diagnósticos), sem os inativos.
-- Só substitui a função intake_form (os grants para a página do link continuam). Pode rodar de novo.

create or replace function public.intake_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  select data into c from public.documents where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'code', '') || ' ' || coalesce(e ->> 'name', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'campos', coalesce(cf, '{}'::jsonb));
end $$;

select (select prosrc like '%diagnosticos%' from pg_proc where proname = 'intake_form') as funcao_nova;
