# Agenda Pipo — contexto do projeto

Este arquivo existe para dar contexto a uma sessão do Claude Code (ou de qualquer
outra ferramenta Claude) que for trabalhar neste repositório sem ter visto as
conversas anteriores no Cowork/claude.ai onde o app foi construído. Leia isto
inteiro antes de mexer em `agenda.html`.

## O que é

**Agenda Pipo** é o sistema de agendamento de atendimentos da **Clínica de
Autismo Pipo** (Blumenau/SC), substituindo uma planilha Excel (`ABA.xlsm`) que a
clínica usava antes. É uma grade semanal (dias × salas × terapeutas × horários)
onde a recepção marca, desmarca, copia e move atendimentos de pacientes, mais
cadastros de pacientes/profissionais/salas/convênios/especialidades e um
relatório de atendimentos por profissional/especialidade.

O usuário (dono da clínica) opera o sistema sozinho ou com a equipe da recepção,
sem conhecimento técnico — toda a comunicação sobre o projeto acontece em
português, em linguagem de negócio ("quero que...", com prints de tela), não em
termos técnicos. Ele identifica problemas por comportamento visual (uma linha
que deveria ficar cinza e está branca, um texto que deveria dizer "Total" e diz
"Especialidades"), não por causa raiz — cabe a quem for mexer no código
investigar a causa real antes de aplicar a mudança.

## Onde o app "mora"

Isto **não é uma aplicação com servidor próprio**. É publicado como um **Claude
Artifact**: uma página HTML/CSS/JS de arquivo único, publicada via Artifact tool
do Claude, hospedada pela plataforma claude.ai. Não existe backend, banco de
dados tradicional, nem deploy de infraestrutura — "publicar uma nova versão" é
literalmente re-publicar o arquivo `agenda.html` através da ferramenta Artifact
a partir de uma sessão Claude com acesso a esse artifact.

- **App publicado (produção):** https://claude.ai/artifact/C46pNNootZV5QNyjB4AS8o
- Compartilhado como **"Anyone with the link"** (qualquer pessoa com o link) —
  ver seção "Compartilhamento e permissões" abaixo, isso tem implicações reais.
- Versão publicada no momento em que este arquivo foi escrito: **v27**.

Este repositório GitHub existe só como **espelho de código-fonte e histórico**
(para revisão, diffs, backup, e para dar contexto ao Claude Code). Editar o
`agenda.html` aqui e commitar **não atualiza o app ao vivo** — isso só acontece
quando alguém (tipicamente eu, via ferramenta Artifact, dentro de uma sessão
Claude) republica o arquivo no artifact acima.

## Plataforma: capabilities do Claude Artifact

O app declara as capabilities `db` (armazenamento compartilhado, tipo
documento/coleção) e `user` (identidade do visitante, com `scopes:["profile"]`
seria necessário para nomes/typeahead — hoje **não** está declarado, então
`user.profiles()`/`user.search()` não funcionam ainda; isso é relevante para o
sistema de permissões pendente, ver abaixo).

- `db`: todos os dados reais (pacientes, profissionais, salas, agendamentos,
  convênios, especialidades) ficam em documentos da capability `db`, **nunca**
  hardcoded no HTML. Regra por padrão: quem tem nível `interact`
  (Contribuidor) ou acima consegue escrever; `view` (Visualizador/Comentarista)
  só lê. Isso é reforçado pela própria plataforma, não é só uma checagem de UI.
- `user`: usado hoje só para `canEdit()`/`can("data.write")`, que definem
  `state.writable` (mostra o banner de somente-leitura e desabilita edição na
  UI). **Isso é calculado uma vez em `connectDb()`**, não é reativo — se a
  permissão do visitante mudar enquanto a página está aberta, é preciso recarregar.

**Nunca** armazenar segredos/senhas reais no `db` — qualquer pessoa com acesso
de leitura ao artifact consegue ler os documentos. Isso já foi decidido
explicitamente com o usuário (ver "Sistema de login/permissões" abaixo).

## Compartilhamento e permissões (armadilha conhecida)

