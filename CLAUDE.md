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
- As colunas antigas `profiles.is_admin`/`profiles.permissions` foram apagadas
  (migração `2026-10-07b-limpeza-campos-antigos.sql`).
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
4. **Guia (Ajuda):** toda função nova ou regra mudada precisa atualizar o tópico
   correspondente em `HELP_TOPICS` (ou criar um), bloco "Guia (Ajuda)" do script.
   O texto explica só a função da tela como ela é hoje — **nunca** o que mudou
   ("agora", "antes era"…). **Não** acrescentar linhas em `HELP_NEWS`: a seção
   Novidades foi tirada a pedido do usuário (2026-10-04) e fica para o futuro.
5. Commit + push na `main` → a Vercel publica sozinha em ~1 minuto.
6. **SQL para o usuário rodar (pedido dele, 2026-10-06):** sempre mostrar o script
   inteiro no chat, num bloco ```sql, pronto para copiar e colar no SQL Editor do
   Supabase (não basta dar o link do arquivo; não há como pôr na área de transferência).

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
  **(Revisto em 2026-10-05: a coluna do grupo NÃO fica mais livre — ver "Grupo bloqueado
  com paciente na sala". Só vale o sentido grupo já marcado → atendimentos na sala.)**
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
- (2026-10-04) A aplicação mora em `window.pipoTheme(cor, corTexto)` (script no
  início do `APP-HEAD`), que também guarda a cor no navegador
  (`agendaPipo:theme`) e a aplica na carga, antes do login. `api/config.js` lê
  `config/clinic` com a service role e devolve só `theme: {corBotoes, corTexto}`
  (null = padrão; ausente = não conseguiu ler); `pipo-supabase.js` aplica antes de
  montar a tela de login — aparelho novo já abre na cor da clínica.
  `html{accent-color:var(--accent)}`: caixas de marcar/rádios nativos seguem a cor.

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
- (2026-10-04) Campos de DATA aceitam digitação: `dpEnhanceDate` cria um
  `<div class="dp-btn dp-date">` com `<input class="dp-txt dp-in">` (máscara
  dd/mm/aaaa; Enter, Tab ou sair do campo grava via `dpParseBr` → `dpCommit`; data
  inválida avisa e volta; vazio limpa se o campo não é `required`). Ícone, seta,
  clique fora do texto ou ↓ abrem o calendário. Horários e listas continuam botões.
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
- (SUBSTITUÍDO em 2026-10-08: "não ABA" bloqueia a sala toda em QUALQUER sala; `roomIsABA` saiu.) Sala SEM "ABA" no nome (`roomIsABA(r)` falso — ex.: "Psicologia",
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
  Nome + Tratamento; Profissionais = Nome + Especialidade principal;
  Serviços e Especialidades = Nome + Profissionais; Convênios = as duas que já
  tem. Busca ocupa a linha toda; na linha seguinte ficam filtros, contador e
  botões juntos sempre que couber (contador `flex:1 1 64px`, quebra o texto em
  duas linhas se precisar; `.spacer` oculto). Tratamentos: contador + Incluir + ? em cima e a seleção de status embaixo (`order:90`). Salas/Grupos: contador no começo da
  linha dos botões e "Inativos" na linha de baixo. Regra do usuário (2026-10-04): o
  botão **?** é sempre o ÚLTIMO da barra (Agenda: data, ‹ Hoje ›, ☰, ?;
  Relatórios: ao lado de "Gerar relatório", `.rp-go-row`). Salas/Grupos já eram cartões e cabem na tela.
  Mudou a ordem das colunas no computador? Ajustar os `:nth-child` também.
- Usuários no celular (CSS em `injectStyles` de `js/usuarios.js`): tabela
  `.adm-users` só com Nome e Situação (esconde 2ª e 3ª colunas), busca na linha toda.
  Janela Níveis de permissão: tabela `.adm-roles` só com Nível e Usuários (esconde o
  resumo das permissões).
- Prontuário no celular: `#tab-prontuario` entra nas mesmas regras das tabelas de
  cadastro (largura da tela, busca na linha toda) e `#prListHost` esconde da 3ª
  coluna em diante (fica Paciente + Registros).

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
branca tinha a altura da tela e os horários passavam por fora dela (faixa branca).
Agenda no celular (2026-10-04): no lugar da lista lateral e do filtro, um seletor
único `#agdPickSel` (`.agd-pick`, preenchido em `agdRenderSide` com
`agdResources()` do modo Profissionais/Salas; vira lista própria com busca);
barra em duas linhas, `#agdNewBtn` e `#agdClearWeekBtn` escondidos; botões de período, cadeados e
desfazer maiores. No computador `.agd-pick`/`.agd-more-wrap`/`.agd-plus-btn` ficam ocultos.
(2026-10-04, pedido do usuário) Barra no celular: linha 1 = data, ‹ Hoje ›, `#agdMoreBtn`, ?
(☰ com três traços de 3px, igual ao botão do menu do topo, sem borda); linha 2 =
busca na largura toda. O ☰ abre `#agdMoreMenu`: primeiro **+ Incluir agendamento**
(repassa o clique a `#agdNewBtn`, só com permissão de incluir), depois Ir para
(Amanhã, Próxima segunda, Mesmo dia da semana que vem), Resumo do dia
(`agdDaySummary`), Bloquear/Liberar o dia e Limpar semana. `#agdPlusBtn` fica oculto.
‹ › andam de dia em dia.

## Cópia de segurança (2026-10-03, menu Acesso, só Administrador)
O projeto Supabase está no plano gratuito (sem backup automático restaurável).
- Menu Acesso → **Backup** (nome na tela desde 2026-10-04; antes "Cópia de segurança") (`data-act="backup"` em
  `js/pipo-supabase.js` → `window.pipoOpenBackup` → `openBackupModal()`, bloco
  "Cópia de segurança" em `index.html`).
- **Baixar** (`backupDownload`): lê no navegador, em páginas de 1000
  (`backupFetchAll`, `.range()`), as tabelas de `BACKUP_TABLES` — `documents`,
  `appointments`, `clinical_records` e `roles` (só consulta) — e baixa
  `backup-agenda-pipo-AAAA-MM-DD-HHMM.json`
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

## Sessão/Mês × soma das especialidades (2026-10-04)
O campo `pacoteHoras` aparece como **Sessão/Mês** em todo o sistema (janela do
tratamento, coluna da lista de Pacientes, resumo do tratamento, guia). Ao lado do
título "Especialidades/serviços e sessão (mês)" fica a etiqueta `#specSum`
(`specSumRead`/`specSumRender`, atualiza ao digitar e ao incluir/tirar linha):
"Sessão/Mês 32 · Especialidades 15 · Faltam 17" — `.spec-sum-ok` (verde, confere),
`-falta` (âmbar, falta distribuir), `-sobra` (vermelho, passou). Salvar o
tratamento com diferença pede confirmação (`sv._sumOk`). Sem SQL.

## Convênios: especialidades cobertas, valor por sessão e "libera" (2026-10-04)
Decisões do usuário: a liberação é igual para todos os convênios; valor POR SESSÃO;
especialidade liberada usa o valor da que liberou; no tratamento só aviso; valores
com a mesma permissão de "Tratamentos – valores".
- Especialidades: `libera: [specIds]` no item de `config/specialties` (campo
  "Libera atender também": caixas de marcar em grade `#regLib .lib-opt`, sem lista suspensa; coluna na lista). `specLibera(id)`.
- Convênios: `especialidades: [specIds]` no item de `config/convenios` (janela com
  linhas `#cvRows`: especialidade + valor; mostra "Libera também: …"). Valor por
  sessão na tabela protegida `public.convenio_finance (id = "conv|spec",
  convenio_id, spec_id, valor)` — migração `supabase/2026-10-04-valores-dos-convenios.sql`
  (RLS `has_perm('tratamentos_valores', view/edit)`). Sem sistema online (testes)
  os valores ficam em `c.valores {specId: valor}`. `CONV.fin`, `convLoadFinance`,
  `convSaveFinance` (upsert + apaga os removidos), `convValor(convId, specId)`
  (para relatórios futuros; liberada = valor da base). Backup inclui
  `convenio_finance` (`optional`) e `api/admin-backup.js` restaura por `id`.
- `convCoverage(convId, specId)` → null (convênio sem especialidades / serviço),
  `{direct}`, `{via: base}`, `{none}`. Tratamento: cada linha ganha
  `data-cover` ("Coberta pelo convênio via X" / "Não coberta pelo convênio",
  `.cover-none` em vermelho), refeito ao mudar convênio ou linhas (`coverRender`).
- Celular: lista de Convênios continua só com Nome + Pacientes (esconde a 3ª coluna).
- (2026-10-04) Convênio também cobre SERVIÇOS (`"svc:<id>"` na mesma lista
  `especialidades`, opções de `cvChoices()`, menos Sessão), botão
  "+ especialidades/serviços" e **Inserir todos** (`#cvAll`, inclui todos os ativos
  que faltam). `convCoverage` de serviço: só confere se o convênio tem algum
  serviço na lista; "libera" não vale para serviços.
  Especialidade/serviço que está num convênio (ou que outra especialidade libera)
  conta como "em uso" em `USAGE` → Inativar em vez de Excluir.

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
- (2026-10-04) **Vencimento por data OU por sessões** (`vencPor: "data"|"sessoes"`,
  select `#trVencPor`; `#trDateBox` com duração/válido até ou `#trTotalBox` com
  `totalSessoes`). Sessões usadas = Finalizado + "Não compareceu"
  (`TR_USED_STATUS`; `trLoadLast` guarda `TR.used`; `trUsedCount(t)` pela regra
  da data). `trDue` por sessões: restam ≤ `TR_DUE_SESSIONS` (4) = "vencendo"
  ("Restam N sessões"), ≤ 0 = "vencido" ("Sessões esgotadas"); `trDueText` na
  coluna ("6 de 10 sessões"). Total e tipo de vencimento entram em `trQtyKey`
  (travados com atendimentos realizados). Renegociar começa em "Data", vazio.
  **(Desde 2026-10-06 o padrão é "Sem vencimento" — ver a seção do fim.)**

## Contratado × realizado mês a mês (Etapa 5, 2026-10-04)
Decisões do usuário: mês a mês; realizado = Finalizado + Não compareceu; mês
atual = realizado + agendados (sem status, de hoje ao fim do mês); primeiro e
último mês proporcionais aos dias; vermelho falta / âmbar sobra; janela, coluna
e filtro.
- `trLoadLast` agora lê até o fim do mês atual (`trMonthEnd`) com
  professional_id e service e guarda `TR.appts` (nome → [{d, prof, svc, st}]);
  `TR.last`/`done`/`used` continuam só até hoje.
- `trMonthly(t)` → `{months:[{ym, label, current, partial, rows:[{specId, contr,
  real, sched, diff}], tot, falta, sobra}]}`: período = início até
  `trPeriodEnd(t)` (véspera do seguinte ou `statusEm`) limitado ao fim do mês
  atual; atendimento atribuído pelo `treatmentAt` da data; linha =
  `trSpecKey(a)` (especialidade principal do profissional na Sessão, ou
  `svc:<serviço>`); especialidade não contratada aparece com contratado 0.
- Janela: seção "Contratado × realizado (mês a mês)" (`#trMonthly`,
  `trMonthlyHtml`, recarrega depois de `trLoadLast`). Lista: coluna
  "Mês (realizado/contratado)" no fim (`trMonthCell`, chip `.tr-mchip`
  `.tr-falta/.tr-sobra/.tr-ok`, + chip do mês anterior se faltou). Filtro
  `abaixo` em `#trFilter` (só Ativos; `trMonthSummary(t).below` = falta no mês
  atual projetado ou no mês anterior).

## Guia de ajuda (2026-10-04)
Decisões do usuário: tela própria; busca; botão "?" em cada tela; cada nível vê só
o que pode usar; ("Novidades" com data — retirada em 2026-10-04, `HELP_NEWS = []`, o item só volta ao menu se a lista tiver itens); tópicos com "para que serve + passo a passo
+ regras + quem pode usar"; sem impressão. **Toda função nova entra no guia.**
- Menu Acesso → **Ajuda** (`data-act="ajuda"` em `js/pipo-supabase.js` →
  `window.pipoOpenHelp`) abre `#tab-ajuda` (botão de aba sempre oculto
  `data-tab="ajuda"`, endereço `#ajuda`; `applyPermissionsUI` e `openNavFromHash`
  deixam qualquer usuário abrir).
- Conteúdo no bloco "Guia (Ajuda)" do script: `HELP_GROUPS`, `HELP_TOPICS`
  (`{id, group, title, mod, tab, purpose, steps[], rules[], who}`; `mod` =
  módulo de permissão "ver", `"admin"` = só Administrador, null = todos;
  `helpCan`), `HELP_NEWS` (vazia; ver regra 4 de "Como publicar").
  `renderHelp()` (menu lateral `#helpNav`, corpo `#helpBody`, busca `#helpSearch`
  com `normText`, todas as palavras), `helpGo(id)`, `openHelp(topicId)`.
- Botão "?" (`.help-q`) colocado por `helpAddQButtons()` na barra de cada tela
  (`.pat-toolbar`, `.controls`, `.agd-toolbar`, `.rp-form`), tópico por
  `HELP_TAB_TOPIC` / `helpTopicForTab` (Salas/Grupos conforme `state.salasView`).
  Refeito a cada troca de aba (a barra de Usuários nasce depois).
- Celular: `#tab-ajuda` em coluna, tópicos escondidos até "Tópicos ▾"
  (`.help-nav-open`), página rola.
- Teste `tests/run_help.js` (no `npm test`, agora 23 arquivos).

## Botões por permissão, confirmação de exclusão e Inativar (2026-10-04)
Decisões do usuário: só ver = janela em leitura; Excluir + janela "Confirmar
exclusão" (todos os cadastros, evoluções e Agenda; o Planner fica como estava);
item em uso não exclui, inativa (todos os cadastros em uso); rodapé padrão
(Excluir à esquerda, Cancelar, Salvar; "Remover"/"Desmarcar" viraram "Excluir");
ferramentas do Planner e da Agenda somem sem permissão.
- `modalApplyPerms(mod, isNew, {ov, save, del, cancel})`: sem incluir/editar →
  esconde Salvar, Cancelar vira "Fechar" e `modalReadOnly(ov)` trava campos e
  botões do corpo (menos `data-ro-ok`; `.modal-ro` esconde `.rm`/`.add-row-btn`);
  sem excluir → esconde Excluir. Usado em Paciente, Profissional, Sala/Grupo e
  agendamento do Planner; Status tem a mesma regra feita à mão.
- Confirmações de exclusão: título e botão "Confirmar exclusão".
- `permToolClasses()` (em `applyPermissionsUI` e quando `state.writable` chega)
  põe `perm-no-create/edit/delete` em `#tab-agenda` (módulo agenda) e
  `#tab-agendadia` (agendamentos); o CSS esconde "+", copiar, mover,
  bloquear/liberar/limpar conforme a falta. `fixPatientBtn` e `swapProfBtn` saem
  sem permissão.
- **Inativar**: `inativo: true` no item (documento; sem SQL). `USAGE[kind](item)`
  → Promise de textos de uso (tratamentos, Planner via `plannerUseCount` sobre os
  20 documentos, Agenda via `apptUseCount(col, val)` com count no banco, outros
  cadastros). `setupInactivate({btn, mod, item, name, usage, save, close})`:
  "Verificando…" → "Excluir" (livre) ou "Inativar" (em uso; precisa editar) e
  botão "Reativar" (`<btn>Reactivate`) para inativo; o clique de exclusão
  original sai cedo com `delBlocked(this)`. Inativos: `isActive`, `activeOnly`;
  fora das listas (checkbox `.inact-toggle` "Inativos", na mesma linha da barra, logo após o contador,
  `SHOW_INACTIVE[key]`, etiqueta `inactTag`), das sugestões de paciente
  (Planner/Agenda), do select de paciente do tratamento novo, de
  `physicalRooms()/supportGroups()` (logo, do Planner e da Agenda; `(true)` traz
  todos), de `professionalSelectOptions`, `specProfessionals`, `agdResources`
  (inativo aparece só com atendimento na semana), especialidade e serviços do
  profissional, `serviceOptionsHtml`, sugestões de convênio/especialidade/serviço
  do tratamento e motivos de cancelamento. Relatórios continuam vendo todos.
  Status e Tratamentos não usam Inativar (Tratamentos já tem as regras dele).
- Teste `tests/run_perm_buttons.js` (no `npm test`, agora 24 arquivos). `tests/run_convenios.js` (convênios/libera, 25 arquivos).

## Início (2026-10-04)
Botão **Início** (`data-tab="inicio"`, `#tab-inicio`, endereço `#inicio`) é o
PRIMEIRO do topo e a tela que abre ao entrar (computador e celular; `state.tab`
começa em "inicio"). Página em branco por enquanto (o usuário vai definir o
conteúdo). Todos veem (`applyPermissionsUI` não esconde); é a primeira da lista de
recuo quando a tela atual não é permitida e o destino do Planner/Resumo no celular.
Clicar na logo ou no nome da clínica (`.brand`, `wireBrandHome`) também abre o Início.
`#zoomCtrl` nasce oculto (só aparece no Planner). Testes: `tests/test.html` e
`test_race.html` põem `#planner` no endereço antes da carga, para continuarem
começando no Planner.

