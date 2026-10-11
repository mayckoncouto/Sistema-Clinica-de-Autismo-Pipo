-- 2026-10-11c — Correção de português nos textos do CRM e nos cadastros (pedido do usuário, 2026-10-11)
-- Decisões do usuário: corrigir títulos, descrições e comentários das tarefas; "Cordenação" → "Coordenação"
-- (tipo de colaborador); nomes de paciente com espaço duplo; Nome e Telefone obrigatórios no cadastro do
-- paciente e nos dois links de cadastro (rápido e permanente).
-- Só troca palavras com um único jeito certo (lista abaixo), palavra inteira, mantendo maiúsculas
-- (ultimo → último, Ultimo → Último, ULTIMO → ÚLTIMO). Não mexe em e-mails, endereços de site nem em
-- palavras que dependem da frase (as/às, esta/está, pais/país, analise/análise…).
-- Antes de trocar, guarda o texto antigo em public.correcoes_texto_2026_10_11 (dá para desfazer).
-- O histórico das tarefas não ganha "alterou o título" (marca pipo.restore, como na restauração do Backup).
-- Pode rodar de novo (o que já foi corrigido não muda mais).

create table if not exists public.correcoes_texto_2026_10_11 (
  tabela text not null, id text not null, campo text not null, antes text, depois text,
  em timestamptz not null default now()
);
alter table public.correcoes_texto_2026_10_11 enable row level security;
revoke all on public.correcoes_texto_2026_10_11 from public, anon, authenticated;

create or replace function pg_temp.pipo_words() returns text language sql immutable as $$ select 'anamnesse|anteciapado|apartir|aspeger|atendimeneto|atendimentoo|atenimento|aterar|atrazado|atualiado|avalição|blumeau|bulling|carêcia|cancelemto|cíinica|cologar|compusão|compussão|cooparticipação|cordenação|cordenador|endicaram|esquisofrenia|alicota|exatemente|execusão|execussão|finaliado|flortime|fonoaudilogia|fonoaudiólogia|hapyvida|imserssão|incício|inicar|intenssificar|interrvenção|mäe|negariva|neuropisicológia|orienação|padrastro|palno|parcitular|paticular|pesoalmente|piscologa|poderimos|preença|psciologia|psicólogica|psicomotrocidade|quatidade|reccorrente|recorentes|relaatórios|relatóio|relizadas|regunião|rescente|retormar|senssorial|sermana|solicitarção|subistituir|terapetico|terpia|trastorno|vericar|veriricar|útima|eviamos|denascimento|kamban|kanbam|iriamos|inumeras|cobranaça|nao|ja|mae|voce|tambem|sessoes|sessao|possivel|proxima|proximo|proximas|proximos|numero|numeros|duvida|duvidas|relatorio|relatorios|horario|horarios|ultimo|ultima|ultimos|periodo|familia|clinica|clinicas|medico|sera|atras|amanha|manha|sabado|usuario|usuarios|formulario|formularios|disponivel|disponiveis|urgencia|calendario|historico|experiencia|experiencias|transferencia|conferencia|estagio|alvara|compativel|beneficios|beneficiario|beneficiarios|endereco|profissao|incluida|incluidas|incluido|automatica|automatico|automaticos|economica|emprestimo|assistencia|distancia|dedutiveis|inteligencia|licenca|maximo|exportacao|favoravel|fisica|impressao|indicacao|juridica|validas|valido|varios|psicologos|graficos|divorcio|dominio|equivoco|especificos|depressao|exclusao|tabeliao|tramites|transito|convenio|convenios|multiplos|contabil|musica|ate|mes|preferencia|psicologa|psicologo|psicologico|psicologica|diagnostico|inicio|neuropsicologica|terapeutico|nivel|apos|agua|vinculo|saude'::text $$;

