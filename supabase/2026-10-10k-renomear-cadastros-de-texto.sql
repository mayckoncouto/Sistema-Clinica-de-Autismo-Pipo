-- =====================================================================
-- Agenda Pipo — renomear Diagnóstico, Origem ou Convênio atualiza quem usa (2026-10-10)
--   Paciente (saúde) e lead do CRM guardam o TEXTO do diagnóstico, da origem e do
--   convênio. Ao corrigir o nome no cadastro, rename_registry_text troca o texto antigo
--   pelo novo nos dados de saúde dos pacientes (diagnóstico) e nos leads das tarefas do
--   CRM — também os que a pessoa não vê. O cadastro dos pacientes e dos tratamentos é
--   atualizado pelo próprio app.
--   Quem pode: Administrador ou quem tem "editar" no cadastro (diagnosticos, origens,
--   convenios).
-- Pode rodar de novo sem estragar.
-- =====================================================================

create or replace function public.rename_registry_text(p_kind text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_mod text; n_health int := 0; n_tasks int := 0;
begin
  v_key := case p_kind when 'diagnosticos' then 'diagnostico' when 'origens' then 'origem' when 'convenios' then 'convenio' end;
  v_mod := p_kind;
  if v_key is null then raise exception 'Cadastro desconhecido: %', p_kind using errcode = '22023'; end if;
  if not (public.is_admin() or public.has_perm(v_mod, 'edit')) then
    raise exception 'Seu nível não pode editar este cadastro.' using errcode = '42501';
  end if;
  if coalesce(trim(p_old), '') = '' or coalesce(trim(p_new), '') = '' or lower(trim(p_old)) = lower(trim(p_new)) then
    return jsonb_build_object('saude', 0, 'tarefas', 0);
  end if;
  if p_kind = 'diagnosticos' then
    update public.patient_health set data = jsonb_set(data, '{cid}', to_jsonb(trim(p_new)))
     where lower(trim(data ->> 'cid')) = lower(trim(p_old));
    get diagnostics n_health = row_count;
  end if;
  update public.tasks set lead = jsonb_set(lead, array[v_key], to_jsonb(trim(p_new)))
   where lead is not null and lower(trim(lead ->> v_key)) = lower(trim(p_old));
  get diagnostics n_tasks = row_count;
  return jsonb_build_object('saude', n_health, 'tarefas', n_tasks);
end $$;
grant execute on function public.rename_registry_text(text, text, text) to authenticated;
revoke execute on function public.rename_registry_text(text, text, text) from anon;

-- Conferência: deve mostrar 1
select count(*) as funcao_criada from pg_proc
 where proname = 'rename_registry_text' and pronamespace = 'public'::regnamespace;
