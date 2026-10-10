-- =====================================================================
-- Tratamentos: limpar as especialidades/serviços para recomeçar no formato
-- novo (um quadro por linha: especialidade, sessões/mês, profissional, ABA,
-- serviço, dia, horário, semanas, sala, seguidas, observação).
-- Pedido do usuário (2026-10-10): limpar TODOS os tratamentos.
-- Apaga só a lista de especialidades (specHours) dos tratamentos e as sobras
-- antigas no cadastro dos pacientes. Sessão/Mês, ABA do tratamento, horário do
-- paciente, convênio, valores, status e histórico NÃO mudam.
-- ANTES DE RODAR: baixe um Backup (menu Acesso → Backup).
-- Pode rodar de novo (não faz nada na 2ª vez).
-- =====================================================================
update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
         select jsonb_agg(case when jsonb_typeof(e) = 'object' then jsonb_set(e, '{specHours}', '[]'::jsonb) else e end order by n)
           from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, n)), '[]'::jsonb))
 where d.path = 'treatments/all'
   and jsonb_typeof(d.data -> 'list') = 'array'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') e
                where jsonb_typeof(e -> 'specHours') = 'array' and jsonb_array_length(e -> 'specHours') > 0
                   or (jsonb_typeof(e) = 'object' and not (e ? 'specHours')));

update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
         select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'specHours' else e end order by n)
           from jsonb_array_elements(d.data -> 'list') with ordinality as x(e, n)), '[]'::jsonb))
 where d.path = 'patients/all'
   and jsonb_typeof(d.data -> 'list') = 'array'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') e where e ? 'specHours');

-- Conferência: as duas devem dar 0; a terceira mostra quantos tratamentos existem (nenhum some).
select
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'treatments/all' and jsonb_array_length(coalesce(e -> 'specHours', '[]'::jsonb)) > 0) as tratamentos_com_especialidades,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'patients/all' and e ? 'specHours') as pacientes_com_sobras,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') e
    where d.path = 'treatments/all') as total_de_tratamentos;
