-- Cadastro do paciente: o campo "Nome social / apelido" saiu do sistema.
-- Apaga o campo de todos os pacientes (patients/all) e da configuração de
-- Campos obrigatórios (config/patient_fields). O nome social do COLABORADOR
-- (nome curto no Planner) continua. Pode rodar de novo.

update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(p - 'nomeSocial' order by ord), '[]'::jsonb)
       from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, ord)
   ))
 where d.path = 'patients/all'
   and exists (select 1 from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p where p ? 'nomeSocial');

update public.documents
   set data = jsonb_set(data, '{fields}', (data -> 'fields') - 'nomeSocial')
 where path = 'config/patient_fields' and data -> 'fields' ? 'nomeSocial';

-- Conferência (deve dar 0 e 0)
select
  (select count(*) from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
    where d.path = 'patients/all' and p ? 'nomeSocial') as pacientes_com_nome_social,
  (select count(*) from public.documents where path = 'config/patient_fields' and data -> 'fields' ? 'nomeSocial') as campo_na_configuracao;
