-- =====================================================================
-- Agenda Pipo — CONFERÊNCIA DE INTEGRIDADE (só lê, não altera nada)
-- Procura "sobras" de dados: registros que apontam para algo que não existe
-- mais (paciente, usuário, lista, status, plano...). Quantidade 0 = tudo certo.
-- Cada linha traz até 15 exemplos. Complementa conferencia-dos-dados.sql.
-- =====================================================================
with
doc as (select path, data from public.documents),
lst as (  -- itens de cada cadastro em lista: caminho, id, nome
  select d.path, e ->> 'id' as id, coalesce(e ->> 'nome', e ->> 'name', '') as nome, e
  from doc d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'list') = 'array' then d.data -> 'list' else '[]' end) e),
pac   as (select id, btrim(nome) as nome from lst where path = 'patients/all'),
tra   as (select id, e ->> 'patientId' as patient_id, e ->> 'convenioId' as conv_id from lst where path = 'treatments/all'),
prof  as (select id from lst where path = 'config/professionals'),
sala  as (select id, nome, coalesce((e ->> 'group')::boolean, false) as grupo from lst where path = 'config/rooms'),
plan as (   -- agendamentos do Planner
  select d.path as doc, k.key as chave, k.value as v,
         btrim(coalesce(k.value ->> 'patient', '')) as nome, split_part(d.path, '/', 2) as dia
  from doc d, jsonb_each(case when jsonb_typeof(d.data -> 'bookings') = 'object' then d.data -> 'bookings' else '{}' end) k
  where d.path like 'schedule/%' and jsonb_typeof(k.value) = 'object'),
crm_l as (select id, e from lst where path = 'config/task_lists'),
crm_s as (select l.id as list_id, s ->> 'id' as st from crm_l l, jsonb_array_elements(coalesce(l.e -> 'statuses', '[]')) s),
tem   as (select exists (select 1 from doc where path = 'config/task_lists') as listas,
                 exists (select 1 from doc where path = 'config/statuses') as status,
                 exists (select 1 from doc where path = 'config/services') as servicos,
                 exists (select 1 from doc where path = 'config/convenios') as convenios)
