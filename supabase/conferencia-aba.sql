-- =====================================================================
-- Conferência do ABA por paciente (SÓ LEITURA, não muda nada). 2026-10-10.
-- Uma linha por paciente, com o tratamento atual (o Ativo; sem Ativo, o mais recente):
--  - aba_do_tratamento: o campo ABA geral do tratamento (o que vai sair);
--  - aba_dos_quadros: o ABA de cada quadro de especialidade do tratamento;
--  - aba_pela_regra_nova: Sim, exceto nível de suporte 3 ou 17 anos ou mais = Não;
--  - aba_no_cadastro_antigo: sobra do ABA no cadastro do paciente (formato antigo).
-- =====================================================================
with pac as (
  select e ->> 'id' as id, e ->> 'nome' as nome, e ->> 'nascimento' as nasc, e ->> 'idade' as idade_txt,
         coalesce(nullif(e ->> 'aba', ''), '') as aba_pac, coalesce(e ->> 'inativo', 'false') = 'true' as inativo,
         e ->> 'suporte' as suporte_doc
    from public.documents d, jsonb_array_elements(d.data -> 'list') e
   where d.path = 'patients/all' and jsonb_typeof(e) = 'object'
), esp as (
  select e ->> 'id' as id, e ->> 'name' as nome
    from public.documents d, jsonb_array_elements(d.data -> 'list') e
   where d.path = 'config/specialties'
), trt as (
  select distinct on (e ->> 'patientId')
         e ->> 'patientId' as pid, e ->> 'status' as status, e ->> 'inicio' as inicio,
         coalesce(e ->> 'aba', '') as aba, coalesce(e -> 'specHours', '[]'::jsonb) as sh
    from public.documents d, jsonb_array_elements(d.data -> 'list') e
   where d.path = 'treatments/all' and jsonb_typeof(e) = 'object'
   order by e ->> 'patientId', (e ->> 'status' = 'ativo') desc, e ->> 'inicio' desc
), base as (
  select p.*, t.status, t.aba as aba_trat, t.sh,
         coalesce(nullif(h.data ->> 'suporte', ''), p.suporte_doc, '') as suporte,
         case when p.nasc ~ '^\d{4}-\d{2}-\d{2}$' then date_part('year', age(current_date, p.nasc::date))::int
              when p.idade_txt ~ '^\d+$' then p.idade_txt::int end as idade
    from pac p
    left join trt t on t.pid = p.id
    left join public.patient_health h on h.patient_id = p.id
)
select b.nome as paciente,
       case when b.inativo then 'Inativo' else 'Ativo' end as cadastro,
       coalesce(b.status, 'sem tratamento') as tratamento,
       b.idade,
       nullif(b.suporte, '') as nivel_de_suporte,
       coalesce(nullif(b.aba_trat, ''), '—') as aba_do_tratamento,
       coalesce((select string_agg(coalesce(s.nome, l ->> 'specId') || ': ' || coalesce(nullif(l ->> 'aba', ''), '—'), '; ' order by n)
                   from jsonb_array_elements(b.sh) with ordinality as x(l, n)
                   left join esp s on s.id = l ->> 'specId'), '—') as aba_dos_quadros,
       case when b.suporte ~ '3' or coalesce(b.idade, 0) >= 17 then 'Não' else 'Sim' end as aba_pela_regra_nova,
       coalesce(nullif(b.aba_pac, ''), '—') as aba_no_cadastro_antigo
  from base b
 order by b.inativo, lower(b.nome);
