-- Permissão "CRM" (2026-10-09)
-- Em Níveis de permissão, o grupo CRM começa pela permissão "CRM" (chave crm_listas):
--   ver   = botão CRM do topo (tela CRM, Minhas tarefas) e a janela Listas e status;
--   incluir / editar / excluir = listas e seus status.
-- Depois vem uma linha por lista (crm_<lista>), como antes.
-- Este script dá "ver" em CRM aos níveis que já enxergam alguma lista do CRM, para ninguém perder o
-- botão CRM. Incluir/editar/excluir ficam desmarcados (o Administrador marca se quiser).
-- Pode rodar de novo (não mexe em nível que já tem o item gravado).

update public.roles r
   set permissions = coalesce(r.permissions, '{}'::jsonb) ||
       jsonb_build_object('crm_listas', jsonb_build_object('view', true, 'create', false, 'edit', false, 'delete', false))
 where not coalesce(r.is_admin, false)
   and not (coalesce(r.permissions, '{}'::jsonb) ? 'crm_listas')
   and exists (
     select 1 from jsonb_each(coalesce(r.permissions, '{}'::jsonb)) e
      where e.key like 'crm\_%' and e.key <> 'crm_listas'
        and jsonb_typeof(e.value) = 'object' and coalesce((e.value->>'view')::boolean, false)
   );

-- Conferência: níveis e se veem o CRM
select name as nivel, coalesce(is_admin, false) or coalesce((permissions->'crm_listas'->>'view')::boolean, false) as ve_crm
  from public.roles order by name;
