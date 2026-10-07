-- 2026-10-07d — Revisão de nomes e campos, Etapa 3: colaborador único.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   1. CPF de quem atende: passa para o cadastro do colaborador (tabela staff, protegida
--      pela permissão Colaboradores) e sai do cadastro de atendimento (config/professionals,
--      que todo usuário ativo lê). Profissional sem colaborador ligado fica como está.
--   2. Uma situação só: colaborador com o tipo Profissional fica com a mesma situação
--      (ativo/inativo) do cadastro de atendimento — o que a grade já mostrava.
-- Pode rodar mais de uma vez.

begin;

-- 1a. CPF do profissional → colaborador (só onde o colaborador ainda não tem CPF)
update public.staff s
   set data = s.data || jsonb_build_object('cpf', regexp_replace(p ->> 'cpf', '\D', '', 'g'))
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
 where d.path = 'config/professionals' and p ->> 'id' = s.professional_id
   and coalesce(p ->> 'cpf', '') <> '' and coalesce(s.data ->> 'cpf', '') = '';

-- 1b. Tira o CPF do cadastro de atendimento de quem tem colaborador ligado
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when exists (select 1 from public.staff s where s.professional_id = p ->> 'id')
            then p - 'cpf' else p end
       order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, o)
   ))
 where d.path = 'config/professionals';

-- 2. Situação do colaborador = situação do atendimento (tipo Profissional)
update public.staff s
   set data = case when coalesce((p ->> 'inativo')::boolean, false)
                   then s.data || '{"inativo": true}'::jsonb
                   else s.data - 'inativo' end
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) p
 where d.path = 'config/professionals' and p ->> 'id' = s.professional_id
   and coalesce(s.data -> 'tipos', '[]'::jsonb) ? 'profissional'
   and coalesce((s.data ->> 'inativo')::boolean, false) is distinct from coalesce((p ->> 'inativo')::boolean, false);

commit;

-- Conferência (deve dar 0 / 0):
select
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') p
    where d.path = 'config/professionals' and coalesce(p ->> 'cpf', '') <> ''
      and exists (select 1 from public.staff s where s.professional_id = p ->> 'id')) as cpf_no_atendimento,
  (select count(*) from public.staff s, public.documents d, jsonb_array_elements(d.data -> 'list') p
    where d.path = 'config/professionals' and p ->> 'id' = s.professional_id
      and coalesce(s.data -> 'tipos', '[]'::jsonb) ? 'profissional'
      and coalesce((s.data ->> 'inativo')::boolean, false) is distinct from coalesce((p ->> 'inativo')::boolean, false)) as situacao_diferente;
