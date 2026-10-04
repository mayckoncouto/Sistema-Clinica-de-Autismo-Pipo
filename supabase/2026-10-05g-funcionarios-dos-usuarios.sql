-- =====================================================================
-- Agenda Pipo — Cadastro de funcionário para os usuários ativos (2026-10-05)
--
--   Cada usuário ATIVO que ainda não tem cadastro em RH → Funcionários e
--   Prestadores (nem como profissional) ganha um, com nome e e-mail do usuário,
--   e fica ligado a ele (profiles.staff_id). Tipo inicial pelo nível:
--   Financeiro → Financeiro, Secretária → Recepção, os demais → Administrativo
--   (ajuste depois na janela do funcionário).
--
-- PRECISA da migração 2026-10-05e-rh-funcionarios.sql antes.
-- ANTES DE RODAR: baixe um backup (menu Acesso → Backup).
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

insert into public.staff (id, professional_id, data)
select 'user-' || p.id::text, null, jsonb_build_object(
  'nome', coalesce(nullif(btrim(p.full_name), ''), p.email),
  'email', p.email,
  'tipos', jsonb_build_array(case
    when p.role_id = 'financeiro' then 'financeiro'
    when p.role_id = 'secretaria' then 'recepcao'
    else 'administrativo' end))
from public.profiles p
where p.active and p.staff_id is null
  and (p.professional_id is null
       or not exists (select 1 from public.staff s where s.professional_id = p.professional_id))
on conflict (id) do nothing;

update public.profiles p set staff_id = 'user-' || p.id::text
where p.staff_id is null
  and exists (select 1 from public.staff s where s.id = 'user-' || p.id::text);

-- conferência: usuários ativos e o cadastro de funcionário de cada um
select p.full_name as usuario, p.email, r.name as nivel,
       coalesce(s.data ->> 'nome', '— sem cadastro —') as funcionario
from public.profiles p
left join public.roles r on r.id = p.role_id
left join public.staff s on s.id = p.staff_id or (p.staff_id is null and s.professional_id = p.professional_id)
where p.active
order by p.full_name;