## Menu Acesso nos Níveis de permissão (2026-10-04)
Decisões do usuário: Usuários com ver/incluir/editar/excluir; Backup = baixar
(restaurar só Administrador); Ajuda e Trocar senha marcados para todos nos níveis
existentes; Status (`cadastro_status`) e Clínica (`clinica`) como já eram.
- `MODULES` (js/usuarios.js) ganhou o grupo "Menu Acesso" (`group`, linha
  `.perm-group` na grade): usuarios, cadastro_status, clinica, backup (view),
  ajuda (view, `dflt: true`), senha (view, `dflt: true`). `normalizePerms` usa
  `dflt` quando o nível não tem o item gravado.
- `pipoAuth.canDefault(mod, ação, padrão)` (js/pipo-supabase.js): Ajuda e Trocar
  senha valem para todos até o item existir no nível. Menu Acesso: cada item segue a
  permissão; Sair sempre aparece. Sem Ajuda: `body.no-help` esconde os "?" e a
  tela `#ajuda` não abre.
- Usuários para quem não é Administrador (`uCan(a)` em js/usuarios.js): botão
  Níveis de permissão só Administrador (`openRolesModal` recusa); nível
  Administrador some da escolha; conta de administrador abre só leitura; "+ Incluir",
  "Criar acessos dos profissionais", senha/ativar e Excluir conforme as caixas.
  `api/admin-users.js`: `currentActor` (admin ou permissão `usuarios`), ação →
  create/edit/delete, recusa mexer em conta de administrador e criar no nível
  Administrador. Backup: `openBackupModal` abre com `backup.view`; o cartão de
  restaurar só aparece para o Administrador (`api/admin-backup.js` continua só admin).
- Banco: migração `supabase/2026-10-04b-permissoes-menu-acesso.sql` (valores
  iniciais nos níveis; `profiles_select`/`profiles_update` com `has_perm('usuarios',…)`;
  trigger `profiles_nonadmin_guard`: não-admin não altera administrador, não dá nível
  Administrador, não muda o próprio nível).

## Relatório financeiro (Etapa 6, 2026-10-04)
Decisões do usuário (refeitas na revisão): é um RELATÓRIO (não painel; o Início
continua em branco), só em Relatórios; valor do tratamento = MENSAL; indicadores:
contagens + receita prevista + ticket médio (sem taxas e sem realizado nos
convênios); permissão própria em Níveis de permissão → **Relatórios** →
"Relatório financeiro" (`relatorios.financeiro`); uma linha por mês do período;
"ativo" = valeu em algum dia do mês; lista dos ativos com valor + totais.
- `RP_TYPES` id `financeiro`, `RP_BUILDERS.financeiro`; bloco "Relatório
  financeiro (Etapa 6)" no script: `finMonth(ym)` → {ativos, novos (tipo novo
  iniciado no mês), reneg (tipo renegociado iniciado no mês), canc (cancelado com
  statusEm no mês), receita (soma `trFinal` dos ativos), ticket}; `finActive(t, s, e)`
  usa `trPeriodEnd`. Seções: "Mês a mês" (+ linha Total do período: média de ativos,
  somas, receita total, ticket = receita ÷ soma de ativos) e "Tratamentos ativos no
  período" (valor final do mês, meses no período, total).
- Valores: `treatment_finance` passa a ser lida também por quem tem o relatório —
  migração `supabase/2026-10-04c-relatorio-financeiro.sql` (policy
  `treatment_finance_select`). `finCanSee()`; `trLoadFinance` carrega com
  `tratamentos_valores` OU o relatório; `rpGenerate` espera `trLoadFinance` no tipo
  financeiro.
- `rpGenerate` busca os atendimentos em páginas de 1000 (antes todo relatório
  parava em 1000 linhas — limite do Supabase).
- Teste `tests/run_financeiro.js` (26 arquivos no `npm test`).

