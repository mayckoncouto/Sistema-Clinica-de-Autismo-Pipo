-- =====================================================================
-- Agenda Pipo — CONFERÊNCIA DOS DADOS (só lê, não altera nada)
-- Cada linha é uma verificação: quantidade encontrada e até 15 exemplos.
-- Quantidade 0 = tudo certo naquele ponto.
-- =====================================================================
with
pac as (
  select e ->> 'id' as id, btrim(e ->> 'nome') as nome, coalesce((e ->> 'inativo')::boolean, false) as inativo,
         nullif(regexp_replace(coalesce(e ->> 'cpf', ''), '\D', '', 'g'), '') as cpf
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]')) e
  where d.path = 'patients/all'),
tra as (
  select e ->> 'id' as id, e ->> 'patientId' as patient_id, e ->> 'status' as status
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]')) e
  where d.path = 'treatments/all'),
prof as (
  select e ->> 'id' as id, btrim(e ->> 'name') as nome, coalesce((e ->> 'inativo')::boolean, false) as inativo
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]')) e
  where d.path = 'config/professionals'),
sala as (
  select r ->> 'id' as id, btrim(r ->> 'name') as nome, coalesce((r ->> 'group')::boolean, false) as grupo,
         coalesce((r ->> 'inativo')::boolean, false) as inativo, r -> 'therapists' as cols
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]')) r
  where d.path = 'config/rooms'),
coluna as (
  select s.id as sala_id, s.nome as sala, t ->> 'id' as col_id, t ->> 'professionalId' as prof_id
  from sala s, jsonb_array_elements(coalesce(s.cols, '[]')) t),