create or replace function pg_temp.pipo_fix(p text) returns text language plpgsql as $$
declare r record; t text := p; pre text := '(?<![@./\w-])'; pos text := '(?![\w@-]|\.\w)';
begin
  if t is null then return null; end if;
  -- Passada rápida: texto sem nenhuma das palavras volta como está (as trocas só rodam nos que têm).
  if t !~* (pre || '(' || pg_temp.pipo_words() || ')' || pos) then return t; end if;
  for r in select * from (values
    ('anamnesse', 'anamnese'),
    ('anteciapado', 'antecipado'),
    ('apartir', 'a partir'),
    ('aspeger', 'asperger'),
    ('atendimeneto', 'atendimento'),
    ('atendimentoo', 'atendimento'),
    ('atenimento', 'atendimento'),
    ('aterar', 'alterar'),
    ('atrazado', 'atrasado'),
    ('atualiado', 'atualizado'),
    ('avalição', 'avaliação'),
    ('blumeau', 'blumenau'),
    ('bulling', 'bullying'),
    ('carêcia', 'carência'),
    ('cancelemto', 'cancelamento'),
    ('cíinica', 'clínica'),
    ('cologar', 'colocar'),
    ('compusão', 'compulsão'),
    ('compussão', 'compulsão'),
    ('cooparticipação', 'coparticipação'),
    ('cordenação', 'coordenação'),
    ('cordenador', 'coordenador'),
    ('endicaram', 'indicaram'),
    ('esquisofrenia', 'esquizofrenia'),
    ('alicota', 'alíquota'),
    ('exatemente', 'exatamente'),
    ('execusão', 'execução'),
    ('execussão', 'execução'),
    ('finaliado', 'finalizado'),
    ('flortime', 'floortime'),
    ('fonoaudilogia', 'fonoaudiologia'),
    ('fonoaudiólogia', 'fonoaudiologia'),
    ('hapyvida', 'hapvida'),
    ('imserssão', 'imersão'),
    ('incício', 'início'),
    ('inicar', 'iniciar'),
    ('intenssificar', 'intensificar'),
    ('interrvenção', 'intervenção'),
    ('mäe', 'mãe'),
    ('negariva', 'negativa'),
    ('neuropisicológia', 'neuropsicologia'),
    ('orienação', 'orientação'),
    ('padrastro', 'padrasto'),
    ('palno', 'plano'),
    ('parcitular', 'particular'),
    ('paticular', 'particular'),
    ('pesoalmente', 'pessoalmente'),
    ('piscologa', 'psicóloga'),
    ('poderimos', 'poderíamos'),
    ('preença', 'preencha'),
    ('psciologia', 'psicologia'),
    ('psicólogica', 'psicológica'),
    ('psicomotrocidade', 'psicomotricidade'),
    ('quatidade', 'quantidade'),
    ('reccorrente', 'recorrente'),
    ('recorentes', 'recorrentes'),
    ('relaatórios', 'relatórios'),
    ('relatóio', 'relatório'),
    ('relizadas', 'realizadas'),
    ('regunião', 'reunião'),
    ('rescente', 'recente'),
    ('retormar', 'retomar'),
    ('senssorial', 'sensorial'),
    ('sermana', 'semana'),
    ('solicitarção', 'solicitação'),
    ('subistituir', 'substituir'),
    ('terapetico', 'terapêutico'),
    ('terpia', 'terapia'),
    ('trastorno', 'transtorno'),
    ('vericar', 'verificar'),
    ('veriricar', 'verificar'),
    ('útima', 'última'),
    ('eviamos', 'enviamos'),
    ('denascimento', 'de nascimento'),
    ('kamban', 'kanban'),
    ('kanbam', 'kanban'),
    ('iriamos', 'iríamos'),
    ('inumeras', 'inúmeras'),
    ('cobranaça', 'cobrança'),
    ('nao', 'não'),
    ('ja', 'já'),
    ('mae', 'mãe'),
    ('voce', 'você'),
    ('tambem', 'também'),
    ('sessoes', 'sessões'),
    ('sessao', 'sessão'),
    ('possivel', 'possível'),
    ('proxima', 'próxima'),
    ('proximo', 'próximo'),
    ('proximas', 'próximas'),
    ('proximos', 'próximos'),
    ('numero', 'número'),
    ('numeros', 'números'),
    ('duvida', 'dúvida'),
    ('duvidas', 'dúvidas'),
    ('relatorio', 'relatório'),
    ('relatorios', 'relatórios'),
    ('horario', 'horário'),
    ('horarios', 'horários'),
    ('ultimo', 'último'),
    ('ultima', 'última'),
    ('ultimos', 'últimos'),
    ('periodo', 'período'),
    ('familia', 'família'),
    ('clinica', 'clínica'),
    ('clinicas', 'clínicas'),
    ('medico', 'médico'),
    ('sera', 'será'),
    ('atras', 'atrás'),
    ('amanha', 'amanhã'),
    ('manha', 'manhã'),
    ('sabado', 'sábado'),
    ('usuario', 'usuário'),
    ('usuarios', 'usuários'),
    ('formulario', 'formulário'),
    ('formularios', 'formulários'),
    ('disponivel', 'disponível'),
    ('disponiveis', 'disponíveis'),
    ('urgencia', 'urgência'),
    ('calendario', 'calendário'),
    ('historico', 'histórico'),
    ('experiencia', 'experiência'),
    ('experiencias', 'experiências'),
    ('transferencia', 'transferência'),
    ('conferencia', 'conferência'),
    ('estagio', 'estágio'),
    ('alvara', 'alvará'),
    ('compativel', 'compatível'),
    ('beneficios', 'benefícios'),
    ('beneficiario', 'beneficiário'),
    ('beneficiarios', 'beneficiários'),
    ('endereco', 'endereço'),
    ('profissao', 'profissão'),
    ('incluida', 'incluída'),
    ('incluidas', 'incluídas'),
    ('incluido', 'incluído'),
    ('automatica', 'automática'),
    ('automatico', 'automático'),
    ('automaticos', 'automáticos'),
    ('economica', 'econômica'),
    ('emprestimo', 'empréstimo'),
    ('assistencia', 'assistência'),
    ('distancia', 'distância'),
    ('dedutiveis', 'dedutíveis'),
    ('inteligencia', 'inteligência'),
    ('licenca', 'licença'),
    ('maximo', 'máximo'),
    ('exportacao', 'exportação'),
    ('favoravel', 'favorável'),
    ('fisica', 'física'),
    ('impressao', 'impressão'),
    ('indicacao', 'indicação'),
    ('juridica', 'jurídica'),
    ('validas', 'válidas'),
    ('valido', 'válido'),
    ('varios', 'vários'),
    ('psicologos', 'psicólogos'),
    ('graficos', 'gráficos'),
    ('divorcio', 'divórcio'),
    ('dominio', 'domínio'),
    ('equivoco', 'equívoco'),
    ('especificos', 'específicos'),
    ('depressao', 'depressão'),
    ('exclusao', 'exclusão'),
    ('tabeliao', 'tabelião'),
    ('tramites', 'trâmites'),
    ('transito', 'trânsito'),
    ('convenio', 'convênio'),
    ('convenios', 'convênios'),
    ('multiplos', 'múltiplos'),
    ('contabil', 'contábil'),
    ('musica', 'música'),
    ('ate', 'até'),
    ('mes', 'mês'),
    ('preferencia', 'preferência'),
    ('psicologa', 'psicóloga'),
    ('psicologo', 'psicólogo'),
    ('psicologico', 'psicológico'),
    ('psicologica', 'psicológica'),
    ('diagnostico', 'diagnóstico'),
    ('inicio', 'início'),
    ('neuropsicologica', 'neuropsicológica'),
    ('terapeutico', 'terapêutico'),
    ('nivel', 'nível'),
    ('apos', 'após'),
    ('agua', 'água'),
    ('vinculo', 'vínculo'),
    ('saude', 'saúde')
  ) v(e, c) loop
    t := regexp_replace(t, pre || r.e || pos, r.c, 'g');
    t := regexp_replace(t, pre || upper(left(r.e, 1)) || substr(r.e, 2) || pos, upper(left(r.c, 1)) || substr(r.c, 2), 'g');
    t := regexp_replace(t, pre || upper(r.e) || pos, upper(r.c), 'g');
  end loop;
  return t;
