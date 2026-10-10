-- =====================================================================
-- Agenda Pipo — excluir paciente sem deixar dados de saúde soltos (2026-10-10)
--   Ao excluir um paciente do cadastro, o app chama delete_patient_health, que apaga
--   os dados de saúde dele (CID, alergias, medicações…). Só funciona para quem pode
--   excluir pacientes (ou Administrador) e só depois que o paciente já saiu do cadastro.
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.delete_patient_health(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_perm('pacientes', 'delete')) then
    raise exception 'Sem permissão para excluir pacientes.' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
              where d.path = 'patients/all' and x ->> 'id' = p_id) then
    raise exception 'O paciente ainda está no cadastro.' using errcode = '42501';
  end if;
  delete from public.patient_health where patient_id = p_id;
end $$;

grant execute on function public.delete_patient_health(text) to authenticated;
revoke execute on function public.delete_patient_health(text) from anon;

-- Limpeza única: dados de saúde de pacientes que já não estão no cadastro
delete from public.patient_health h
 where not exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
                    where d.path = 'patients/all' and x ->> 'id' = h.patient_id);

-- Conferência: deve mostrar 1 e 0
select (select count(*) from pg_proc where proname = 'delete_patient_health' and pronamespace = 'public'::regnamespace) as funcao_criada,
       (select count(*) from public.patient_health h
         where not exists (select 1 from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) x
                            where d.path = 'patients/all' and x ->> 'id' = h.patient_id)) as saude_solta;
