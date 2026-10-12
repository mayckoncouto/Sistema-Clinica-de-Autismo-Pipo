-- Sala com campo ABA (Sim/Não) no cadastro: aba = true nas salas que já têm "ABA" no nome; false nas outras
-- (grupos de suporte não têm o campo). O nome continua mostrando "… ABA" (o cadastro monta o nome sozinho).
update public.documents d
   set data = jsonb_set(d.data, '{list}', (
     select coalesce(jsonb_agg(
       case when coalesce((r ->> 'group')::boolean, false) then r
            else r || jsonb_build_object('aba', (r ->> 'name') ~* '\yABA\y') end
       order by ord), '[]'::jsonb)
       from jsonb_array_elements(d.data -> 'list') with ordinality as t(r, ord)))
 where d.path = 'config/rooms' and jsonb_typeof(d.data -> 'list') = 'array';

select (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') r where d.path = 'config/rooms' and (r ->> 'aba') = 'true') as salas_aba,
       (select count(*) from public.documents d, jsonb_array_elements(d.data -> 'list') r where d.path = 'config/rooms' and (r ->> 'aba') = 'false') as salas_sem_aba;