## Botões de incluir = "+ Incluir" (2026-10-04)
Todo botão que cria um registro novo (Pacientes, Tratamentos, Profissionais,
Convênios, Serviços, Especialidades, Motivos, Salas/Grupos, Agenda, Prontuário,
Usuários, Níveis) tem o texto **"+ Incluir"** (antes "+ Novo …"/"+ Nova …").
Botões de linha dentro das janelas ("+ terapeuta", "+ status", "+ especialidade ou
serviço") continuam como estão. Novo botão de inclusão: usar "+ Incluir".

## Robustez (Etapa 7, 2026-10-04)
- **Tratamentos gravam só o que mudou:** `writeTreatments(list)` compara com
  `state.treatments` e chama `ref.patchList(alterados/novos, idsExcluídos)`
  (`js/pipo-supabase.js` → RPC `patch_list(p_path, p_upserts, p_deletes)`, trava a
  linha e troca/acrescenta/remove itens por id; não aceita `schedule/*`). Sem a
  função no banco (erro `code "nofunc"`) ou nos testes, grava a lista inteira.
  Migração `supabase/2026-10-04d-gravar-so-o-tratamento.sql`.
- **"Enviar para a Agenda" com avisos:** `plannerSendPlan` devolve também `warns`
  (`{rec, info, msgs}`: "Fora do horário do paciente" — `patientSlotOk` com o
  tratamento da data —, "Terapeuta diferente do tratamento" — `therapistMismatchMsg`).
  A prévia mostra `details.send-warns` com uma caixa por item (`[data-warn]`,
  marcada); desmarcado não vai, e o botão mostra "Enviar (N)".
- **Término/realizado dos tratamentos pelo banco:** `trLoadLast` lê a RPC
  `treatment_appt_summary(p_until)` (agrupado por paciente/data/profissional/
  serviço/status com `n`); sem a função, volta a ler `appointments` página a página.
  Migração `supabase/2026-10-04e-resumo-atendimentos-tratamentos.sql`.
- **Inativar paciente encerra o tratamento ativo:** depois de inativar,
  `offerCancelActiveTreatment(paciente)` abre `#ovCancTr` (motivo `#ctMot`,
  observação `#ctObs`, obrigatória com "Outro"; "Manter ativo" / "Cancelar
  tratamento"). Precisa de editar em Tratamentos (senão só avisa).
- Teste `tests/run_robustez.js` (no `npm test`, agora 27 arquivos).

## Listas de cadastro: digitar direto no campo (2026-10-04)
Decisões do usuário: só as listas de CADASTRO (paciente, profissional,
especialidade, serviço, convênio, sala, status, motivo — qualquer tamanho); texto
que não existe volta ao valor anterior; no celular igual ao computador.
- `DP_COMBO_SEL` (ids/classes dos `<select>` de cadastro + `[data-combo]` para
  novos) → `dpEnhanceCombo(el)` (chamado por `dpEnhanceTimeList`): `<div class="dp-btn
  dp-date dp-combo">` com `<input class="dp-txt dp-in" role="combobox">` + seta; o
  `<select>` continua escondido (`.value`/`change` como sempre). **Não copia as
  classes do select** (o código acha `.spec-prof`/`.cv-spec`/`.rm-prof-select` por
  classe). Opção de valor vazio ("Escolha…", "Todos", "Sem sala") aparece como
  placeholder.
- Lista flutuante `#dpPop` (mesmo visual): digitar filtra com `normText` e marca o
  primeiro (`.dp-opt.kb`); ↑ ↓ andam, Enter/Tab/clique escolhem; "Nenhum item
  encontrado" (`.dp-none`); Esc fecha e volta o texto (`pop.__onEsc`, também usado
  por `dpKey`); ao sair: nome exato = escolhe, vazio = opção vazia (se houver),
  outro texto = volta. Entrar no campo marca todo o texto.
- Listas que não são de cadastro (Sim/Não, status do tratamento, Vencimento por,
  semana/dia…) continuam botão com lista. Teste `tests/run_combo.js` (28 arquivos).

## Planner: "Horário livre" (2026-10-04)
Botão `#freeSlotBtn` → `openFreeSlotModal()`: paciente + Especialidade (Todas) +
Profissional (Todos, filtrado pela especialidade). Varre as 4 semanas × dias abertos
× horários × colunas de SALA com profissional: célula vazia (sem paciente nem
bloqueio), `seatAvailable`, `patientSlotOk` (fora do horário do paciente não
aparece) e `plannerConflict` com serviço Sessão. Resultado por semana (recolhível)
e dia; clicar fecha a janela, abre o dia/semana e `openBookingModal` da célula com
o paciente já preenchido. Garante `state.scheduleDocs` das 4 semanas carregados
(as regras leem dali). Teste `tests/run_free_slot.js` (8 checagens).

## Lista de Pacientes só com dados do paciente (2026-10-04)
Decisões do usuário: colunas **Nome, Nascimento, Idade, Tratamento** (situação do
tratamento atual — `currentTreatment` — com a etiqueta `.tr-chip`, ou "Sem
tratamento"); busca só pelo nome. Convênio, plano, Sessão/Mês, ABA e
especialidades saíram da lista (ficam em Tratamentos). `SORT_COLS` /
`PAT_COL_KEYS` = nome, nascimento, idade, tratamento (todas ordenáveis,
`patSortKey`); larguras padrão 340/150/110/200. Celular: Nome + Tratamento
(`:nth-child(1)` e `(4)`). A bolinha de cor continua (tratamento ativo).

## Planner: menu "Ferramentas ▾" (2026-10-04)
Na barra fica só **Enviar para a Agenda**; Horário livre, Editar agendamento,
Trocar profissional, Exportar Excel e Limpar semana ficam no menu `#plToolsBtn` /
`#plToolsMenu` (`.pl-tools-wrap`, mesmo visual dos menus do topo), no fim da barra,
antes do "?" da ajuda. Os botões mantêm os ids (listeners e `applyPermissionsUI`
continuam iguais). Abre para a esquerda quando não cabe (`.to-left`); fecha ao
escolher, clicar fora ou Esc. A busca do Planner encolhe até 140px antes de a barra
quebrar linha. Testes abrem o menu antes de clicar nesses botões.

## Planner lembra o dia e a semana (2026-10-04)
Decisão do usuário: só dia e semana, neste computador. `savePlannerView()` grava
`{day, week}` em `localStorage["agendaPipo:plannerView"]` ao trocar dia/semana;
`restorePlannerView()` no início do `boot()` (dia inválido cai no primeiro dia
aberto pela regra de `dayEnabled`). Filtro de sala, zoom e busca NÃO são lembrados.
Teste `tests/run_planner_view.js`.

## Cartão do tratamento na janela do paciente; menu "Opções" (2026-10-04)
- `treatCardHtml(t)`: etiqueta de status + vencimento (`trDueChip`), grade
  (Início, Tipo, Convênio, Plano, Sessões/mês, ABA, Válido até/Sessões usadas) e
  especialidades/serviços como etiquetas com sessões/mês. Borda esquerda, etiqueta
  "Ativo" (`.tr-chip.st-ativo`, em todo o sistema) e números na cor do sistema
  (`--accent`). `treatSummaryHtml` continua para os outros lugares.
- Menu do Planner renomeado de "Ferramentas" para **Opções** (`#plToolsBtn`).

## Cadastro completo do paciente; Médicos, Escolas e CBO (2026-10-05)
Decisões do usuário: dados novos JUNTO com o cadastro atual (`patients/all`, legível
por todo usuário ativo — o usuário foi avisado do risco LGPD e escolheu assim);
Médico e Escola como cadastros próprios com "+" na janela do paciente; campos
extras: documentos, clínicos, endereço completo, administrativos; data de entrada
= data do cadastro (editável); configuração "Campos" num botão da tela Pacientes.
- `PAT_SECTIONS` / `PAT_FIELDS` (bloco "Cadastro do paciente: seções e campos
  configuráveis"): janela com abas (`.pm-tab[data-pmtab]`, `.pm-panel[data-pmsec]`):
  Paciente (nome `#pNome`, nomeSocial, nascimento `#pNasc` + `#pIdadeField`, sexo,
  cpf, rg, cns + cartão do tratamento), Responsáveis (`responsaveis: [{nome,
  parentesco, cpf, telefone, email, financeiro, principal, buscar}]`, rádio
  `name="respFin"` — um só financeiro — ou "outra pessoa" → `finOutro: {ativo, nome,
  doc, telefone, email, endereco}`), Contato e endereço (telefone, email,
  prefContato, `endereco: {cep, rua, numero, compl, bairro, cidade, uf}`; CEP busca
  no ViaCEP e preenche só os vazios), Clínico (cid com sugestões `CID_SUGGESTIONS`,
  diagData, suporte, comunicacao, alergias, medicacoes, restricoes), Médico e escola
  (medicoId, escolaId, escolaSerie, escolaTurno, escolaContato, mediador),
  Administrativo (entrada — hoje no paciente novo —, comoConheceu, obs). Ids
  `pf-<campo>`, `pa-<parte do endereço>`, `fo-<campo do financeiro>`. CPF/telefone
  gravados só com dígitos (máscaras `data-mask`). `criadoEm` no paciente novo.
- Botão `#patFieldsBtn` "Campos" (permissão `campos_paciente` ver/editar) →
  `openPatientFieldsModal()`: tabela Aparece/Obrigatório por campo, grava
  `config/patient_fields {fields:{campo:{show,req}}}` (`state.patientFields`,
  `patFieldCfg`). Nome sempre visível e obrigatório; obrigatório marca Aparece.
  Salvar o paciente recusa com "Preencha: …" e abre a aba do 1º que falta.
  Campo escondido não é apagado (Object.assign sobre o registro antigo).
- Cadastros novos (REG_CFG + `SIMPLE_LISTS`/`writeSimpleList`): **Médicos**
  (`config/doctors`, nome/especialidade/CRM/telefone), **Escolas**
  (`config/schools`, nome/telefone/contato), **CBO** (`config/cbo`, `code` +
  `name`="Descrição", id = só dígitos, código único — `cboKey`). `REG_CFG[k].fields`
  = campos extras genéricos (`regFieldsHtml`/`readRegFields`). Sem documento no
  banco, `cboList()` = `CBOS_SUGGESTIONS` + CBO já gravados nos profissionais.
- Lista de cadastro com "+": `regPickHtml(kind, id, opts)` (`.reg-pick`, select vira
  campo de digitar) + `quickAddRegistry(kind)` (janela por cima no `#confirmHost`,
  salva e já escolhe). Usado em Médico/Escola do paciente e no CBO do profissional
  (`#profCbos`, valor = código, texto "código — descrição").
- Permissões novas: `medicos`, `escolas`, `cbo`, `campos_paciente` (MODULES em
  `js/usuarios.js` e `js/pipo-supabase.js`). Migração
  `supabase/2026-10-05-cadastro-do-paciente.sql` (caminhos, `module_for_path`,
  níveis copiam Pacientes/Profissionais, Campos começa desligado, CBO semeado com
  sugestões + os dos profissionais).
- Teste `tests/run_patient_form.js` (29 arquivos no `npm test`).

## Cadastro de Conselhos (2026-10-05)
Cadastros → **Conselhos** (`#tab-conselhos`, `REG_CFG.conselhos`, documento
`config/councils {list:[{id, sigla, name}]}`, permissão `conselhos`; id =
`councilKey(sigla)`, sigla única). Sem documento no banco, `councilList()` =
`DEFAULT_COUNCILS` (CRP, CRFa, CREFITO, CRN, CRM, CREF, CRESS, ABPp) + os já
gravados nos profissionais. No profissional, `#profConselho` virou
`regPickHtml("conselhos", …)` (valor = sigla, texto "sigla — nome", "+" inclui).
`REG_CFG` ganhou ganchos genéricos usados por CBO e Conselhos: `dupKey`, `newId`,
`label`, `pickValue`, `optsHtml` (`regDupKey`, `regItemLabel`). Migração
`supabase/2026-10-05b-conselhos.sql` (precisa da 2026-10-05 antes).

## Cadastro do paciente em janela única (2026-10-05, substitui as abas)
Decisões do usuário: uma janela com rolagem (mesma largura no computador, tela
cheia no celular), grupos nesta ordem — Identificação, Endereço, Filiação,
Responsáveis pela retirada, Medida protetiva, Contato, Responsável financeiro,
Escola, Saúde, Administrativo, Tratamento (`PAT_SECTIONS`, `PAT_FIELDS`, `.pm-sec`).
- Formato no paciente: `mae`/`pai` {nome, cpf}; `rotina` [{nome, src?}] (Mãe/Pai
  entram sozinhos com `src`, tirados ficam em `rotinaOff`); `telefones`
  [{numero, nome, via: "whatsapp"|"ligacao"}]; `emails` [{email, nome}];
  `financeiro` {nome, doc, telefone, email, endereco, link: ""|"mae"|"pai"};
  `professor` (antes `escolaContato`). `patNormalize(p)` converte o formato das
  abas (`responsaveis`, `finOutro`, `telefone`, `email`, `prefContato`) ao abrir;
  salvar apaga essas chaves (`PAT_LEGACY_KEYS`).
- Botão **Responsável** ao lado da Mãe/Pai: liga nome e CPF do financeiro
  (somente leitura, acompanha as correções) enquanto marcado. Copiar telefone /
  e-mail (lista quando há mais de um) / endereço do paciente; pergunta antes de
  trocar valor diferente.
- **CPF do paciente obrigatório** (também ao editar cadastros antigos), válido e
  único (`cpfDup`). CPF de mãe/pai igual ao de outro paciente = só aviso
  (`patSameParent`). Contador "N faltando" no título de cada grupo (`pendUpdate`).
- Data de entrada: hoje no paciente novo; não pode passar do início do 1º
  tratamento (`patFirstTreatmentStart`); o tratamento não começa antes dela
  (`trPatEntrada`, dica "Cadastrado em" em `#trEntradaHint`).
- Cartão do tratamento mostra o horário (`trHoursText`: só dias/períodos em que
  vem, "Seg 07:20–12:00 · Qua 13:30–17:30") no lugar das especialidades.
- Lista: `#patSearchBy` (Paciente, Mãe, Pai, Responsável financeiro — nome ou CPF).
  Celular: busca + seletor na 1ª linha; contador, Inativos, "Opções" (texto curto
  `.pm-sm`), + Incluir e ? na 2ª (regras com `section#tab-pacientes` para vencer as gerais).
  Lista no celular (Pacientes e Tratamentos): coluna da situação com 122px (só a etiqueta,
  sem quebrar) e o nome com o resto da largura.
  Menu **Outras opções ▾** (`#patMoreBtn`/`#patMoreMenu`): Campos obrigatórios
  (`openPatientFieldsModal`; ver o item do Administrador abaixo), Imprimir ficha cadastral (`openPatientPrintPick` → `patientPrint`,
  iframe A4 com logo), **Mesclar cadastros** (`openPatientMergeModal`, só
  Administrador, fora dos Níveis): 1º fica, 2º é excluído; RPC
  `merge_patient_records` (Agenda + Prontuário), Planner renomeado via
  `applyBookingChanges`, tratamentos passam (Ativo do 2º vira Renegociado com
  histórico se o 1º tem Ativo), vazios do 1º completados com o 2º.
- (2026-10-05) **Administrador tem controle total dos Campos obrigatórios** (menos o Nome,
  sempre obrigatório): CPF nasce obrigatório (`dfltReq`) e Filiação/Financeiro nascem
  visíveis (`fixed`), mas o Administrador pode tirar; os outros níveis com
  `campos_paciente.edit` não mexem nesses três. Mãe/Pai escondidos somem da janela e o
  vínculo "Responsável" com eles é ignorado.
- Migração `supabase/2026-10-05c-mesclar-e-data-de-entrada.sql` (flag
  `pipo.merging` em `clinical_records_stamp`, função de mesclar, acerto único da
  data de entrada = menor entre 01/01/2026 e o início do 1º tratamento).

## Retirada do paciente e medida protetiva (2026-10-05)
Decisões do usuário: "Responsáveis pela rotina" virou **Responsáveis pela retirada**
(Mãe/Pai entram sozinhos quando preenchidos; outros com nome + parentesco `rel`);
grupo novo **Medida protetiva** (`protetiva: [{nome, rel, obs, ate}]` no paciente,
`ate` = válida até, vazia = sem prazo; vencida fica guardada e para de avisar —
`protActive`). A mesma pessoa não fica nas duas listas (ao salvar, oferece tirar da
retirada). Observação só para quem pode marcar "Finalizado" ou Administrador
(`protCanSeeObs`; sem isso o campo nem aparece e o valor gravado é mantido).
- Agenda: alerta SÓ no último atendimento do paciente no dia (`agdIsLastOfDay`, entre
  as linhas carregadas em `AD.rows`): `.book-main.prot-last` (borda + escudo
  `protShieldHtml`). Janela e detalhes do atendimento mostram o quadro
  `pickupBoxHtml(p, alerta)` (quem não pode / quem pode retirar) — só se houver alguém.
- Lista de Pacientes: escudo vermelho ao lado do nome com medida ativa
  (`patHasProtetiva`). Ficha impressa: retirada + medidas (com "vencida").
- `patPickup(p)` → {ret, prot (ativas), old (vencidas)}. Sem SQL (dados em `patients/all`).

## Feriados e recessos + "Gerar mês" (2026-10-05)
Decisões do usuário: feriado NÃO bloqueia marcação (Agenda cinza + confirmação);
pré-cadastrar nacionais + Corpus Christi + Aniversário de Blumenau (2/9); repetição
automática (fixos com "Repete todo ano"; Sexta-feira Santa/Corpus Christi pela Páscoa);
meio período (dia/manhã/tarde); permissão própria `feriados` (níveis copiam
`agendamentos`). Gerar mês: só 4 semanas (5ª sempre à mão), Semana 1 = primeira semana
que começa numa segunda dentro do mês, feriados SEMPRE pulados, leva o mesmo que o
Enviar, botão `#genMonthBtn` ao lado de "Enviar para a Agenda".
- Documento `config/holidays {list:[{id, name, tipo, inicio, fim, periodo, anual,
  movel}]}` (`SIMPLE_LISTS.feriados`, `state.holidays`; sem documento =
  `DEFAULT_HOLIDAYS`). `holCovers`, `holidaysOn(iso)`, `holidayAt(iso, time)` (sem
  horário = só dia inteiro; manhã/tarde pelo almoço de `agdSlots`), `holEaster`,
  `holMovelIso`. Tela Cadastros → Feriados e recessos (`REG_CFG.feriados` com os
  ganchos novos `open` e `sort`; janela própria `openHolidayModal`).
- Agenda: `td.agd-hol` (listrado cinza, `title` com o nome), cabeçalho do dia
  `.agd-hol-th`/`.agd-hol-name`, etiqueta `.agd-hol-tag` na visão Dia.
  `agdPatientConfirm` pergunta "Feriado ou recesso" antes das outras checagens
  (o resto passou para `agdPatientConfirmHours`).
- `openGenMonthModal` / `genMonthWeeks(ym)`: `plannerSendPlan(dia, semana, data,
  skipTime)` ganhou o 4º parâmetro (pula com motivo `holiday`); dias fora do mês,
  passados ou feriado de dia inteiro ficam de fora; prévia por semana, notas dos dias
  "à mão", avisos com caixa; grava em lotes e entra no desfazer da Agenda.
  "Enviar para a Agenda" só avisa quando a data é feriado.
- Migração `supabase/2026-10-05d-feriados.sql`. Teste `tests/run_holidays.js`.

## RH: Funcionários e Prestadores (2026-10-05)
Decisões do usuário: cadastro ÚNICO (profissional = funcionário com o tipo
"Profissional"); tipos múltiplos e editáveis; usuário criado só na janela do
funcionário (Administrador ainda pode criar conta sem funcionário); horário de
trabalho = horário de atendimento (UMA tabela, qualquer dia e hora; fora dele não
agenda); nível novo "Recursos Humanos"; Ausências e Controle de jornada virão depois
no mesmo menu.
- Topo: menu **RH ▾** (`#rhBtn`/`#rhMenu`, `RH_ITEMS`, `RH_TABS` em `NAV_MENUS`;
  grupo "RH" no ☰ do celular): **Funcionários e Prestadores** (`#tab-funcionarios`,
  `renderStaffTab`, `wireStaffTab`, `staffOnShow`; busca nome/cargo/CPF, filtro de
  tipo `#staffTypeFilter`, Inativos; celular = Nome + Tipos; barra no celular: busca + tipo na 1ª linha, contador, Inativos, + Incluir e ? na 2ª) e **Tipos de
  funcionário** (`REG_CFG.tiposfunc`, `SIMPLE_LISTS.tiposfunc` → `config/staff_types`,
  `DEFAULT_STAFF_TYPES`; "Profissional" travado, `STAFF_PROF_TYPE`).
- Banco (migração `supabase/2026-10-05e-rh-funcionarios.sql`): `public.staff (id,
  professional_id, data jsonb)` — RLS `rh_funcionarios` — e `public.staff_pay
  (staff_id, data jsonb)` — RLS `rh_remuneracao` (view/edit); `profiles.staff_id`;
  nível `recursos-humanos`; Financeiro e RH com tudo do RH; cada profissional virou
  uma linha `prof-<id>`. Backup inclui `staff` e `staff_pay` (optional).
- App: `STAFF.rows` (`staffLoad`, `staffSaveRow`, `staffDeleteRow`), remuneração
  `staffPayLoad`/`staffPaySave`; sem sistema online fica em memória (`STAFF_PAY_MEM`).
  `staffEntries()` = linhas do RH + profissionais sem linha; `staffView(e)` junta os
  dados (nome/CPF/nome social vêm do profissional).
- Janela `openStaffModal(entry, opts)` (ids antigos mantidos: `#ovProf`, `#profName`,
  `#profSpecialty`, `#profCbos`, `#profConselho`, `#profSave`…). `openProfessionalModal(p)`
  virou atalho para ela (Cadastros → Profissionais; "+ Incluir" já marca Profissional).
  Seções (`data-sfsec`): Identificação, Tipos (`#sfTypes`, "+" inclui tipo), Atendimento
  (só com Profissional), Horário de trabalho (`#profHours`, 7 dias, campos texto HH:MM
  `.ph-start/.ph-end`, `staffTime`, `staffDayInit` = salvo ou o da clínica; total de
  horas, atendimentos para profissional, aviso `#sfJornadaNote` × jornada), Contato
  (telefone + `#sf-telvia` WhatsApp/Ligação → `telefoneVia`; CEP ViaCEP, ids `sa-*`; grade `.sf-grid` com `data-ga`, 2 colunas no celular), Contrato (`sf-vinculo`, `sf-cargo`, `sf-admissao`,
  `sf-deslig`, `sf-jornada`), Remuneração (`#sf-valor` + linhas `.sf-pay` com
  descrição/valor/forma/favorecido/PIX ou banco/obs, `#sfPayAdd`, soma × contratado
  `#sfPaySum`), Contato de emergência, Acesso ao sistema (e-mail, `#sfRole`, senha,
  ativo — `userForStaff`/`userForProfessional`, `adminApi create` com `staff_id` e/ou
  `professional_id`; evento `pipo:users-changed` atualiza a tela Usuários), Observações.
  Seções do RH só com `rh_funcionarios.view`; remuneração com `rh_remuneracao`.
- Salvar: profissional grava `config/professionals` (Object.assign; `horarios` dos 7
  dias = o que a Agenda/Planner leem); desmarcar Profissional deixa o profissional
  inativo; RH grava `staff` e `staff_pay`. Desligamento ≤ hoje (confirmação): pessoa e
  profissional inativos, usuário desativado (`set_active`), aviso se há atendimentos
  na Agenda a partir da data.
- Usuários → "+ Incluir" (`newUser` em `js/usuarios.js`): abre funcionário novo
  (`window.pipoOpenStaffNew`); Administrador escolhe também "Conta sem funcionário".
- Permissões: `rh_funcionarios` (ver/incluir/editar/excluir) e `rh_remuneracao`
  (ver/editar, exibido como "Funcionários e Prestadores – valores", exclusivo como Tratamentos – valores), grupo "RH" em Níveis de permissão (`MODULES` nos dois js).
- Teste `tests/run_staff.js` (30 arquivos no `npm test`).

## Profissionais dentro de Funcionários e Prestadores (2026-10-05)
Decisão do usuário: não existe mais cadastro de profissional separado nem
permissão "Profissionais". Cadastrar/editar qualquer pessoa (inclusive quem atende)
segue a permissão **Funcionários e Prestadores** (`rh_funcionarios`: ver, incluir,
editar, excluir), com as regras de antes: só ver = janela em leitura; em uso
(atendimentos, colunas de sala, tratamentos ou usuário de acesso) não exclui,
**Inativar**; inativo tem **Reativar** (`setupInactivate` com `mod: "rh_funcionarios"`
para profissional e não profissional). Remuneração continua com `rh_remuneracao`.
- "Profissionais" saiu do menu Cadastros (`CAD_ITEMS`) e dos Níveis de permissão
  (`MODULES` de `js/usuarios.js`); a aba `#tab-profissionais` continua no código,
  oculta (testes e `openProfessionalModal`). `writeProfessionals` confere
  `rh_funcionarios`. Tópico de ajuda "profissionais" juntou-se a "funcionarios".
- Banco: migração `supabase/2026-10-05f-profissionais-no-rh.sql` —
  `module_for_path('config/professionals') = 'rh_funcionarios'` e cada nível recebe
  em `rh_funcionarios` o que tinha em `profissionais` (OR com o que já tinha).
- (2026-10-05) Tipos na janela = lista suspensa de várias opções (`#sfTypesMs`, painel
  `#sfTypes` com `.ms-opt`, mesmo padrão de Serviços) + "+". Migração
  `supabase/2026-10-05g-funcionarios-dos-usuarios.sql`: usuário ativo sem cadastro
  ganha funcionário `user-<id>` (nome, e-mail, tipo pelo nível) ligado por `staff_id`.

## Colaboradores em Cadastros (2026-10-05, substitui o menu RH)
Pedido do usuário: sem botão RH no topo. **Cadastros → Colaboradores** (antes "RH →
Funcionários e Prestadores"; aba `funcionarios`) e **Cadastros → Tipos de colaborador**
(antes "Tipos de funcionário"; aba `tiposfunc`), logo depois de Tratamentos em
`CAD_ITEMS`/`CAD_TABS` (`RH_ITEMS`/`RH_TABS`/`#rhBtn` não existem mais). Permissões
exibidas como **Colaboradores** e **Colaboradores – valores** (ids continuam
`rh_funcionarios` / `rh_remuneracao`, sem grupo próprio na grade de Níveis). Tópicos de
ajuda no grupo Cadastros. O nível "Recursos Humanos" continua com esse nome.
Nas seções acima, onde se lê "RH → Funcionários e Prestadores" vale "Cadastros → Colaboradores".

## Botões "+" das janelas (2026-10-05)
`.reg-pick > .btn.reg-pick-add` ("+" ao lado das listas de cadastro) e
`.modal .btn.add-row-btn` ("+ telefone", "+ especialidade", "+ terapeuta"…): mesmo
visual — fundo `--accent-weak`, texto e borda na cor do sistema, cantos 8px; hover
preenchido. O "+" é quadrado da altura do campo (44px no celular).

## Listas flutuantes acompanham o campo (2026-10-05)
`dpPlace(pop)` posiciona `#dpPop` (calendário, listas, campos de digitar) junto do
campo; `dpReplace` roda em todo `scroll` (captura), `resize` e `visualViewport`
(teclado do celular), então a lista acompanha o campo ao rolar a janela; se o campo
sai da área visível da janela/tela, a lista fica escondida até ele voltar. O seletor
de cor (`#cpPop`, `pop.__place`) faz o mesmo.

## Tratamento cancelado pode voltar a outro status (2026-10-05) — DESFEITO, Cancelado é definitivo (ver abaixo)
Pedido do usuário: saiu a regra "Cancelado é definitivo". `#trSt` não trava mais e o
salvar não força "cancelado". Ao sair de Cancelado, `motivoCancel`/`motivoCancelNome`/
`obsCancel` saem do tratamento (ficam no `historico`) e `statusEm` vira a data da troca.
Continua: cancelar exige motivo ("Outro" exige observação) e só um Ativo por paciente
(reativar com outro Ativo pede confirmação e passa o outro para Renegociado). Banco:
migração `supabase/2026-10-05h-cancelado-pode-voltar.sql` (`treatments_cancel_rules`
sem o bloqueio de troca de status).
- (2026-10-05) **Cancelar o tratamento inativa o paciente** (`trInactivatePatient`, depois
  de salvar): só se ele não tiver outro tratamento Ativo e se o nível pode editar
  Pacientes (senão avisa). Sem SQL.
- (2026-10-05) **Tratamento novo de paciente inativo**: `#trPat` lista todos os pacientes,
  inativos com "(inativo)" ao lado do nome; salvar um tratamento NOVO (que não seja
  Cancelado) reativa o paciente (`trReactivatePatient`; sem editar Pacientes, só avisa).
- (2026-10-05, desfeito a pedido do usuário) **Cancelado voltou a ser definitivo**: a
  mudança "cancelado pode voltar a outro status" foi desfeita (`wasCancelled` trava
  `#trSt` e força "cancelado" ao salvar). Banco: migração
  `supabase/2026-10-05i-cancelado-definitivo.sql` repõe a regra (só precisa se a 05h
  foi rodada). `trOfferReactivatePatient` saiu (não há mais cancelado → ativo).
- (2026-10-05) **Cancelar ou renegociar pergunta se remove os agendamentos**
  (`trOfferRemoveBookings(patId)`, depois de salvar; também quando outro Ativo vira
  Renegociado): janela `#ovRmBk` com `#rbPl` (Planner, as 4 semanas — conta via
  `currentBookingsFor(plannerAllDocIds())`, remove com `applyBookingChanges`/
  `clearValueFor`, entra no desfazer; precisa de `agenda.delete`) e `#rbAg` (Agenda a
  partir da data `#rbFrom`, conta `appointments` do paciente com `date >=`; remove com
  `agdSplitByRecords` + `agdDeleteByIds` + `agdRecord`; precisa de
  `agendamentos.delete`). Nada marcado por padrão; com evolução no prontuário fica.

## Planner: "Enviar para a Agenda" com Semana/Mês; "Outras opções"; barra numa linha (2026-10-05)
- Pedido do usuário: "Gerar mês" deixou de ser botão/janela própria. **Enviar para a Agenda**
  (`#sendToAgendaBtn`) fica dentro do menu **Outras opções ▾** (`#plToolsBtn`, antes
  "Opções"), e a janela começa com o seletor **Período** (`#sendMode`, `sendModeHtml` /
  `wireSendMode`): Semana = `openSendToAgendaModal` (dia ou semana inteira numa data);
  Mês = `openGenMonthModal` (as 4 semanas no mês; título "Enviar para a Agenda", botão
  "Enviar"). Trocar o Período troca o conteúdo da mesma janela. `#genMonthBtn` não existe mais.
- Barra do Planner sempre numa linha no computador (`@media (min-width:761px)`:
  `flex-wrap:nowrap`, filtro de salas e busca encolhem; até 1300px os botões de dia/semana
  ficam compactos).

## Telefone com máscara em todos os cadastros (2026-10-05)
Ouvinte global de `input` (perto de `formatCpf`): todo `input[data-phone]` ou
`input[data-mask="phone"]` recebe `formatPhone` ao digitar. Campos marcados: telefones e
responsável financeiro do paciente (`#fi-telefone`, valor mostrado já formatado),
colaborador (`#sf-tel`, `#sf-em-tel`), Clínica (`#clFone`), Médicos/Escolas
(`REG_CFG.fields` com `phone: true`, valor gravado também aparece formatado). Gravação
continua só com dígitos onde já era assim. Campo de telefone novo: usar `data-phone`.

## Ordem do menu Cadastros (2026-10-05)
Decisão do usuário: agrupados por assunto, com divisória entre os grupos
(`sep: true` no item de `CAD_ITEMS`; `.cad-sep` no menu do topo, `.mnav-sep` no ☰):
Pacientes, Tratamentos, Convênios, Motivos de cancelamento, Médicos, Escolas |
Colaboradores, Tipos de colaborador, Especialidades, Serviços, CBO, Conselhos |
Salas, Grupos de Suporte, Feriados e recessos, Status. Item novo de cadastro: colocar no
grupo do assunto. Item sem tela própria usa `open` (ex.: Status → `openStatusesModal`;
`navActivate`/`openNavFromHash` chamam `it.open`, endereço `#status`).

## Início oculto (2026-10-05)
Pedido do usuário: o botão **Início** fica oculto em todos os modos até ele definir
o conteúdo. Chave `INICIO_ON = false` (perto de `var state`): botão sempre oculto,
`#inicio` não abre, ao entrar sem endereço abre o Planner (celular: Agenda;
`navInitialTab` grava `#planner`/`#agendadia` e `openNavFromHash` faz o clique; sem
permissão cai na primeira tela permitida), e a logo/nome leva para essa mesma tela.
Para voltar a mostrar o Início: `INICIO_ON = true` (e rever o tópico "inicio" da Ajuda).

## Grupo bloqueado com paciente na sala (Planner, 2026-10-05)
Pedido do usuário: profissional com paciente numa SALA tem a coluna dele nos Grupos
de Suporte bloqueada no horário (`.prof-busy`), SEM a exceção antiga "grupo
apontando para a mesma sala" (a grade não libera mais a coluna do grupo e
`plannerConflict` recusa gravar no grupo). Continua: agendamento de grupo JÁ marcado
apontando para a sala não bloqueia nem recusa os atendimentos dele nessa sala
(`sameRoomViaGroup` só nesse sentido), e as regras "não ABA" da sala não mudam.

## Menu Acesso em grupos (2026-10-05)
Pedido do usuário: menu Acesso organizado em grupos com divisória (`accGroups` em
`js/pipo-supabase.js`, `.acc-sep`): Clínica, Usuários, Backup | Senha, Ajuda |
Sair. (2026-10-05) **Status** saiu do Acesso e foi para Cadastros (último item);
na grade dos Níveis, "Status (cadastro)" fica junto dos cadastros, depois de Grupos. "Trocar senha" passou a se chamar **Senha** (menu, Níveis de permissão, Ajuda).
A grade "Menu Acesso" dos Níveis segue a mesma ordem.
## Menu do topo com uma opção só vira botão direto (2026-10-04)
Regra do usuário: em `renderNavMenus`, se o nível permite só UMA opção de um menu
do topo (Cadastros ou Planner), o botão mostra o nome dessa opção (ex.:
"Pacientes"), sem seta nem menu (`m.single`, classe `.nav-single`), e o clique
abre a tela direto (`navActivate`; Ctrl+clique abre em outra aba). Com duas ou
mais, volta o menu com o texto original (`btn.__menuHtml`). Nenhuma = botão
oculto. No celular (`mnavRender`) o grupo com uma opção também vira o item solto.
Teste `tests/run_nav_single.js`.

## Agenda: janela do atendimento respeita o horário de trabalho (2026-10-05)
Pedido do usuário: profissional fora do horário de trabalho (cadastro do colaborador,
`horarios` em `config/professionals`) não pode ser agendado. As células já ficavam
`.agd-off`; a janela (`agdOpenModal`, "+ Incluir", visão Salas) deixava escolher
qualquer profissional/data/hora. Agora o Salvar recusa com "Fora do horário de trabalho
de Fulano neste dia (08:00–12:00)" / "não trabalha neste dia" (`agdInHours`,
`profDayHours`), antes das outras checagens. Atendimento já gravado que não mudou de
profissional, data e horário continua editável. Vale para todos os tipos (bloqueio,
reunião, treinamento também). Teste `tests/run_prof_workhours.js`.

## Janela do colaborador não diz "Alterado" se o profissional não gravou (2026-10-05)
Caso real: quem tinha "editar" em Colaboradores mudou o horário de trabalho, viu um aviso
rápido de erro e depois "Alterado", mas o horário não ficou salvo. O banco recusou
`config/professionals` (se a migração `2026-10-05f-profissionais-no-rh.sql` não foi rodada,
`module_for_path` ainda exige a permissão antiga `profissionais`, que saiu dos Níveis) e
`writeProfessionals` engolia o erro. Agora `writeProfessionals(list, true)` (modo strict,
usado pela janela do colaborador) rejeita com o motivo do banco: a janela fica aberta,
"Não foi possível salvar tudo: …" e os dados do RH não são gravados pela metade. Teste no
fim de `tests/run_prof_workhours.js`.
- Produção (2026-10-05): a 05f não tinha sido rodada (`module_for_path` devolvia
  `profissionais`). Criada `supabase/2026-10-05j-cadastro-profissional-segue-colaboradores.sql`
  só com a função (sem a parte 2 da 05f, que copiaria o acesso antigo de Profissionais
  para Colaboradores por cima do que o Administrador já ajustou nos Níveis).

## Plano terapêutico — Parte 1 (2026-10-06)
Decisões do usuário: Prontuário ▾ com **Prontuário** e **Plano terapêutico**; um plano
vigente por paciente, validade 6 meses, Revisar = nova versão (anterior guardada); quadro
clínico = dados da seção Saúde do cadastro (automático) + texto "Resumo do quadro
clínico" do plano; um quadro por especialidade do tratamento (novas entram, nenhuma sai;
fora do tratamento = aviso); objetivo: Nº automático com ▲▼ na linha, Habilidade/área,
Objetivo, Critério de sucesso, Prazo (3/6/12 meses da data do plano), Escala, Situação
(níveis da escala), Status (Ativo/Atingido/Suspenso; último nível = Atingido automático;
atingido fica no plano); impressão/PDF. Escalas e Habilidades comuns à clínica.
- Banco: migração `supabase/2026-10-06-plano-terapeutico.sql` — tabela protegida
  `therapy_plans` (patient_id, version, status vigente|encerrado, plan_date, review_date,
  summary, sections jsonb, prev_id, created_by/updated_by + nomes; índice único de um
  vigente por paciente; RLS por `plano_terapeutico`), função `plan_prof_update(p_id,
  p_sections)` (profissional sem "editar": só levelId/status/statusEm dos objetivos das
  especialidades dele — principal + `complementares` em config/professionals —, objetivos
  novos só na principal, nada some), documentos `config/scales` (Likert 0–5, ABA com
  cores) e `config/skill_areas` (8 áreas), módulos `plano_terapeutico`, `escalas`,
  `habilidades` e o nível **Coordenador** (cópia do Profissional + plano completo).
- App (bloco "Plano terapêutico" no fim do script): `PLAN` (sem sistema online = memória
  `PLAN.mem`), `planLoadAll`, `planVigente`, `planVersions`, `openPlanFor(pid)`,
  `openPlanModal(plan, {patientId})`, `planSectionsView` (salvos + `planTreatSpecs` =
  specHours do paciente somado ao tratamento), `planProfMode`/`planFull`/`planMySpecs`
  (teste: `window.__planProfId`), `planReviewChip`, `planPrint`. Tela `#tab-planos`
  (`renderPlansTab`, busca, filtro Revisão a vencer/vencida). Menu `#prBtn`/`#prMenu`
  (`PR_ITEMS`, `PR_TABS`, também no ☰ do celular). Tratamento: seção "Convênio, pacote e
  horário" + botão `#trOpenPlan` (não existia texto antigo de "plano terapêutico" para
  migrar: era só o título dessa seção).