select * from (
  select 1 as ordem, 'CRM: tarefa com responsável que não é mais usuário' as verificacao, count(*) as quantidade,
         string_agg(title, '; ') filter (where rn <= 15) as exemplos
  from (select t.title, row_number() over (order by t.title) rn from public.tasks t
        where exists (select 1 from unnest(t.assignees) a where not exists (select 1 from public.profiles p where p.id = a))) x
  union all
  select 2, 'CRM: tarefa em lista que não existe mais', count(*), string_agg(list_id || ': ' || title, '; ') filter (where rn <= 15)
  from (select t.*, row_number() over (order by t.title) rn from public.tasks t, tem
        where tem.listas and not exists (select 1 from crm_l where crm_l.id = t.list_id)) x
  union all
  select 3, 'CRM: tarefa em status que não existe mais na lista', count(*), string_agg(list_id || '/' || status || ': ' || title, '; ') filter (where rn <= 15)
  from (select t.*, row_number() over (order by t.title) rn from public.tasks t, tem
        where tem.listas and exists (select 1 from crm_l where crm_l.id = t.list_id)
          and not exists (select 1 from crm_s where crm_s.list_id = t.list_id and crm_s.st = t.status)) x
  union all
  select 4, 'CRM: tarefa ligada a paciente que não existe mais', count(*), string_agg(title, '; ') filter (where rn <= 15)
  from (select t.*, row_number() over (order by t.title) rn from public.tasks t
        where coalesce(t.patient_id, '') <> '' and not exists (select 1 from pac where pac.id = t.patient_id)) x
  union all
  select 5, 'CRM: "lido" de usuário que não existe mais', count(*), null
  from public.task_reads r where not exists (select 1 from public.profiles p where p.id = r.user_id)
  union all
  select 6, 'Tratamentos: valores de tratamento que não existe mais', count(*), string_agg(treatment_id, '; ') filter (where rn <= 15)
  from (select f.treatment_id, row_number() over (order by f.treatment_id) rn from public.treatment_finance f
        where not exists (select 1 from tra where tra.id = f.treatment_id)) x
  union all
  select 7, 'Tratamentos: convênio que não existe mais', count(*), string_agg(id, '; ') filter (where rn <= 15)
  from (select tra.*, row_number() over (order by tra.id) rn from tra, tem
        where tem.convenios and coalesce(conv_id, '') <> '' and not exists (select 1 from lst where lst.path = 'config/convenios' and lst.id = tra.conv_id)) x
  union all
  select 8, 'Convênios: valor de convênio que não existe mais', count(*), string_agg(id, '; ') filter (where rn <= 15)
  from (select c.id, row_number() over (order by c.id) rn from public.convenio_finance c, tem
        where tem.convenios and not exists (select 1 from lst where lst.path = 'config/convenios' and lst.id = c.convenio_id)) x
  union all
  select 9, 'Saúde de paciente que não existe mais', count(*), string_agg(patient_id, '; ') filter (where rn <= 15)
  from (select h.patient_id, row_number() over (order by h.patient_id) rn from public.patient_health h
        where not exists (select 1 from pac where pac.id = h.patient_id)) x
  union all
  select 10, 'Agenda: atendimento ligado a paciente que não existe mais', count(*),
         string_agg(to_char(date, 'DD/MM/YY') || ' ' || time || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by a.date desc) rn from public.appointments a
        where coalesce(a.patient_id, '') <> '' and not exists (select 1 from pac where pac.id = a.patient_id)) x
  union all
  select 11, 'Agenda: atendimento ligado a grupo de suporte que não existe mais', count(*),
         string_agg(to_char(date, 'DD/MM/YY') || ' ' || time || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by a.date desc) rn from public.appointments a
        where coalesce(a.group_id, '') <> '' and not exists (select 1 from sala where sala.grupo and sala.id = a.group_id)) x
  union all
  select 12, 'Agenda: atendimento com status que não existe mais', count(*),
         string_agg(to_char(date, 'DD/MM/YY') || ' ' || patient || ' (' || status || ')', '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by a.date desc) rn from public.appointments a, tem
        where tem.status and a.status is not null and not exists (select 1 from lst where lst.path = 'config/statuses' and lst.id = a.status)) x
  union all
  select 13, 'Agenda: atendimento com serviço que não existe mais', count(*),
         string_agg(to_char(date, 'DD/MM/YY') || ' ' || patient || ' (' || service || ')', '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by a.date desc) rn from public.appointments a, tem
        where tem.servicos and coalesce(a.service, '') not in ('', 'sessao') and not exists (select 1 from lst where lst.path = 'config/services' and lst.id = a.service)) x
  union all
  select 14, 'Agenda: atendimento com sala que não existe mais', count(*),
         string_agg(to_char(date, 'DD/MM/YY') || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by a.date desc) rn from public.appointments a
        where coalesce(a.room_id, '') <> '' and not exists (select 1 from sala where sala.id = a.room_id)) x
  union all
  select 15, 'Prontuário: evolução de paciente que não existe mais', count(*), string_agg(distinct patient_name, '; ') filter (where rn <= 15)
  from (select c.*, row_number() over (order by c.patient_name) rn from public.clinical_records c
        where not exists (select 1 from pac where pac.id = c.patient_id)) x
  union all
  select 16, 'Prontuário: evolução que aponta para Plano Terapêutico que não existe mais', count(*), string_agg(distinct patient_name, '; ') filter (where rn <= 15)
  from (select c.*, row_number() over (order by c.patient_name) rn from public.clinical_records c
        where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.plan_goals) = 'array' then c.plan_goals else '[]' end) g
                      where not exists (select 1 from public.therapy_plans p where p.id::text = g ->> 'planId'))) x
  union all
  select 17, 'Plano Terapêutico de paciente que não existe mais', count(*), string_agg(distinct patient_name, '; ') filter (where rn <= 15)
  from (select p.*, row_number() over (order by p.patient_name) rn from public.therapy_plans p
        where not exists (select 1 from pac where pac.id = p.patient_id)) x
  union all
  select 18, 'Plano Terapêutico: paciente sem nenhuma versão vigente (só encerradas)', count(*), string_agg(distinct patient_name, '; ') filter (where rn <= 15)
  from (select p.patient_name, row_number() over (order by p.patient_name) rn from public.therapy_plans p
        group by p.patient_id, p.patient_name having bool_and(p.status = 'encerrado')) x
  union all
  select 19, 'Planner: agendamento ligado a paciente que não existe mais', count(*), string_agg(doc || ' ' || chave || ' (' || nome || ')', '; ') filter (where rn <= 15)
  from (select p.*, row_number() over (order by doc, chave) rn from plan p
        where coalesce(p.v ->> 'patientId', '') <> '' and not exists (select 1 from pac where pac.id = p.v ->> 'patientId')) x
  union all
  select 20, 'Planner: agendamento em dia em que a clínica está fechada', count(*), string_agg(doc || ' ' || chave || ' (' || nome || ')', '; ') filter (where rn <= 15)
  from (select p.*, row_number() over (order by doc, chave) rn from plan p, doc c
        where c.path = 'config/clinic' and jsonb_typeof(c.data -> 'horarios') = 'object'
          and coalesce((c.data -> 'horarios' -> split_part(p.dia, '-', 1) ->> 'ativo')::boolean, false) = false
          and (p.nome <> '' or coalesce((p.v ->> 'lock')::boolean, false) or coalesce((p.v ->> 'training')::boolean, false))) x
  union all
  select 21, 'Bloqueio de horário do Planner de profissional/sala que não existe mais', count(*), string_agg(id, '; ') filter (where rn <= 15)
  from (select b.id, row_number() over (order by b.id) rn from lst b
        where b.path = 'config/planner_blocks'
          and ((b.e ->> 'alvo' = 'prof' and not exists (select 1 from prof where prof.id = b.e ->> 'profId'))
            or (coalesce(b.e ->> 'roomId', '') <> '' and not exists (select 1 from sala where sala.id = b.e ->> 'roomId')))) x
  union all
  select 22, 'Usuário ligado a colaborador que não existe mais', count(*), string_agg(full_name, '; ') filter (where rn <= 15)
  from (select u.*, row_number() over (order by u.full_name) rn from public.profiles u
        where coalesce(u.staff_id, '') <> '' and not exists (select 1 from public.staff s where s.id = u.staff_id)) x
  union all
  select 23, 'Colaborador ligado a profissional que não existe mais', count(*), string_agg(coalesce(data ->> 'nome', id), '; ') filter (where rn <= 15)
  from (select s.*, row_number() over (order by s.id) rn from public.staff s
        where coalesce(s.professional_id, '') <> '' and not exists (select 1 from prof where prof.id = s.professional_id)) x
  union all
  select 24, 'Profissional sem cadastro de colaborador', count(*), string_agg(nome, '; ') filter (where rn <= 15)
  from (select l.nome, row_number() over (order by l.nome) rn from lst l
        where l.path = 'config/professionals' and not exists (select 1 from public.staff s where s.professional_id = l.id)) x
  union all
  select 25, 'Cadastros: id repetido dentro da mesma lista', count(*), string_agg(path || ' → ' || id, '; ') filter (where rn <= 15)
  from (select path, id, row_number() over (order by path, id) rn from lst where id is not null group by path, id having count(*) > 1) x
) t
order by ordem;
