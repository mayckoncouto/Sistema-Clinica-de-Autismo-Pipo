-- =====================================================================
-- Agenda Pipo — um só tratamento Ativo por paciente, conferido no banco
-- (2026-10-03, Etapa 0)
--
--   * O app já não deixa salvar dois tratamentos Ativos do mesmo paciente,
--     mas duas pessoas salvando ao mesmo tempo poderiam escapar disso.
--     Agora o próprio banco recusa qualquer gravação de treatments/all que
--     deixe um paciente com mais de um tratamento Ativo.
--   * Vale para todos (inclusive Administrador, scripts e restauração da
--     cópia de segurança).
--
-- Rode UMA vez no SQL Editor do Supabase (pode rodar de novo sem estragar).
-- =====================================================================

create or replace function public.treatments_one_active()
returns trigger language plpgsql as $$
declare
  v_dup text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  select x.pid into v_dup
  from (
    select e ->> 'patientId' as pid, count(*) as n
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e
    where e ->> 'status' = 'ativo'
    group by 1
  ) x
  where x.n > 1
  limit 1;
  if v_dup is not null then
    raise exception 'Cada paciente só pode ter um tratamento ativo (paciente %). Recarregue a página e tente de novo.', v_dup;
  end if;
  return new;
end;
$$;

drop trigger if exists treatments_one_active on public.documents;
create trigger treatments_one_active
  before insert or update on public.documents
  for each row execute function public.treatments_one_active();

-- conferência: deve mostrar 0 (nenhum paciente com mais de um ativo hoje)
select count(*) as pacientes_com_mais_de_um_ativo
from (
  select e ->> 'patientId', count(*)
  from public.documents d, jsonb_array_elements(d.data -> 'list') e
  where d.path = 'treatments/all' and e ->> 'status' = 'ativo'
  group by 1 having count(*) > 1
) x;
