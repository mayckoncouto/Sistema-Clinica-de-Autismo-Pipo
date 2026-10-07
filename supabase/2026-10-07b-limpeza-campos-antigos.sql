-- 2026-10-07b — Revisão de nomes e campos, Etapa 1: limpeza segura.
-- Faça uma cópia (Acesso → Backup → Baixar) antes de rodar.
--   1. Pacientes COM tratamento: tira do cadastro do paciente os campos que hoje
--      são do tratamento (convenioId, convenio, plano, pacoteHoras, aba, specHours,
--      horarios). O app já lia esses dados do tratamento; nada muda na tela.
--      Paciente SEM tratamento fica como está (ainda é de onde o app lê).
--   2. Pacientes COM data de nascimento: tira a idade gravada (a idade é sempre
--      calculada pelo nascimento). Sem nascimento, a idade gravada fica até alguém
--      preencher a data.
--   3. Colunas das salas: o nome guardado de cada profissional passa a ser o nome
--      atual do cadastro (a grade já mostrava o nome atual; é só a cópia guardada).
--   4. Níveis: tira a permissão antiga "profissionais" (hoje vale "Colaboradores").
--   5. profiles: apaga as colunas antigas is_admin e permissions (sem uso desde
--      2026-09-30; a permissão vem do nível).
-- Pode rodar mais de uma vez.

begin;

-- 1 e 2. Pacientes
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case
         when exists (
           select 1 from public.documents t, jsonb_array_elements(coalesce(t.data -> 'list', '[]'::jsonb)) tr
           where t.path = 'treatments/all' and tr ->> 'patientId' = p ->> 'id'
         )
         then p - array['convenioId','convenio','plano','pacoteHoras','aba','specHours','horarios']
         else p
       end
       - case when coalesce(p ->> 'nascimento', '') ~ '^\d{4}-\d{2}-\d{2}$' then 'idade' else '' end
       order by ord), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(p, ord)
   ))
 where d.path = 'patients/all';

-- 3. Nome guardado nas colunas das salas = nome atual do profissional
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when jsonb_typeof(r -> 'therapists') = 'array' then
         jsonb_set(r, '{therapists}', (
           select coalesce(jsonb_agg(
             case when pr.name is not null then s || jsonb_build_object('name', pr.name) else s end
             order by so), '[]'::jsonb)
           from jsonb_array_elements(r -> 'therapists') with ordinality as y(s, so)
           left join lateral (
             select btrim(p ->> 'name') as name
             from public.documents pd, jsonb_array_elements(coalesce(pd.data -> 'list', '[]'::jsonb)) p
             where pd.path = 'config/professionals' and p ->> 'id' = s ->> 'professionalId'
               and coalesce(btrim(p ->> 'name'), '') <> ''
             limit 1
           ) pr on true
         ))
       else r end
       order by ro), '[]'::jsonb)
     from jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality as x(r, ro)
   ))
 where d.path = 'config/rooms';

-- 4. Permissão antiga "profissionais" (o nível Administrador é travado pelo
--    trigger roles_guard; ele fica desligado só durante esta troca).
alter table public.roles disable trigger roles_guard;
update public.roles set permissions = permissions - 'profissionais' where permissions ? 'profissionais';
alter table public.roles enable trigger roles_guard;

-- 5. Colunas antigas de profiles
alter table public.profiles drop column if exists is_admin;
alter table public.profiles drop column if exists permissions;

commit;

-- Conferência (deve dar 0 / 0 / 0 / 0 / nenhuma):
select
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') p
    where d.path = 'patients/all'
      and p ?| array['convenioId','convenio','plano','pacoteHoras','aba','specHours','horarios']
      and exists (select 1 from public.documents t, jsonb_array_elements(t.data -> 'list') tr
                  where t.path = 'treatments/all' and tr ->> 'patientId' = p ->> 'id')) as pacientes_com_campos_de_tratamento,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') p
    where d.path = 'patients/all' and coalesce(p ->> 'nascimento', '') <> '' and p ? 'idade') as idade_gravada_com_nascimento,
  (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') r,
          jsonb_array_elements(coalesce(r -> 'therapists', '[]'::jsonb)) s,
          public.documents pd, jsonb_array_elements(pd.data -> 'list') p
    where d.path = 'config/rooms' and pd.path = 'config/professionals'
      and p ->> 'id' = s ->> 'professionalId'
      and lower(btrim(coalesce(s ->> 'name', ''))) <> lower(btrim(p ->> 'name'))) as colunas_com_nome_antigo,
  (select count(*) from public.roles where permissions ? 'profissionais') as niveis_com_profissionais,
  coalesce((select string_agg(column_name, ', ') from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name in ('is_admin', 'permissions')), 'nenhuma') as colunas_antigas;