- Cadastros → **Escalas** (`REG_CFG.escalas`, janela `openScaleModal`: níveis com cor,
  ▲▼, último = final) e **Habilidades / áreas** (`REG_CFG.habilidades`). Em uso nos
  planos = Inativar (`planUseCount`).
- Colaborador: **Áreas complementares** (`#sfCompl`, `#sfComplAdd` → `complementares`
  no profissional). **Aviso de área** (`areaMismatchMsg`, `areaConfirm`): Sessão com
  profissional cuja principal + complementares não estão nas especialidades do
  tratamento → confirmação. Planner: `areaMismatches` em `applyBookingChanges`
  (`opts.areaOk`, não vale para desfazer); Agenda: `agdAreaCheck` depois do terapeuta.
- Backup inclui `therapy_plans` (restaura por versão crescente). Teste
  `tests/run_plano.js` (31 arquivos no `npm test`). Os profissionais fictícios de
  `tests/test.html` têm `complementares` para os testes antigos não pararem no aviso.
- Quadro de cada especialidade com borda lateral na cor dela (`.pl-spec`, `border-left-color`); colunas estreitas (Nº 52, Habilidade 128, Prazo 96, Escala 92, Situação 168, Status 104) e o resto dividido entre Objetivo e Critério de sucesso (`.pl-col-txt`), que crescem com o texto (`planGrow`).
- (2026-10-06) **Banco de objetivos** e cadastros do plano no menu Prontuário ▾ (`PR_ITEMS`:
  Prontuário, Plano terapêutico | Banco de objetivos, Escalas, Habilidades / áreas; saíram de
  Cadastros). Documento `config/goal_bank {list:[{id, name, areaId, criterio, scaleId, specId}]}`
  (`specId` vazio = todas), permissão `objetivos`, `REG_CFG.objetivos` + `openGoalModal(item,
  {stack, prefill, onSaved})`. No plano, o campo Objetivo mostra `.pl-goal-pop` (fixa, junto do
  campo) com `goalMatches(texto, especialidade)`; escolher preenche o texto e, se vazios, área,
  critério e escala (`goalApply`); "+ Salvar no Banco de objetivos" abre a janela por cima
  (`#confirmHost`) já preenchida. Migração `supabase/2026-10-06b-banco-de-objetivos.sql`.
- Pedidos do usuário para o plano (2026-10-06), aprovados: Parte 2; objetivos do dia na Agenda;
  copiar objetivos na revisão (manter/ajustar/encerrar); aviso de objetivo parado; painel da
  coordenação; prazo vencido no objetivo; comparação entre versões; relatório para a família;
  relatório para o convênio. Recusados: ciência da família, metas da família, anexos.
- **Parte 2 (2026-10-06):** evolução (`prOpenEditor`) com "Objetivos do plano terapêutico
  trabalhados" (`#prGoals`, só com `plano_terapeutico.view`): objetivos ATIVOS do plano vigente
  nas especialidades do profissional do atendimento (`profAreas`; sem profissional, todas) —
  `planEvoGoalsFor`, `planEvoGoalsHtml`, `planEvoGoalsRead`. Grava
  `clinical_records.plan_goals [{planId, specId, objId, scaleId, levelId}]`; o trigger
  `clinical_records_plan_goals` (security definer) põe `levelId` + `levelEm` (data da evolução)
  no objetivo do plano vigente se a data não for anterior a `levelEm`; último nível = Atingido,
  sair dele = Ativo. Mudança manual da Situação no plano também grava `levelEm` (hoje);
  `plan_prof_update` aceita `levelEm`. Gráfico no plano (`#plCharts`, `planEvoLoad`,
  `planEvoCharts`, `planChartSvg`, `planChartsHtml`): figura por especialidade × escala, linha
  por objetivo (até 8, `PLAN_VIZ_MAX`), cores `--viz-1..8` (paleta validada claro/escuro),
  legenda, rótulo direto (≤ 4), dica no ponto e "Ver tabela". Sem sistema online lê
  `PLAN.evoMem`. Migração `supabase/2026-10-06c-objetivos-na-evolucao.sql`; backup leva
  `plan_goals`.
- (2026-10-06) **Agenda: clique num atendimento abre sempre `agdOpenDetails`** (antes, quem podia
  editar ia direto para `agdOpenModal`); botão **Editar agendamento** (`#agdDetEdit`, só com
  `agendamentos.edit`). Nos Detalhes, quadro **Objetivos do atendimento** (`#agdDetGoals`,
  `agdGoalsFill` → `agdGoalsData`/`agdGoalsBoxHtml`, só com `plano_terapeutico.view`): resumo,
  quadro clínico (`summary`) e objetivos ATIVOS do plano vigente nas áreas do profissional do
  atendimento (`planActiveObjs`), cada um com `planObjMetaHtml` (critério, prazo, escala, situação,
  status). Outros pacientes do mesmo profissional/data/horário (`agdSameSlotPatients`, em
  `AD.rows`): objetivos em comum (mesmo texto, `normText`) primeiro e os do paciente em
  "Objetivos do paciente ▾" (`[data-ag-obj-more]`); sozinho, todos abertos.
- Outros pacientes do horário SEM plano vigente (ou sem objetivos ativos nas áreas do
  profissional) não contam no quadro (`agdGoalsData` filtra). Ao agendar na Agenda (janela,
  colar/mover, trocar), `agdGoalsCheck(pairs)` — último passo de `agdPatientConfirm`, depois
  de `agdAreaCheck` — avisa "Sem objetivos em comum" (confirmação) quando o paciente e outro
  do mesmo profissional/data/horário têm plano vigente e nenhum objetivo com o mesmo texto.
