-- 2026-10-06e: "Sem vencimento" passa a valer para TODOS os tratamentos existentes
-- (pedido do usuário: escolha padrão, atualizar todos). Quem quiser vencimento por
-- data ou por sessões escolhe de novo na janela do tratamento.
-- Os campos duracaoMeses, validoAte e totalSessoes ficam guardados (só não valem).
update public.documents
   set data = jsonb_set(data, '{list}', (
         select coalesce(jsonb_agg(x || '{"vencPor":"sem"}'::jsonb order by ord), '[]'::jsonb)
           from jsonb_array_elements(coalesce(data->'list', '[]'::jsonb)) with ordinality t(x, ord)))
 where path = 'treatments/all';