end $$;

select set_config('pipo.restore', '1', true);

-- 1. Tarefas: título e descrição
insert into public.correcoes_texto_2026_10_11 (tabela, id, campo, antes, depois)
select 'tasks', id::text, 'title', title, pg_temp.pipo_fix(title) from public.tasks where pg_temp.pipo_fix(title) is distinct from title;
insert into public.correcoes_texto_2026_10_11 (tabela, id, campo, antes, depois)
select 'tasks', id::text, 'description', description, pg_temp.pipo_fix(description) from public.tasks where pg_temp.pipo_fix(description) is distinct from description;
update public.tasks t set title = c.depois from public.correcoes_texto_2026_10_11 c
 where c.tabela = 'tasks' and c.campo = 'title' and c.id = t.id::text and t.title = c.antes;
update public.tasks t set description = c.depois from public.correcoes_texto_2026_10_11 c
 where c.tabela = 'tasks' and c.campo = 'description' and c.id = t.id::text and t.description = c.antes;

-- 2. Comentários
insert into public.correcoes_texto_2026_10_11 (tabela, id, campo, antes, depois)
select 'task_events', id::text, 'body', body, pg_temp.pipo_fix(body) from public.task_events
 where kind = 'comment' and pg_temp.pipo_fix(body) is distinct from body;