O usuário já teve o problema de convidar alguém como "Editor" pelo menu
Compartilhar do claude.ai e essa pessoa continuar só conseguindo visualizar.
Causa provável, documentada na própria plataforma: quando o artifact **também**
está compartilhado como "qualquer pessoa com o link" (que é o caso aqui), um
convite individual de Editor para alguém **de fora da organização** do dono não
é aplicado — a pessoa cai para nível de Visualizador mesmo aparecendo como
"Editor" na lista. Isso foi explicado ao usuário; a solução (desativar
"qualquer pessoa com o link" e manter só convites individuais) depende de uma
ação dele no menu Compartilhar da página — **isso não é algo que se resolve no
código**.

## Sistema de login/permissões — decisão de design (pendente, não implementado)

O usuário pediu um sistema de "login e senha" com cadastro de usuários e
permissão por módulo (Agenda, Pacientes, Profissionais, Salas) × ação
(visualizar/incluir/editar/excluir).

**Decisão já tomada e confirmada com o usuário:** não implementar senha
própria (não é seguro nesta plataforma — sem backend, qualquer dado no `db` é
legível por quem tem acesso). Em vez disso: usar a **conta Claude real de cada
pessoa** (convidada pelo menu Compartilhar do claude.ai) como identidade, mais
uma tela "Usuários" dentro do próprio app para atribuir permissões granulares
por módulo/ação a cada pessoa.

**Isso ainda não foi implementado.** Desenho já definido, para continuar depois:

- Documento `config/permissions` no `db`: `{ entries: { "<userId>":
  { agenda:{view,create,edit,delete}, pacientes:{...}, profissionais:{...},
  salas:{...} } } }`.
- Nova regra de acesso no `db` (via `capabilities.db.rules`):
  `{path:"config/permissions", read:"view", write:"admin"}` — só quem tem
  nível Editor/Owner real (do menu Compartilhar) pode escrever o cadastro de
  permissões, fechando a brecha de auto-promoção que só esconder botões na UI
  deixaria aberta (hoje qualquer Contribuidor já tem `interact` bruto em
  qualquer caminho não declarado).
- Mudar a declaração de `user` para `capabilities:{user:{scopes:["profile"]}}`
  para liberar `user.profiles()` (nomes) e `user.search()` (busca de pessoas
  para o seletor de usuário na tela de admin).
- Nova aba "Usuários" (admin): lista de pessoas cadastradas (nome resolvido ao
  vivo via `user.profiles()`, **nunca armazenado**), grade de checkboxes 4
  módulos × 4 ações por pessoa, campo de busca (`user.search(query)`) para
  adicionar, remover pessoa, botão Salvar com o `user.canEdit()` controlando a
  UI (e a regra do `db` controlando de verdade).
- Especialidades/Convênios (sub-cadastros dentro da aba Pacientes) ficam sob a
  permissão do módulo **Pacientes**, não um módulo à parte.
- O lápis de editar sala que aparece no cabeçalho da grade da Agenda
  (`[data-room-edit]`, abre o mesmo `openRoomModal()` da aba Salas) fica sob a
  permissão do módulo **Salas**, não Agenda — ele edita dado de Sala,
  independente de onde foi acionado.
- Botões de bloquear/liberar período na Agenda ficam sob `agenda.edit`.
- Modal de agendamento: "Salvar" usa `agenda.create` (novo) ou `agenda.edit`
  (existente); "Desmarcar" usa `agenda.delete`.
- Copiar/mover só populam `state.clipboard` (não escrevem nada); a ação de
  colar (`pasteToSlot`) que precisa de `agenda.create` (cópia) ou
  `agenda.create` **e** `agenda.delete` (mover, que também limpa a origem).
- **Não decidido ainda:** qual o nível padrão de permissão para alguém que
  ainda não está em `config/permissions.entries` — a ideia até agora era
  padrão "só visualizar", mas isso nunca foi confirmado com o usuário nem
  implementado.
- Ainda faltava mapear, antes de implementar: `pasteToSlot()` completo,
  `openBookingModal()` completo, a função que abre o modal de profissional, e
  os handlers de clique de `pDelete`/`pSave`/`profDelete`/`rmDelete`.

## O que já está implementado (por área)

