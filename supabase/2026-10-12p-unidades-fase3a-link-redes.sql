-- Unidades — Fase 3A: o formulário público do link de cadastro devolve também as redes sociais da Clínica DA UNIDADE do link.
-- (A marca — nome, logo, cores — já vinha da unidade do link desde a Fase 2C.) Só reinstala a função; pode rodar de novo.
CREATE OR REPLACE FUNCTION public.intake_form(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.intake_links; c jsonb; st text; org jsonb; cf jsonb; dg jsonb;
begin
  select * into l from public.intake_links where token = p_token;
  st := public.intake_link_state(l);
  if st <> 'ok' then return jsonb_build_object('ok', false, 'motivo', st); end if;
  perform set_config('pipo.unit', l.unit_id, true);   -- tudo o que a página lê vem da unidade do link
  select data into c from public.documents_u where path = 'config/clinic';
  c := coalesce(c, '{}'::jsonb);
  select data -> 'link' -> (case when l.kind = 'geral' then 'geral' else 'individual' end) into cf from public.documents_u where path = 'config/patient_fields';
  org := public.intake_names('config/origins');
  if org = '[]'::jsonb then org := '["Indicação médica", "Indicação de outro paciente", "Escola", "Convênio", "Internet / redes sociais", "Outro"]'::jsonb; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into dg from (
    select distinct btrim(coalesce(e ->> 'name', '')) as n
      from public.documents_u d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', ''),
                                  'redes', case when jsonb_typeof(c -> 'redes') = 'array' then c -> 'redes' else '[]'::jsonb end),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'escolas', public.intake_names('config/schools'), 'medicos', public.intake_names('config/doctors'), 'campos', coalesce(cf, '{}'::jsonb));
end $function$;
