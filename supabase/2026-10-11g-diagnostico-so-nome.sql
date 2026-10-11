-- Diagnósticos só pelo NOME (2026-10-11)
-- 1) O formulário do link recebe só o nome dos diagnósticos (em ordem alfabética), sem o código CID.
-- 2) Paciente (saúde e cadastro) e lead do CRM que guardavam "F84.0 Autismo infantil" passam a guardar só
--    "Autismo infantil" (só quando o texto é exatamente "código nome" de um diagnóstico cadastrado).
-- Pode rodar de novo (não muda o que já está só com o nome).

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
    select distinct btrim(coalesce(e ->> 'name', '')) as n
      from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
     where d.path = 'config/diagnoses' and not coalesce((e ->> 'inativo')::boolean, false)) x
  where n <> '';
  return jsonb_build_object('ok', true, 'kind', l.kind, 'nome', l.nome, 'prefill', l.prefill,
    'clinica', jsonb_build_object('nome', coalesce(c ->> 'nome', ''), 'subtitulo', coalesce(c ->> 'subtitulo', ''), 'logo', coalesce(c ->> 'logo', ''),
                                  'telefone', coalesce(c ->> 'telefone', ''), 'cor', coalesce(c ->> 'corBotoes', ''), 'corTexto', coalesce(c ->> 'corTexto', '')),
    'convenios', public.intake_names('config/convenios'), 'origens', org, 'diagnosticos', dg, 'campos', coalesce(cf, '{}'::jsonb));
end $$;

select set_config('pipo.restore', '1', true);

with dg as (
  select lower(btrim(e ->> 'code')) || ' ' || lower(btrim(e ->> 'name')) as velho, btrim(e ->> 'name') as novo
    from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
   where d.path = 'config/diagnoses' and btrim(coalesce(e ->> 'code', '')) <> '' and btrim(coalesce(e ->> 'name', '')) <> ''
)
update public.patient_health h
   set data = jsonb_set(h.data, '{cid}', to_jsonb(dg.novo))
  from dg
 where lower(regexp_replace(btrim(coalesce(h.data ->> 'cid', '')), '\s+', ' ', 'g')) = dg.velho;

with dg as (
  select lower(btrim(e ->> 'code')) || ' ' || lower(btrim(e ->> 'name')) as velho, btrim(e ->> 'name') as novo
    from public.documents d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e
   where d.path = 'config/diagnoses' and btrim(coalesce(e ->> 'code', '')) <> '' and btrim(coalesce(e ->> 'name', '')) <> ''
)
update public.tasks t
   set lead = jsonb_set(t.lead, '{diagnostico}', to_jsonb(dg.novo))
  from dg
 where lower(regexp_replace(btrim(coalesce(t.lead ->> 'diagnostico', '')), '\s+', ' ', 'g')) = dg.velho;

-- Conferência: quantos ainda estão no formato "código nome" (deve dar 0) e a função nova
select (select count(*) from public.patient_health h, public.documents d, jsonb_array_elements(d.data -> 'list') e
         where d.path = 'config/diagnoses' and btrim(coalesce(e ->> 'code', '')) <> ''
           and lower(regexp_replace(btrim(coalesce(h.data ->> 'cid', '')), '\s+', ' ', 'g')) = lower(btrim(e ->> 'code')) || ' ' || lower(btrim(e ->> 'name'))) as saude_no_formato_antigo,
       (select count(*) from public.tasks t, public.documents d, jsonb_array_elements(d.data -> 'list') e
         where d.path = 'config/diagnoses' and btrim(coalesce(e ->> 'code', '')) <> ''
           and lower(regexp_replace(btrim(coalesce(t.lead ->> 'diagnostico', '')), '\s+', ' ', 'g')) = lower(btrim(e ->> 'code')) || ' ' || lower(btrim(e ->> 'name'))) as leads_no_formato_antigo,
       (select prosrc not like '%code%' from pg_proc where proname = 'intake_form') as funcao_nova;
