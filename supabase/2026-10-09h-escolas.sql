-- 2026-10-09h — Cadastros → Escolas: 65 escolas de Blumenau, Gaspar, Timbó e Ilhota (nome, município, telefone).
--   * Escola que ainda não existe (mesmo nome, sem diferenciar maiúscula/acento): é incluída.
--   * Escola que já existe: só preenche Município, Telefone e Contato que estiverem em branco
--     (não troca o que já foi digitado).
--   * Nenhuma escola é excluída. A EBM Alberto Stein tem dois números: o 2º vai em "Contato na escola".
-- Pode rodar mais de uma vez.

begin;

create temp table esc_novas (ord int, name text, municipio text, telefone text, contato text) on commit drop;
insert into esc_novas values
  ( 1, 'Colégio Sagrada Família', 'Blumenau', '(47) 3326-0232', ''),
  ( 2, 'Colégio Bom Jesus Santo Antônio', 'Blumenau', '(47) 2102-3500', ''),
  ( 3, 'Escola Barão do Rio Branco', 'Blumenau', '(47) 3322-6133', ''),
  ( 4, 'Colégio Visão Blumenau', 'Blumenau', '(47) 3232-5450', ''),
  ( 5, 'Dual International School', 'Blumenau', '(47) 3285-3586', ''),
  ( 6, 'Escola Infantil Doce Lar', 'Blumenau', '(47) 3037-3289', ''),
  ( 7, 'Escola Infantil Montessori Eureka', 'Blumenau', '(47) 99212-3984', ''),
  ( 8, 'Escola Happy Kids', 'Blumenau', '(47) 3327-0472', ''),
  ( 9, 'Doce Infância Montessori', 'Blumenau', '(47) 99104-9716', ''),
  (10, 'EBM Alberto Stein', 'Blumenau', '(47) 3381-6353', 'Também: (47) 3381-6354'),
  (11, 'EBM Almirante Tamandaré', 'Blumenau', '(47) 3381-6152', ''),
  (12, 'EBM Anita Garibaldi', 'Blumenau', '(47) 3381-7404', ''),
  (13, 'EBM Bilíngue Annemarie Techentin', 'Blumenau', '(47) 3381-6173', ''),
  (14, 'EBM Bilíngue Duque de Caxias', 'Blumenau', '(47) 3381-6381', ''),
  (15, 'EBM Bilíngue Gustavo Richard', 'Blumenau', '(47) 3381-6286', ''),
  (16, 'EBM Bilíngue Olga Rutzen', 'Blumenau', '(47) 3381-6406', ''),
  (17, 'EBM Bilíngue Prof. Oscar Unbehaun', 'Blumenau', '(47) 3381-6362', ''),
  (18, 'EBM General Lúcio Esteves', 'Blumenau', '(47) 3381-7444', ''),
  (19, 'EEB Bruno Hoeltgebaum', 'Blumenau', '(47) 3378-8672', ''),
  (20, 'EEB Luiz Delfino', 'Blumenau', '(47) 3378-8375', ''),
  (21, 'EEB Santos Dumont', 'Blumenau', '(47) 3378-8686', ''),
  (22, 'EEB Professora Aninha Pamplona Rosa', 'Gaspar', '(47) 3091-2221', ''),
  (23, 'EEB Belchior Vereador Laurentino Schmitt', 'Gaspar', '(47) 3091-2222', ''),
  (24, 'EEB Professora Dolores Luzia dos Santos Krauss', 'Gaspar', '(47) 3091-2223', ''),
  (25, 'EEB Ervino Venturi', 'Gaspar', '(47) 3091-2224', ''),
  (26, 'EEB Ferandino Dagnoni', 'Gaspar', '(47) 3091-2225', ''),
  (27, 'EEB Luiz Franzói', 'Gaspar', '(47) 3091-2226', ''),
  (28, 'EEB Mário Pederneiras', 'Gaspar', '(47) 3091-2227', ''),
  (29, 'EEB Norma Mônica Sabel', 'Gaspar', '(47) 3091-2228', ''),
  (30, 'EEB Professor Rudolfo Günther', 'Gaspar', '(47) 3091-2229', ''),
  (31, 'EEB Professora Angélica de Souza Costa', 'Gaspar', '(47) 3091-2230', ''),
  (32, 'EEB Professor Vitório Anacleto Cardoso', 'Gaspar', '(47) 3091-2231', ''),
  (33, 'EEB Zenaide Schmitt Costa', 'Gaspar', '(47) 3091-2232', ''),
  (34, 'EEB Professor Olímpio Moretto', 'Gaspar', '(47) 3091-2233', ''),
  (35, 'EEF Professora Ana Lira', 'Gaspar', '(47) 3091-2234', ''),
  (36, 'Escola Municipal Erwin Prade', 'Timbó', '(47) 3380-7733', ''),
  (37, 'Escola Municipal Maurício Germer', 'Timbó', '(47) 3380-7735', ''),
  (38, 'Escola Municipal Padre Martinho Stein', 'Timbó', '(47) 3380-7747', ''),
  (39, 'Escola Municipal Professor Nestor Margarida', 'Timbó', '(47) 3380-7755', ''),
  (40, 'Escola Municipal Polidoro Santiago', 'Timbó', '(47) 3380-7878', ''),
  (41, 'Escola Municipal São Roque', 'Timbó', '(47) 3380-7770', ''),
  (42, 'Escola Municipal Tiroleses', 'Timbó', '(47) 3380-7780', ''),
  (43, 'NEI Arco-Íris', 'Timbó', '(47) 3380-7820', ''),
  (44, 'NEI Beija-Flor', 'Timbó', '(47) 3380-7825', ''),
  (45, 'NEI Lar da Criança', 'Timbó', '(47) 3380-7830', ''),
  (46, 'NEI Luar Encantado', 'Timbó', '(47) 3380-7838', ''),
  (47, 'NEI Mundo Mágico', 'Timbó', '(47) 3380-7840', ''),
  (48, 'NEI Paraíso da Criança', 'Timbó', '(47) 3380-7845', ''),
  (49, 'NEI Primeiros Passos', 'Timbó', '(47) 3380-7850', ''),
  (50, 'NEI Raio de Sol', 'Timbó', '(47) 3380-7855', ''),
  (51, 'NEI Sonho da Criança', 'Timbó', '(47) 3380-7860', ''),
  (52, 'NEI Vida de Criança', 'Timbó', '(47) 3380-7765', ''),
  (53, 'NEI Professora Maria Luiza Bell', 'Timbó', '(47) 3380-7870', ''),
  (54, 'E.M. Alberto Schmitt', 'Ilhota', '(47) 3343-1647', ''),
  (55, 'E.M. Domingos José Machado', 'Ilhota', '(47) 3343-1305', ''),
  (56, 'E.M. José Elias de Oliveira', 'Ilhota', '(47) 3343-1756', ''),
  (57, 'E.M.M. Pedro Teixeira de Melo', 'Ilhota', '(47) 3255-0379', ''),
  (58, 'EEB Marcos Konder', 'Ilhota', '(47) 3378-8278', ''),
  (59, 'EEB Valério Gomes', 'Ilhota', '(47) 3378-8473', ''),
  (60, 'CEI Chapeuzinho Vermelho', 'Ilhota', '(47) 3343-0296', ''),
  (61, 'CEI Tia Flor', 'Ilhota', '(47) 3171-0026', ''),
  (62, 'CEI Tia Loli', 'Ilhota', '(47) 3343-7188', ''),
  (63, 'CEI Vó Rosa', 'Ilhota', '(47) 3343-7333', ''),
  (64, 'CEI Vó Varda', 'Ilhota', '(47) 3343-1002', ''),
  (65, 'CEI Vovô Juca', 'Ilhota', '(47) 3343-1362', '');

