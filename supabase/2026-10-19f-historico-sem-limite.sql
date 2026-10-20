-- Histórico de Alterações: o limite de 4000 linhas cortava dias inteiros de exclusões em lote.
-- O app agora lê em páginas de 1000; a função passa a entregar até 20000 linhas do período.
create or replace function public.change_log_list(p_area text, p_days integer default 30)
returns table(id bigint, at timestamptz, user_id uuid, user_name text, acao text, tipo text, paciente text, quando text, hora text,
              sala_id text, prof_id text, ref text, antes jsonb, depois jsonb, lote text, lida boolean)
language sql stable set search_path to 'public' as $$
  select c.id, c.at, c.user_id, c.user_name, c.acao, c.tipo, c.paciente, c.quando, c.hora, c.sala_id, c.prof_id, c.ref,
         c.antes, c.depois, c.lote,
         (c.user_id is not distinct from auth.uid() or exists (select 1 from public.change_log_read r where r.log_id = c.id and r.user_id = auth.uid()))
    from public.change_log c
   where c.area = p_area and c.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
   order by c.at desc, c.id desc
   limit 20000;
$$;