- (2026-10-06) **Detalhes do Agendamento**: ao lado do nome, seletor `#agdDetSeg`
  (`.seg`, `[data-det]`) que troca o quadro (`[data-det-pane]`): **Agendamento** (Serviço, Sala,
  Data/Hora, Observação), **Saúde** (CID, alergias, medicações, restrições — cadastro do
  paciente) e **Tratamento** (Plano, ABA, Horários — `trHoursText` do paciente somado ao
  tratamento da data). Sem paciente cadastrado (grupo, bloqueio) só o quadro Agendamento, sem
  seletor. Ordem: quadro, retirada/medida protetiva, **Objetivos** (o antigo "Objetivos do
  atendimento"), Status. Nomes no menu: **Objetivos** (antes "Banco de objetivos") e
  **Plano Terapêutico** (com T maiúsculo no menu, aba, Níveis e Ajuda).
- (2026-10-06) Detalhes: **"Podem retirar"** (`pickupRetHtml`) acima do nome; **Medida protetiva**
  (`pickupProtHtml`, quadro vermelho só com medida ativa: aviso + "Não pode retirar: Nome
  (Relação)") abaixo do quadro de informações. Objetivos recolhidos (`.ag-obj-head[data-ag-toggle]`,
  `[data-ag-box="all"|"common"|"own"]`): resumo visível, lista oculta; linha = cor, nº,
  habilidade, objetivo / Critério · Escala / Status · Situação; "Objetivos do paciente" em quadro
  próprio, recolhido, sem resumo. A janela "Editar agendamento" continua com `pickupBoxHtml`.
- (2026-10-06) Janela do paciente: o tratamento atual aparece numa linha só (`treatCardHtml` →
  `.trc-line`: Início, Tipo, Plano, ABA).
- Evolução: objetivos ANTES das "Observações" (o editor), com as mesmas informações.
- **Finalizado travado para o terapeuta** (`agdFinalLocked`, `agdTherapistUser` = usuário com
  `professional_id`, não Administrador; teste: `window.__planProfId`): status desativado nos
  Detalhes e na janela, com aviso. Banco: `appointments_status_guard` (migração
  `supabase/2026-10-06d-finalizado-travado-terapeuta.sql`).

## Agenda: linha final com a saída da última sessão (2026-10-05)
Pedido do usuário: horários do Planner e da Agenda seguem o horário da clínica e a
duração padrão (`clinicSlots`: só sessões inteiras; com 50 min, 07:20–12:00 vira
07:20…10:40). A Agenda mostra a saída da última sessão: almoço (`agdLunchLabel`, já
existia) e a nova linha final `tr.agd-endrow` (`agdDayEnd`, `agdEndRowHtml`; na Semana o
rótulo é a saída mais tarde e o dia diferente mostra a dele em `td.agd-end-cell`). O
Planner já tinha as duas linhas (`timeRows`). Teste `tests/run_clinic_slots.js`.

## Planner: barrinha na cor da sala embaixo do profissional (2026-10-05)
Pedido do usuário (opção 5 das sugestões de divisão entre salas): embaixo do nome do
profissional, no cabeçalho (`.seathead .seathead-cell`) e na linha do almoço
(`.periodrow-seatname`), uma barra de 3px na cor da sala (`--room` = `swatchVar(r.color)`
inline no `th`/`div`, `box-shadow: inset 0 -3px 0`). Só cabeçalhos: sem custo na grade.

## Plano terapêutico: linhas de objetivo compactas (2026-10-05)
Pedido do usuário ("as linhas ocupam muito espaço"): linha vazia de 68px → 41px.
Objetivo e Critério com `rows="1"` (`planGrow` mínimo 32px, cresce ao digitar), listas
`.pl-tbl .dp-btn` com 32px, células `vertical-align:middle`, "até dd/mm/aa" ao lado do
prazo (`.pl-prazo`, data completa no `title`; coluna Prazo 176px), setas ▲▼ menores.
- (2026-10-05) Setas ▲▼ ANTES do número, discretas (sem borda, cinza, mais visíveis no
  passar do mouse); número com a fonte dos campos (12.5px, peso normal).
  "Habilidade / área" passou a se chamar **Habilidade** (janela, cadastro "Habilidades",
  menu, Níveis de permissão, ajuda, mensagens).

## Tratamento: Sem vencimento, Descontos e ABA por especialidade (2026-10-06)
- **Vencimento por** ganhou **Sem vencimento** (`vencPor: "sem"`, padrão do tratamento
  novo e da renegociação): esconde duração/válido até; `trDue` = null, `trDueText` = "".
  Migração `supabase/2026-10-06e-tratamento-sem-vencimento.sql` pôs "sem" em TODOS os
  tratamentos existentes (pedido do usuário).
- "Despesas" aparece como **Descontos** (campo no banco continua `despesas`).
- **ABA por linha** em `specHours[].aba` (select `.spec-aba` em cada linha). Mudar o ABA
  do tratamento (`#pAba`) copia para todas as linhas; cada linha muda sozinha.
  `bookingAbaOf(p, profId, service)` / `bookingPatient(p, b, profId)`: serviço ≠ Sessão =
  linha `svc:<id>`; Sessão = linha da principal ou complementar do profissional
  (`profAreas`); sem linha (ou nenhuma linha com ABA) = ABA do tratamento. Usado na cor
  (Planner, `agdEventHtml`, Detalhes) e em `isNaoABABooking(b, profId)` (grade do Planner,
  `plannerConflict`, `abaGroupDependencyDenied`; a Agenda usa `professional_id` da linha).
  Teste `tests/run_aba_linha.js` (32 arquivos no `npm test`).
- (2026-10-06) ABA do tratamento e das linhas só **Sim** ou **Não** (`abaYesNo`: vazio de
  cadastros antigos aparece como Sim; vazio e Sim valem igual na cor e nas regras), padrão
  Sim. Títulos das colunas acima das linhas (`.spec-head`: Especialidade ou serviço,
  Sessões/mês, Terapeuta, ABA; oculto no celular, onde as linhas quebram).
- (2026-10-06) Janela do tratamento: botão **Cadastro do paciente** (`#trOpenPat`, no topo à
  direita, `.modal-head-acts`; só com `pacientes.view` e paciente escolhido) fecha o
  tratamento e abre `openPatientModal` do paciente.
- (2026-10-06, revisão) ABA mostrado nos Detalhes do Agendamento (aba Tratamento) = o ABA
  daquele atendimento (`bookingAbaOf` com o profissional e o serviço da linha), não o do
  tratamento; cartão do tratamento mostra Sim quando o ABA está vazio (`abaYesNo`).
  `schema.sql` conferido montando um banco do zero (sem erros).
- (2026-10-06, correção) O ABA trocado numa linha não era gravado: o botão visual da lista
  (`dpMakeButton`) copia a classe do `<select>`, e `syncSpecRowsFromDom` lia `.spec-aba` (o
  botão, sem `.value`). Agora lê `select.spec-aba`. Ao procurar um `<select>` melhorado pela
  classe, use sempre `select.<classe>`. Regra (Planner e Agenda): linha com ABA manda;
  especialidade/serviço fora do tratamento = ABA do tratamento; mudar o ABA do tratamento
  copia para todas as linhas.

## Dados de saúde com permissão própria; Criar acessos sem duplicar (2026-10-06)
- **Pacientes – saúde** (`saude_paciente`: ver/editar; `MODULES` nos dois js). `HEALTH_KEYS`
  (medicoId, cid, diagData, suporte, comunicacao, alergias, medicacoes, restricoes) saem de
  `patients/all` para a tabela `public.patient_health (patient_id pk, data jsonb)` com RLS
  (migração `supabase/2026-10-06f-saude-do-paciente.sql`: copia, tira do documento, níveis
  herdam ver/editar de Pacientes; pode rodar de novo, inclusive depois de restaurar cópia antiga).
- App: `HEALTH.map` (null = sem sistema online/tabela → campos continuam no paciente, como nos
  testes), `healthLoad()` (chamado em `applyPermissionsUI`), `healthOf`, `healthSave`,
  `healthCanSee/Edit`, `patFieldShown(key)`. `rebuildPatients`/`patientAt` somam a saúde;
  `writePatients` tira `HEALTH_KEYS` do documento quando a tabela está em uso; o salvar do
  paciente e o Mesclar gravam a saúde com `healthSave`. Sem "ver": some o grupo Saúde da
  janela, o seletor Saúde dos Detalhes do Agendamento, a parte Saúde da ficha impressa e o
  quadro clínico do plano (mensagem). Com "ver" sem "editar": campos travados.
  Backup inclui `patient_health` (optional; `api/admin-backup.js` por `patient_id`).
  Teste `tests/run_saude.js` (33 arquivos no `npm test`).
- **Criar acessos dos profissionais** fica (pedido do usuário): lista só profissionais ATIVOS
  sem usuário ligado por `professional_id`, por `staff_id` do colaborador ou com conta no
  e-mail de contato (`window.pipoProfStaff()` → `{prof, staffId, email}`); sugere o e-mail
  de contato do colaborador; cria com `staff_id`. `api/admin-users.js` recusa criar quando
  já há perfil com o mesmo `professional_id`/`staff_id` ("Já existe um usuário ligado a este
  cadastro."), e a lista mostra "Já tem usuário" (não conta como erro).
- `supabase/conferencia-dos-dados.sql`: script SÓ DE LEITURA com 17 verificações (Planner em
  colunas apagadas, nomes não cadastrados, inativos agendados, tratamentos, CPF, Agenda sem
  status, Finalizado sem evolução, usuários/profissionais). Não é migração.
- Produção (2026-10-06): o usuário rodou a `2026-10-06d` (Finalizado travado) e a
  `2026-10-06f` (saúde do paciente).

## Tirar coluna, excluir ou inativar sala/grupo com agendamentos (Planner, 2026-10-06)
Decisões do usuário: coluna tirada com agendamentos → apagar ou mover; sala/grupo
excluído ou inativado → apaga só os do Planner (Agenda não é mexida); agendamentos de
colunas que não existem mais são limpos ao salvar. Bloco "Salas/grupos × agendamentos do
Planner" (depois de `writeRooms`):
- `plannerSeatRemovalFlow(rec, removedSeats, newList)` (no Salvar de `openRoomModal`):
  janela `#ovSeatRm` com um `select[data-sr-seat]` por coluna ("Apagar os agendamentos" ou
  "Mover para <sala — profissional>", só colunas do mesmo tipo, ativas e com profissional),
  prévia `.sr-prev` (movidos / não cabem → apagados: ocupado, `seatAvailable`,
  `slotRefusal`, `plannerConflict`). Junta `plannerOrphans(all, newList)` (chaves cuja
  coluna não existe; só com `agenda.delete`).
- `plannerRoomDeleteFlow(room, uses)`: Excluir (uses null) e Inativar (via
  `setupInactivate({inactivateFlow})`) — `roomPlannerUse` = colunas dela + grupos que
  marcam o nome da sala; confirmação "Apagar e excluir" / "Apagar e inativar". `USAGE.salas`
  passou a contar só a Agenda (Planner não decide mais Inativar).
- `applyBookingChanges(..., {noHistory: true})`: grava sem entrar no desfazer (estrutural).
- `plannerLoadDocs()` lê as 4 semanas e preenche `state.scheduleDocs`. Teste
  `tests/run_room_seats.js` (34 arquivos no `npm test`).

## Grupo marcando a mesma sala também bloqueia (Planner, 2026-10-06)
Pedido do usuário (caso Lara: grupo às 10:00 marcando "Fonoaudiologia" e colunas dela na
sala Fonoaudiologia livres): acabou a exceção `sameRoomViaGroup`. Profissional com
agendamento num grupo tem as colunas dele em TODAS as salas bloqueadas no horário
(`.prof-busy`), inclusive a sala que o grupo marca; `plannerConflict` recusa gravar. A
exceção "não ABA" de `groupBookedRoom` (outro profissional na sala) não mudou.

## Tratamentos: coluna ABA na lista (2026-10-06)
Pedido do usuário. Coluna "ABA" logo depois de Status (`trAbaText`/`trAbaCell`): o ABA do
tratamento; se as especialidades (`specHours[].aba`) têm valores diferentes, "Misto" com o
detalhe por especialidade no `title`. Ordenável.
- (2026-10-06, pedido do usuário) Ordem das colunas: Paciente, Início, Vencimento, Convênio,
  ABA, Término, Tipo, Status, Mês (realizado/contratado) e, só para quem vê valores, Valor
  final no fim (`trCols.push`). Celular: Paciente + Status (1ª e 8ª, `:nth-child(8)`).

## Fluidez do Planner e da Agenda; Tela cheia (2026-10-06)
Medido com volume real fictício (110 pacientes, 15 salas/40 colunas, 75% ocupado).
- Agenda: `agdRenderIfVisible` junta as mudanças do tempo real e redesenha uma vez a cada
  150 ms (`agdRenderTimer`; enviar um mês = 1 redesenho, não centenas). `agdLoadWeek` lê
  em páginas de 1000 (`.order("id").range()`; antes uma semana com mais de 1000 linhas
  vinha incompleta) e, recarregando a MESMA semana (`AD._loadedRange`), não apaga a grade.
  `agdPatchGrid(host, html)` troca só as `td`/`tr` cujo HTML mudou (mesmo `thead` e mesmo
  nº de linhas; senão refaz tudo): sem piscar, mantém rolagem e "clique de novo".
- Planner Todos×Todos: cada tabela fica num `.cv-lazy` (`content-visibility:auto` + `width:max-content` —
  sem ele, em "Todos os dias × 1 semana" o embrulho cortava a tabela e não rolava para os lados —
  `contain-intrinsic-size` estimado por nº de colunas/horários): só é posicionada e pintada
  perto da tela. Até pintar: 2,3 s → 0,9 s (sem limitar CPU). As 20 tabelas continuam no
  DOM (busca, atualização por documento e testes iguais).
- **Tela cheia** (`[data-full-toggle]`, botão de quatro cantos na barra do Planner e da
  Agenda; oculto no celular): `gridFullscreen(on)` põe `body.grid-full` (esconde topo,
  barra, legenda, nota e, na Agenda, a lista lateral), pede tela cheia ao navegador e mostra
  `#fullExit` "Sair da tela cheia". Esc (do navegador via `fullscreenchange`, ou do teclado
  sem janela/menu/copiar aberto) volta. Teste `tests/run_fluidez.js` (35 arquivos).

## Plano terapêutico por Habilidade (2026-10-06, substitui os quadros por especialidade)
Decisões do usuário: quadros por **Habilidade**; cada objetivo com as **especialidades que
podem trabalhá-lo** (seleção múltipla); Situação ÚNICA (vale a última evolução, de qualquer
especialidade); profissional inclui/edita objetivos (a principal dele vem marcada e não sai;
pode marcar outras como apoio); planos do formato antigo EXCLUÍDOS; todas as sugestões
aprovadas (especialidades sugeridas na Habilidade, conferência de cobertura, filtro "Só as
minhas especialidades", contador + quadro recolhível, outras especialidades e últimas
avaliações nos Detalhes/evolução, relatório "Evolução por habilidade", Nº por habilidade).
- Formato: `sections = [{areaId, objectives: [{id, objetivo, criterio, specIds, prazo, scaleId,
  levelId, levelEm, status, statusEm, criadoEm}]}]` (sem `specId` no quadro, sem `areaId` no
  objetivo). `planSectionsView(plan)` ignora quadro sem `areaId`. Apoio: `planObjSpecs`,
  `planObjById`, `planProfWorks(o, áreas)` (alguma especialidade do objetivo está nas
  áreas = principal + complementares), `planWorkSpec(o, prof)` (principal se marcada, senão a
  1ª em comum — vai em `plan_goals[].specId`), `planSkillSpecs(areaId)`, `planSpecSiglas/Names`,
  `planLastBySpec(records)` + `planLastHtml` (última avaliação por especialidade).
- Janela (`openPlanModal`): `#plAddArea` "Incluir habilidade…" (cria o quadro e o 1º objetivo),
  quadro `.pl-area[data-area]` com `[data-area-toggle]` (recolhe; contador objetivos · ativos ·
  atingidos), colunas Nº | Objetivo | Critério | **Especialidades** (`[data-specs]` → lista
  flutuante `.pl-specs-pop`: "Do tratamento" primeiro, "Outras especialidades (apoio)"; a
  principal do profissional fica marcada e travada) | Prazo | Escala | Situação | Status.
  Objetivo novo já vem com as sugeridas da habilidade que estão no tratamento.
  Sem especialidade não salva. `#plCover` (cobertura) e `#plOnlyMine` (só para quem é
  profissional). Regras do profissional: `canFull(o)` (objetivo com a principal dele, ou novo),
  `canSt(o)` (área complementar: situação/status), `canRm(o)` (só os ainda não gravados).
- Banco de objetivos: `specIds` (vazio = todas; itens antigos com `specId` lidos por
  `goalSpecIds`), caixas `#glSpecs` (`specCheckGridHtml`/`specCheckGridWire`), mesmo texto não
  repete na mesma habilidade. `goalMatches(q, areaId, specIds)`: mesma habilidade do quadro.
- Habilidades: campo "Especialidades sugeridas" (`#regHabSpecs` → `specIds`), coluna na lista.
- Evolução: `planEvoGoalsFor(pid, profId, picked, records)` por habilidade; Detalhes do
  Agendamento: `agdGoalsData(row, records)` agrupado por habilidade (`.ag-obj-area`), linha com
  "Especialidades: … (também …)" e últimas avaliações; `agdGoalsFill` carrega planos + evoluções.
- Gráficos por habilidade × escala (`ch.areaId`); a dica do ponto traz a sigla da especialidade.
- Relatório **Evolução por habilidade** (`RP_TYPES` id `evolucao-habilidade`, lê `PLAN.rows`;
  `rpGenerate` espera `planLoadAll`): por habilidade e por paciente × habilidade (objetivos,
  ativos, atingidos, suspensos, %, atingidos no período por `statusEm`); filtro de profissional =
  `planProfWorks`. Permissão `relatorios.evolucao-habilidade` (REPORTS em `js/usuarios.js`).
- Banco: migração `supabase/2026-10-06g-plano-por-habilidade.sql` (exclui planos com quadro
  `specId` e esvazia `plan_goals` que apontavam para eles; `clinical_records_plan_goals` procura
  o objetivo em qualquer quadro; `plan_prof_update` com as regras novas). Testada num Postgres de
  teste (PGlite) antes de publicar. Teste `tests/run_plano.js` reescrito (55 checagens).

## Regras "não ABA" só para Sessão (Planner e Agenda, 2026-10-06)
Pedido do usuário: quando o serviço não é Sessão, as regras ABA são ignoradas.
`isNaoABABooking` devolve false para `service` ≠ `DEFAULT_SERVICE_ID` (atendimento de
outro serviço não ocupa sala/horário); `plannerConflict` e `agdConflictIn` não barram um
registro de outro serviço ao lado de um "não ABA". Na grade do Planner, a célula travada
só pela regra ABA (sem outra trava) ganha `.aba-soft`: continua listrada, mas aceita
clique/colar/soltar (a gravação recusa se for Sessão). A cor do paciente não mudou.
Testes no fim de `tests/run_aba_linha.js`.

## Agenda: menu "Outras opções ▾" (2026-10-06, substitui "Limpar semana")
Decisões do usuário: Limpar por período com filtros completos, prévia e proteção dos
realizados; Bloquear período; Trocar profissional no período; Copiar dia/semana;
Pendências de status; Status em lote; Exportar Excel; as mesmas opções no ☰ do celular.
- Bloco "Agenda: menu Outras opções" (no lugar de `agdClearWeek`, que saiu): `AGD_TOOLS`
  (`{k, label, ok(), run()}`; `agdToolsVisible`, `agdToolsMenuHtml`, `agdRunTool`).
  Botão `#agdToolsBtn` / `#agdToolsMenu` em `#agdToolsWrap` (oculto sem nenhuma opção
  permitida; oculto no celular, onde o ☰ `#agdMoreMenu` ganha o grupo "Outras opções" com
  `[data-agd-tool]`). Permissões: limpar = excluir; bloquear e copiar = incluir (apagar
  junto no bloquear = excluir); trocar = editar; status em lote = algum status permitido
  além de Finalizado; pendências e exportar = todos.
- Apoio: `agdToolModal` (janela padrão), `agdPickHtml/Wire/Read` (lista de marcar com
  filtro; nada marcado = todos; já vem marcado o profissional/sala aberto), `agdFetchRange`
  (páginas de 1000), `agdRecordsMap` (evolução, confere também para o Administrador),
  `agdInsertBatches`, `agdUpdateRows`, `agdInPer` (manhã/tarde pelo fim da última sessão da
  manhã), `agdTimesFor`, `agdDatesBetween` (só dias abertos), `agdListTable`, `agdCountTable`.
- Toda ferramenta tem "Ver prévia" (qualquer mudança nos campos limpa a prévia) e grava com
  `agdRecord` (desfazer). Com status ou evolução: Limpar não apaga, Trocar não troca.
  Copiar pula data passada, clínica fechada, feriado, fora do horário, horário ocupado e
  `agdConflictIn`. Status em lote usa `agdSetStatusQuiet` (RPC, um aviso só) e não oferece
  Finalizado. Exportar = CSV ";" com BOM (Data, Dia, Hora, Profissional, Sala, Paciente/grupo,
  Tipo, Serviço, Status, Observação, Origem).
- Teste `tests/run_agd_tools.js` (banco em memória no lugar do Supabase; 36 arquivos no
  `npm test`).

## Planner Todos: "Segunda-feira" fica à esquerda ao rolar (2026-10-06)
`.day-section{width:max-content;min-width:100%}`: a seção do dia acompanha a largura da
grade, então o rótulo (sticky `left:0`) não sai da tela ao rolar para os lados (antes a seção
tinha a largura da tela e o rótulo ia embora junto). "1ª semana" já ficava presa dentro da
própria semana. Teste no `tests/run_fluidez.js`.

## Menus "Outras opções" por cima de tudo; Observações do tratamento (2026-10-06)
- Pedido do usuário: o menu da Agenda ficava atrás da grade (a barra `.agd-toolbar` tem
  `overflow-x:auto` e cortava o menu) e os menus não podem alargar a janela.
  `placeToolsMenu(btn, menu)` (antes do bloco "Tela cheia"): `.pl-tools-menu.tools-fixed`
  com `position:fixed`, alinhado pela direita do botão, preso dentro da tela (abre para cima
  se não couber embaixo, com rolagem própria). Usado no Planner (`#plToolsMenu`), Agenda
  (`#agdToolsMenu`) e Pacientes (`#patMoreMenu`); fecha ao rolar ou mudar o tamanho da
  janela. O menu da Agenda tem o mesmo visual do Planner (sem divisórias).
- Barra do Planner: de 761 a 1100px a busca e o filtro encolhem mais; até 960px a barra
  quebra em duas linhas (antes o "?" passava da borda e a página ganhava rolagem lateral).
- Tratamento: **Observações** logo depois das especialidades/serviços e antes do horário
  (`treatFieldsEditor(v, {beforeHours})`).

## Trocar o nome do paciente atualiza Planner, Agenda, Prontuário e Plano (2026-10-06)
Pedido do usuário. Planner (`bookings[].patient`) e Agenda (`appointments.patient`) guardam o
NOME. No salvar do paciente (`openPatientModal`), com nome diferente e cadastro gravado
(`writePatients` agora resolve `true` quando gravou), `patientRenameEverywhere(id, antigo, novo)`:
Planner pelas 4 semanas (`currentBookingsFor` + `applyBookingChanges` com `noHistory`, sem as
confirmações de horário/terapeuta/área) e Agenda + `clinical_records.patient_name` +
`therapy_plans.patient_name` pela RPC `rename_patient(p_id, p_old, p_new)` (Administrador ou
`pacientes.edit`; exige o nome novo já salvo; flag `pipo.merging` mantém autor das evoluções).
Outro paciente com o mesmo nome antigo = não renomeia (aviso). Migração
`supabase/2026-10-06h-renomear-paciente.sql`. Teste `tests/run_patient_rename.js`.
## Planilhas: exportar e importar (2026-10-06)
Decisões do usuário: ferramenta no sistema (não SQL); Excel .xlsx; exportar = modelo;
Tratamentos, Pacientes, Objetivos, Habilidades e Escalas. Bloco "Planilhas: exportar e
importar" no fim do script.
- Motor sem biblioteca externa: `xlBuild(sheets)` (zip sem compressão, `xlZip`, `xlCrc32`;
  cabeçalho em negrito e fixo, aba "Instruções"), `xlRead(buf)` (`xlUnzip` com
  `DecompressionStream("deflate-raw")` para os arquivos que o Excel comprime; shared strings,
  inlineStr, números), `xlParseText` (colar do Excel / CSV ";" ou ","), `xlReadFile`.
- `IO_KINDS[tipo] = {label, file, mod, cols:[{k, h, alias, req, hide}], exportRows, plan, apply,
  prepare}`. `ioRecords` acha o cabeçalho (nome da coluna ou apelido, sem acento/maiúscula;
  colunas desconhecidas vão para "Colunas ignoradas"). `ioOpenImport(tipo)` (janela `#ovIo`:
  baixar modelo atual/vazio, arquivo `#ioFile` ou colar `#ioPaste`, "Ver prévia" → `ioRenderPlan`
  com Novo / Atualizar / Igual / Com problema, filtro pelas contagens, "Importar (N)"). Antes de
  gravar baixa uma cópia (`ioExport(tipo)`). `ioExport(tipo, vazio)`. Célula vazia nunca apaga.
- Menus: "Outras opções ▾" (`ioToolsMenuHtml`/`ioWireMenu`, `[data-io-wrap]`) antes do "+ Incluir"
  em Tratamentos, Objetivos, Escalas e Habilidades; Pacientes ganhou `#patExportBtn` /
  `#patImportBtn` no `#patMoreMenu`. Exportar = ver; Importar = incluir ou editar no módulo.
- **Tratamentos** (`ioTrPlan`/`ioTrApply`): paciente pelo nome (`ioFindPatient`, homônimo desempata
  pelo nascimento); fora do cadastro = listado e pulado. Mesmo paciente + mesmo início = atualiza
  (especialidades/terapeutas/horários do sistema ficam; histórico "importado"). O tratamento da
  migração (`id = "tr-" + pacienteId`, início que não está na planilha) é apagado e passa
  specHours/horários ao Ativo da planilha (ou ao mais recente). Outro Ativo do sistema vira
  Renegociado. Tipo recalculado (`trTipoFor`). Status Ativo / Alterado|Renegociado|Negociado /
  Cancelado; Fim = `statusEm` (Renegociado sem fim = início do seguinte; Ativo com fim = ignorado).
  Problema: fim antes do início, mesmo início repetido, 2 Ativos, Cancelado do sistema mudando de
  status. Cancelado sem motivo = `motivoPendente: true` (etiqueta "sem motivo", filtro
  `semmotivo` "Cancelados sem motivo"; ao salvar com motivo na janela a marca sai). Valor/Descontos
  (mensal) → `treatment_finance` em lote (precisa de "Tratamentos – valores" editar). Suporte
  1/2/3 → `suporte` "Nível N"; texto → `cid` (só se vazios; tabela de saúde quando existe).
  Nascimento vazio é preenchido; data de entrada baixa até o 1º início. Migração
  `supabase/2026-10-06i-importacao-cancelado-sem-motivo.sql` (`treatments_cancel_rules` aceita
  `motivoPendente`).
- **Pacientes** (`ioPatPlan`): mesmo CPF; sem CPF, mesmo nome e nascimento (vazio de um lado vale)
  → só completa campos vazios. Novo entra sem CPF (pedido ao editar). Saúde só com
  "Pacientes – saúde".
- **Habilidades** (nome), **Escalas** (uma linha por nível; nível existente não sai — vira
  problema; ids dos níveis mantidos pelo nome), **Objetivos** (texto + habilidade; habilidade
  desconhecida = problema; especialidades por nome ou sigla, vazio = todas).
- Teste `tests/run_planilhas.js` (cria `tests/page_io.html`; 38 arquivos no `npm test`).

## Planner Todos×Todos: arrastar e gravar mais leves (2026-10-06)
Pedido do usuário ("arrastar fica pesado em Todos e Todos"). Medido com volume real fictício
(~94 mil elementos na página, CPU 4× mais lenta): soltar um paciente 790 ms → ~250 ms.
- `renderScheduleDocsTargeted` não troca mais a tabela inteira: `plannerPatchTable(table, html)`
  compara o HTML novo com o da última montagem (`table.__plHtml`; `renderGrid` guarda via
  `PL_HTML`) linha a linha e célula a célula NO TEXTO (`plannerSplitTable`), lê só as linhas
  que mudaram e troca só os `td` diferentes. Estrutura diferente (cabeçalho, nº de linhas) =
  troca a tabela como antes (-1). A tabela continua o mesmo elemento.
- Arrastar: `setDragOver(td)` só mexe na classe `drag-over` quando muda de célula (o
  `dragover` dispara dezenas de vezes por segundo); sai ao soltar/terminar/sair da grade.
- `refreshHistoryButtons` acha os botões por classe (`getElementsByClassName`), não por
  atributo na página toda.
- Testes: `tests/run_grid_perf.js` (tabelas ficam, a célula editada muda) e
  `tests/run_fluidez.js` (mover troca poucas células e o resultado é igual a montar do zero).

## Editar sala: coluna com agendamentos precisa ser movida; troca de profissional pergunta (2026-10-06)
Decisões do usuário: mover obrigatório (não há mais "Apagar os agendamentos" ao tirar
coluna); trocar o profissional da coluna pergunta; destino = qualquer coluna (ordem
sugerida); só o Planner (a Agenda não é conferida). `plannerSeatRemovalFlow(rec, removed,
newList, changedSeats)` (salvar de `openRoomModal` calcula `changedSeats` = colunas com o
mesmo id e outro `professionalId`):
- Coluna tirada (`kind "rm"`): select só com "Mover para …" (`rankFor`: mesmo profissional →
  mesma sala → outras; destinos tirados de `newList`, sem as colunas tiradas/trocadas). Já
  vem escolhido o primeiro destino em que tudo cabe (`initial`). Algum não cabe, ou não há
  destino = `#srOk` desativado com o motivo. Precisa de incluir + excluir no Planner.
- Profissional trocado (`kind "chg"`): padrão "Ficam com <novo>" (`keepConflicts`: fora do
  horário do novo ou ele em outra coluna no mesmo horário → aviso e confirmação dupla) ou
  "Mover para" colunas do profissional antigo.
- Continua limpando órfãos (`plannerOrphans`). Teste `tests/run_room_seats.js`.

## IDEIA EM AVALIAÇÃO (não implementada): organizar o Planner pelos tratamentos (2026-10-06)
O usuário quer, no futuro, que o sistema leia os tratamentos ativos e monte uma PROPOSTA de
Planner (4 semanas) — nunca grava sem prévia; depois o "Enviar para a Agenda" leva às datas.
Modos discutidos: "Completar o que falta" (recomendado para começar), reorganizar um paciente/
especialidade, reorganizar tudo. Prévia com o que entra/sai, contratado × planejado e aceite por
paciente; tudo no desfazer; reconferir `plannerConflict` antes de aplicar. Sugerido começar por um
relatório de prontidão dos dados (tratamentos sem sessões/mês, horário, terapeuta, ABA).
Respostas do usuário (2026-10-06):
1. Máximo de sessões por dia por paciente = total de sessões dividido pelos horários de atendimento
   do tratamento (distribuir pelo horário disponível).
2. No mesmo dia, sessões SEGUIDAS.
3. Distribuir na semana: ex. 8 sessões/mês de Fono = 2 por semana, em dias diferentes.
4. Mesmo horário toda semana: SIM — o horário do tratamento é a rotina da família; as
   especialidades são distribuídas dentro dos dias/horários do tratamento.
5. Irmãos no mesmo horário ou em horários colados: sempre que possível.
6. Quando não cabe todo mundo: LISTAR os que não couberam (com o motivo), sem prioridade automática.
7. Ocupação do profissional: tentar deixar um horário livre por turno (preferência, não obrigatório).
8. Pacientes "não ABA": deixar um intervalo entre eles sempre que possível.
Pendente decidir: qual modo primeiro e se faz antes o relatório de prontidão.

## Horário de atendimento do paciente: "Disponível" e Outras opções (2026-10-06)
Pedido do usuário. Na tabela do tratamento (`patHoursSectionHtml`) a coluna "Atende" se chama
**Disponível** (o campo continua `horarios[dia].ativo`; o cadastro da Clínica segue com "Atende").
Os botões ficam no menu **Outras opções ▾** (`#pHoursMore`, `wirePatHoursMenu`, posição por
`placeToolsMenu`): **Limpar horário de todos os dias** (`data-ph-act="clear-all"`), **Limpar os
dias sem "Disponível" marcado** (`clear-off`: apaga só os horários que sobraram nos dias
desmarcados) e **Copiar segunda para todos** (`copy`, todos os dias da tabela). Cada ação guarda
como estava e mostra **Desfazer** (`#pHoursUndo`) por 15 segundos. Teste no fim de
`tests/run_treatments.js`.

## "Não ABA": sem exceção do grupo de suporte / aplicador (2026-10-07)
Pedido do usuário: acabou a exceção em que um Grupo de Suporte (ex.: Aplicador ABA) marcando
a sala liberava o MESMO profissional a ter dois pacientes "não ABA" juntos. Saíram
`groupBookedRoom`, `abaFreeProf`/`abaGroupOk`/`abaExcept` da grade, o `continue` em
`plannerConflict`, `abaGroupDependencyDenied` (e sua chamada em `applyBookingChanges`) e o
`grpOk` de `agdConflictIn`. As regras "não ABA" valem igual com ou sem grupo marcando a sala.
(As seções acima que citam essa exceção ficaram históricas.) Teste no fim de
`tests/run_aba_linha.js`.

## Acesso → Sistema: regras com chave (2026-10-07)
Decisões do usuário: três modos por regra (**Bloquear** recusa / **Avisar** pergunta e deixa
continuar / **Desligado** não confere); só Administrador; histórico de mudanças e restaurar
padrão; regras que evitam duplicidade ou dados inconsistentes ficam travadas (🔒).
- Menu Acesso → **Sistema** (`data-act="sistema"` em `js/pipo-supabase.js`, só `isAdmin()`) →
  `window.pipoOpenSystem` → `openSystemModal()` (bloco "Sistema: regras com chave", logo depois de
  `confirmDialog`). Grupos `SYS_GROUPS` (Planner, Agenda, Pacientes, Tratamentos, Plano
  Terapêutico), catálogo `SYS_RULES` `{id, g, label, desc, def, modes, db, locked}`, busca, etiqueta
  "alterada", "Restaurar padrão do grupo", "Restaurar tudo", aba Histórico.
- Documento `config/system {rules: {id: modo}, historico: [{em, por, id, de, para}]}` (só grava o
  que difere do padrão; histórico com até 300 itens). `subscribeSystem` → `state.sysRules`,
  `state.sysHist`.
- Uso no código: `sysMode(id)` / `sysOn(id)`; `sysGate(id, título, msgs, confirmaçãoDeSempre)`
  para regras de aviso; `sysSaveGate(btn, id, título, msg)` nos botões Salvar (Avisar = pergunta e
  clica de novo com a regra liberada); `plannerConflict` e `agdConflictIn` devolvem texto (recusa)
  ou `{warn, msg}` (Avisar) — `sysConflictGate` nas janelas/arrastar/colar; `sysHard(c)` nas
  ferramentas em lote (Avisar deixa passar; "Enviar para a Agenda" mostra como aviso na prévia).
  `seatAvailable` (pl_fora_prof) e `agdInHours` (ag_fora_trabalho) já respeitam a chave; o
  relatório de ocupação usa `profSlotOk` direto.
- Regra nova com chave: incluir em `SYS_RULES` e conferir com `sysMode`/`sysGate` no lugar dela;
  regra que evita dado duplicado/inconsistente entra com `locked: true`.
- Banco (migração `supabase/2026-10-07-sistema-regras.sql`): caminho `config/system` (módulo
  `sistema`, só Administrador), função `sys_rule(id, padrão)`; `appointments_status_guard`
  (ag_final_evolucao, ag_final_terapeuta) e `treatments_cancel_rules` (tr_cancelado_def,
  tr_cancel_motivo) só recusam no modo Bloquear. Testada no PGlite.
- Teste `tests/run_sistema.js` (cria `tests/page_sys.html`).


## Revisão de nomes e campos (2026-10-07, CONCLUÍDA)
Pedido do usuário: rever nomes/campos que mudaram (profissional → funcionário → colaborador
etc.). Decisões: RENOMEAR também os nomes internos (com análise de riscos e verificações),
fazer as 3 etapas — 1) limpeza (campos antigos de paciente/profissional, horário antigo,
idade sempre calculada pelo nascimento, permissão `profissionais` e sobras), 2) paciente
por código no Planner e na Agenda (além do nome), 3) colaborador único (profissional vira a
parte "atendimento" do colaborador, um campo `nome`, códigos no mesmo padrão). Primeiro passo:
`supabase/conferencia-nomes-e-campos.sql` (SÓ LEITURA, 31 verificações) para o usuário rodar
e devolver os números antes de qualquer correção.
Resultado da conferência em produção (2026-10-07): 111 pacientes (110 com campos de
tratamento ainda no cadastro, 107 sem nascimento, todos sem CPF), 0 nomes órfãos ou
homônimos no Planner (2638) e na Agenda (141), 15 profissionais todos com colaborador,
12 colunas de sala com nome guardado antigo, 1 tratamento com `svc:`, permissão
`profissionais` em 4 níveis, `profiles.is_admin/permissions` ainda no banco.
- **Etapa 1 (feita, 2026-10-07):** migração `supabase/2026-10-07b-limpeza-campos-antigos.sql`
  — tira `TREAT_FIELDS` do paciente que tem tratamento (o app já lia do tratamento), tira
  `idade` de quem tem nascimento, atualiza o nome guardado nas colunas das salas (a grade já
  mostrava o nome atual via `therapistDisplayName`), tira `profissionais` dos níveis (com
  `roles_guard` desligado só na troca) e apaga as colunas antigas de `profiles`. App: idade
  NÃO é mais gravada quando há nascimento (janela do paciente e importação de planilha);
  sem nascimento a idade digitada continua valendo (`patientAgeYears`); `profissionais`
  saiu de `MODULES` (`js/pipo-supabase.js`) e de `PERM_MODULE_LABELS`.