create temp table esc_atual on commit drop as
select i, e, lower(translate(trim(e ->> 'name'), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as k
  from public.documents d, jsonb_array_elements(coalesce(d.data -> 'list', '[]'::jsonb)) with ordinality x(e, i)
 where d.path = 'config/schools';

create temp table esc_par on commit drop as
select distinct on (a.k) a.i, n.*
  from esc_novas n join esc_atual a on a.k = lower(translate(trim(n.name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
 order by a.k, a.i;

insert into public.documents (path, data)
select 'config/schools', jsonb_build_object('list', coalesce((
  select jsonb_agg(item order by grp, pos) from (
    -- já cadastradas: completa só os campos em branco
    select 1 as grp, a.i as pos,
           case when p.i is null then a.e
                when coalesce(trim(a.e ->> 'municipio'), '') <> '' and coalesce(trim(a.e ->> 'telefone'), '') <> ''
                     and (p.contato = '' or coalesce(trim(a.e ->> 'contato'), '') <> '') then a.e
                else a.e || jsonb_build_object(
                       'municipio', coalesce(nullif(trim(a.e ->> 'municipio'), ''), p.municipio),
                       'telefone',  coalesce(nullif(trim(a.e ->> 'telefone'), ''), p.telefone),
                       'contato',   coalesce(nullif(trim(a.e ->> 'contato'), ''), p.contato),
                       '_upd', jsonb_build_object('por', 'Cadastro de escolas', 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
           end as item
      from esc_atual a left join esc_par p on p.i = a.i
    union all
    -- novas
    select 2, n.ord, jsonb_strip_nulls(jsonb_build_object('id', 'es-' || md5(lower(n.name)), 'name', n.name,
                       'municipio', n.municipio, 'telefone', n.telefone, 'contato', nullif(n.contato, ''),
                       '_upd', jsonb_build_object('por', 'Cadastro de escolas', 'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
      from esc_novas n where not exists (select 1 from esc_par p where p.ord = n.ord)
  ) s), '[]'::jsonb))
on conflict (path) do update set data = excluded.data;

-- Conferência: escolas da lista que já existiam no cadastro
select name as ja_existia, municipio, telefone from esc_par order by ord;

commit;

-- Conferência: deve mostrar 65 (todas as escolas da lista estão no cadastro com município)
select count(distinct lower(translate(trim(e ->> 'name'), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))) as escolas_da_lista_no_cadastro
  from public.documents d, jsonb_array_elements(d.data -> 'list') e
 where d.path = 'config/schools' and coalesce(trim(e ->> 'municipio'), '') <> ''
   and lower(translate(trim(e ->> 'name'), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) in (
     'colegio sagrada familia',
     'colegio bom jesus santo antonio',
     'escola barao do rio branco',
     'colegio visao blumenau',
     'dual international school',
     'escola infantil doce lar',
     'escola infantil montessori eureka',
     'escola happy kids',
     'doce infancia montessori',
     'ebm alberto stein',
     'ebm almirante tamandare',
     'ebm anita garibaldi',
     'ebm bilingue annemarie techentin',
     'ebm bilingue duque de caxias',
     'ebm bilingue gustavo richard',
     'ebm bilingue olga rutzen',
     'ebm bilingue prof. oscar unbehaun',
     'ebm general lucio esteves',
     'eeb bruno hoeltgebaum',
     'eeb luiz delfino',
     'eeb santos dumont',
     'eeb professora aninha pamplona rosa',
     'eeb belchior vereador laurentino schmitt',
     'eeb professora dolores luzia dos santos krauss',
     'eeb ervino venturi',
     'eeb ferandino dagnoni',
     'eeb luiz franzoi',
     'eeb mario pederneiras',
     'eeb norma monica sabel',
     'eeb professor rudolfo gunther',
     'eeb professora angelica de souza costa',
     'eeb professor vitorio anacleto cardoso',
     'eeb zenaide schmitt costa',
     'eeb professor olimpio moretto',
     'eef professora ana lira',
     'escola municipal erwin prade',
     'escola municipal mauricio germer',
     'escola municipal padre martinho stein',
     'escola municipal professor nestor margarida',
     'escola municipal polidoro santiago',
     'escola municipal sao roque',
     'escola municipal tiroleses',
     'nei arco-iris',
     'nei beija-flor',
     'nei lar da crianca',
     'nei luar encantado',
     'nei mundo magico',
     'nei paraiso da crianca',
     'nei primeiros passos',
     'nei raio de sol',
     'nei sonho da crianca',
     'nei vida de crianca',
     'nei professora maria luiza bell',
     'e.m. alberto schmitt',
     'e.m. domingos jose machado',
     'e.m. jose elias de oliveira',
     'e.m.m. pedro teixeira de melo',
     'eeb marcos konder',
     'eeb valerio gomes',
     'cei chapeuzinho vermelho',
     'cei tia flor',
     'cei tia loli',
     'cei vo rosa',
     'cei vo varda',
     'cei vovo juca');