update public.task_events e set body = c.depois from public.correcoes_texto_2026_10_11 c
 where c.tabela = 'task_events' and c.campo = 'body' and c.id = e.id::text and e.body = c.antes;

-- 3. Tipo de colaborador "Cordenação" → "Coordenação"
insert into public.correcoes_texto_2026_10_11 (tabela, id, campo, antes, depois)
select 'documents', 'config/staff_types:' || (x ->> 'id'), 'name', x ->> 'name', 'Coordenação'
  from public.documents d, jsonb_array_elements(d.data -> 'list') x
 where d.path = 'config/staff_types' and x ->> 'name' = 'Cordenação';
update public.documents d set data = jsonb_set(d.data, '{list}', (
  select jsonb_agg(case when x ->> 'name' = 'Cordenação' then jsonb_set(x, '{name}', '"Coordenação"') else x end order by n)
    from jsonb_array_elements(d.data -> 'list') with ordinality y(x, n)))
 where d.path = 'config/staff_types' and d.data::text like '%Cordenação%';

-- 4. Nomes de paciente com espaços a mais (só no cadastro: esses nomes não aparecem em agendamentos)
insert into public.correcoes_texto_2026_10_11 (tabela, id, campo, antes, depois)
select 'documents', 'patients/all:' || (x ->> 'id'), 'nome', x ->> 'nome', btrim(regexp_replace(x ->> 'nome', '\s+', ' ', 'g'))
  from public.documents d, jsonb_array_elements(d.data -> 'list') x
 where d.path = 'patients/all' and x ->> 'nome' is distinct from btrim(regexp_replace(x ->> 'nome', '\s+', ' ', 'g'));
update public.documents d set data = jsonb_set(d.data, '{list}', (
  select jsonb_agg(case when x ? 'nome' then jsonb_set(x, '{nome}', to_jsonb(btrim(regexp_replace(x ->> 'nome', '\s+', ' ', 'g')))) else x end order by n)
    from jsonb_array_elements(d.data -> 'list') with ordinality y(x, n)))
 where d.path = 'patients/all'
   and exists (select 1 from jsonb_array_elements(d.data -> 'list') x where x ->> 'nome' is distinct from btrim(regexp_replace(x ->> 'nome', '\s+', ' ', 'g')));

-- 5. Nome e Telefone obrigatórios no cadastro do paciente e nos dois links
update public.documents set data = jsonb_set(jsonb_set(jsonb_set(
    coalesce(data, '{}'::jsonb) || jsonb_build_object('fields', coalesce(data -> 'fields', '{}'::jsonb) || '{"telefones": {"show": true, "req": true}}'::jsonb),
    '{link}', coalesce(data -> 'link', '{}'::jsonb)),
    '{link,individual}', coalesce(data -> 'link' -> 'individual', '{}'::jsonb) || '{"nome": {"show": true, "req": true}, "telefone": {"show": true, "req": true}}'::jsonb),
    '{link,geral}', coalesce(data -> 'link' -> 'geral', '{}'::jsonb) || '{"nome": {"show": true, "req": true}, "telefone": {"show": true, "req": true}}'::jsonb)
 where path = 'config/patient_fields';

select set_config('pipo.restore', '', true);

-- Conferência: quantos textos foram corrigidos e se os obrigatórios ficaram marcados
select tabela || '.' || campo as onde, count(*) as corrigidos from public.correcoes_texto_2026_10_11 group by 1
union all
select 'obrigatorios_ok', count(*) from public.documents
 where path = 'config/patient_fields' and (data #>> '{fields,telefones,req}')::boolean
   and (data #>> '{link,individual,nome,req}')::boolean and (data #>> '{link,individual,telefone,req}')::boolean
   and (data #>> '{link,geral,nome,req}')::boolean and (data #>> '{link,geral,telefone,req}')::boolean
order by 1;