- **Etapa 2 (feita, 2026-10-07): paciente e grupo por código.** Decisões do usuário:
  homônimos PERMITIDOS com aviso; grupos da Agenda também por código.
  - Planner: cada booking leva `patientId` (coluna de sala) ou `roomRef` (coluna de grupo =
    sala marcada); `plannerNormRefs(changesByDoc)` no início de `applyBookingChanges`
    preenche/acerta (homônimo sem código escolhido fica sem). O desfazer compara sem os
    códigos (`histCmpStr`). Agenda: colunas `appointments.patient_id` / `group_id`
    (migração `supabase/2026-10-07c-paciente-por-codigo.sql`: gatilho `appointments_refs`
    preenche pelo nome quando só um paciente tem o nome; preenche os existentes e o Planner;
    `rename_patient`/`merge_patient_records` pelo código; `rename_group` novo;
    `treatment_appt_summary` devolve `pid`). O app só manda `patient_id`/`group_id` depois
    de confirmar que as colunas existem (`AD.hasPid`, sonda em `agdLoadWeek`); `agdRowCore`
    leva os dois quando a linha tem.
  - Busca: `findPatientByName(x)` e `findPatientAt(x, iso)` aceitam o agendamento (código
    primeiro, nome de reserva) — `findPatientRef`, `findPatientById`, `recPid`,
    `recIsPatient(rec, p)`, `samePatient(a, b)`, `patsByName`, `patNameCount`,
    `bookingRoomRef(rec)`. Regras de conflito, "último do dia", Editar agendamento,
    contagens de uso, mesclar, remover agendamentos e `TR.*` (agora chave = id do paciente)
    usam o código.
  - Homônimos: sugestões com `data-pid` e `.autolist-sub` (`patDisambig`: nascimento/mãe);
    `bookingPidWire` guarda a escolha em `input.dataset.pid`; `bookingPatientPick` recusa
    salvar sem escolher. Cadastrar paciente com nome repetido pede confirmação.
  - Renomear sala → células dos grupos no Planner (`roomRenameEverywhere`, chamado no salvar da
    sala; `writeRooms` resolve `true` quando gravou); renomear grupo → Agenda (`rename_group`).
  - Teste `tests/run_patient_code.js` (no `npm test`). Backup restaura as colunas novas.
