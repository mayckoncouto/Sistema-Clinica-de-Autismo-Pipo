# Agenda Pipo — contexto do projeto

Este arquivo existe para dar contexto a uma sessão do Claude Code (ou de qualquer
outra ferramenta Claude) que for trabalhar neste repositório sem ter visto as
conversas anteriores no Cowork/claude.ai onde o app foi construído. Leia isto
inteiro antes de mexer em `index.html`.

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

## Onde o app "mora" (desde 2026-09 — Vercel + Supabase)

O app saiu do Claude Artifact e hoje é um **site estático na Vercel com banco
Supabase**:

- **Código:** GitHub `mayckoncouto/Sistema-Clinica-de-Autismo-Pipo`, branch
  `main`. A Vercel está ligada ao repositório: **todo push na `main` publica
  automaticamente**. Não há passo de build.
- **Front-end:** `index.html` (HTML + CSS + JS do app, arquivo único, igual ao
  antigo `agenda.html`) + `js/pipo-supabase.js` (camada de dados/login) +
  `js/usuarios.js` (aba Usuários).
- **Funções serverless** (`api/`): `config.js` entrega URL + chave anon do
  Supabase ao navegador; `admin-users.js` cria/exclui usuários, troca senha e
  ativa/desativa (usa a service role key — só roda no servidor).
- **Banco:** Supabase (Postgres + Auth + Realtime). Esquema completo em
  `supabase/schema.sql`.
- **Variáveis de ambiente na Vercel:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. O projeto usa o **formato novo de chaves**:
  `SUPABASE_ANON_KEY` = *publishable key* (`sb_publishable_...`) e
  `SUPABASE_SERVICE_ROLE_KEY` = *secret key* (`sb_secret_...`). A secret key
  não é JWT: vai só no header `apikey`, nunca em `Authorization`
  (`adminHeaders()` em `api/admin-users.js` trata os dois formatos).