### Grade da Agenda
- 5 dias (segunda a sexta) × 4 semanas, salas com terapeutas/assentos como
  colunas, horários fixos da manhã e tarde, reunião clínica semanal automática
  às 11:20 (toda segunda, valor padrão "virtual" até alguém sobrescrever).
- Arrastar e soltar, copiar/mover (com barra de clipboard e clique para colar
  em qualquer dia/semana), desmarcar.
- Bloqueio/liberação de período (manhã/tarde) por assento, com confirmação de
  dois cliques.
- Cor de paciente por regra herdada da planilha VBA antiga: ABA="Não" → vermelho;
  senão por idade (0–4 azul, 5–9 verde, 10+ laranja); sem idade numérica e
  ABA≠"Não" → sem cor.
- Cor customizável por especialidade e por sala (aplicada nos agendamentos e no
  cabeçalho da sala).
- Filtro por sala (chips) e busca de paciente na grade (ignora acento e
  maiúscula/minúscula — ver seção de busca abaixo).
- Visualização "todos os dias" / "todas as semanas" combinável (`day=todos`,
  `week=todos`).
- Controle de zoom da grade.
- App usa 100% da largura e altura disponíveis da janela do usuário (não fica
  limitado a `max-width`), inclusive nas abas Pacientes e Relatório.

### Cabeçalho / marca
- Logo real da clínica (imagem fornecida pelo usuário — puzzle-globo colorido),
  recortada e embutida como `data:` URI, substituindo o antigo badge de texto
  "PP".
- Título "Clínica de Autismo Pipo" / subtítulo "Sistema de atendimentos".

### Relatório de atendimentos
- Agregação por profissional e especialidade, calculada **a partir dos
  agendamentos reais** (`schedule/*`), nunca do cadastro de pacientes — ou
  seja, paciente sem nenhum atendimento marcado nunca aparece como linha.
  Linhas especiais "Coordenador" e "Aplicador ABA" somam por sala, sempre
  presentes mesmo com zero.
- Cabeçalhos fixos (sticky) ao rolar e ao filtrar.
- Linha de resumo: **"X pacientes · X profissionais · X atendimentos"** — o "X
  pacientes" conta só pacientes com atendimento de verdade (nunca inclui as
  linhas especiais nem gente sem agendamento).
- Busca por nome de paciente ignora acento e maiúscula/minúscula.

### Pacientes / Profissionais / Salas / Convênios / Especialidades
- Tabela de pacientes ordenável, com colunas redimensionáveis (largura
  persistida em localStorage) e busca (ignora acento/maiúscula).
- Cadastro de convênio e de especialidade com autocomplete "criar se não
  existir" (também ignora acento/maiúscula na busca e na checagem de
  duplicidade).
- Cores customizáveis por especialidade e por sala.

### Linhas estruturais cinza na grade
A coluna de horário (sticky à esquerda) tinha um "risco branco" nas linhas que
não são de dado real: cabeçalho de salas (1ª linha), cabeçalho de profissional
(2ª linha), linha de botões de bloqueio, linha das 12:00 e linha final (18:10).
Isso foi corrigido — essas células agora usam `var(--surface-2)` (cinza) em vez
do branco padrão herdado de `.timecell`/`.corner`.

### Busca sem acento/maiúscula (`normText`)
Há uma função utilitária `normText(s)` (perto de `esc()`/`slugify()`) que
normaliza para minúsculas e remove acentos (`.normalize("NFKD")` + remoção de
marcas combinantes). **Todo campo de busca/filtro/autocomplete do app usa
essa função dos dois lados da comparação** (o que a pessoa digitou e o texto
alvo): busca da grade, lista de Pacientes, Relatório, autocomplete de
paciente/sala no modal de agendamento, autocomplete de convênio e de
especialidade. Comparações que **não** são "campo de busca" de verdade (slug
de id, normalização de "aba", checagem de duplicidade interna não voltada ao
usuário) foram deixadas como estavam, de propósito.

## Armadilhas de CSS já resolvidas (não reintroduzir)