- Produção (2026-10-07): o usuário rodou a `2026-10-07b` (conferência 0/0/0/0/nenhuma) e a `2026-10-07c`.
- **Etapa 3 (feita, 2026-10-07): colaborador único.** Decisões do usuário: CPF na parte
  protegida; uma situação só. CPF de quem atende fica só em `staff.data.cpf` (o salvar do
  colaborador grava `cpf: undefined` no profissional quando tem acesso ao RH; `staffView` lê o
  do RH e, de reserva, o antigo do profissional). Situação: o salvar põe `inativo` do
  profissional = colaborador (desligado ou inativo); Inativar/Reativar (`setupInactivate` do
  colaborador, `stItem.inativo` = situação do colaborador) grava os dois — o profissional só
  volta a ativo se o colaborador tiver o tipo Profissional. Migração
  `supabase/2026-10-07d-colaborador-unico.sql` (CPF → staff, tira do documento, alinha a
  situação pelo atendimento). Códigos `prof-…`/`user-…`/`func-…` dos colaboradores ficaram
  (internos, ligados a usuários e remuneração; trocar não traz ganho). Testes em `run_staff.js`.
- Produção (2026-10-07): `2026-10-07d` rodada (conferência 0/0).
- **Etapa 4 (feita, 2026-10-07): nomes internos novos** (o usuário escolheu os 4 grupos).
  **Daqui em diante valem os nomes NOVOS; as seções antigas deste arquivo usam os antigos:**
  | antigo | novo |
  |---|---|
  | aba `agenda` (Planner), `#tab-agenda`, permissão `agenda` | aba/seção/permissão `planner` (`#tab-planner`) |
  | aba `agendadia` (Agenda), `#tab-agendadia`, permissão `agendamentos` | aba/seção/permissão `agenda` (`#tab-agenda`) |
  | aba `relatorio` (Resumo), `#tab-relatorio` | `resumo` (`#tab-resumo`; permissão já era `resumo`) |
  | permissão `rh_funcionarios` / `rh_remuneracao` | `colaboradores` / `colaboradores_valores` |
  | aba `funcionarios` / `tiposfunc` | `colaboradores` / `tiposcolab` |
  | tratamento `pacoteHoras` / `despesas` (e coluna `treatment_finance.despesas`) | `sessoesMes` / `descontos` |
  | profissional (`config/professionals`) `name` | `nome` |
  Continuam iguais: `SYS_RULES` (`pl_*`/`ag_*`, grupos `planner`/`agenda`), `source: "planner"`,
  tópicos da Ajuda, chaves `agendaPipo:*`, prefixo `agd`, nomes de funções (`renderRelatorioTab`…),
  tabelas `staff`/`staff_pay`, `config/staff_types`, `config/skill_areas`, `config/goal_bank`,
  sala/serviço/especialidade com `name`.
  - Compatibilidade (o app funciona antes E depois do SQL): `window.pipoPerms` em
    `js/pipo-supabase.js` (`permsUpgrade`: nível sem a chave `planner` = formato antigo,
    convertido ao ler em `can`/`canDefault`; `js/usuarios.js` grava convertendo de volta
    enquanto `dbNew` for falso); `trNormLegacy` (tratamentos e pacientes ao carregar);
    `TR.finCol` + `finDbRow` (coluna `descontos` ou `despesas`); `profNorm` (ao carregar e em
    `writeProfessionals`: grava `nome` e deixa `.name` só como leitura não enumerável) e
    `profNome(p)`; `navOldHash` (endereços `#agendadia`, `#relatorio`, `#funcionarios`,
    `#tiposfunc`); `api/admin-backup.js` aceita `despesas` de cópias antigas.
  - Migração `supabase/2026-10-07e-nomes-internos.sql` (níveis, `module_for_path`,
    `documents_enforce`, `agenda_scope_professional`, `set_appointment_status`, políticas de
    `appointments`/`staff`/`staff_pay`, `sync_professional_user_names` e
    `profiles_professional_name` lendo `nome`, dados e coluna). Teste `tests/run_nomes.js`.
  - Produção (2026-10-07): `2026-10-07e` rodada (conferência 0/0/0/0/descontos). A
    compatibilidade com os nomes antigos continua no código (lê cópias de segurança antigas e
    endereços salvos); pode ser removida no futuro, com cuidado.

## Tratamento: Contratado × Planner × Agenda × Realizado (2026-10-07)
Decisões do usuário: Planner = total das 4 semanas (igual todo mês; proporcional no 1º e
último mês, como o Contratado); Diferença = Realizado − Contratado nos meses passados e
Realizado + marcados até o fim do mês − Contratado no mês atual; avisos de onde está o
problema; linha Total por mês; faltas justificadas à parte.
- `trMonthly` devolve por linha `{contr, plan, ag, real, sched, just, semSt, diff}` (+ `tot`).
  `plan` vem de `trPlannerCounts(p)` (lê `TR.plan` = 4 semanas do Planner, `trLoadPlanner()`
  via `plannerLoadDocs`, cache 2 min; chave = `trSpecKey` com o profissional da coluna);
  null = ainda não lido ("…"). `ag` = atendimentos do mês na Agenda (qualquer status, sem
  bloqueio); `just` = `TR_JUST_STATUS` ("falta-justificada"); `semSt` = já passou sem status.
- (2026-10-07, refeito a pedido do usuário) A JANELA mostra um mês por vez: seção recolhível
  (`trMonthSectionHtml`/`trMonthSectionWire`, botão `#trMonthToggle` com seta, começa fechada,
  aberta/fechada lembrada em `agendaPipo:trMonthOpen`), seletor `‹ mês ›` (`#trMonthPrev/Next`,
  "Mês atual"; do mês de início até o mês seguinte ao atual — `trMonthRange`; abre no mês
  atual). `trMonthView(t, ym)` / `trMonthViewHtml`: só as linhas de `specHours` (mesmo com 0),
  Contratado MENSAL (sem proporção), Planner, **Dif. Planner = Contratado − Planner**, Agenda,
  Realizado, Justificado, **Dif. Agenda = Contratado − Agenda + Justificado** (positivo = falta,
  vermelho; negativo = "+N" âmbar; 0 verde, `trDifCell`), linha Total, etiqueta "N sem status",
  nota de atendimentos em especialidades fora do tratamento. Explicação com `.pat-count` (mesmo
  texto da nota do horário do paciente). `trLoadLast` lê até o fim do PRÓXIMO mês.
  `trMonthly` (proporcional) continua só para a coluna "Mês" da lista e o filtro "Abaixo do contratado".
- Teste `tests/run_tr_monthly.js`.
## Data de término digitável no tratamento (2026-10-07)
Pedido do usuário. `#trFim` virou campo de data (digitável, `dpEnhanceDate`) gravado em
`termino` (vazio = apaga). Não pode ser antes do início. `trEnd(t)` / `trEndText(t)` usam o
digitado; sem ele, o automático (`trEndAuto` / `trEndAutoText` = último atendimento da Agenda,
mostrado na dica `#trFimHint`). `trPeriodEnd(t)` = o menor entre o término digitado e o
automático (`trPeriodEndAuto`): vale no contratado × realizado, relatório financeiro e
tratamento vigente. Renegociar começa sem término. Sem SQL. Teste no fim de `tests/run_treatments.js`.

## Cadastro do paciente: Rotina atual (2026-10-07)
Decisões do usuário: tipo (lista) + detalhe (texto); segunda a sexta; "Copiar segunda" em cada
coluna; aviso ao agendar; ficha impressa; Campos obrigatórios. Grupo `rotinaatual` logo depois
de Escola (`PAT_SECTIONS`), campo `rotinaAtual` (`type: "weekroutine"`; a chave `rotina` já era
"Responsáveis pela retirada"). Formato: `rotinaAtual = {seg: {m: {tipo, txt}, t: {...}}, … sex}`
em `patients/all`. Tipos `ROUTINE_TYPES` (escola, terapia, atividade, outro = `busy`; casa =
livre). `routineHtml`/`routineRead`/`routineWire` (ids `rt-<dia>-<m|t>-tipo|txt`,
`[data-rt-copy]`, `#rtUndo` 15 s), `routineCell`, `routineText`, `routinePer(dia, hora)` (manhã/
tarde pela grade da clínica), `routineConflictMsg`. Aviso: Planner `routineConflicts` em
`applyBookingChanges` (`opts.routineOk`, depois do horário do paciente); Agenda `agdRoutineCheck`
entre `agdPatientConfirmHours` e `agdTherapistCheck`. Regras do Sistema `pl_rotina`/`ag_rotina`
(padrão Avisar). Ficha: seção "Rotina atual" em `patientFichaHtml`. Sem SQL. Teste
`tests/run_rotina.js`.
- 2026-10-07: nova opção **Terapia (Pipo)** (`pipo`, NÃO ocupa — não avisa ao agendar), antes de "Outra terapia" (terapia em outro lugar, avisa). Pedido do usuário.

## Janela e lista de Tratamentos: ajustes (2026-10-07)
Pedidos do usuário (Renegociar continua mudando só ao Salvar; "Pacote/Mês" foi descartado).
- **Histórico** recolhível (começa fechado; `trCollapseHtml(id, título, html, chave)` /
  `trCollapseWire`, ids `#trHistToggle`/`#trHistBody`, lembrado em `agendaPipo:trHistOpen`).
- Topo da janela: **Outras opções ▾** (`#trMoreBtn`/`#trMoreMenu`, `.tr-more-wrap`, posição por
  `placeToolsMenu`) com **Cadastro do paciente** (`#trOpenPat`) e **Abrir plano terapêutico**
  (`#trOpenPlan`; saiu do corpo, `.tr-plan-link` não existe mais). Sem nenhum item, o botão some.
- **Valor, Descontos, Valor final** (R$, `fmtMoney`; ao sair do campo formata) foram para
  "Convênio, pacote e horário", logo depois de Convênio/Plano: `treatFieldsEditor(v, {afterConv})`.
- Lista: caixas **Cancelados** (`#trShowCanc`) e **Renegociados** (`#trShowReneg`) ao lado do
  contador; desmarcadas, esses tratamentos ficam ocultos (o filtro de status Cancelados /
  Cancelados sem motivo / Renegociados mostra mesmo assim). Vencimento vazio = "Sem vencimento".
- Testes no fim de `tests/run_tr_monthly.js`; `run_treatments.js` marca as duas caixas no início.

## Habilidades: Escopo e Faixas etárias (2026-10-07)
Decisões do usuário: campos Habilidade, Escopo (texto), Faixas etárias (as MESMAS da cor do
paciente, atualizando junto) e Especialidades sugeridas; no plano, as da idade primeiro.
- `AGE_BANDS` (perto de `PCOLOR_*`): lista única `{id, min, max, label, color}` — 0–4, 5–9,
  10+. Usada por `patientColor` (`ageBandOf`), pelas legendas do Planner/Agenda
  (`[data-age-legend]` → `ageLegendHtml`) e pelo cadastro de Habilidades. Mudou a faixa? Só
  aqui. Habilidade guarda os ids (`faixas: ["0-4"]`); id que sumiu é ignorado (`ageBandIds`);
  vazio = "Todas as idades" (`ageBandText`).
- `config/skill_areas` ganhou `escopo` (texto) e `faixas`. Janela: `#regName` com rótulo
  "Habilidade" (`REG_CFG.habilidades.nameLabel`), `#regHabEscopo`, `#regHabAges` (caixas
  `.lib-opt` com bolinha da cor), `#regHabSpecs`. Lista: Habilidade, Escopo (uma linha só,
  `.reg-oneline` com "…", texto inteiro no `title`; oculto no celular), Faixas
  etárias, Especialidades sugeridas (`REG_CFG.habilidades.widths`; `renderRegistryTab` aceita `widths`).
- Plano (`#plAddArea`): habilidades da faixa do paciente (ou sem faixa) primeiro; as outras no
  fim com "(fora da faixa)". Paciente sem idade = tudo igual. Não bloqueia.
- Planilha de Habilidades: colunas Habilidade, Escopo, Faixas etárias e Especialidades sugeridas; exportar
  escreve "Todas as idades" quando não há faixa e importar aceita esse texto (limpa as faixas). `ioAgeBands` aceita "0–4 anos",
  "0-4", "10+"; texto desconhecido = aviso); célula vazia não apaga. Sem SQL.
  Teste `tests/run_habilidades.js`.

## Janela do Objetivo (Banco de objetivos): ordem dos campos (2026-10-07)
Pedido do usuário. `openGoalModal`: Habilidade (`#glArea`, lista), Objetivo (`#glName`, texto
de UMA linha), Critério de sucesso (`#glCrit`, uma linha), Escala (`#glScale`), Especialidades
(`#glSpecs`). Quebras de linha antigas viram espaço ao abrir. Foco inicial na Habilidade (ou no
Objetivo quando a habilidade já vem preenchida, ex.: "+ Salvar no Banco de objetivos" do plano).
Teste no fim de `tests/run_habilidades.js`.

## Objetivos com faixa etária; Objetivo do plano = lista do cadastro (2026-10-07)
Decisões do usuário: no plano só objetivos do cadastro (sem texto livre), os da faixa do
paciente primeiro; critério só leitura (vem do cadastro); várias faixas por objetivo; script SQL
que separa o "[0–4]" do nome e liga os planos ao cadastro.
- Cadastro de Objetivos (`config/goal_bank`): campo `faixas` (ids de `AGE_BANDS`, caixas
  `#glAges` logo depois da Habilidade, `ageCheckGridHtml`), nome SEM o prefixo. Digitar
  "[0–4] Nome" separa sozinho (`goalNamePrefix`). Lista com a coluna "Faixas etárias" depois de
  Habilidade. `goalAgeTag`/`goalLabel(g)` = "[0–4] Nome" (todas as faixas ou nenhuma = sem etiqueta).
