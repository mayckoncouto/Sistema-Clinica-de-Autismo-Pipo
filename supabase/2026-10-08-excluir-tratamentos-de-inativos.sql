-- 2026-10-08 — Excluir todos os tratamentos dos pacientes INATIVOS (pedido do usuário).
-- Não é migração: é uma limpeza de dados feita uma vez.
-- ANTES: Acesso → Backup → Baixar (a exclusão não tem desfazer).
--
-- PARTE 1 (só leitura): rode primeiro e confira a lista.
-- PARTE 2: apaga os tratamentos desses pacientes (documento treatments/all) e os valores
--          deles (tabela treatment_finance). Pacientes, Agenda, Planner, Prontuário e
--          Plano Terapêutico NÃO são mexidos.

-- ===================== PARTE 1 — conferir =====================
with inativos as (
  select p ->> 'id' as id, coalesce(p ->> 'nome', p ->> 'name') as nome
    from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
   where d.path = 'patients/all' and (p ->> 'inativo') = 'true'
)
select i.nome as paciente, t ->> 'inicio' as inicio, t ->> 'status' as status, t ->> 'id' as tratamento_id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
  join inativos i on i.id = t ->> 'patientId'
 where d.path = 'treatments/all'
 order by 1, 2;

-- ===================== PARTE 2 — excluir =====================
begin;

create temp table _tr_del on commit drop as
select t ->> 'id' as id
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) t
 where d.path = 'treatments/all'
   and t ->> 'patientId' in (
     select p ->> 'id'
       from public.documents pd, jsonb_array_elements(coalesce(pd.data -> 'list', '[]'::jsonb)) p
      where pd.path = 'patients/all' and (p ->> 'inativo') = 'true');

update public.documents d
   set data = jsonb_set(d.data, '{list}', coalesce((
     select jsonb_agg(t order by ord)
       from jsonb_array_elements(d.data -> 'list') with ordinality as x(t, ord)
      where t ->> 'id' not in (select id from _tr_del)), '[]'::jsonb))
 where d.path = 'treatments/all';

delete from public.treatment_finance where treatment_id in (select id from _tr_del);

select count(*) as tratamentos_excluidos from _tr_del;

commit;