- **Flex "preencher altura restante" precisa de altura definida na raiz.**
  Para uma cadeia `flex:1` (`body` → `.app` → seção da aba → host → wrapper da
  tabela) realmente **limitar** a altura de um descendente (em vez de só
  crescer com o conteúdo, quebrando `overflow:auto` e `position:sticky`), o
  elemento raiz da cadeia (`body`) precisa de `height:100dvh` — **não**
  `min-height:100dvh`. Com `min-height`, o flexbox não tem orçamento fixo pra
  distribuir e cada `flex:1` descendente só cresce para caber o próprio
  conteúdo. Isso já causou um bug real (cabeçalho "sticky" do Relatório não
  ficava fixo com muitos dados) e foi corrigido.
- **`table-layout:fixed` + `width:100%` + `min-width` inline (nunca `width`
  fixo) nas colunas** deixa a tabela esticar proporcionalmente em telas largas
  sem nunca ficar menor que a soma configurada em pixels (cai pra scroll
  horizontal em telas estreitas).
- A célula da coluna de horário é um `<div class="timecell">` **dentro** do
  `<td class="timecol">`, com background próprio — mudar o fundo do `td`/`tr`
  não é suficiente, é preciso mirar `.timecell` (ou uma combinação tipo
  `.periodrow .timecell`) para realmente mudar a cor visível.

## Testes automatizados

Pasta `tests/`, usando **Playwright** com Chromium local (sem depender de
serviço externo). `tests/test.html` é um harness com um `window.__STORE__` /
`window.claude.use()` simulados (mock de `db`/`user`) e um placeholder
`__PAGE_BODY__` onde o conteúdo de `agenda.html` é injetado.

Fluxo pra rodar/atualizar testes depois de mexer em `agenda.html`:

```bash
node tests/build.js     # gera tests/page.html a partir do agenda.html atual
node tests/run_dnd.js   # roda um teste específico, ou use `npm test` pra rodar tudo
```

Cada `run_*.js` cobre uma área: drag&drop, copiar/mover, bloqueio de período,
somente-leitura, cadastros (convênio/especialidade), cores por especialidade,
cor de sala/bloqueio, reunião de segunda, ordenação/redimensionamento da lista
de pacientes, relatório de profissionais, visualização todos-dias/todas-semanas
e zoom, funcionalidades diversas (cor por idade/ABA, sala como "paciente" da
cor da sala), performance de re-render da grade, busca sem acento/maiúscula, e
uma condição de corrida (`run_race.js`).

Lição aprendida: o dataset mock padrão é pequeno (poucos pacientes/
agendamentos) e pode dar **falso positivo** em teste de scroll/sticky (porque
não há conteúdo suficiente pra realmente rolar). Quando for necessário testar
isso de verdade, injete agendamentos sintéticos via
`page.evaluate(async () => { const db = await window.claude.use('db'); ... })`
direto num assento **normal** (não especial) — salas como "Coordenador"/
"Aplicador ABA" colapsam todos os agendamentos numa única linha especial
(`SPECIAL_REPORT_ROWS`), então não servem pra gerar muitas linhas distintas de
teste.

## Nunca versionar dados reais de pacientes

Este repositório **não contém e não deve conter** dados reais de pacientes da
clínica. Em algum momento do desenvolvimento houve arquivos de trabalho com
nomes reais, idades e informações de atendimento (extraídos da planilha antiga
para popular o `db` inicial) — esses arquivos foram **propositalmente
excluídos** deste repositório. Os dados de teste em `tests/test.html` são
100% fictícios ("Paciente Um", "Ana Azul" etc.) e devem continuar assim. Os
dados reais só existem no `db` do artifact publicado, acessível apenas a quem
tem permissão na página — nunca em arquivo de código.

## Como publicar uma alteração

1. Editar `agenda.html`.
2. `node tests/build.js` e rodar a suíte relevante (idealmente tudo, com
   `npm test`) — o app não tem tipos nem build step além disso, então os
   testes são a principal rede de segurança.
3. Publicar o arquivo via ferramenta Artifact do Claude, com `url` apontando
   para o artifact de produção acima (isso **não** pode ser feito pelo Claude
   Code sozinho — precisa de uma sessão Claude com acesso à ferramenta
   Artifact; Claude Code pode preparar a mudança e os testes, mas a
   publicação final é um passo separado, fora deste repositório).
4. Commitar a mudança aqui também, pra manter o histórico do repositório
   alinhado com o que está publicado.