- O antigo artifact (https://claude.ai/artifact/C46pNNootZV5QNyjB4AS8o, v27)
  ficou só como referência histórica; os dados foram migrados dele.

### Como o app fala com o banco

O código do app foi escrito para a API do Artifact —
`window.claude.use("db")` → `db.doc(caminho).onSnapshot/get/set` e
`window.claude.use("user")` → `can()`. **`js/pipo-supabase.js` implementa
exatamente essa API em cima do Supabase**, por isso o app quase não mudou e os
testes continuam usando o mesmo mock.

- Tabela `public.documents (path, data jsonb)`: um registro por "documento",
  com os mesmos caminhos de antes — `config/rooms`, `config/specialties`,
  `config/convenios`, `config/professionals`, `patients/all` e
  `schedule/<seg|ter|qua|qui|sex>-<1..4>`. Uma `check constraint` só aceita
  esses caminhos.
- `onSnapshot` = leitura inicial + um único canal Realtime (`postgres_changes`
  na tabela `documents`) despachado por caminho; ao reconectar, relê tudo.
- `set` = `upsert`. Se falhar, o adaptador relê o documento para desfazer a
  mudança otimista da tela.
- Agendamentos usam `ref.patchBookings(changes)` → RPC `patch_bookings`, que
  aplica só as chaves alteradas numa transação com trava de linha (antes era
  ler-alterar-gravar o dia inteiro, com risco de perder edição simultânea).
  `applyBookingChanges` cai no caminho antigo `get`+`set` quando
  `patchBookings` não existe (mock dos testes).

## Login, usuários e permissões

- Login por **e-mail + senha (Supabase Auth)**. Tela de login montada pelo
  `pipo-supabase.js` por cima do app; `window.claude.use("db")` só resolve
  depois do login, então o app nem começa a carregar dados antes disso.
- Cadastro público de contas deve ficar **desligado** no Supabase; quem cria
  usuários é o administrador. A pessoa troca a senha depois pelo botão
  "Trocar senha" no topo.
- **Permissão por NÍVEL, não por pessoa** (desde 2026-09-30, migração
  `supabase/2026-09-30-niveis-de-permissao.sql`). Tabela `public.roles`
  começou com 4 níveis: `administrador` (is_admin, acesso total, **travado**:
  não pode ser alterado nem excluído — triggers `roles_guard` /
  `roles_before_delete`), `financeiro`, `profissional`, `secretaria`. O
  administrador **cria, renomeia e exclui** níveis (migração
  `2026-09-30b-niveis-editaveis.sql`): nível novo nunca vira admin
  (`roles_before_insert`), nome único sem diferenciar maiúsculas, nível com
  usuários não pode ser excluído. Cada nível tem `permissions` jsonb
  `{agenda|pacientes|profissionais|salas: {view,create,edit,delete}}`;
  `profiles.role_id` aponta o nível.
  Usuários em 2026-09-30: Mayckon = Administrador, Lucas = Secretária.
- No topo, ao lado do nome e do nível, o botão **Acesso ▾** (menu em
  `pipo-supabase.js`): **Usuários** (só Administrador), **Trocar senha**,
  **Sair**. A tela de Usuários NÃO tem botão nas abas principais: o menu
  clica no botão sempre oculto `#mainTabs [data-tab="usuarios"]`.
- Tela **Usuários** (só Administrador): busca por nome/e-mail/nível,
  contador, lista (`.adm-table`), cadastro em janela (nome, e-mail, senha,
  nível, ativar/desativar, excluir — ninguém muda o próprio nível). O botão
  **Níveis de permissão** na barra (igual a "Especialidades" em Pacientes)
  abre a janela com a lista de níveis (`openRolesModal`); clicar num nível
  abre o cadastro dele (nome + grade; excluir pede confirmação) e fechar
  volta para a lista.
  Código em `js/usuarios.js`; o app lê o nível via
  `profiles.select("*, role:roles(*)")` em `pipo-supabase.js`.
- O **primeiro usuário criado no projeto vira Administrador**; os seguintes
  nascem Profissional (só ver) até o admin escolher o nível (trigger
  `handle_new_user`; a API de criação já grava o nível escolhido). O banco
  nunca deixa ficar sem administrador ativo (trigger `profiles_guard`).
- As colunas antigas `profiles.is_admin`/`profiles.permissions` ficaram no
  banco de produção sem uso (transição); podem ser removidas.
- Mapeamento módulo ↔ dados: `schedule/*` → agenda; `patients/all`,
  `config/specialties`, `config/convenios` → pacientes;
  `config/professionals` → profissionais; `config/rooms` → salas. A aba
  Relatório segue `agenda.view`. O lápis de sala no cabeçalho da grade grava
  `config/rooms`, então vale a permissão de **Salas**.
- **Leitura:** qualquer usuário ativo lê todos os documentos (a grade precisa
  de salas/pacientes/profissionais). `view` controla quais abas aparecem.
- **Escrita — conferida no banco**, trigger `documents_enforce`: compara o
  documento antigo com o novo. Listas: item novo = `create`, removido =
  `delete`, alterado ou reordenado = `edit`. Agenda: chave nova = `create`,
  removida = `delete`, alterada = `edit`; bloquear/liberar horário
  (`blocked:true`) = `edit`. Mover = `create` + `delete`.
- No app, `can(module, action)`, `listPermDenied()` e `bookingPermDenied()`
  (perto do topo do script) fazem a mesma conta antes de gravar, só para dar
  uma mensagem clara sem ir ao servidor; `applyPermissionsUI()` esconde abas
  e botões "+ Novo". Sem `window.pipoAuth` (testes) tudo isso vira no-op e
  vale só o `state.writable` antigo.
- Nível trocado ou permissões do nível alteradas chegam ao vivo (Realtime
  em `profiles` e `roles` → `reloadProfile()`);
  usuário desativado é deslogado e tem o login bloqueado (`ban_duration`).

## Planner × Agenda (desde 2026-10-01)

- **Planner** = a grade original de 4 semanas que se repetem (aba
  `data-tab="agenda"`, documentos `schedule/*`, permissão `agenda`). Só o
  rótulo mudou; o identificador interno continua `agenda` (testes dependem).
- **Agenda** (nova, aba `data-tab="agendadia"`) = atendimentos em **datas
  reais**, tabela própria `public.appointments` (uma linha por atendimento:
  date, time, professional_id, room_id, patient, note, blocked), permissão
  própria **`agendamentos`** (item "Agenda" nos Níveis). Migração
  `supabase/2026-10-01-agenda-por-data.sql`. Começou vazia (não copia nada
  do Planner).
  - Seg–sex, mesmos horários de 40 min do Planner (vêm de `DAYS`), almoço.
  - Mesma altura de célula do Planner (44px; quadradinho de 36px); a grade
    rola quando o dia não cabe na tela.
  - Visões **Semana** (5 dias do profissional/sala selecionado) e **Dia**
    (uma coluna por profissional ou sala). Painel à direita: Profissionais |
    Salas, filtro, contagem da semana. Data, ‹ Hoje ›.
  - O **Planner** segue a mesma regra: célula vazia fora do horário do
    profissional da coluna fica cinza (`.slot-off`, `seatAvailable()`), sem
    clique/colar/soltar; "bloquear período" a ignora; algo já marcado ali
    continua visível. Teste: `tests/run_prof_hours.js`.
  - Horário de cada profissional **por dia da semana** (`horarios:
    {seg:{inicio,fim},…}` no cadastro; `inicio:""` = não atende; cadastros
    antigos com `horaInicio`/`horaFim` únicos valem para todos os dias —
    `profDayHours()`): fora dele a célula fica hachurada e não aceita marcação.
  - Células no **mesmo visual do Planner** (`.book`/`.book-main`, "+" nas
    vazias, ícones mover/copiar no hover) e as mesmas funções: **copiar**
    (cola quantas vezes quiser até Esc/Cancelar), **mover** (barra
    `#agdClipboardBar`), **arrastar** (solta em vazio = move; sobre outro
    atendimento = troca os dois). Na visão Dia a coluna de destino define o
    profissional (ou a sala, no modo Salas). Nada disso entra em horário fora do
    expediente. Código: `agdPlace()`, `agdTargetFor()`, `agdRenderClipboardBar()`.
  - Botões **liberar / bloquear / limpar** por coluna, na linha antes das
    07:20 (manhã) e na do almoço (tarde), dois cliques para confirmar, mesmas
    regras do Planner (`agdPeriodCell`, `agdPeriodAction`). No modo Salas,
    bloquear vale para cada profissional que atende naquela sala.
  - **Desfazer / refazer** igual ao Planner: botões no canto acima dos
    horários (`data-ad-hist`), Ctrl+Z / Ctrl+Y, lista ▾ (`openHistoryMenu` com
    `AD_HISTORY_API`). Cada ação grava as linhas antes/depois (`agdRecord`);
    desfazer reaplica o "antes" (`agdApplyState`) se ninguém mexeu nelas.
  - Banco garante 1 atendimento por profissional/data/horário (unique);
    sala ocupada por outro profissional gera só um aviso (pode confirmar).
  - Código: bloco "Nova Agenda por data real" no fim do script (`AD`,
    `agdLoadWeek`, `agdRender`, `agdOpenModal`…). Carrega a semana inteira de
    todos e aplica mudanças do Realtime. Sem `window.pipoAuth` (testes) mostra
    "Agenda indisponível".
- **Cadastro de profissional**, nesta ordem: Nome, CPF (máscara + dígito
  verificador), Especialidade principal, CBOS (sugestões), Conselho, Registro,
  **Serviços** (seleção múltipla flutuante dos serviços cadastrados, salvo em
  `servicos: [ids]`) — sem `servicos` salvo, abre com todos marcados,   **Horários** (início/fim de segunda a sexta, "Não atende", botão "Copiar
  segunda para todos") e, só para Administrador, a seção **Usuário**
  (e-mail e senha): cria um usuário no nível
  "Profissional" ligado ao profissional (`profiles.professional_id`); se já
  houver usuário ligado, o campo vira "Nova senha". O salvar usa
  `Object.assign` sobre o registro antigo para não perder campos.
- Tela Usuários tem o botão temporário **"Criar acessos dos profissionais"**
  (some quando todos têm usuário): sugere `primeironome@clinicapipo.com`
  (sem acento; nome repetido vira `primeiro.segundo@`), senha `Pipo1234!`,
  lista editável antes de criar. Não é regra do sistema — foi pedido só para
  os profissionais que já existiam em 2026-10-01; pode ser removido depois.
- CPF fica no documento `config/professionals`, legível por qualquer usuário
  ativo (mesma regra de leitura dos outros cadastros).
- Células do Planner e da Agenda com **3 linhas** (58px de altura, quadro de
  50px): paciente, serviço (`.pserv`, `bookingServiceName`) e observação.
- **Só agenda quem está cadastrado** (Planner e Agenda): o nome digitado
  precisa ser de um paciente do cadastro (ou de uma sala, no Planner);
  compara sem acento/maiúscula e grava o nome do cadastro
  (`registeredBookingName`). Horários especiais não passam por essa regra.
- **Serviço do atendimento** (Planner e Agenda): campo "Serviço" na janela,
  padrão **Sessão** (`DEFAULT_SERVICE_ID = "sessao"`, travada no cadastro de
  Serviços: não renomeia nem exclui). Opções = serviços que o profissional
  atende (`serviceOptionsHtml`). Gravado em `service` (Planner: no registro
  do booking; Agenda: coluna `appointments.service`, migração
  `2026-10-01c-servico-no-atendimento.sql`, que também pôs "sessao" nos
  atendimentos já existentes). Horários especiais não têm serviço. Copiar/colar
  do Planner agora leva o registro inteiro (`state.clipboard.rec`).
- **Tipos especiais de horário** (Planner e Agenda): na janela do atendimento,
  três opções exclusivas — **Bloqueado** (cinza escuro, `blocked:true`),
  **Reunião Clínica** (amarelo, `patient:"Reunião Clínica"`) e **Treinamento**
  (ciano `#24E2FC`, `training:true`). Com uma marcada, o campo de paciente
  fica desativado. `SLOT_KINDS`, `bookingKind()`, `slotKindRecord()`,
  `slotKindPickerHtml()`; nenhum conta no Relatório nem na contagem da Agenda.
- **Serviços** (desde 2026-10-01): documento `config/services`
  `{list:[{id,name}]}` (Sessão, Triagem, Avaliação, Avaliação
  Neuropsicológica, Orientação Familiar, Orientação Escolar — semeados pela
  migração `2026-10-01b-servicos.sql`). Cadastro em janela
  (`openServicesModal`, mesmo padrão de Convênios), permissão do módulo
  `profissionais`. Ainda não é usado em outro lugar.
- Os botões **Serviços** e **Especialidades** ficam na tela de
  **Profissionais**; Pacientes ficou só com **Convênios**. A permissão de
  Especialidades continua sendo a de `pacientes` (o cadastro de paciente
  ainda cria especialidade "na hora").

## O que já está implementado (por área)

### Grade da Agenda
- 5 dias (segunda a sexta) × 4 semanas, salas com terapeutas/assentos como
  colunas, horários fixos da manhã e tarde, reunião clínica semanal automática
  às 11:20 (toda segunda, valor padrão "virtual" até alguém sobrescrever).
- Arrastar e soltar, copiar/mover (com barra de clipboard e clique para colar
  em qualquer dia/semana), desmarcar.
- Botões por período (manhã/tarde) e por assento, todos com confirmação de
  dois cliques: **bloquear** só marca os horários *livres* (não mexe em
  paciente, sala nem reunião); **liberar** só remove *bloqueios* (marcação
  `blocked` ou texto "Bloqueado" de dados antigos); **limpar** (ícone de
  borracha) apaga tudo do período, inclusive a reunião de segunda. Todos
  entram no desfazer.
- Cor de paciente por regra herdada da planilha VBA antiga: ABA="Não" → vermelho;
  senão por idade (0–4 azul, 5–9 verde, 10+ laranja); sem idade numérica e
  ABA≠"Não" → sem cor.
- Cor customizável por especialidade e por sala (aplicada nos agendamentos e no
  cabeçalho da sala).
- Filtro por sala em **menu suspenso** antes da busca (`#roomChips`,
  `.rf-btn`/`.rf-panel`, "Todas as salas" + cada sala com sua cor) e busca de paciente na grade (ignora acento e
  maiúscula/minúscula — ver seção de busca abaixo).
- Visualização "todos os dias" / "todas as semanas" combinável (`day=todos`,
  `week=todos`).
- Controle de zoom da grade.
- **Desfazer / refazer** (só células da agenda): botões no canto da grade
  (`th.corner` da 1ª linha, fixo no topo e à esquerda) e atalhos Ctrl+Z /
  Ctrl+Y / Ctrl+Shift+Z (ignorados dentro de campos de texto e com janela
  aberta). Implementado em `applyBookingChanges(changes, {history})` +
  `runHistory()`: cada gravação vira `{changes, prev}`; até 50 passos, por
  aba do navegador (some ao recarregar). Antes de desfazer, confere se a
  célula ainda está como deixamos — se outra pessoa mexeu, recusa em vez de
  sobrescrever. Ao lado de cada botão há uma setinha ▾ (como no Excel) que
  abre a lista das ações (`openHistoryMenu`, texto gerado por
  `describeHistoryEntry` na hora da gravação): passar o mouse marca o item e
  todos acima, clicar aplica todos até ali (`runHistory(dir, steps)`, um
  passo de cada vez, parando no primeiro conflito). Teste:
  `tests/run_undo.js`.
- Busca de paciente na grade: resultado com célula e quadro preenchidos em
  amarelo (`.search-hit` / `.book-main.match`) e os demais atendimentos
  esmaecidos (`.search-dim`).
- App usa 100% da largura e altura disponíveis da janela do usuário (não fica
  limitado a `max-width`), inclusive nas abas Pacientes e Relatório.

### Cabeçalho / marca
- Logo real da clínica (imagem fornecida pelo usuário — puzzle-globo colorido),
  recortada e embutida como `data:` URI, substituindo o antigo badge de texto
  "PP".
- Logo com fundo transparente (enviada em 2026-10-01): `favicon.png` (128px) na raiz
  é o ícone da aba; a mesma imagem vai embutida no `.brand-mark` do topo e na
  impressão dos relatórios, ligado
  no `<head>` (`rel="icon"` e `apple-touch-icon`).
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
- Profissionais em **tabela** igual à de Pacientes (`.pat-table`): busca
  (`#profListSearch`, nome/especialidade/sala, sem acento), contador
  "X de Y profissionais", ordenação por coluna (`state.profSort`) e coluna
  "Salas onde atende" calculada das colunas das salas. Clique na linha edita.
- Editor da sala: setas ▲▼ em cada coluna (terapeuta) para mudar a ordem das
  colunas na grade; a coluna mantém o id, então os atendimentos vão junto.
- Troca de abas protegida: erro ao abrir uma aba vira aviso na tela
  (`reportAppError`, também para erros não tratados); aba atual sem permissão
  ou sem seção vai para a primeira permitida.
- Salas: busca por nome da sala ou de profissional (`#roomListSearch`) e
  contador; com busca ativa as setas de reordenar somem (reordenar só com a
  lista completa).
  Colunas redimensionáveis como em Pacientes — o mesmo
  `patColResizeStart`/`wirePatColResize`, recebendo uma config por tabela
  (`patResizeCfg()` / `profResizeCfg()`); larguras salvas no navegador em
  `agendaPipo:profColWidths`; duplo clique no divisor volta ao padrão.
- **Toda exclusão pede confirmação** numa janela própria (`confirmDialog()`,
  host `#confirmHost` por cima do cadastro aberto, foco inicial em Cancelar):
  paciente, profissional, sala, e — na hora de salvar — colunas tiradas de
  uma sala, especialidades e convênios removidos.

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
`__PAGE_BODY__` onde o app é injetado — `tests/build.js` copia só os trechos
entre os marcadores `APP-HEAD` e `APP-BODY` do `index.html` (os scripts do
Supabase ficam de fora, então os testes rodam 100% offline com o mock).

Fluxo pra rodar/atualizar testes depois de mexer em `index.html`:

```bash
node tests/build.js     # gera tests/page.html a partir do index.html atual
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
tem permissão — hoje no Supabase — nunca em arquivo de código. Os exports/SQL de
importação da migração ficam fora do repositório (`.gitignore` bloqueia `export/` e
`import*.sql`).

## Como publicar uma alteração

1. Editar `index.html` (e/ou `js/`, `api/`). Código novo do app vai **entre os
   marcadores** `APP-HEAD`/`APP-BODY`, senão os testes não o enxergam.
2. `node tests/build.js` e rodar a suíte (`npm test`) — o app não tem tipos
   nem build step, os testes são a principal rede de segurança.
3. Mudança no banco: criar um arquivo novo em `supabase/` (ex.:
   `supabase/2026-10-xx-descricao.sql`) e rodar no SQL Editor do Supabase;
   manter `schema.sql` como o retrato completo e atual.
4. Commit + push na `main` → a Vercel publica sozinha em ~1 minuto.

## Nunca usar prefixo `ad` / `ad-` em classes, ids ou atributos
Bloqueadores de anúncio (AdBlock, uBlock etc.) escondem elementos chamados
`ad-*`, `#ad…`, `.ad-panel` e parecidos. Em 2026-10-01 a Agenda ficou em branco
só no Chrome de um usuário por isso. Os nomes da Agenda usam o prefixo `agd`
(`.agd-panel`, `#agdGrid`, `agdRender()`…). Não criar nomes começando com `ad`,
`ads`, `advert`, `banner`, `sponsor`, `promo`.

## Lixeira nas células (Planner e Agenda)
Cada célula com agendamento tem os ícones Excluir (`.book-del`, lixeira), Mover e
Copiar, nessa ordem. Só aparece para quem tem permissão de excluir no módulo
(`agenda` no Planner, `agendamentos` na Agenda). O clique abre direto o `confirmDialog`. Na Agenda a exclusão usa `agdDeleteRow(row, msg)` (o mesmo do
botão Desmarcar da janela); no Planner, `writeBooking(..., clearValueFor(...))`.
As duas entram no desfazer (Ctrl+Z).

## Grupos de suporte (2026-10-02)
Ficam no mesmo cadastro das salas (`config/rooms`), com `group: true`, então as
chaves de agendamento do Planner (`hora|roomId|seatId`) não mudam. Helpers:
`isGroup`, `physicalRooms()`, `supportGroups()`, `plannerRooms()` (grupos
primeiro, depois salas — usado por `visibleRooms()` e pelo filtro de salas).
- Tela Salas: botão "Grupos de suporte" alterna `state.salasView` entre
  "salas" e "grupos" (vira "Salas"; "+ Nova sala" vira
  "+ Novo grupo"). As setas trocam só com o vizinho do mesmo tipo.
  `openRoomModal(r, asGroup)` serve aos dois.
- Regras do Planner: célula de grupo só aceita SALA; célula de sala só aceita
  PACIENTE; Bloqueado / Reunião Clínica / Treinamento valem nos dois.
  `slotBookingName(room, text)` na janela, `slotRefusal(roomId, rec)` ao
  colar/mover/arrastar (na troca, os dois lados são checados).
- Agenda (por data): grupos não aparecem como sala (`physicalRooms()`).
- Migração: `supabase/2026-10-02-grupos-de-suporte.sql` marca Coordenador e
  Aplicador ABA como grupos.

## Agenda: vários atendimentos no mesmo horário (2026-10-02)
Sem a regra única (date, time, professional_id) — migração
`supabase/2026-10-02b-varios-atendimentos.sql`. `agdIndex()` devolve listas em
`byProf` e `byRoom`. Cada atendimento da célula é um `.book[data-id]` dentro de
`.agd-multi` (lado a lado) + botão `.agd-add` ("+") para marcar mais um. Cliques,
lixeira, mover/copiar e arrastar usam o `data-id` do `.book`, não do `td`.
Colar/mover para um horário ocupado coloca ao lado; arrastar em cima de outro
atendimento troca os dois (`agdPlace(row, td, mode, swapWith)`).

## Planner → Agenda: "Enviar para a Agenda" e "Limpar semana" (2026-10-02)
- Planner, botão `#sendToAgendaBtn` (precisa de criar em `agendamentos`):
  `openSendToAgendaModal()` escolhe dia + semana do Planner e a data real
  (precisa ser o mesmo dia da semana, hoje ou futura). `plannerSendPlan()` monta
  a prévia: paciente/sala/serviço/observação; coluna de grupo vai com o NOME DO
  GRUPO no lugar do paciente e a sala agendada como `room_id`; Bloqueado,
  Reunião Clínica e Treinamento também vão. Só acrescenta (nunca altera nem
  apaga). Pula: já existe (mesmo profissional/horário/nome e sala), horário
  bloqueado na Agenda, bloqueio onde já há atendimento, fora do horário do
  profissional, coluna sem profissional. Repetido dentro do envio vai uma vez.
  Cada linha leva `source: "planner"` (coluna da migração
  `2026-10-02c-origem-planner.sql`). Entra no desfazer da Agenda.
- Agenda, botão `#agdClearWeekBtn` (precisa de excluir): `agdClearWeek()` apaga
  TUDO de segunda a sexta da semana aberta, com dupla confirmação; desfazível.
- `agdSelectByIds` / `agdDeleteByIds` trabalham em lotes de 100 ids (URL).

## Regras de horário (Planner e Agenda) (2026-10-02)
Bloqueado / Reunião Clínica / Treinamento não entram nas regras.
1. Profissional não pode estar em dois lugares (salas/grupos diferentes) no
   mesmo horário. Na Agenda, vários atendimentos do mesmo profissional na
   MESMA sala continuam permitidos (lado a lado).
2. Paciente não pode ter o MESMO serviço em dois lugares no mesmo horário
   (serviço diferente pode).
3. (Planner, 2026-10-02) Paciente não pode ter dois atendimentos com o MESMO
   profissional no mesmo horário, nem com serviço diferente (`plannerConflict`).
- Exceção da regra 1 (Planner, 2026-10-02, decidida com o usuário): o agendamento
  de GRUPO do profissional que aponta para a MESMA sala onde ele está atendendo não
  conta como "dois lugares" (`sameRoomViaGroup` em `plannerConflict`; na grade,
  `profWhere[].target` e a coluna do grupo fica livre quando ele está numa sala só).
  Regra 2 mantida como está (decisão do usuário).
- Planner: `plannerConflict(docId, key, rec, ignoreKeys, extra)` — na janela,
  ao colar e ao mover/arrastar (na troca confere os dois lados).
- Agenda: `agdConflictIn(rows, rec)` (síncrono) e `agdConflictsFor(recs,
  ignoreIds)` (consulta o banco pelas datas) — na janela, colar/mover/trocar e
  no envio do Planner (pula com o motivo "Profissional ou paciente já ocupado").

## Liberar / bloquear por linha (2026-10-02)
Ao lado de cada horário (coluna de horários) há dois botões `.row-lock`
(liberar / bloquear), 2 cliques via `armTwoClick(btn, title)`. Planner:
`plannerRowAction(action, docId, dayKey, time)` em todas as colunas visíveis
da tabela (respeita o filtro de sala). Agenda: `agdRowAction(action, time)` —
Semana = os 5 dias do profissional/sala selecionado; Dia = só o selecionado.
Bloquear só preenche livres (dentro do horário do profissional); liberar só
remove bloqueios. Os botões novos (Enviar / Limpar semana) também são
mostrados/ocultados em `applyPermissionsUI` (o perfil chega depois do 1º desenho).

## Agenda: paciente ou grupo de suporte (2026-10-02)
O campo da janela da Agenda aceita paciente do cadastro OU nome de grupo de
suporte (`agdBookingName`); sugestões mostram os dois com bolinha de cor. Sala
física não é aceita na Agenda (no Planner, só nas colunas de grupo).

## Agenda: busca e visão Dia (2026-10-02)
- Busca `#agdSearch` (`AD.search`, `agdSearchHit(row)`): destaca em amarelo os
  atendimentos cujo nome (paciente/grupo/tipo) contém o texto, apaga os outros,
  mostra "N na tela · M na semana" e, na lista da esquerda, quantos encontrados
  por profissional/sala (os sem resultado ficam apagados).
- Visão Dia mostra só o profissional/sala selecionado (uma coluna), igual à
  Semana; trocar na lista da esquerda.

## Status dos atendimentos (2026-10-02)
- Cadastro `config/statuses` ({list:[{id,name,color}]}) — `openStatusesModal()`,
  aberto pelo menu "Acesso" → "Status" (só Administrador; no banco o caminho
  usa o módulo `cadastro_status`, que nenhum nível tem). Pré-cadastrados:
  finalizado, nao-compareceu, falta-justificada.
- `appointments.status` = id do status. Etiqueta colorida `.agd-status` no canto
  da célula. Campo "Status" na janela da Agenda (só atendimento já marcado, não
  em bloqueio/reunião/treinamento).
- Quem pode usar cada status: `roles.permissions.status[id]` (tela Níveis de
  permissão, seção "Status dos atendimentos"); `canUseStatus(id)` usa
  `pipoAuth.can("status", id)` direto (o Profissional é "somente leitura" mas
  pode marcar status). Só troca de um status permitido para outro permitido.
- Gravação pela função `set_appointment_status(p_id, p_status)` (security
  definer; serve para quem não tem "editar"). Trigger
  `appointments_status_guard` confere no banco. Migração
  `supabase/2026-10-02d-status.sql`.

## Prontuário (2026-10-02)
- Tabela `clinical_records` (migração `supabase/2026-10-02e-prontuario.sql`):
  patient_id, patient_name, appointment_id, appointment_date/time,
  professional_id, author_id (sempre auth.uid(), trigger), author_name,
  content (HTML), created_at/updated_at. Módulo de permissão `prontuario`
  (ver/incluir/editar/excluir). RLS: editar só o AUTOR; excluir autor com
  permissão ou Administrador. Dados de saúde: nunca versionar conteúdo real.
- Aba "Prontuário" (`#tab-prontuario`, código no bloco "Prontuário" do script,
  estado `PR`): lista de pacientes (registros, último atendimento,
  profissionais) → linha do tempo do paciente → editor `prOpenEditor` (barra
  com negrito/itálico/sublinhado, título, listas, tabela com + linha/+ coluna,
  desfazer). `prSanitize` limpa o HTML (só tags de texto e tabela, sem
  atributos além de colspan/rowspan) ao salvar E ao mostrar.
- Agenda: botão "Atendimento" na janela do atendimento (paciente cadastrado e
  permissão de ver) → `prFromAppointment(row)`: abre a evolução daquele
  atendimento do próprio usuário, ou uma nova ligada a ele.

## Agenda: "Detalhes do Agendamento" e "Iniciar Atendimento" (2026-10-02)
- Quem não tem "editar" na Agenda, ao clicar num atendimento, vê o popup
  `agdOpenDetails(row)` (só leitura): nome, serviço (ou "Grupo de suporte"),
  profissional, observação, sala, data/hora "até", e o Status (grava ao mudar).
- (Removido em 2026-10-02: o botão Registrar/Editar Atendimento da janela.) Antes ficava no canto superior
  direito (cabeçalho, ao lado do ✕), no popup e na janela de edição; as duas
  abrem no centro. Na edição, Status fica abaixo de "Ou marque o horário como". Evoluções também podem ser lançadas direto no
  Prontuário ("+ Nova evolução"), sem atendimento.

## Profissional vê só a própria agenda (2026-10-02)
Usuário ligado a um profissional (`profiles.professional_id`), não
Administrador e sem "editar" na Agenda: `agdOwnProfId()` esconde a lista
lateral (`.agd-panel.agd-solo`), força modo Profissional no próprio
profissional (Dia e Semana). No banco, `agenda_scope_professional()` limita o
SELECT de appointments e o `set_appointment_status` aos atendimentos dele
(migração `2026-10-02f-agenda-do-profissional.sql`). Prontuário: só o autor
edita; o nível Profissional não tem "excluir".

## Relatórios (2026-10-02)
- A aba antiga "Relatório" (Planner, 4 ciclos) agora se chama "Atendimentos"
  (data-tab continua `relatorio`).
- Nova aba "Relatórios" (`#tab-relatorios`, bloco "Relatórios" do script,
  `RP_TYPES` / `RP_BUILDERS`): formulário à esquerda (tipo, De/Até + atalhos,
  profissional, filtros extras por tipo) e resultado à direita, com
  Imprimir/PDF (`rpPrint`: página própria num iframe, com logo, "Clínica de Autismo Pipo", título e filtros; A4 paisagem quando a tabela tem mais de 6 colunas) e Exportar Excel (CSV ";"
  com BOM). Ordenação: clique no título da coluna (▲/▼) (`RP.last.sort`, `rpRows`); vale para tela, impressão e Excel. Lê `appointments` do período (o Profissional fica preso ao próprio
  `agdOwnProfId`). Tipos: lista, produtividade, frequencia, convenios, pacote,
  pendentes, ocupacao, bloqueios, sem-atendimento.
- Permissão por tipo: `roles.permissions.relatorios[tipo]` (+ `view` quando há
  algum), seção "Relatórios" em Níveis de permissão. "Evoluções pendentes" usa a
  função `report_appointments_with_records(p_from, p_to)` (não expõe o texto do
  prontuário). Migração `supabase/2026-10-02g-relatorios.sql`.

## Planner: "Limpar semana" (2026-10-02)
Botão `#plClearWeekBtn` na barra do Planner (precisa de excluir em `agenda`):
`plannerClearWeek()` lê os 5 documentos `schedule/<dia>-<semana>` da semana
escolhida (com "Todos" pede para escolher uma), remove toda chave gravada com
conteúdo (a Reunião Clínica padrão de segunda 11:20 volta), dupla confirmação,
um único `applyBookingChanges` (entra no desfazer).

## Seletor de cor único (2026-10-02)
`openColorPicker(anchor, corAtual, aoEscolher)` (perto de `swatchVar`): janela
flutuante `#cpPop` com "Cor" (12 cores prontas, `CP_PRESETS`), "Minhas cores"
(salvas no navegador em `agendaPipo:myColors`, até 12) e o "+" que abre o editor
(quadro saturação/brilho, barra de matiz, HEX/RGB, aviso de contraste, Salvar →
entra em Minhas cores e já escolhe). Esc/clique fora fecha só o seletor. Usado em
Salas/Grupos (`#rmColorBtn`), Especialidades (`.spec-color-btn`) e Status
(`[data-stcolor]`). Cor nova é sempre "#rrggbb"; nomes antigos ("teal"…)
continuam valendo via `swatchVar`/`cpToHex`.

## Horário do profissional: manhã e tarde (2026-10-02)
`horarios[dia] = {manha:{inicio,fim}, tarde:{inicio,fim}}` (período sem início =
não atende). Formato antigo (`{inicio,fim}` por dia, ou `horaInicio/horaFim`)
continua valendo como faixa única. `profDayRanges` (faixas do dia),
`profDayHours` (resumo {start,end,ranges}), `profSlotOk` (o horário cabe numa
faixa) — usados por `seatAvailable` (Planner), `agdInHours` (Agenda, envio,
relatórios) e `agdHoursText` ("08:00–12:00 e 13:30–17:30"). Cadastro: tabela
Dia | Manhã (Início, Fim) | Tarde (Início, Fim), `profDayPeriods` converte o
formato antigo ao abrir; "Copiar segunda para todos" copia os 4 campos.
  Coluna "Atendimentos" por dia (horários da clínica dentro da manhã/tarde do
  profissional) e rodapé com total da semana e do mês (4 semanas): `hoursCounts`.

## Cadastro da Clínica: dias e horários do Planner e da Agenda (2026-10-02)
- Documento `config/clinic` {nome, cnpj, telefone, email, endereco, cidade,
  horarios:{seg..dom:{ativo, manha:{inicio,fim}, tarde:{inicio,fim}}}} — menu
  Acesso → Clínica (`openClinicModal`, só Administrador; módulo
  `cadastro_clinica` no banco). Migração `supabase/2026-10-02h-clinica.sql`
  (também libera `schedule/sab-N` e `dom-N`).
- `DAYS` deixou de ser fixo: `rebuildDays()` gera os dias abertos e os horários
  de 40 min (`clinicSlots`) a partir do cadastro; sem cadastro = padrão antigo
  (seg a sex, 07:20–12:00 / 13:30–18:10, sexta tarde até 17:30).
  `onClinicChange()` refaz botões de dia, assinaturas do Planner e a Agenda.
- Agenda: `agdWeekDays()` = dias abertos da semana (inclui sáb/dom se abertos);
  semana carregada de segunda a domingo; `agdWeekSlots`/`agdLunchLabel`
  (linha do almoço = fim da manhã); célula de horário que não existe naquele dia
  = cinza "Clínica fechada neste horário"; `agdClampWeekday` pula dias fechados.
- Horário dos profissionais: linhas = dias abertos (`profWeekdays`), opções de
  manhã/tarde = horários da clínica (`profPeriodTimes`); salvar mantém dias
  fechados já gravados. Relatórios (`rpWeekdays`) contam só dias abertos.

## Topo, menu Cadastros e duração dos atendimentos (2026-10-02)
- As abas (`#mainTabs`) ficam na mesma linha do nome do sistema (`.topbar`).
  Abas visíveis, nesta ordem: **Cadastros ▾** (`#cadBtn`/`#cadMenu`,
  `CAD_ITEMS`), Planner, Agenda, Prontuário, Atendimentos, Relatórios. As abas de cadastro
  (`CAD_TABS`: pacientes, profissionais, convenios, servicos, especialidades,
  salas) ficam com o botão sempre oculto e abrem pelo menu; "Grupos de
  Suporte" abre Salas com `state.salasView = "grupos"`; "Clínica" abre
  `openClinicModal` (só Administrador).
- Convênios, Serviços e Especialidades viraram telas como Pacientes
  (`#tab-convenios` etc., `REG_CFG`, `renderRegistryTab`, `openRegistryItem`):
  busca, contador, "+ Novo", tabela, clique abre o item (excluir com
  confirmação). Os botões dessas listas saíram das telas de Pacientes e
  Profissionais (as janelas antigas `open*Modal` continuam no código).
- Duração padrão do atendimento: `config/clinic.duracao` (minutos;
  `CLINIC_DURATIONS`), aplicada em `rebuildDays` (`CLINIC_SLOT_MIN`,
  `SESSION_MINUTES`); `agdPlus40(t)` agora = início + duração. Mudar a duração
  pede confirmação (horários que deixam de existir somem da grade, os
  agendamentos ficam guardados).

## Cores dos botões (cadastro da Clínica) (2026-10-02)
`config/clinic.corBotoes` (#rrggbb ou vazio = verde padrão) e `corTexto`
(vazio = automático, branco ou escuro por contraste — `clinicTextAuto`).
`applyClinicTheme()` (chamado em `onClinicChange`) põe no `:root` as variáveis
`--accent`, `--accent-ink`, `--accent-weak` (color-mix 16% com a superfície) e
`--ring`; sem cor escolhida remove e volta ao tema padrão (inclusive o escuro).
Campos ao lado da duração, com prévia e botão "Padrão".

## Nome, subtítulo e logo da clínica; desfazer na linha de bloquear (2026-10-02)
- `config/clinic.nome`, `subtitulo` (padrão "Clínica Multidisciplinar") e `logo`
  (PNG 128 px em data URL, gerado no navegador ao escolher a imagem).
  `applyClinicBrand()` (em `onClinicChange`) põe nome em `#brandName` e no
  título da aba, subtítulo em `#brandSub`, logo no `.brand-mark` e no ícone
  da aba (`#favIcon`); sem cadastro volta ao padrão (`DEFAULT_BRAND`,
  `/favicon.png`). A impressão dos relatórios usa `clinicName()`. A tela de
  login continua com o nome fixo (ela aparece antes de ler o cadastro).
- Desfazer/refazer saíram do cabeçalho: no Planner ficam na linha
  `periodrow-pre` (`.timecell-hist`), na Agenda na primeira `agd-periodrow`
  (`.agd-tcol-hist`) — a mesma linha dos botões de bloquear/liberar.
- Evolução lançada a partir de um atendimento mostra o ícone de agenda
  (`.pr-appt-link`, `CAL_SVG`) antes da data: `prGoToAppointment(rec)` abre a
  Agenda na data e no profissional e abre a janela do atendimento (avisa se ele
  foi apagado).

## "Finalizado" exige evolução (2026-10-02)
Sem botão de prontuário nas janelas da Agenda. Mudar o status passa por
`agdChangeStatus(row, v)`: "finalizado" (`FINAL_STATUS`) em atendimento de
paciente cadastrado sem evolução abre `prOpenEditor({..., onSaved, onCancel})`
e só grava o status depois que a evolução é salva (cancelar = não finaliza).
Já tendo evolução, ou sendo grupo de suporte, finaliza direto. Sem permissão de
incluir no Prontuário, recusa com aviso. No banco, `appointments_status_guard`
recusa a troca para "finalizado" sem `clinical_records` ligada (migração
`supabase/2026-10-02i-finalizado-exige-evolucao.sql`).

## Menus suspensos e seletores no padrão do sistema (2026-10-02)
- Todo `<input type="date">`, `<input type="time">` e `<select>` simples (sem
  `multiple`, sem `data-native`) vira um botão `.dp-btn` que abre uma janela
  própria flutuante `#dpPop` (calendário ou lista). O campo original fica
  escondido e continua recebendo `.value` / `change` (`dpEnhanceDate`,
  `dpEnhanceTimeList`, `dpScan`, observador no body). Ícone de relógio só nos
  selects de horário (`dpIsTimeSelect`); os outros têm `.dp-plain`.
- Visual único (bloco "Padrão de TODO menu suspenso" no CSS): fundo branco,
  borda e linhas cinzas entre itens, cantos de 10px, sombra leve; cor do
  sistema só no item escolhido. Vale para `.autolist` (sugestões, agora
  flutuantes, não empurram a janela), `.dp-pop`, `.cp-pop`, `.cad-menu`,
  `.ms-panel`, `.rf-panel`, `.hist-menu`, `#acessoMenu`.
- Teclado: nas sugestões ↑ ↓ marcam (`.kb`) e Enter escolhe; no calendário
  ← → dia, ↑ ↓ semana, Enter escolhe; nas listas ↑ ↓ e Enter; nos menus
  ↑ ↓ andam pelos itens. Esc fecha.

## Menu Planner, Clínica só em Cadastros, Ctrl+clique (2026-10-02)
- "Planner ▾" virou menu suspenso igual a Cadastros (`#plBtn`/`#plMenu`,
  `PL_ITEMS`): **Planner** (aba `agenda`) e **Resumo** (aba `relatorio`, antiga
  "Atendimentos"). Os dois botões de aba ficam sempre ocultos. Código genérico
  `NAV_MENUS` / `renderNavMenus` / `navActivate` / `navMenuTab(k)`;
  `renderCadMenu()` ficou como apelido. Tela inicial sem permissão: a primeira
  permitida na ordem agenda, agendadia, prontuario, relatorio, relatorios, cadastros.
- (2026-10-03) "Clínica" voltou para o menu Acesso (`js/pipo-supabase.js`,
  `data-act="clinica"`, aparece com `clinica.view`) e saiu de Cadastros. O
  endereço `#clinica` continua abrindo a janela (`CLINIC_NAV` em `navItem`).
- Ctrl+clique (ou botão do meio) em qualquer aba ou item dos menus do topo abre
  a tela em outra aba do navegador: endereço `#chave` (ex.: `#pacientes`,
  `#grupos`, `#resumo`, `#agendadia`, `#clinica`), aberto por `openNavFromHash()`
  (na carga e depois que as permissões chegam).
- Legenda de cores: "Não faz Intervenção ABA".

## Serviço diferente de "Sessão" = cor de Treinamento (2026-10-02)
Célula de paciente com `service` diferente de `DEFAULT_SERVICE_ID` ("sessao") é
preenchida com `TRAINING_COLOR`, no Planner e na Agenda (`otherService(b)`), no
lugar da cor por idade/ABA. Legenda: "Treinamento ou Outros serviços".

## Planner: barra fixa, grade rola sozinha (2026-10-02)
`#tab-agenda` é coluna flex com altura limitada (`flex:1;min-height:0`) e só
`.grid-scroll` rola (`overflow:auto`), igual à aba Resumo/Atendimentos. A barra
de dias/semanas/salas/busca e a legenda ficam paradas; os cabeçalhos de sala e
profissional (`.grouphead` / `.seathead`, sticky top) ficam presos no topo da grade.

## Ordenar e ajustar colunas em todos os cadastros (2026-10-02)
`gtRender(host, id, cols, rows, render, extraClass)` (perto de `SORT_NONE_SVG`):
tabela `.pat-table` com botão de ordenar (⇅ crescente → decrescente → padrão,
`GT_SORT[id]`, vazios no fim, números em ordem numérica) e bordas de arrastar
(reusa `wirePatColResize`; larguras em `agendaPipo:colWidths:<id>`, duplo clique
volta ao padrão). `rows = [{attrs, cells:[html], vals:[valor de ordenação]}]`.
Usado em Convênios, Serviços, Especialidades (`REG_CFG[k].vals`) e na lista de
pacientes do Prontuário (`prRenderList`).

## Primeiro nome do profissional no Planner e no Resumo (2026-10-02)
`firstName(n)` (perto de `therapistDisplayName`): cabeçalho das colunas do
Planner (`.seathead-name`, nome completo no `title`), nome na linha do almoço
(`.periodrow-seatname`) e cabeçalho de profissionais do Resumo (`.rpt-prof-name`).

## Nome do usuário = nome do profissional (2026-10-02)
Usuário com `profiles.professional_id` tem sempre o nome do cadastro do
profissional. Migração `supabase/2026-10-02j-nome-usuario-igual-profissional.sql`:
trigger em `documents` (`config/professionals`) atualiza `profiles.full_name`;
trigger `profiles_professional_name` (before insert/update) força o nome ao ligar
ou editar; acerto único dos já diferentes. Tela Usuários: campo Nome travado
para usuário ligado ("altere em Cadastros → Profissionais").

## Horários do profissional sem rolagem lateral (2026-10-02)
`#profHours` com `table-layout:fixed` e `<colgroup>` (dia 48px, contagem 58px):
dia abreviado ("Seg", nome completo no `title`), seletores sem ícone de relógio,
coluna "Atend." só com o número (texto completo no `title`), rodapé numa linha só
("Total: N atendimentos por semana · M por mês (4 semanas)", colspan 6 — antes
somava 7 colunas e empurrava a tabela para fora da janela).

## Nome social do profissional (2026-10-02)
Campo "Nome social" no cadastro do profissional (`#profSocial` → `nomeSocial`).
`profShortName(p)` = nome social ou, sem ele, `firstName(p.name)`;
`seatShortName(t)` para as colunas do Planner. Usado no cabeçalho das colunas e
na linha do almoço do Planner e no cabeçalho de profissionais do Resumo.

## Permissão própria para cada cadastro e para o Resumo (2026-10-02)
Novos módulos em `roles.permissions` (tela Níveis de permissão, `MODULES` em
`js/usuarios.js`, com `actions` quando nem todas as ações fazem sentido):
`convenios`, `especialidades`, `servicos`, `grupos`, `clinica` (ver/editar),
`cadastro_status`, `resumo` (ver). Antes seguiam Pacientes / Profissionais / Salas
/ só Administrador / Planner. Migração `supabase/2026-10-02l-permissoes-cadastros.sql`:
`module_for_path` novo, `can_write_path` (config/rooms aceita salas ou grupos) nas
políticas de `documents`, `documents_enforce` confere cada item com o módulo dele
(item de config/rooms com `group:true` = `grupos`; documento que não é lista, como
config/clinic, mudou = editar) e copia o acesso antigo para os níveis existentes.
No app: `tabCan(k)` em `applyPermissionsUI` (Salas aparece com salas OU grupos),
`writeRooms` confere salas e grupos separadamente, Clínica abre com "ver" e só
salva com "editar", Status (menu Acesso) com `cadastro_status`.

## Atendimento com evolução não pode ser apagado (2026-10-02)
Só o Administrador exclui atendimento da Agenda que tem `clinical_records`
ligada (a evolução fica, sem a ligação). Banco: trigger
`appointments_delete_guard` (migração `supabase/2026-10-02m-atendimento-com-evolucao.sql`).
App: `agdSplitByRecords(rows)` separa {del, kept}; usado em `agdDeleteRow`
(lixeira/Desmarcar), limpar período e `agdClearWeek` (os com evolução ficam e o
aviso diz quantos). Trocar dois atendimentos de lugar (arrastar em cima de outro)
agora ATUALIZA os dois (antes apagava e recriava o outro, perdendo o id e a
ligação com a evolução); permissão exigida: editar.

## Cadastro da Clínica: Aparência e Atendimento em linhas (2026-10-02)
Os dois cartões ficam um embaixo do outro (`.cl-cards` em coluna, `.cl-row`):
Aparência = linha 1 "Cor do botão · Cor do texto",
linha 2 "Prévia | Restaurar padrão", linha 3 "Logo · Escolher | Restaurar padrão" (mesma divisória .cl-sep de "Cor do texto") (primeira etiqueta de cada
linha com 104px: círculo da cor, prévia e logo alinhados); Atendimento = "Duração padrão [seletor] +
orientação". Janela com 840px. Botão da tela Salas em modo grupos: "Salas".

## Coluna de horários com largura fixa ao filtrar (2026-10-02)
Planner: `table.sched` com `width:max-content` (sem `min-width:100%`): com o
filtro de salas (poucas ou nenhuma coluna) a coluna de horários fica nos 87px em
vez de esticar até a largura da tela. Agenda (visão Dia): sem nenhuma coluna a
tabela recebe `width:87px` (com `table-layout:fixed` a única coluna esticava).

## Paciente que não faz intervenção ABA ocupa o horário do profissional (Planner, 2026-10-02)
Paciente com ABA = "Não" numa coluna de SALA (não grupo) bloqueia as outras
colunas do MESMO profissional nessa sala no mesmo horário (colunas de outros
profissionais na sala continuam livres; `abaByProf` na grade). Regra derivada (nada é gravado): tirar o
paciente libera as células. `isNaoABABooking(b)`, `abaRoomMsg()`. Na grade a célula
vazia vira `.slot-off.aba-lock` (listras cinza-claro e branco, `title` com o motivo; clique e
soltar mostram o motivo). `plannerConflict` recusa: (a) paciente "não ABA" onde o
profissional já tem alguém nessa sala no horário; (b) qualquer paciente numa
coluna do profissional que está com um "não ABA". Bloqueado / Reunião / Treinamento não entram na regra.
- Exceção (`groupBookedRoom(bookings, dayKey, time, room)`): se um Grupo de
  Suporte tem, no mesmo horário, um agendamento com o nome desta sala, o MESMO
  profissional pode ter outro paciente "não ABA" em outra coluna dele na sala.
  Na grade, as colunas desse profissional não ficam listradas (`abaFreeProf`);
  paciente ABA ou outro profissional continuam recusados.

## Profissional atendendo numa sala fica bloqueado nos grupos (Planner, 2026-10-02)
Na grade, por horário, `profInRoom[profId]` = sala (não grupo) onde o
profissional tem paciente. A coluna dele nos Grupos de Suporte, se vazia, vira
`.slot-off.prof-busy` (listras cinza-claro e branco, `title` "Fulano está atendendo em <sala> neste
horário."; clique/soltar mostram o motivo). A gravação já era recusada pela
regra "profissional em dois lugares" de `plannerConflict`.
- O agendamento do grupo que libera esses "não ABA" não pode sair (excluir,
  mover, trocar o nome, limpar, desfazer) enquanto o profissional tiver 2+
  pacientes "não ABA" na sala naquele horário, a não ser que outro grupo
  continue marcando a sala: `abaGroupDependencyDenied(changesByDoc)`, conferido
  em `applyBookingChanges` logo depois de `bookingPermDenied`.
- Sala SEM "ABA" no nome (`roomIsABA(r)` falso — ex.: "Psicologia",
  "Fisioterapia"): o paciente "não ABA" bloqueia a SALA TODA no horário, inclusive
  as colunas de outros profissionais (`abaAny` na grade; `plannerConflict` confere
  todas as colunas da sala). Sala COM "ABA" no nome (ex.: "Fonoaudiologia ABA"):
  só as colunas do mesmo profissional. A exceção do grupo de suporte vale nos dois
  casos, só para as colunas do profissional que tem o "não ABA".
- Sentido contrário: profissional com agendamento num GRUPO (`profInGroup`) tem
  as colunas dele nas SALAS bloqueadas no mesmo horário (`.prof-busy`, "Fulano tem
  agendamento no grupo <grupo> neste horário.").
- Generalizado: `profWhere[profId] = [{id, name, grp}]` (salas e grupos onde o
  profissional tem atendimento no horário). Qualquer coluna vazia dele em OUTRA
  sala ou grupo fica `.prof-busy` ("Fulano está atendendo em <sala>" / "tem
  agendamento no grupo <grupo>"). Colunas dele na MESMA sala seguem só as regras
  de "não ABA".

## Agenda, visão Dia + Salas: coluna dos grupos de suporte (2026-10-02)
Só nesse modo, a grade tem duas colunas para a sala escolhida: a da sala (atendimentos
dos profissionais) e, à direita, "Grupos de suporte" (atendimentos com o NOME de um
grupo no lugar do paciente e `room_id` = a sala — como chegam do "Enviar para a
Agenda"). `agdIsGroupRow(row)`; as colunas são cópias do recurso com `_split:
"prof" | "grupos"` e `cell()` filtra a lista por isso. A coluna dos grupos não tem
botões de bloquear/liberar (`td.agd-grp-col`, fundo cinza-claro).

## Digitar para buscar nas listas longas (2026-10-02)
Lista própria (`dpEnhanceTimeList`) de `<select>` que não é de horários e tem mais
de 6 opções (ex.: profissional da coluna da sala): campo `.dp-filter` no topo
("Digite para buscar…", sem acento/maiúscula via `data-n`), Enter escolhe o
primeiro que sobrou, ↓ desce para a lista. Começar a digitar com o botão em foco
já abre a lista com a letra no campo.

## Horário de atendimento do paciente (2026-10-02)
Cadastro do paciente: seção "Horário de atendimento" (`patHoursSectionHtml`,
`wirePatHours`, `readPatHours` → `horarios` no formato da clínica, só os dias
abertos; sem horário salvo abre com o da clínica). `patientSlotOk(p, dayKey, time)`
(sem `horarios` = sem restrição). Planner: `applyBookingChanges` chama
`patientHoursOutside(changesByDoc)` e, se algum paciente novo naquela célula fica
fora do horário dele, pede confirmação dupla ("Continuar" → "Agendar assim
mesmo") antes de gravar; desfazer/refazer não perguntam (`opts.patientHoursOk`).

## Filtro de salas do Planner mantém os grupos (2026-10-02)
`visibleRooms()`: com `state.activeRoomFilter`, mostra a sala escolhida E todos os
Grupos de Suporte (`isGroup(r) || r.id === filtro`).

## Paciente: especialidade OU serviço; sigla dos serviços (2026-10-02)
- "Especialidades/serviços e sessão (mês)" no cadastro do paciente: cada linha é
  uma especialidade (id normal) ou um serviço do cadastro, guardado em
  `specHours[].specId` como `"svc:<id>"` (`SVC_PREFIX`, `isSvcItem`,
  `svcItemService`). "Sessão" NÃO aparece (sessão = escolher a especialidade).
  `specialtyName` / `specialtySigla` entendem os dois; serviços vêm depois das
  especialidades na coluna "Especialidades/Serviços (sessão/mês)" da lista.
- Cadastro de Serviços com "Sigla" (coluna na tabela; vazio = `defaultSigla`).
  A gravação mantém os campos de "Sessão" (antes era recriada só com id/nome). Sigla da Sessão: "SS".
- Relatório "Pacote contratado × realizado": linha de serviço conta os
  Finalizados com aquele `service`.

## Planner: "Editar agendamento" (antes "Corrigir paciente") (2026-10-02)
Botão `#fixPatientBtn` na barra do Planner (antes de "Enviar para a Agenda") →
`openFixPatientModal()`: lê os documentos `schedule/<dia>-<1..4>` e, para o
paciente escolhido (select com busca), mostra:
- tabela por especialidade (do profissional da coluna) × semana + total;
- **Apagar** (precisa de excluir em `agenda`): do dia / da semana / do mês (4
  semanas), confirmação dupla, `clearValueFor`, entra no desfazer;
- **Trocar por outro paciente** (precisa de editar) no mesmo período: mantém
  sala/profissional/serviço/observação; os que dariam conflito
  (`plannerConflict`) ficam como estão;
- lista detalhada (semana, dia, hora, sala, profissional, especialidade); clicar
  abre o dia/semana no Planner e preenche a busca com o paciente.
- Depois de "ir até o horário", **Esc** no Planner limpa a busca da grade e
  reabre "Editar agendamento" com o mesmo paciente e período
  (`state.fixReturn`, `openFixPatientModal(back)`; não age com janela/menu aberto
  ou com copiar/mover em andamento).
- `profWhere` é calculado sobre `plannerRooms()` (todas as salas e grupos), não só
  as visíveis: com o filtro de salas os bloqueios continuam valendo.

## Otimização: índices de busca (2026-10-02)
`findPatientByName` e `findRoom` usam um índice (`_patIdx`, `_roomIdx`) refeito só
quando `state.patients` / `state.rooms` é substituído (sempre por uma lista nova;
nunca alterar essas listas no lugar, senão o índice fica velho). A grade chama
essas buscas várias vezes por célula (cores, regras "não ABA", bloqueios).

## Editar agendamento: pacote contratado × planejado (2026-10-02)
Na janela, abaixo do resumo por especialidade: tabela com o pacote do paciente
(`patientSpecRows`) × agendamentos no Planner nas 4 semanas (= 1 mês).
Especialidade conta os de serviço Sessão com profissional dessa especialidade;
serviço (`svc:`) conta pelo serviço. Diferença em vermelho (falta) / âmbar (sobra).
- Botão "Pacientes com pacote diferente do Planner": lista todos os pacientes
  cuja comparação (`pkCompare`) não bate, ordenados por sessões faltando; clicar
  abre o paciente na janela.
- "Copiar a semana do paciente para outra semana" (precisa de incluir): mesmas
  células na semana de destino; ocupadas ou com `plannerConflict` ficam de fora.

## Planner: "Trocar profissional" (2026-10-02)
Botão `#swapProfBtn` → `openSwapProfModal()`: escolhe o profissional atual e o
novo, marca as colunas (salas e grupos) a passar; mostra quantos agendamentos vão
junto, quantos horários ficariam com o novo profissional em dois lugares e quantos
fora do horário dele (`profSlotOk`). Aplica trocando `professionalId`/`name` das
colunas em `config/rooms` (`writeRooms`, permissão de editar Salas/Grupos). Com
conflito, pede confirmação dupla. Não entra no desfazer da grade: voltar = trocar
ao contrário.

## Agenda: regra do paciente "não ABA" (2026-10-02)
`agdConflictIn(rows, rec)` agora também aplica a regra do Planner na mesma sala,
data e horário: sala SEM "ABA" no nome → o "não ABA" ocupa a sala toda; sala COM
"ABA" → só o horário do mesmo profissional; exceção: atendimento de grupo de
suporte (`agdIsGroupRow`) na mesma sala libera outro "não ABA" do MESMO
profissional. Atendimentos de grupo não contam como ocupantes. Vale na janela,
colar/mover/trocar e no "Enviar para a Agenda" (que já usa `agdConflictsFor`).

## Testes no Windows (2026-10-02)
Node.js 24 instalado (winget `OpenJS.NodeJS.LTS`). `npm install` com
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (não baixa navegador): `tests/launch-opts.js`
escolhe o navegador — `PW_CHROMIUM`, senão o Chrome/Edge instalado, senão o
Chromium do ambiente Linux antigo. `tests/build.js` gera `page.html` e também
`page_race.html` (de `test_race.html`). `npm test` = 19 arquivos, 268 checagens.
Testes atualizados para o sistema atual: abas de cadastro abrem pelos menus
(`$eval('#mainTabs button[data-tab=…]', b => b.click())`), selects/datas viram
listas próprias (setar `.value` + `change`), Coordenador é grupo de suporte no mock
(agendamento dele às 16:10), Especialidades/Convênios pelas telas de cadastro,
seletor de cor `#cpPop`, desfazer na linha dos cadeados, cor de Treinamento
#24E2FC, "Reunião Clínica" como tipo marcado.

## Planner: Exportar Excel, envio da semana inteira, legenda (2026-10-02)
- `#plExportBtn` → `plannerExportCsv()`: baixa `planner.csv` (";" com BOM, abre no
  Excel) com uma linha por agendamento das 4 semanas — Semana, Dia, Hora, Sala/grupo,
  Profissional, Agendamento, Tipo, Serviço, Observação. Respeita o filtro de salas.
- "Enviar para a Agenda": opção **Semana inteira** no dia do Planner →
  `refreshWeek()`: cada dia aberto vai para o mesmo dia da semana (seg–dom) que
  contém a data escolhida; dias que já passaram ficam de fora; prévia por dia.
- Legenda do Planner: "Bloqueado por regra" (listras cinza-claro e branco).
- Teste `tests/run_planner_tools.js` (export, Editar agendamento, Trocar
  profissional) — `npm test` agora 20 arquivos.

## Planner mais leve (2026-10-02)
Medido com volume real fictício (110 pacientes, 15 salas/40 colunas, ~75% ocupado):
- Ícones das células (excluir/mover/copiar) e dos botões de cadeado/borracha
  (colunas e linhas, Planner e Agenda) sem `<svg>` dentro: desenhados por máscara
  CSS (`--ico` + `::before`, cor = currentColor). Célula com agendamento passou de
  22 para ~5 elementos. Redesenho da visão Todos×Todos: 1,2 s → ~0,65 s.
- Busca da grade (`#patientSearch`) não redesenha mais: `applyGridSearch()` só liga
  /desliga `.search-hit`/`.search-dim`/`.match` e atualiza o contador. Por letra:
  ~1,2 s → ~12 ms (Todos×Todos), ~37 ms → ~2 ms (1 dia). O desenho completo
  continua marcando a busca do mesmo jeito.
- Testado e descartado: `content-visibility` nos dias (sem ganho medido).

## Versão Mobile (desde 2026-10-03, uma tela por vez)
- Topo no celular (até 760px): abas (`#mainTabs`) e `.topbar-right` (usuário,
  Acesso, sincronização) somem; no canto direito fica o botão ☰ `#mnavBtn`
  (vira ✕ aberto) que abre `#mnavPanel` (`mnavRender`, `wireMobileNav`): nome e
  nível do usuário, seção Cadastros (`CAD_ITEMS`),
  abas visíveis de `#mainTabs` e seção Acesso (cópias dos botões de
  `#acessoMenu`; o clique é repassado ao botão original). Montado a cada
  abertura, então segue as permissões atuais.
- **Planner e Resumo não aparecem no celular** (`MOBILE_HIDDEN_TABS` =
  `agenda`, `relatorio`; `isMobileView()`, `MOBILE_MQ` = mesma largura de
  760px): ficam fora do menu ☰; clicar nessas abas no celular vai para
  `mobileAltTab()` (primeira permitida: Agenda, Prontuário, Relatórios,
  cadastros); ao abrir ou virar celular com uma delas na tela,
  `mobileLeavePlanner()` troca de tela. Só fica nelas quem não tem outra tela.
- Menu ☰: **Cadastros** e **Acesso** são grupos recolhidos (`mnavGroup`,
  botão `.mnav-grp[data-mnav-grp]` com seta + `.mnav-items` oculto); tocar no
  título abre/fecha as opções sem fechar o menu. Agenda, Prontuário e
  Relatórios ficam soltos.
- **Daqui em diante os pedidos de ajuste são só para o celular** (CSS dentro do
  `@media (max-width:760px)` do bloco "celular: menu ☰ no topo").
- Cadastros no celular: tabelas na largura da tela (sem `min-width`, colunas sem
  largura fixa, sem bordas de arrastar, texto quebra linha) e só as colunas
  principais, escondidas por posição (`:nth-child` em col/th/td): Pacientes =
  Nome + Plano (`p.plano`); Profissionais = Nome + Especialidade principal;
  Serviços e Especialidades = Nome + Profissionais; Convênios = as duas que já
  tem. Busca ocupa a linha toda. Salas/Grupos já eram cartões e cabem na tela.
  Mudou a ordem das colunas no computador? Ajustar os `:nth-child` também.
- Usuários no celular (CSS em `injectStyles` de `js/usuarios.js`): tabela
  `.adm-users` só com Nome e Situação (esconde 2ª e 3ª colunas), busca na linha toda.
  Janela Níveis de permissão: tabela `.adm-roles` só com Nível e Usuários (esconde o
  resumo das permissões).

## Atualizar a página mantém a tela (2026-10-03, computador e celular)
A tela aberta fica no endereço (`navSaveHash()` → `history.replaceState`, sem
criar histórico): `#planner`, `#resumo`, `#agendadia`, `#prontuario`,
`#relatorios`, `#pacientes`, `#salas`/`#grupos`, `#usuarios`… (`navHashKey()`).
Chamado no clique das abas (`wireTabs`) e em `renderSalasTab`. No F5,
`openNavFromHash()` abre a mesma tela (o mesmo mecanismo do Ctrl+clique); só
grava depois que o endereço inicial foi tratado (`navHashDone`), para a tela
padrão da carga não apagar o endereço. `applyPermissionsUI` chama
`openNavFromHash(true)` (perfil carregado): sem permissão para a tela do
endereço, desiste e grava a tela atual. No celular, Planner/Resumo continuam
sendo trocados pela Agenda.
- **Sem "passar" por outra tela ao carregar:** `navInitialTab()` (no `boot`,
  logo após `wireTabs`) mostra já a seção certa antes do primeiro desenho — a do
  endereço, ou no celular sem endereço (ou com Planner/Resumo) a Agenda, gravando
  `#agendadia` no endereço. Só troca a seção visível; a carga dos dados vem do
  clique feito depois por `openNavFromHash()`. Roda antes de `CAD_ITEMS` e
  `MOBILE_MQ` existirem (por isso tem o próprio mapa e o próprio `matchMedia`).

## Janelas no celular sem zoom (2026-10-03)
- Causa do zoom: o iPhone (Safari) amplia sozinho ao tocar num campo com letra
  menor que 16px e não volta ao sair. No `@media (max-width:760px)`: todo
  input/select/textarea/contenteditable com `font-size:16px!important` (inclui o
  login e campos com estilo inline). A meta viewport ganhou `maximum-scale=1`
  (o iOS continua deixando a pessoa dar zoom com os dedos).
- Janelas (`.modal`) ocupam a largura toda (`max-width/width:100%!important`,
  vence os `style="max-width:…"` inline), overlay com 8px de margem e alinhado
  em cima; `.field-row` quebra em 2 por linha (`flex:1 1 140px`); rodapé quebra
  linha com botões centralizados; ✕ de fechar (`.modal-close`) com 24px e área
  de toque de 44×44; seletores (`.field .dp-btn`) com 16px.
- Tabelas de horário (profissional, paciente, clínica) sem ícones/setas nos
  seletores para caber "07:20"; `#clHours` rola para o lado se precisar.
- Conferido com Playwright em 390px (`isMobile`) abrindo cada janela: Clínica,
  confirmação, Paciente (novo/editar), Status, Profissional, Sala, Grupo, Agenda
  (novo/detalhes), Editar agendamento, Trocar profissional, Evolução, Convênio,
  Serviço, Especialidade — nenhuma passa da tela e nenhum campo < 16px.
  Atenção: `tests/test.html` não tem meta viewport; para testar em celular
  "de verdade" (isMobile) injete `<meta name="viewport" ...>` numa cópia.

## Relatórios no celular: resultado em tela cheia (2026-10-03)
No celular a aba Relatórios mostra OU os campos OU o relatório: `rpGenerate()`
chama `rpShowResult(true)` (classe `.rp-result` em `#tab-relatorios`), que
esconde `.rp-form` e mostra `#rpOut` com a barra `.rp-back-bar` / botão
`#rpBack` ("‹ Voltar") no topo; Voltar = `rpShowResult(false)`. Sem relatório
gerado, `#rpOut` fica oculto no celular. No computador nada muda (a barra fica
sempre oculta, form e resultado lado a lado).

## Agenda no celular: só a visão Dia (2026-10-03)
`#agdViewSeg` (Dia/Semana) oculto no `@media (max-width:760px)`. No início de
`agdRender()`, em tela de celular, `AD.view` vira "dia" (a escolha anterior fica
em `AD._deskView` e volta ao alargar a tela); a data é levada ao próximo dia
aberto (`agdClampWeekday`) e, se isso mudar de semana, chama `agdLoadWeek()`.
A troca de largura (`MOBILE_MQ`, `wireMobileNav`) redesenha a Agenda se ela
estiver aberta.
No celular a seção `#tab-agendadia` cresce com a grade (`flex:none`, `.agd-main`
`min-height:auto`, `.agd-scroll` `overflow:visible`) e a página rola; antes a caixa
branca tinha a altura da tela e os horários passavam por fora dela (faixa branca). ‹ › andam de dia em dia (lógica da visão Dia que já existia).

## Cópia de segurança (2026-10-03, menu Acesso, só Administrador)
O projeto Supabase está no plano gratuito (sem backup automático restaurável).
- Menu Acesso → **Cópia de segurança** (`data-act="backup"` em
  `js/pipo-supabase.js` → `window.pipoOpenBackup` → `openBackupModal()`, bloco
  "Cópia de segurança" em `index.html`).
- **Baixar** (`backupDownload`): lê no navegador, em páginas de 1000
  (`backupFetchAll`, `.range()`), as tabelas de `BACKUP_TABLES` — `documents`,
  `appointments`, `clinical_records` e `roles` (só consulta) — e baixa
  `copia-de-seguranca-agenda-pipo-AAAA-MM-DD-HHMM.json`
  (`{app:"agenda-pipo", formato:1, criado_em, clinica, tabelas:{…}}`). Data da
  última cópia guardada no navegador (`agendaPipo:lastBackup`).
- **Restaurar** (`backupRestore`): valida o arquivo (`backupValidate`), dupla
  confirmação, manda lotes (≤400 linhas / ~1,5 MB, `backupBatches`) para
  **`api/admin-backup.js`** (`pipoAuth.adminApi(payload, "/api/admin-backup")`;
  `adminApi` ganhou o 2º parâmetro `path`). A função confere Administrador,
  aceita só as colunas conhecidas por tabela, troca por null usuário que não
  existe mais (FK de auth.users) e faz **upsert** com a service role
  (`documents` por `path`, os outros por `id`): repõe o que estava na cópia,
  nunca apaga o que veio depois. Ordem: documentos, atendimentos, evoluções.
- Migração `supabase/2026-10-03-copia-de-seguranca.sql`: `appointments_stamp` e
  `clinical_records_stamp` mantêm datas/autores vindos da cópia quando não há
  usuário logado (service role). Sem ela a restauração funciona, mas as datas
  de criação viram "agora".
- O arquivo tem dados de saúde: nunca versionar (nem em `tests/`), não mandar
  por canais abertos.

## Tratamentos (2026-10-03)
- Cadastros → **Tratamentos** (`#tab-tratamentos`, `CAD_TABS`/`CAD_ITEMS`,
  permissão própria `tratamentos`; relatório `tratamentos`). Documento
  `treatments/all` `{list:[{id, patientId, inicio, valor, despesas, tipo
  ("novo"|"renegociado"), status ("ativo"|"renegociado"|"cancelado"), statusEm
  (data da última troca de status), obs, convenioId, convenio, plano,
  pacoteHoras, aba, specHours, horarios, criadoEm, atualizadoEm}]}`. Migração
  `supabase/2026-10-03b-tratamentos.sql` (caminho permitido, `module_for_path`,
  níveis copiam o acesso de Pacientes, cria 1 tratamento Ativo/Novo por paciente
  com os dados do cadastro dele; início = 1º atendimento na Agenda ou hoje).
- **Convênio, plano, pacote, ABA, especialidades/serviços e horário saíram do
  paciente** (`TREAT_FIELDS`). O paciente guarda nome, nascimento, idade. A
  janela do paciente mostra o tratamento (`treatSummaryHtml`, "Abrir
  tratamento" / "+ Novo tratamento"); paciente novo abre o tratamento ao salvar.
- **Como o resto do app lê:** `state.patientsRaw` = `patients/all`;
  `state.patients` = paciente + campos do tratamento atual
  (`rebuildPatients()`, `currentTreatment` = Ativo ou, sem ativo, o mais
  recente; `_treatId`). Planner, Agenda, cores por ABA, regra "não ABA",
  horário do paciente, pacote × planejado, lista de Pacientes e relatórios
  continuam lendo `p.aba`, `p.specHours`, `p.horarios`… sem mudança. Sem
  tratamento, vale o que está no paciente (dados antigos / testes).
  `writePatients` grava só o que é do paciente (tira `_treatId` e devolve os
  `TREAT_FIELDS` crus).
- Campos do tratamento na janela: `treatFieldsEditor(v)` → `{html, wire(ovId),
  read()}` (mesmos ids de antes: `#pConv`, `#pPlano`, `#pPac`, `#pAba`,
  `#specRowsHost`, `#pHours`…). `openTreatmentModal(t, {patientId, copyFrom,
  renegotiateFrom})`: Paciente, Início, Término (só leitura), Valor, Despesas,
  Valor final (automático), Tipo, Status, Plano terapêutico, Observações;
  Excluir / **Renegociar** (novo tratamento copiando o atual; ao salvar o
  anterior vira Renegociado) / Salvar.
- Regras: **só um Ativo por paciente** (salvar outro ativo pede confirmação e
  passa o anterior para Renegociado). Tipo automático (`trTipoAuto`): Novo se é
  o primeiro ou o anterior foi Cancelado; senão Renegociado. **Término** =
  último atendimento da Agenda (sem bloqueio, até hoje) entre o início deste e o
  do seguinte (`trLoadLast` lê `appointments` patient/date paginado, cache 2
  min; `trEnd`, `trEndText`; ativo = "Em andamento (último dd/mm)").
- Tela: busca, filtro de status (+ "Pacientes sem tratamento ativo"), aviso
  com quantos pacientes estão sem tratamento ativo, tabela `gtRender`
  ("tratamentos"; celular mostra Paciente + Status). Valores em R$ (`parseMoney`,
  `fmtMoney`, `trFinal`).
- Relatório **"Tratamentos novos e renegociados"** (`RP_BUILDERS.tratamentos`,
  lê `state.treatments`, não os atendimentos): resumo Novo × Renegociado com
  valores, iniciados no período e encerrados no período (por `statusEm`).
- Atenção: como todo documento, `treatments/all` é legível por qualquer usuário
  ativo (inclusive os valores); a tela só aparece para quem tem `tratamentos.view`.
- (2026-10-03, ajuste) **Tipo não se escolhe**: `trTipoFor(rec, list)` olha o
  tratamento anterior do paciente (início antes; mesmo início = criado antes; um
  novo vê todos): nenhum ou Cancelado → Novo; Renegociado (ou Ativo, que vira
  Renegociado ao salvar) → Renegociado. Campo "Tipo (automático)" desabilitado;
  recalculado ao salvar, já com o anterior atualizado.
- Bolinha de cor: na lista de Tratamentos, antes do nome (`trColor(t)` = idade do
  paciente + ABA do tratamento); na lista de Pacientes, a cor vem do tratamento
  ATIVO (paciente com tratamentos e nenhum ativo fica sem bolinha).
- (2026-10-03) **Terapeuta por especialidade no tratamento**: cada linha de
  `specHours` pode ter `profId` (vazio = "Todos os terapeutas"). Seleção
  `.spec-prof` ao lado da quantidade (`specProfOptions` / `specProfessionals`:
  especialidade = profissionais com essa especialidade principal; serviço
  `svc:` = quem atende o serviço). `patientSpecRows` devolve `profId`.
- **Dupla verificação** (`therapistMismatchMsg(paciente, profId, serviço)`): a
  linha do tratamento é a da especialidade principal do profissional (serviço
  Sessão) ou a do serviço; se ela tem `profId` e o agendamento é com outro →
  "Terapeuta diferente do tratamento" + "Tem certeza?" (`therapistConfirm`).
  Planner: `therapistMismatches(changesByDoc)` em `applyBookingChanges` (depois
  do horário do paciente; `opts.therapistOk`; não vale para desfazer/refazer;
  não pergunta se o paciente/serviço já estava naquela célula). Agenda:
  `agdTherapistConfirm([{rec, old}])` na janela, colar/mover e trocar. Não é
  bloqueio: confirmando duas vezes, grava.
- (2026-10-03) **Agenda também confere o horário do paciente** (antes só o
  Planner, via `patientHoursOutside`): `agdPatientConfirm([{rec, old}])` faz
  1) "Fora do horário do paciente" + "Tem certeza?" (`patientSlotOk` com o dia
  da data) e depois 2) terapeuta do tratamento (`agdTherapistCheck`). Usado na
  janela, colar/mover e trocar. Sem pergunta se paciente, data e hora não
  mudaram. O horário vem do tratamento (via `state.patients` somado).
- (2026-10-03, Etapa 0) **Banco garante um só Ativo por paciente**: trigger
  `treatments_one_active` em `documents` (migração
  `supabase/2026-10-03c-um-tratamento-ativo.sql`) recusa gravar `treatments/all`
  com dois Ativos do mesmo paciente (vale para todos, inclusive admin e
  restauração). O app mostra o motivo (`writeTreatments`).
- Teste fixo `tests/run_treatments.js` (no `npm test`, agora 21 arquivos): tipo
  automático, só um Ativo, cancelado → Novo, valor final, bolinha, ABA lida do
  tratamento (paciente cru intacto) e dupla verificação de terapeuta no Planner.

## Valores dos tratamentos protegidos por nível (2026-10-03)
- Valor e despesas saíram do documento `treatments/all` (que todo usuário ativo lê)
  para a tabela `public.treatment_finance (treatment_id pk, valor, despesas,
  updated_at, updated_by)` com RLS: ler = `has_perm('tratamentos_valores','view')`,
  gravar = `edit`, apagar = `edit` ou `tratamentos.delete`. Migração
  `supabase/2026-10-03d-valores-dos-tratamentos.sql` (copia os valores atuais,
  tira `valor`/`despesas` da lista e cria o módulo com tudo desligado: o
  Administrador marca "Tratamentos – valores" em Níveis de permissão; ele mesmo
  sempre vê).
- App: `trCanSeeVal()` / `trCanEditVal()`, `trMoney(t)` (lê `TR.fin[id]`; sem
  linha na tabela usa `t.valor` — dados antigos e testes), `trLoadFinance()` (ao
  abrir a aba e na 1ª assinatura), `trSaveFinance(id, valor, despesas)` depois de
  gravar o tratamento. Sem "ver": some a coluna "Valor final", a linha
  Valor/Despesas/Valor final da janela e as colunas de dinheiro do relatório
  (nota "Valores ocultos"). Com "ver" sem "editar": campos desativados.
- Cópia de segurança inclui `treatment_finance` (`optional`: se a tabela ainda não
  existe, a cópia segue sem ela) e `api/admin-backup.js` restaura por `treatment_id`.

## Tratamento vigente na data (Etapa 2, 2026-10-03)
- `treatmentAt(pid, iso)`: hoje ou depois = `currentTreatment` (igual a
  `state.patients`); data passada = tratamento de início mais recente até a data
  (mesmo início = o criado depois); antes do 1º, vale o 1º. `patientAt(p, iso)` =
  paciente somado a esse tratamento (cache `_patAt`); `findPatientAt(nome, iso)`.
- Usam a data do atendimento: cor da célula e popup da Agenda (`agdEventHtml`,
  `agdOpenDetails`), regra "não ABA" (`isNaoABABooking` quando o registro tem
  `date` — só a Agenda; o Planner é grade modelo e segue o tratamento atual),
  horário do paciente e terapeuta na Agenda (`agdPatientConfirm`,
  `therapistMismatchMsg(..., iso)`).
- Relatórios: Convênios (convênio/plano da data), Pacote (uma linha por
  tratamento × especialidade; cada tratamento conta só o trecho em que valeu —
  do início até o início do seguinte ou o `statusEm` do encerramento; Realizado =
  Finalizados atribuídos por `treatmentAt`), Sem atendimento (só quem tinha
  tratamento valendo no período; convênio/plano do fim do período). Frequência e
  Lista não usam dados do tratamento.
- Teste `tests/run_treatment_history.js` (cria `tests/page_ev.html` com
  `window.__ev` e apaga no fim) — `npm test` agora 22 arquivos.

## Motivo do cancelamento e histórico dos tratamentos (Etapa 3, 2026-10-03)
Decisões do usuário: motivo SÓ no Cancelado (Renegociado não pede); observação
do cancelamento opcional, obrigatória com "Outro"; Cancelado é definitivo (não
volta a outro status — para retomar, novo tratamento); histórico na janela.
- Cadastro **Motivos de cancelamento** (Cadastros → `#tab-motivos`, `REG_CFG.motivos`,
  documento `config/cancel_reasons` {list:[{id,name}]}, permissão própria
  `motivos_cancelamento`). `cancelReasonsList()` usa `DEFAULT_CANCEL_REASONS`
  (Financeiro, Mudança de cidade, Alta terapêutica, Insatisfação, Outro) enquanto
  o banco não tem o documento. "Outro" (`CANCEL_OTHER_ID`) é travado
  (`REG_CFG.motivos.locked` / `lockedMsg`) e sempre volta à lista ao gravar.
- Tratamento: `motivoCancel` (id), `motivoCancelNome` (nome na data),
  `obsCancel`; caixa `#trCancelBox` (`#trMot`, `#trObsCancel`) aparece com Status
  = Cancelado; `#trSt` desativado quando já estava cancelado.
- `historico: [{em, por, acao: "criado"|"status"|"motivo", de, para, motivo,
  motivoNome, obs, auto}]` — `trHistAdd(rec, entry)` (por = `trWho()`, nome do
  usuário logado), `trHistHtml(t)` na seção "Histórico" da janela. O ativo que vira
  Renegociado sozinho ganha entrada com `auto: true`. Tratamentos antigos sem
  histórico mostram "criado" a partir de `criadoEm`.
- Relatório "Tratamentos novos e renegociados": encerrados com colunas Motivo e
  Observação do cancelamento (`cancelReasonName`).
- Banco: migração `supabase/2026-10-03e-motivos-de-cancelamento.sql` (caminho
  permitido, `module_for_path`, níveis copiam o acesso de Tratamentos, motivos
  iniciais, trigger `treatments_cancel_rules`: cancelado não muda de status e
  cancelar exige `motivoCancel`). `writeTreatments` mostra essas mensagens.

## Tratamento com atendimentos realizados fica travado (2026-10-03)
"Realizado" = atendimento da Agenda com status Finalizado, atribuído ao
tratamento pela data (`treatmentAt`). `trLoadLast` (agora devolve Promise) também
guarda `TR.done` (nome normalizado → datas Finalizadas); `trDoneCount(t)` (null =
ainda não carregado). Com 1 ou mais: a janela mostra `#trLockNote`, esconde
Excluir e desativa pacote (`#pPac`) e quantidades/linhas de especialidades e
serviços (`.spec-name`, `.spec-hours-val`, `.rm`, `#specRowAdd`) — o terapeuta da
linha continua editável. Salvar compara `trQtyKey` (pacote + specId/quantidade)
e recusa mudança; excluir recusa. Para mudar: Renegociar (ou Cancelar). Só no
app (o banco não confere). Teste no fim de `tests/run_treatment_history.js`.

## Vencimento dos tratamentos (Etapa 4, 2026-10-04)
Decisões do usuário: vencimento por duração em meses (ajustável), opcional, aviso
30 dias antes só na tela de Tratamentos; ao vencer continua Ativo com etiqueta
"Vencido"; renegociação começa com duração/vencimento em branco.
- Campos `duracaoMeses` e `validoAte` (iso) no tratamento; janela: `#trDur` +
  `#trVenc` (`trAddMonths(inicio, n)` = início + n meses − 1 dia, recalcula ao
  mudar duração ou início); vencimento antes do início é recusado.
- `trDue(t)` (só Ativo com `validoAte`) → `{days, state: "vencido"|"vencendo"|""}`,
  `TR_DUE_DAYS = 30`, etiqueta `trDueChip`. Tela: botões `#trDue`
  ("N vencem nos próximos 30 dias" / "N vencidos") que aplicam os filtros
  `vencendo` / `vencidos` de `#trFilter`; coluna "Vencimento" no FIM da tabela
  (não muda os `:nth-child` do celular). Sem SQL (campos no documento).
