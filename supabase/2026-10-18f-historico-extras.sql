-- Histórico de Alterações: contador de não lidas e aviso (push) de exclusão em lote (2026-10-18)

create index if not exists change_log_lote_idx on public.change_log (lote);

-- Não lidas da pessoa (últimos 30 dias, sem as dela e sem mudança de status).
create or replace function public.change_log_unread(p_area text)
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::integer
    from public.change_log c
   where c.area = p_area and c.at >= now() - interval '30 days'
     and c.acao <> 'status'
     and c.user_id is distinct from auth.uid()
     and not exists (select 1 from public.change_log_read r where r.log_id = c.id and r.user_id = auth.uid());
$$;
grant execute on function public.change_log_unread(text) to authenticated;
revoke execute on function public.change_log_unread(text) from anon, public;

-- Quem recebe o aviso: usuários ativos da mesma unidade com "ver" no histórico daquela área (ou Administrador), menos o autor.
create or replace function public.push_delete_targets(p_log bigint)
returns table (user_id uuid, area text, author text, n integer)
language sql stable security definer set search_path = public as $$
  select p.id, c.area, coalesce(nullif(c.user_name, ''), 'Alguém'),
         (select count(*)::integer from public.change_log x where x.lote = c.lote and x.user_id is not distinct from c.user_id and x.acao = 'excluiu')
    from public.change_log c
    join public.profiles p on p.active and p.id is distinct from c.user_id and p.unit_id = c.unit_id
    join public.roles r on r.id = p.role_id
   where c.id = p_log
     and (r.is_admin or coalesce((r.permissions -> ('historico_' || c.area) ->> 'view')::boolean, false));
$$;
revoke execute on function public.push_delete_targets(bigint) from public, anon, authenticated;
grant execute on function public.push_delete_targets(bigint) to service_role;

-- Dispara o aviso quando a mesma gravação passa de 9 exclusões (uma vez por gravação).
create or replace function public.change_log_push_del()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lote is not null and (select count(*) from public.change_log x where x.lote = new.lote and x.user_id is not distinct from new.user_id and x.acao = 'excluiu') = 10 then
    perform public.push_call(jsonb_build_object('tipo', 'exclusao', 'log', new.id));
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke execute on function public.change_log_push_del() from public, anon, authenticated;
create trigger change_log_push_del after insert on public.change_log
  for each row when (new.acao = 'excluiu') execute function public.change_log_push_del();