plan as (   -- agendamentos do Planner: chave "hora|sala|coluna"
  select d.path as doc, k.key as chave, split_part(k.key, '|', 2) as sala_id, split_part(k.key, '|', 3) as col_id,
         btrim(coalesce(k.value ->> 'patient', k.value #>> '{}', '')) as nome,
         coalesce((k.value ->> 'blocked')::boolean, false) as bloqueado
  from public.documents d, jsonb_each(coalesce(d.data -> 'bookings', '{}')) k
  where d.path like 'schedule/%'),
especial(nome) as (values ('bloqueado'), ('reunião clínica'), ('treinamento'), ('virtual'), (''))
select * from (
  select 1 as ordem, 'Planner: agendamentos em colunas/salas que não existem mais' as verificacao,
         count(*) as quantidade, string_agg(doc || ' ' || chave || ' (' || nome || ')', '; ' order by doc, chave) filter (where rn <= 15) as exemplos
  from (select p.*, row_number() over (order by doc, chave) rn from plan p
        where p.nome <> '' and not exists (select 1 from coluna c where c.sala_id = p.sala_id and c.col_id = p.col_id)) x
  union all
  select 2, 'Planner: nome agendado que não é paciente, sala/grupo nem tipo especial', count(*),
         string_agg(distinct nome, '; ') filter (where rn <= 15)
  from (select p.*, row_number() over (order by nome) rn from plan p
        where not p.bloqueado and lower(p.nome) not in (select nome from especial)
          and not exists (select 1 from pac where lower(pac.nome) = lower(p.nome))
          and not exists (select 1 from sala where lower(sala.nome) = lower(p.nome))) x
  union all
  select 3, 'Planner: paciente INATIVO ainda agendado', count(*), string_agg(distinct nome, '; ') filter (where rn <= 15)
  from (select p.*, row_number() over (order by p.nome) rn from plan p join pac on lower(pac.nome) = lower(p.nome) where pac.inativo) x
  union all
  select 4, 'Salas/grupos: coluna com profissional inexistente ou inativo', count(*),
         string_agg(sala || ' → ' || coalesce(prof_id, '(vazio)'), '; ') filter (where rn <= 15)
  from (select c.*, row_number() over (order by sala) rn from coluna c left join prof on prof.id = c.prof_id
        where c.prof_id is not null and c.prof_id <> '' and (prof.id is null or prof.inativo)) x
  union all
  select 5, 'Pacientes ATIVOS sem tratamento ativo', count(*), string_agg(nome, '; ' order by nome) filter (where rn <= 15)
  from (select pac.*, row_number() over (order by nome) rn from pac
        where not inativo and not exists (select 1 from tra where tra.patient_id = pac.id and tra.status = 'ativo')) x
  union all
  select 6, 'Pacientes com MAIS DE UM tratamento ativo', count(*), string_agg(nome, '; ') filter (where rn <= 15)
  from (select pac.nome, row_number() over (order by pac.nome) rn from pac join tra on tra.patient_id = pac.id and tra.status = 'ativo'
        group by pac.id, pac.nome having count(*) > 1) x
  union all
  select 7, 'Tratamentos de paciente que não existe mais', count(*), string_agg(id, '; ') filter (where rn <= 15)
  from (select tra.*, row_number() over (order by id) rn from tra where not exists (select 1 from pac where pac.id = tra.patient_id)) x
  union all
  select 8, 'Pacientes com CPF repetido', count(*), string_agg(nomes, ' | ') filter (where rn <= 15)
  from (select string_agg(nome, ' = ') as nomes, row_number() over () rn from pac where cpf is not null group by cpf having count(*) > 1) x
  union all
  select 9, 'Pacientes sem CPF', count(*), string_agg(nome, '; ' order by nome) filter (where rn <= 15)
  from (select pac.*, row_number() over (order by nome) rn from pac where cpf is null and not inativo) x
  union all
  select 10, 'Agenda (de hoje em diante): profissional inexistente ou inativo', count(*),
         string_agg(to_char(date, 'DD/MM') || ' ' || time || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by date, time) rn from public.appointments a left join prof on prof.id = a.professional_id
        where a.date >= current_date and (prof.id is null or prof.inativo)) x
  union all
  select 11, 'Agenda (de hoje em diante): nome que não é paciente, grupo nem tipo especial', count(*),
         string_agg(distinct patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by patient) rn from public.appointments a
        where a.date >= current_date and not a.blocked and lower(btrim(a.patient)) not in (select nome from especial)
          and not exists (select 1 from pac where lower(pac.nome) = lower(btrim(a.patient)))
          and not exists (select 1 from sala where sala.grupo and lower(sala.nome) = lower(btrim(a.patient)))) x
  union all
  select 12, 'Agenda (de hoje em diante): paciente INATIVO agendado', count(*),
         string_agg(to_char(date, 'DD/MM') || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by date) rn from public.appointments a join pac on lower(pac.nome) = lower(btrim(a.patient))
        where a.date >= current_date and pac.inativo) x
  union all
  select 13, 'Agenda: atendimentos de PACIENTES que já passaram e continuam sem status', count(*),
         string_agg(to_char(date, 'DD/MM') || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by date desc) rn from public.appointments a
        where a.date < current_date and a.status is null and not a.blocked and lower(btrim(a.patient)) not in (select nome from especial)
          and not exists (select 1 from sala where sala.grupo and lower(sala.nome) = lower(btrim(a.patient)))) x
  union all
  select 14, 'Agenda: "Finalizado" sem evolução no prontuário', count(*),
         string_agg(to_char(date, 'DD/MM') || ' ' || patient, '; ') filter (where rn <= 15)
  from (select a.*, row_number() over (order by date desc) rn from public.appointments a
        where a.status = 'finalizado' and exists (select 1 from pac where lower(pac.nome) = lower(btrim(a.patient)))
          and not exists (select 1 from public.clinical_records c where c.appointment_id = a.id)) x
  union all
  select 15, 'Usuários ATIVOS ligados a profissional inexistente ou inativo', count(*),
         string_agg(full_name, '; ') filter (where rn <= 15)
  from (select u.*, row_number() over (order by full_name) rn from public.profiles u left join prof on prof.id = u.professional_id
        where u.active and u.professional_id is not null and (prof.id is null or prof.inativo)) x
  union all
  select 16, 'Profissionais ATIVOS sem usuário (use "Criar acessos dos profissionais")', count(*),
         string_agg(nome, '; ' order by nome) filter (where rn <= 15)
  from (select prof.*, row_number() over (order by nome) rn from prof
        where not inativo and not exists (select 1 from public.profiles u where u.professional_id = prof.id)) x
  union all
  select 17, 'Dois ou mais usuários ligados ao mesmo profissional', count(*), string_agg(nomes, ' | ') filter (where rn <= 15)
  from (select string_agg(full_name, ' = ') as nomes, row_number() over () rn from public.profiles
        where professional_id is not null group by professional_id having count(*) > 1) x
) t
order by ordem;
