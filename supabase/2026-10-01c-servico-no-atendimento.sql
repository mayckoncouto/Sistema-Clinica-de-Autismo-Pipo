-- =====================================================================
-- Agenda Pipo — Serviço em cada atendimento (2026-10-01, parte 3)
--
--   * Cada atendimento (Planner e Agenda) passa a ter um serviço; o padrão
--     é "Sessão" (id "sessao"), que não pode ser excluído nem renomeado.
--   * Os atendimentos que já existem recebem "Sessão". Horários marcados
--     como Bloqueado / Reunião Clínica / Treinamento não recebem serviço.
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

begin;

-- 1. Garante que "Sessão" existe no cadastro de serviços (e com esse nome).
update public.documents
set data = jsonb_build_object('list',
  case when exists (select 1 from jsonb_array_elements(data -> 'list') e where e ->> 'id' = 'sessao')
    then (select jsonb_agg(case when e ->> 'id' = 'sessao' then jsonb_build_object('id','sessao','name','Sessão') else e end)
          from jsonb_array_elements(data -> 'list') e)
    else jsonb_build_array(jsonb_build_object('id','sessao','name','Sessão')) || coalesce(data -> 'list', '[]'::jsonb)
  end)
where path = 'config/services';

insert into public.documents (path, data)
values ('config/services', '{"list": [{"id": "sessao", "name": "Sessão"}]}'::jsonb)
on conflict (path) do nothing;

-- 2. Agenda (por data): coluna de serviço, padrão Sessão.
alter table public.appointments add column if not exists service text;
update public.appointments
set service = 'sessao'
where (service is null or service = '')
  and not blocked
  and lower(btrim(patient)) not in ('reunião clínica', 'treinamento', 'bloqueado', '');

-- 3. Planner: grava "service": "sessao" em cada atendimento de paciente.
update public.documents d
set data = jsonb_set(d.data, '{bookings}', (
  select coalesce(jsonb_object_agg(e.k,
    case
      when jsonb_typeof(e.v) = 'object'
        and not (e.v ? 'service')
        and not coalesce((e.v ->> 'blocked')::boolean, false)
        and not coalesce((e.v ->> 'training')::boolean, false)
        and lower(btrim(coalesce(e.v ->> 'patient', ''))) not in ('reunião clínica', 'treinamento', 'bloqueado', '')
      then e.v || '{"service": "sessao"}'::jsonb
      else e.v
    end), '{}'::jsonb)
  from jsonb_each(d.data -> 'bookings') as e(k, v)
))
where d.path like 'schedule/%' and jsonb_typeof(d.data -> 'bookings') = 'object';

commit;

select
  (select count(*) from public.appointments where service = 'sessao') as agenda_com_sessao,
  (select sum((select count(*) from jsonb_each(data -> 'bookings') e where e.value ->> 'service' = 'sessao'))
     from public.documents where path like 'schedule/%') as planner_com_sessao;
