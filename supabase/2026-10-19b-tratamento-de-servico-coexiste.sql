-- Tratamento de serviço (todos os tipos "svc:") pode ficar Ativo junto com um de especialidades.
-- Continua valendo: no máximo um Ativo de serviço e um Ativo de outro tipo por paciente.
create or replace function public.treatments_one_active()
returns trigger language plpgsql set search_path = public as $$
declare
  v_dup text;
begin
  if new.path <> 'treatments/all' then return new; end if;
  select x.pid into v_dup
  from (
    select e ->> 'patientId' as pid,
           (coalesce(jsonb_array_length(e -> 'tipos'), 0) > 0
            and not exists (select 1 from jsonb_array_elements_text(e -> 'tipos') k where k not like 'svc:%')) as svc,
           count(*) as n
    from jsonb_array_elements(coalesce(new.data -> 'list', '[]'::jsonb)) e
    where e ->> 'status' = 'ativo'
    group by 1, 2
  ) x
  where x.n > 1
  limit 1;
  if v_dup is not null then
    raise exception 'Cada paciente só pode ter um tratamento ativo de serviço e um de especialidades (paciente %). Recarregue a página e tente de novo.', v_dup;
  end if;
  return new;
end;
$$;