- Plano: objetivo guarda `goalId` (+ `objetivo`/`criterio` copiados do cadastro ao salvar, só nos
  que o usuário pode editar — `canFull`). Mostrado por `planObjLabel(o)` / `planObjCrit(o)` (cadastro
  ao vivo; sem ligação, o texto gravado) — também na evolução, gráficos, Detalhes do Agendamento e
  impressão. Comparação "objetivos em comum" por `planObjKey`. Campo Objetivo = botão
  `[data-goal-pick]` → lista flutuante `.pl-goal-pop` (`goalOpen`/`goalListHtml`: busca `.dp-filter`,
  os da faixa do paciente — `goalFitsAge` — e depois "Outras faixas etárias", já usados no quadro
  desativados, "+ Incluir objetivo" no fim → `openGoalModal` por cima com habilidade e faixa do
  paciente; ao salvar já fica escolhido). Critério = `.pl-crit` (uma linha, só leitura). "+ Inserir
  objetivo" já abre a lista. `USAGE.objetivos` conta planos com o `goalId` (em uso = Inativar).
- Janela do plano: idade ao lado do nome; "Quadro clínico" + explicação e "Objetivos por
  habilidade" + conferência na mesma linha (`.pl-sec-inline`); quadro da habilidade sem a cor lateral.
- Planilha de Objetivos: coluna "Faixas etárias" (ou "[0–4]" no começo do nome); o mesmo objetivo
  com ou sem prefixo é atualizado.
- Migração `supabase/2026-10-07f-objetivos-faixa-etaria.sql` (testada no PGlite; pode rodar de novo).
  Testes em `tests/run_plano.js` e `tests/run_habilidades.js`.
- Produção (2026-10-07): `2026-10-07f` rodada — 0 com prefixo, 300 objetivos com faixa, 0
  objetivos em planos (ainda não havia plano com objetivos).

## Prontuário: "Objetivos trabalhados" na linha do tempo (2026-10-07)
Pedido do usuário (só dava para ver os objetivos da evolução entrando em Editar). Cada cartão
da linha do tempo (`prRenderDetail`) mostra, antes do texto, o quadro `.pr-goals`
(`prGoalsWorkedHtml(r)`, lê `r.plan_goals`): habilidade, nº, objetivo (`planObjLabel`, com a
faixa), nível alcançado com a cor e a sigla da especialidade. Só com `plano_terapeutico.view`;
carrega `PLAN.rows` se ainda não estiver (redesenha depois). Objetivo que saiu do plano aparece
como "Objetivo que não está mais no plano". Teste no fim de `tests/run_plano.js`.
- (2026-10-07) Janela da evolução: cada habilidade de "Objetivos do plano terapêutico trabalhados"
  é recolhível (`[data-goal-toggle]` com seta + `.pr-goal-items` `hidden`; começa fechada, aberta
  se já tem objetivo marcado — edição). Título com "N objetivos · M marcados"
  (`prGoalCountText`, `[data-goal-count]`); `prGoalsWire(body)` liga a seta e o contador.

## Plano: gráfico de barras com seletor de objetivo (2026-10-07)
Decisões do usuário: barras; seletor ao lado do nome da escala começa em "Todos os objetivos"
(uma barra por objetivo = último nível registrado, Nº embaixo); escolher um objetivo = uma barra
por evolução (data embaixo); tons de azul pelo NÍVEL (mais escuro = mais alto).
- `planChartSvg(ch, sel)` (barras com topo arredondado 4px, linha de base, dica por barra com
  nível/data/sigla da especialidade em `.pv-hit`), `planChartBodyHtml(ch, sel)` (legenda numerada,
  gráfico, tabela), `planChartsHtml(charts)` (`figure[data-pv]` + `select[data-pv-sel]`).
  `planChartsWire` troca o corpo no `change` usando `host.__charts` (gravado ao carregar).
- Cor: `planLvColor(idx, nLevels)` → `--pvb-1..5` (rampa ordinal azul validada pelo validador
  da skill dataviz: claro #86b6ef→#104281; escuro #1c5cab→#b7d3f6, nível alto mais claro).
  Escalas com mais de 5 níveis repetem tons vizinhos (a altura continua diferenciando).
  `PLAN_VIZ_MAX = 30` barras na visão "Todos". Teste no `tests/run_plano.js`.
- (2026-10-08) **Barras por MÊS** (pedido do usuário; substituiu as semanas S1–S4 do mesmo dia):
  uma barra por mês (`planMonths`, `planMonthLabel` "out/26"); período = data do plano até hoje
  (ou até a revisão, se já passou), ampliado se houver evolução fora (`ch.start`/`ch.end` de
  `planEvoCharts`); altura = MÉDIA dos níveis do mês (`planMonthAvg`, `planAvgText`); mês sem
  evolução fica vazio. "Todos os objetivos" = barras lado a lado em cada mês, na ordem do Nº, tom
  fixo por objetivo (`planObjColor`, legenda `.pv-sq`); um objetivo = uma barra por mês com a cor
  pelo nível. Muitos meses/objetivos = o gráfico alarga e rola para o lado (`.pv-scroll`).


## Planner: Bloqueio de horário (2026-10-08)
Pedido do usuário: bloquear/liberar sem gravar "atendimento Bloqueado" — horário bloqueado = igual a
fora do horário do profissional (célula cinza, sem clique/colar/soltar); atendimentos já marcados
continuam e não são tocados. Decisões: só no Planner; alvos Profissional / Sala / Clínica toda;
SEM "por data" (só dia × horário × semanas 1ª–4ª, sem fim); botões da grade = só a coluna clicada
(subordinados: não liberam bloqueio de Outras opções, avisam); Liberar horário tira tudo que trava
ali (bloqueios do alvo + os dos botões nas colunas dele; Clínica toda tira qualquer alvo); mesmo
cinza + motivo no mouse; motivo, prévia, permissão própria; "Bloqueado" antigos do Planner APAGADOS.
- Botões da grade e "Bloqueado" da janela gravam no dia do Planner `{patient:"", lock:true[, motivo]}`
  (entra no desfazer; `describeHistoryEntry` trata como Bloqueado). Clique na célula bloqueada
  pelo botão: confirma e libera (`plLockCellClick`). `plSeatLockStep` = um passo dos botões.
- Outras opções → **Bloquear horário** / **Liberar horário** (`#plBlockBtn`/`#plUnblockBtn`,
  `openPlBlockModal(mode)`): alvo, semanas, grade (célula, dia, Manhã/Tarde, horário, Tudo),
  motivo (`PLB_MOTIVOS` + detalhe), prévia (`#plbPrev`: horários, colunas, atendimentos que
  ficam / o que continua bloqueado por outro alvo). Cadastro `config/planner_blocks`
  `{list:[{id, alvo, profId|roomId, slots:{"1":{seg:[…]}}, motivo, criadoEm, criadoPor}]}`
  (`subscribePlBlocks`, `PLB`, índice `plbIndex` uma vez por mudança, `plRuleLock`,
  `plLockInfo`, `plLockTitle`, `plbWrite`).
- Grade: `buildScheduleTable` põe `slot-off pl-lock` + title com motivo. "Horário livre" e
  "Trocar profissional" pulam horário bloqueado.
- Permissão `bloqueio_horario` (MODULES nos 2 js, `PERM_MODULE_LABELS`): incluir = bloquear,
  excluir = liberar; `bookingPermDenied` (lock) e `permToolClasses` (`perm-no-lock`/`perm-no-unlock`).
- Migração `supabase/2026-10-08-bloqueio-horario.sql`: permissão nos níveis que editam o Planner,
  `module_for_path` (planner_blocks), `can_write_path` (schedule = planner OU bloqueio_horario),
  `documents_enforce` (lock → bloqueio_horario), apaga "Bloqueado" antigos do Planner (seg 11:20
  vira marcação vazia). Testada no PGlite. Teste `tests/run_bloqueio.js`; `run_period_lock.js` e
  `run_blocked_roomcolor.js` atualizados.

- 2026-10-08: aviso/filtro "Pacientes sem tratamento ativo" (Tratamentos) só conta pacientes ATIVOS (`isActive(p)` em `renderTreatmentsTab`); a aba Tratamentos redesenha quando o cadastro de pacientes muda (`subscribePatients`). Teste em `run_treatments.js`.
- Produção (2026-10-08): `2026-10-08-bloqueio-horario` rodada (0 bloqueados antigos / 2 níveis com a permissão / bloqueio_horario). Paciente "Reunião Clínica" e tratamentos excluídos por SQL fora do repositório (conferência 0/0/0).
- 2026-10-08: paciente "não ABA" bloqueia a SALA TODA em qualquer sala, inclusive com "ABA" no nome (Planner e Agenda; `roomIsABA` removida). Pedido do usuário (sala Fonoaudiologia ABA). Teste em `run_aba_linha.js`.

## Planner ▾ → Disponibilidade (2026-10-08)
Relatório por dia × horário (subtotal Manhã/Tarde e total), semana 1ª–4ª ou Todas (soma). Colunas:
por especialidade (do profissional da coluna) "atendidos / livres", Total atendido (pacientes nas
salas), Bloqueios / reuniões (Bloqueado/Reunião/Treinamento + horário bloqueado, este 1× por
profissional), Total disponível, Não ABA (`isNaoABABooking`). Só colunas de SALA com profissional.
Vaga livre = célula sem nada e sem `slot-off` na grade montada por `buildScheduleTable` (mesmas
regras: horário do profissional, bloqueio de horário, não ABA, profissional em outro lugar).
Profissional com colunas em várias salas: se atende numa, só as livres dela; senão a sala com mais
colunas livres. Código: `DISP`, `dispDoc`, `dispCompute(weeks)`, `renderDispTab`, `wireDispTab`
(`#tab-disponibilidade`, `#dispWeekSeg`, `#dispHost`); atualiza pelo `scheduleRelatorioRender`.
Permissão `disponibilidade` (só ver) em MODULES/`PERM_MODULE_LABELS`; migração
`supabase/2026-10-08b-disponibilidade.sql` (quem vê o Resumo passa a ver). Teste `tests/run_disponibilidade.js`.
- 2026-10-08: Reunião Clínica / Treinamento GRAVADOS numa coluna ocupam a sala toda (como "não ABA"): paciente não entra nas outras colunas, outra Reunião/Treinamento pode (`roomMeetingKind`, regras `pl_reuniao_sala`/`ag_reuniao_sala` no Sistema; grade `meetLock` = aba-lock + aba-soft). A Reunião automática de segunda 11:20 (sem registro) não trava. Disponibilidade: Bloqueado/Reunião/Treinamento/horário bloqueado contam 1× por profissional. Testes em `run_aba_linha.js`.
- 2026-10-08: Planner, coluna dos horários: horário em cima e 3 botões lado a lado embaixo (liberar, bloquear, **limpar**; `rowLockButtonsHtml(attrs, withClear)`, `.row-btns-below`, `.row-lock-3`). Limpar a linha = `plannerRowAction("clear")` apaga os agendamentos do horário nas colunas visíveis (bloqueio fica; permissão Planner excluir). Agenda não mudou. Teste `tests/run_row_clear.js`.
- 2026-10-08 (pedido do usuário, SUBSTITUI a linha "ocupam a sala toda" acima): Reunião Clínica /
  Treinamento GRAVADOS ocupam o PROFISSIONAL, não a sala. Nesse horário ele não pode ter outro
  agendamento (paciente, grupo, outra reunião/treinamento) em nenhuma sala ou grupo, inclusive outra
  coluna dele na mesma sala; os outros profissionais atendem normalmente na sala. Regras do Sistema
  `pl_reuniao_prof` / `ag_reuniao_prof` (no lugar de `pl_reuniao_sala` / `ag_reuniao_sala`);
  `profMeetingMsg`; grade: `profMeet[profId]` (só gravado — a Reunião automática de segunda não
  conta) → colunas vazias dele ficam `.prof-busy`; `plannerConflict` e `agdConflictIn` conferem
  pelo profissional. Testes em `run_aba_linha.js`.

## Agenda ▾ → Visão geral (2026-10-08)
Topo: "Agenda" virou menu (`#agBtn`/`#agMenu`, `AG_ITEMS`/`AG_TABS` em `NAV_MENUS`; botões `data-tab`
agenda e visaogeral ocultos; celular: grupo "Agenda" no ☰; `prGoToAppointment` confere `can("agenda")`).
Tela `#tab-visaogeral`: todos os atendimentos de UM dia da Agenda, faixa por horário (contagem ao
lado), cartões com Paciente, Sala e Serviço na cor da especialidade do profissional (`vgSpecColor`);
clique = `agdOpenDetails`. Filtros (paciente, profissional, especialidade, sala, status incl. "Sem
status"), contadores (dia + chips por especialidade = legenda), avisos (feriado, profissional com
horário bloqueado na Agenda, paciente com horários vizinhos, aniversariantes ativos). Bloqueado não
vira cartão. Dados: `agdFetchRange(dia, dia)`; tempo real pelo canal da Agenda (`vgOnRealtime`).
Código: `VG`, `vgOnShow`, `vgLoad`, `vgRender`, `vgAlerts`, `wireVisaoGeral`. Permissão
`visao_geral` (ver); migração `supabase/2026-10-08c-visao-geral.sql` (quem vê a Agenda passa a ver).
Teste `tests/run_visao_geral.js`. Decisões do usuário: cartão = Paciente/Sala/Serviço; cor =
especialidade; com filtros/contadores e avisos; SEM status no cartão, sessão do mês, linha do agora,
modo TV, semana e impressão (podem vir depois).
- 2026-10-08: avisos do dia REMOVIDOS da Visão geral (pedido do usuário).
- 2026-10-08 (decisões do usuário) Disponibilidade: horário bloqueado (cadeado / Bloquear horário,
  célula `pl-lock`) fica FORA da conta (nem vaga livre, nem "Bloqueios / reuniões"). Vaga livre =
  célula vazia dentro do horário de trabalho e sem trava de regra; profissional com colunas em várias
  salas conta uma sala (a que já atende ou a com mais colunas vazias: Lara 2 Fono + 2 Fono ABA = 2).
  Bloqueado / Reunião Clínica / Treinamento = 1 por profissional por horário. Teste em
  `tests/run_disponibilidade.js`.
- 2026-10-08: Visão geral — todos os cartões do horário na MESMA linha, dividindo a largura da janela (`.vg-cards` nowrap, `.vg-card` flex:1 1 0).
- 2026-10-08: Visão geral com botão de tela cheia (`data-full-toggle`, mesmo `gridFullscreen` do Planner/Agenda); na tela cheia some o topo do sistema, mas a barra de data/filtros e os selos por especialidade continuam.
- 2026-10-08 (pedido do usuário, com imagem do Excel) Disponibilidade: "aquecimento" nos totais de
  cada horário — Total atendido laranja (`--heat-at`), Total disponível verde (`--heat-fr`), Não ABA
  vermelho (`--heat-nao`), intensidade = valor ÷ maior valor da coluna nas linhas de horário da semana
  mostrada (`heat(kind, v)` em `renderDispTab`, color-mix com `--surface`); zero sem cor; subtotais,
  total e Bloqueios sem cor.
- 2026-10-08: Visão geral — filtros vazios quando a tela abria antes dos cadastros chegarem: `vgFillFilters()` agora roda em todo `vgRender`, e chegar profissionais/especialidades/salas/status redesenha a Visão geral.
- 2026-10-08 (pedidos do usuário) Disponibilidade: nome do dia em TODAS as linhas (inclusive Manhã/Tarde);
  tudo centralizado nas células; colunas com cor da especialidade (título 30% + barra embaixo, células
  14%, subtotais 26%, `vgSpecColor`); ordem das colunas por arrastar o título (Dia e Horário fixos;
  `dispColumns`, `dispWireReorder`, `agendaPipo:dispColOrder`; especialidade nova entra no lugar
  padrão) e largura pela borda (`dispWidthCfg` + `wirePatColResize`, `agendaPipo:colWidths:disp`;
  duplo clique volta). Botão `#dispResetCols` "Colunas padrão" (`dispResetColumns`).
- 2026-10-08 Disponibilidade: seta ▾/▸ no título "Dia" (`#dispCollapse`, `DISP.collapsed`, salvo em
  `agendaPipo:dispCollapsed`) recolhe a tabela para só os resumos Manhã/Tarde; resumos com aquecimento
  próprio (`hsub`, compara só os resumos de todos os dias). Títulos no formato do Resumo (maiúsculas,
  especialidade com a cor cheia e texto branco `.disp-spec-solid`, quebram linha).
- 2026-10-08 (pedido do usuário) Disponibilidade: cada Grupo de Suporte ativo tem uma coluna própria
  ("atendidos", cor do grupo, depois das especialidades; chave `grp:<id>` em `d.at`, então entra no
  Total atendido e no aquecimento). Reunião/Treinamento no grupo = 1 bloqueio do profissional.
  `dispCompute` devolve `groups`; colunas em `dispColumns(specs, groups)` (ordem/largura como as outras).
