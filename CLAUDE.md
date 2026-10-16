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
   **Depois de mandar um SQL, ESPERAR o usuário confirmar o resultado antes de prosseguir**
   (pedido dele, 2026-10-10): não começar o próximo item nem fazer outra pergunta até ele
   mandar o resultado da conferência.

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
- 2026-10-08 (pedido do usuário, SUBSTITUI arrastar/largura/"Colunas padrão"): Disponibilidade no
  formato do Resumo — especialidades na ordem do cadastro de Especialidades (igual ao Resumo), depois
  os grupos e os totais; tabela na largura da janela (`width:100%`, Dia 120px e Horário 112px fixos,
  resto dividido; mínimo 64px por coluna). Título em 2 linhas: 1ª = especialidades com a cor cheia e
  "atend. / livres" (`tr.disp-h1`); 2ª = TOTAL da semana (`tr.disp-h2`, presa logo abaixo da 1ª ao
  rolar; substitui a linha Total do fim). Corpo por dia: horários alternando branco/cinza
  (`tr.disp-alt`), Manhã e Tarde em cinza (`tr.disp-sub`) e **Total do dia** um pouco mais escuro
  (`tr.disp-daytot`); recolher (▸ no Dia) mostra Manhã, Tarde e Total do dia. Saíram
  `dispColumns`/`dispWidthCfg`/`dispWireReorder`/`dispResetColumns` e as cores por especialidade nas
  células (só no título). Aquecimento das colunas de total continua (horários e resumos).
- 2026-10-08 (pedido do usuário) Disponibilidade, ordem fixa das colunas: Fono, TO, Psicomotricidade, Fisioterapia, Psicologia, Psicopedagogia, Musicoterapia, Nutrição (`DISP_SPEC_ORDER`, pelo começo do nome sem acento; outras especialidades depois, na ordem do cadastro), Coordenador, Aplicador ABA (`DISP_GROUP_ORDER`; outros grupos depois) e os totais **Reunião** (antes "Bloqueios / reuniões"), **Disponível**, **Atendido**, **Individual (não ABA)** (`dispOrderIdx`).
- 2026-10-08 (pedido do usuário) Disponibilidade: o título "Dia" virou o botão de recolher `#dispCollapse` com setas na vertical (SVG; estendido = setas para dentro + "Recolher", recolhido = setas para fora + "Estender").
- 2026-10-08 (pedido do usuário) Disponibilidade: Coordenador e Aplicador ABA (grupos) também em **atend. / livres**. Coluna vazia do grupo sem trava = vaga livre do profissional nesse grupo; o grupo entra na escolha de UM lugar por profissional (onde atende; senão sala/grupo com mais colunas vazias) e a vaga vai para `free["grp:<id>"]` (grupo) ou para a especialidade (sala). Agendamento no grupo marca o profissional como ocupado ali. Botão Recolher/Estender com o símbolo DEPOIS do texto. Ajuda da Disponibilidade reescrita.
- 2026-10-08 Bloquear horário: com alvo **Profissional**, campo **Sala** (`#plbRoom`, "Todas as salas"
  + salas/grupos onde ele tem coluna; `fillRooms`). Bloqueio guarda `roomId` opcional no alvo prof
  (`plbHits` confere a sala; `plbSeats(alvo, id, roomId)`; `plbAlvoText` "Fulano em Sala X").
  Liberar com "Todas as salas" tira também os dele de uma sala só; com sala escolhida, só os daquela
  sala (`plbSame(b, alvo, id, roomId)`). Correção: `config/planner_blocks` faltava em
  `documents_path_valid` (erro "violates check constraint") — migração
  `supabase/2026-10-08d-bloqueio-caminho-permitido.sql` (testada no PGlite).
- 2026-10-08 (pedido do usuário) Bloquear/Liberar horário: a grade de clicar células saiu; no lugar, tabela
  `#plbHours` igual à do horário de trabalho do colaborador (Dia Seg–Dom × Manhã/Tarde Início/Fim, inputs
  `.plb-h[data-day][data-p=m|t][data-e=s|e]`, `staffTime`). Vem preenchida (`fillHours`): alvo Profissional =
  horário de trabalho dele (`staffDayInit`); Sala/Clínica toda = horário da clínica; refaz ao trocar alvo ou
  profissional. Botões `#plbClearHours` "Limpar horários" e `#plbDefault` "Horário padrão". `cells()` = horários
  do Planner (`DAYS`) que começam dentro das faixas; dia fechado no Planner fica desativado; faixa inválida ou
  incompleta trava o botão com o motivo. `plbAllTimes` removida. Teste em `tests/run_bloqueio.js`.

## CRM — Fase 1: listas, tarefas, Lista/Quadro, atividade (2026-10-08)
Projeto do usuário: trazer para o sistema o que usam no ClickUp (CRM, Agendas, Fature, Canal...).
**Mapa aprovado:** Fase 1 tarefas + CRM (FEITA) · Fase 2 checklist, subtarefas e anexos · Fase 3
calendário/filtros/"Minhas tarefas" avançado · Fase 4 integração (Contrato assinado → paciente +
tratamento; automações: tratamento cancelado/vencendo cria tarefa; "Criar tarefa" no paciente/Agenda)
· Fase 5 Canal (chat) · Fase 6 importar do ClickUp. Decisões: lead (contato) à parte do paciente;
listas e status configuráveis (só Administrador); anexos depois; responsável = usuários do sistema;
permissão POR LISTA; contato com básico + convênio/plano + origem + motivo de perda; avisos =
contador no topo, @menções, vencidas em vermelho. Botão do topo = **CRM**; a lista do funil se chama
**Atendimento**; listas iniciais Atendimento, Agendas, Fature, Gestão.
- Topo `#crmBtn`/`#crmMenu` (`CRM_ITEMS` montado por `crmRebuildNav` a partir do cadastro; `CRM_TABS`
  em `NAV_MENUS`; grupo "CRM" no ☰), badge `#crmBadge` (`crmBadgeRender`: minhas abertas vencidas +
  menções não lidas). Itens: Minhas tarefas (`CRM.list = "__mine"`), uma por lista (`crm-<id>`),
  Listas e status (`crmOpenListsModal`, só admin). `tabCan("crm")` = alguma lista visível.
- Cadastro `config/task_lists {list:[{id, name, color, lead, statuses:[{id, name, color, done, lost}]}]}`
  (`subscribeTaskLists`; sem documento = `CRM_DEFAULT_LISTS`). `done` = encerra (sai de Minhas
  tarefas, não fica vencida); `lost` (só em lista `lead`) = pede motivo de perda.
- Tabelas `tasks` (list_id, status, title, description, priority urgente|alta|normal|baixa, due_date,
  assignees uuid[], tags text[], patient_id, lead jsonb {nome, nascimento, responsavel, telefone, email,
  convenio, plano, origem, motivoPerda}, position, created_by/_name, closed_at), `task_events` (comment |
  create | status | field; histórico escrito pelo gatilho `tasks_history`; usuário só insere comment),
  `task_reads` (seen_at por pessoa). RLS por `has_perm('crm_' || list_id, …)`; `crm_people()` (nomes dos
  usuários ativos). Tempo real em `tasks`/`task_events` (`crmEnsureChannel`).
- Tela `#tab-crm`: Lista (`crmGroupHtml`, grupos por status recolhíveis) e Quadro (`.crm-board`,
  arrastar = `crmSetStatus`), filtros (busca, responsável incl. Eu/Sem, prioridade, vencimento).
  Janela `crmOpenTask(task, {listId, status})` com dados do contato (lista `lead`), atividade
  (`crmActivityLoad`, `crmEventText`) e comentário com @menção (`crmMentionWire`; menções = nomes
  "@Nome" no texto). Abrir a tarefa = `crmMarkRead`. Sem sistema online tudo em `CRM.mem`.
- Permissões: `window.pipoCrmModules()` → `js/usuarios.js` `allModules()` (grade, resumo e
  `normalizePerms`) mostra "CRM – <lista>". Migração `supabase/2026-10-08e-crm-tarefas.sql` (caminho
  permitido, `module_for_path` = `crm_listas` → só admin grava, tabelas, gatilhos, RLS, `crm_people`,
  tempo real, níveis que veem a Agenda ganham tudo nas 4 listas). Testada no PGlite (RLS com usuário
  comum). Teste `tests/run_crm.js`.
- 2026-10-08 (pedido do usuário: "tudo que criar deve partir do estilo que já temos") CRM no padrão do sistema: "Listas e status" com os componentes das janelas de Status/Sala (`.therapist-row`, bolinha `.spec-color-btn` + `openColorPicker`, ▲▼ `.col-move`, ✕ `.rm`, opções `.kind-opt` dentro de `.field`, "+ status"/"+ lista" `.add-row-btn`); janela da tarefa com h3 "Nova tarefa/Editar tarefa", campo Título comum e seções no estilo `.pm-sec-title`. **Regra: tela nova reaproveita classes/componentes existentes, nada de input/visual próprio.**
- 2026-10-08 (pedidos do usuário, com imagens do ClickUp) CRM refeito no padrão do sistema:
  - Lista = tabela de Tratamentos (`gtRender` "crm-lista"/"crm-mine"): Status, Tarefa, Paciente ou Lead
    (`crmWhoName`, selo "lead"), Convênio (`crmConvName`: do paciente/tratamento ou do lead),
    Vencimento; "Minhas tarefas" com a coluna Lista. Contador `#crmCount` e caixa **Finalizados**
    (`#crmShowDone`): sem ela, tarefas em status `done` somem da lista e o Quadro esconde essas colunas.
    Status "Encerra" passou a se chamar **Finalizado** (chave `done`).
  - Janela da tarefa (`crmOpenTask`): campos em 2 colunas (`.crm-props` / `.field.crm-prop`): Tarefa,
    Status, Responsáveis (lista de marcar `.ms` como os Tipos do colaborador), Vencimento, Prioridade,
    **Paciente ou Lead** (`#crmWho`: sugestões de paciente; nome sem cadastro = lead `lead.nome`),
    Motivo de perda (status `lost`), "Dados do lead" (só lead em lista `lead`: nascimento, responsável,
    telefone, e-mail, convênio, plano, origem = lista "Como conheceu a clínica"), Descrição. Saíram
    Etiquetas e Nome da criança. **Cadastrar paciente** (`#crmRegPat`, só para lead) abre
    `openPatientModal(null, {prefill, noTreatment, onSaved})` preenchido e liga a tarefa ao paciente.
  - Barra lateral recolhível `#crmSide` (lembrada em `agendaPipo:crmSide`): resumo das alterações em
    texto (`#crmSideSum`), comentários (`#crmSideCom`) e campo de comentário com @menção. No corpo,
    "Atividade" recolhida (`#crmActTog`) com o histórico completo. Botão **Alternar layout**
    (`#crmLayBtn`: Modal / Tela cheia / Barra lateral, `agendaPipo:crmLayout`).
  - **Tarefa finalizada não pode ser excluída**: Excluir desativado na janela + gatilho
    `tasks_delete_guard` (migração `supabase/2026-10-08f-crm-finalizada-nao-exclui.sql`, testada).
- 2026-10-08 (pedido do usuário) CRM: a tela ocupa a altura toda (`#tab-crm{flex:1}`; Quadro com colunas até o fim). Nova visualização **Calendário** (`CRM.view = "calendario"`, também em Minhas tarefas; Quadro não): mês domingo→sábado (`crmCalHtml`, `CRM.calMonth`, ‹ Hoje ›, `crmCalShift`), tarefas pelo vencimento com a cor do status (vencida em vermelho, finalizada riscada), até 4 por dia + "+ N mais" (`CRM.calOpen`), hoje destacado, contadores "sem vencimento" e "em atraso", arrastar para outro dia muda o vencimento (`crmSetDue`), + no dia cria tarefa com aquele vencimento (`crmOpenTask(null, {due})`). Testes em `run_crm.js`.
- 2026-10-08 (pedidos do usuário) CRM: status como bolinha + texto (`crmStDot`) na lista e na atividade. Seletores
  flutuantes (`crmPop`, `#crmPop`): Status agrupado Não iniciado / Ativo / Concluído / Perdido com ícone de andamento
  (`crmStatusMenu`, `crmStGroups`, `crmStIcon`), Responsáveis com busca, "Eu" primeiro e iniciais coloridas
  (`crmPeopleMenu`, `crmAv`, `crmAvColor`), Prioridade com bandeiras e teclas 1–4 (`crmPrioMenu`, `crmFlagSvg`; sem
  "Limpar": a prioridade é obrigatória no banco, padrão Normal). Na janela: `#crmStBtn`/`#crmSt` (hidden),
  `#crmPrioBtn`/`#crmPrio` (hidden), Responsáveis pelo mesmo `#crmPeopleMs .ms-btn` (o painel `#crmPeople` com as
  caixas continua escondido como armazenamento). Na lista: colunas Responsáveis e Prioridade e cliques
  `[data-crm-st]`, `[data-crm-people]`, `[data-crm-prio]` mudam sem abrir a tarefa (perda em lista de atendimento sem
  motivo abre a tarefa). Contador de comentários por tarefa (`crmLoadComCount`, `CRM.comCount`, `crmComHtml`) na lista
  e no quadro. Janela só no modo modal (saíram o botão de layout e `CRM_LAYOUTS`); barra lateral sempre aberta ao abrir,
  também em tarefa nova; a seção "Atividade" do fim da janela saiu — a lateral (`#crmFeed`) mostra alterações (linhas) e
  comentários (cartões) em ordem de data. Teste `tests/run_crm.js`.
- 2026-10-08 (pedido do usuário: as imagens do ClickUp eram só conceito) Seletores do CRM no PADRÃO de menu suspenso do
  sistema (`.cad-menu.crm-pop`: linhas cinzas entre itens, item escolhido na cor do sistema `.sel`, busca `.dp-filter`,
  caixas de marcar nos Responsáveis). Status SEMPRE com bolinha colorida (`crmStIcon` = `.crm-dot`; sem ícones de
  andamento, sem grupos — `crmStGroups` saiu), também no cabeçalho das colunas do Quadro. Prioridade com bandeiras (sem
  números de atalho visíveis; as teclas 1–4 continuam funcionando).
- 2026-10-09 (pedido do usuário) CRM, janela da tarefa: na lista com `lead`, **Paciente ou Lead** fica DENTRO de
  "Dados do lead" (`whoHtml`), em pares: Paciente ou Lead | Nascimento, Responsável | Origem, Telefone | E-mail,
  **Diagnóstico** (`#crmLDiag` → `lead.diagnostico`, sugestões `CID_SUGGESTIONS`; vai para `cid` no "Cadastrar
  paciente") | Convênio; **Plano saiu** (valor antigo `lead.plano` é mantido ao salvar). Com paciente cadastrado
  só Paciente ou Lead fica (os outros `.crm-lf` somem). Etiqueta Lead/Paciente dentro do campo.
  Comentário: caixa `.crm-compose` (texto em cima, barra branca `.crm-compose-bar` com `.crm-compose-tools` vazia
  para funções futuras e botão enviar `.crm-send` #crmCommentSend, desativado sem texto); **Enter envia**,
  Shift+Enter quebra linha, com a lista de @menção aberta Enter escolhe a 1ª pessoa. Comentário registrado
  `.crm-cmt` (iniciais 28px, nome, tempo relativo `crmAgo` — "23 minutos" — com a data no `title`, texto 13,5px).
- 2026-10-09 (pedido do usuário) CRM Calendário cabe na tela: `.crm-host:has(.crm-cal)` em coluna sem rolagem, semanas
  dividem a altura (`grid-template-rows: repeat(semanas, minmax(0,1fr))`, antes mínimo de 104px por semana) e cada dia
  rola por dentro (`.crm-cal-day` overflow hidden, `.crm-cal-items` overflow auto). Tarefa no dia 20% mais alta
  (`.crm-cal-task` padding 5px 8px, line-height 1.35).
- 2026-10-09 (pedido do usuário, celular) Detalhes do Agendamento: nome na 1ª linha, idade embaixo
  (`.agd-det-age`, `patientAgeYears`), depois os botões Agendamento/Saúde/Tratamento na largura toda (no
  `@media (max-width:760px)` `.agd-det-top` em coluna, `.agd-det-seg` com botões iguais); Horários do
  tratamento em quadrinhos, dois dias por linha (`agdDetHoursHtml`, `.agd-det-hours`). Status (`#agdDetStatus`
  e `#agdStatus`) saiu de `DP_COMBO_SEL`: é lista só de escolher (não abre teclado no celular).
- 2026-10-09 (decisões do usuário) Detalhes de agendamento de **grupo de suporte**: seletor Agendamento | **Pacientes (N)**
  (`agdGroupSlotRows(row)` = atendimentos de paciente na MESMA sala/data/horário em `AD.rows`; lista
  `agdGroupPatientsHtml`: cor, nome, idade; tocar abre `agdOpenDetails` do paciente). Objetivos
  (`agdGroupGoalsFill`/`agdGroupGoalsBoxHtml`): "Objetivos em comum" (mesmo objetivo em 2+ pacientes, com
  "Pacientes: …") e um quadro recolhido "Objetivos de <paciente>" com os só dele; cada paciente filtrado pelo
  profissional com quem ELE está agendado. Linhas/quadros reaproveitam `agdObjLine`/`agdObjGrouped`/`agdObjBox`
  (extraídos de `agdGoalsBoxHtml`). Teste no `tests/run_plano.js`.
- 2026-10-09 (correção) Pacientes do grupo vazios em produção: a lista lia só `AD.rows`, e quem só vê a
  própria agenda (`agenda_scope_professional`) não recebe os atendimentos dos outros profissionais.
  `agdGroupSlotFetch(row)` chama a RPC `group_slot_appointments(p_id)` (security definer: confere
  `agenda.view` e que a pessoa vê o agendamento do grupo; devolve atendimentos da mesma sala/data/hora,
  sem bloqueio e sem `group_id`) e redesenha "Pacientes (N)", a lista e os objetivos; sem a função, fica o
  da semana carregada. Migração `supabase/2026-10-09-pacientes-do-grupo.sql` (testada no PGlite).
- 2026-10-09 (pedido do usuário, celular) **CRM: campo de escolha abre janela de baixo**. `useSheet(el)` (celular e
  dentro de `SHEET_SCOPE` = `#tab-crm, #ovCrm, #ovCrmL`) → `sheetWrap(título, aoFechar)` cria `#mSheetBg` + `#mSheet`
  (título = rótulo do campo via `sheetTitleFor`, ✕, toque fora fecha; `sheetRemove`, `inSheet`). `dpOpenPop` põe o
  `#dpPop` dentro da janela (`pop.__sheet`, sem `dpPlace`); a data fica só leitura no celular (sem teclado) e ganha
  **Limpar** (`.dp-clear`); a busca das listas não abre o teclado sozinha. `crmPop` faz o mesmo (`o.title`; Status com
  busca `o.search` → `.crm-pop-q`). `#crmLConv` sem `data-combo` no celular. Lista no celular: Status, Tarefa (4
  primeiras palavras, `.crm-t-sm`), Venc., Prio. (só a bandeira, `.crm-prio-name` oculto); Minhas tarefas = tabela
  `.crm-mine-t`. Calendário: dias "Dom/Seg…" (`data-s`), tarefas viram marcas coloridas e tocar no dia abre
  `crmCalDaySheet` (tarefas do dia + "+ Nova tarefa neste dia"). Janela da tarefa: rótulo em cima, uma coluna, tudo
  rola junto (atividade e comentário no fim). Listas e status: nome na linha toda, opções embaixo. Barra: busca na
  linha toda, os 3 filtros lado a lado. Teste `tests/run_crm_mobile.js`.
- 2026-10-09 (pedido do usuário, celular) Janela da tarefa do CRM com **Detalhes | Atividade** no topo (`#crmMTabs`,
  `.seg`, `[data-mtab]`; oculto no computador): Detalhes = campos + descrição; Atividade (`.crm-modal.mt-act`) =
  `#crmSide` na janela toda (alterações e comentários, rola até o fim ao abrir) com o campo de comentar embaixo;
  número de comentários ao lado (`.crm-mtab-n`). As duas com fundo branco; o » de recolher some no celular.
- 2026-10-09 (pedido do usuário, celular) Menu ☰: parecia ter vários botões selecionados. Causas: o toque deixava o
  `:hover`/`:focus` preso (fundo colorido) e todos os itens do CRM tinham a mesma aba `crm`. Agora só `.on` marca
  (item com `isOn()` — CRM compara `CRM.list` — ou mesma aba), toque mostra só `:active` cinza, foco de teclado com
  `:focus-visible`; o grupo que tem a tela aberta já abre e o título fica na cor do sistema (`.mnav-grp.has-on`).
- 2026-10-09 (pedido do usuário, celular) CRM **Quadro**: um status por vez na largura da tela (`.crm-col` 100% −
  24px, `scroll-snap`), só os quadros deslizam (topo parado: `.crm-host:has(.crm-board)` sem rolagem). Barra de status
  em cima `.crm-pager` (bolinha, nome, quantidade; oculta no computador): tocar leva ao status, deslizar marca o atual
  (`crmBoardPager`, `CRM.boardPage` mantém o status ao redesenhar). Correção: a regra do celular que esconde `.crm-t`
  ficou só na tabela (`#crmHost .pat-table .crm-t`); antes sumia o título nos cartões do Quadro ("— —").
- 2026-10-09 (pedido do usuário) **Tarefa nova = mesma janela da edição**, com a Atividade desde o cadastro: o campo de
  comentar fica liberado na tarefa nova; cada comentário entra em `pendingCom` e aparece no feed tracejado
  (`.crm-cmt.pending`, "enviado ao salvar"); ao salvar, depois do `crmInsert`, cada um é enviado por `crmComment`
  (texto ainda no campo também vai). `crmCommentHtml(e, textoDaHora)` monta os cartões (feed e pendentes).
- 2026-10-09 (pedido do usuário) Cadastro do paciente: Alergias, Medicações em uso e Restrições alimentares viraram
  campos de UMA linha (`type: "line"`; texto antigo com quebra de linha aparece separado por ";"); Observações com
  5 linhas (`rows: 5`). Linhas organizadas: Escola (2 colunas, `span2`) | Série/ano; Turno | Professor(a) | Mediador;
  Médico (`span2`) | Diagnóstico (CID, sem a seta preta do datalist); Data do diagnóstico | Nível de suporte | Comunicação. **"Nome social /
  apelido" do PACIENTE saiu** (campo, busca, ficha impressa, planilha; `nomeSocial` em `PAT_LEGACY_KEYS` → apagado
  ao salvar). O nome social do colaborador continua. Migração `supabase/2026-10-09b-paciente-sem-nome-social.sql`
  (apaga dos pacientes e de `config/patient_fields`; testada no PGlite).
- Produção (2026-10-09): `2026-10-09b-paciente-sem-nome-social` rodada.

## Revisão de lentidão e comunicação com o banco — etapa 1 (2026-10-09)
Medido com volume real fictício (110 pacientes, 40 colunas, 75% ocupado, CPU 4× mais lenta).
- `js/pipo-supabase.js`: documentos pedidos no mesmo instante vão numa consulta só
  (`fetchDoc` com fila `fetchQueue` + `flushFetch`, `.in("path", …)` em lotes de 50; a mesma
  leitura em andamento é reaproveitada; `fetchDoc(path, true)` = precisa do valor de agora).
  Abertura: ~30 leituras → 1. Ao conectar o tempo real (`SUBSCRIBED`, também na 1ª vez)
  `refetchAll` relê tudo numa consulta e só avisa o que mudou (fecha a brecha entre a leitura
  e a conexão). Com o canal ao vivo, um ouvinte novo de documento já lido (`liveFresh`) recebe
  o valor guardado sem ir ao banco; canal caiu = `liveFresh` zera. Mudança do tempo real que
  chega durante uma leitura vence a leitura (`rtSeq`). Aviso do tempo real SEM o conteúdo
  (documento grande demais, `payload.errors` / sem `data`) relê do banco — antes o documento
  virava "vazio" na tela. Teste `tests/run_docs_layer.js`.
- Planner: trocar dia/semana desenha na hora com os 20 documentos que já ficam ao vivo para o
  Resumo (`state.reportDocs` → `state.scheduleDocs` em `subscribeSchedule`).
- `dbAll(make)` (perto de `agdClient`): lê todas as páginas de 1000. Usado onde a lista podia vir
  pela metade sem aviso: Prontuário (`prLoadSummary`, todas as evoluções — passaria de 1000 em
  poucos meses), `staff`, `patient_health`, `treatment_finance`, `convenio_finance`,
  `therapy_plans`. Consulta nova que lê uma tabela inteira: usar `dbAll` com `.order` por coluna única.
- `normText` guarda os textos já convertidos (`_normCache`, até 20 mil) e `esc` não monta texto
  novo quando não há o que trocar.
- Legenda e nota do Planner com espaço à direita para o controle de zoom (antes passavam por baixo).
- (2026-10-09, aprovado pelo usuário) Planner: o controle de zoom saiu do canto da tela
  (`position:fixed`) e foi para a barra, antes da tela cheia (`#zoomCtrl` dentro de
  `#tab-planner .controls`; opções "100%"…"50%", "Ajustar à tela"; `#zoomLabel` só aparece no
  "Ajustar à tela", classe `.zoom-fit`). O texto longo do rodapé ("Clique numa célula…") saiu
  (está na Ajuda). Botões liberar/bloquear/limpar da coluna de horários (`.row-lock`, Planner e
  Agenda) invisíveis até passar o mouse na linha (`@media (hover:hover)`; no toque continuam).
  Agenda: trocar de semana não apaga mais a grade — a semana nova aparece apagada e sem clique
  (`#agdGrid.agd-loading`) com "Carregando…" no título (`.agd-loading-tag`) até os atendimentos
  chegarem; "Carregando agenda…" só na 1ª carga. Teste `tests/run_planner_agenda_visual.js`.
- (2026-10-09, pedido do usuário) Planner: na janela do agendamento, a amostra de "Bloqueado" é o
  cinza do horário bloqueado (`slotKindPickerHtml(atual, desativado, planner=true)` →
  `--off-bg` tracejado); legenda do Planner junta "Bloqueado ou fora do horário do profissional".
  A Agenda continua com o Bloqueado escuro (`BLOCKED_COLOR`).
- (2026-10-09, pedido do usuário) Barras com largura pelo conteúdo: campo de data das barras
  (`.pat-toolbar`/`.agd-toolbar`/`.crm-toolbar`/`.controls`, computador) com a largura de
  dd/mm/aaaa. Agenda (computador): ordem data · ‹ Hoje › · Dia/Semana · período · "Profissional:
  X" (não cortam mais); o lado direito (busca, tela cheia, Outras opções, + Incluir, ?) fica no
  grupo `.tb-right.agd-tb-right` (quebra de linha leva o grupo inteiro; no celular
  `display:contents`; `helpAddQButtons` põe o "?" dentro de `.tb-right` quando existe).
  Visão geral: ‹ Hoje › agrupados como na Agenda (`.agd-nav`); de 1100px para cima a barra fica
  numa linha e os filtros encolhem com "…".
- (2026-10-09, pedido do usuário) Barra da Agenda numa linha só de 1280px para cima
  (`@media (min-width:1280px)` → `flex-wrap:nowrap`): falta espaço = a busca encolhe (mín. 120px)
  e depois "Profissional: Nome" ganha "…" (`flex:0 100 auto`, nome inteiro no `title` de `#agdWho`);
  o período nunca corta. Abaixo de 1280px o grupo da direita desce para a 2ª linha.

## Lista de Pacientes: 8 colunas (2026-10-09, pedido do usuário; substitui "Nome, Nascimento, Idade, Tratamento")
`SORT_COLS` / `PAT_COL_DEFAULT_WIDTH`: **Nome, Idade, Telefone** (só o primeiro, `patFirstPhone`),
**E-mail** (só o primeiro, `patFirstEmail`), **Escola**, **Médico** (`patRegName(kind, id)`; Médico
só aparece para quem vê "Pacientes – saúde"), **Status** (paciente Ativo `.tr-chip.st-ativo` /
Inativo `.tr-chip.st-inativo` — saiu a etiqueta "inativo" ao lado do nome) e **Tratamento**.
Todas ordenáveis (`patSortKey`) e com largura ajustável; textos longos com "…" (`.pt-ell`, valor
no `title`). Celular: Nome + Tratamento (`:nth-child(1)` e `(8)`).
- (2026-10-09, pedidos do usuário) Janela da tarefa do CRM no computador: rótulo em cima de cada
  campo (`.crm-prop` em coluna), todos os campos com 40px, 13px e cor `--ink` (inclusive
  "Ninguém", "Não informado", data vazia); comentários e descrição 13px; registro das atividades
  11,5px. Abas Detalhes/Atividade só no celular (`@media (min-width:761px)` esconde `#crmMTabs`).
  Barra lateral Atividade sempre aberta (fundo cinza-claro): saíram o » (`#crmSideClose`) e o
  botão de balão (`#crmSideOpen`). Feed em ordem de execução (`Date.parse` do `created_at`; no
  mesmo instante, alteração antes do comentário). Responsáveis sem bolinhas de iniciais: lista,
  quadro e campo mostram só os primeiros nomes (`crmAvatars` → `.crm-pp-names`, nomes completos no
  `title`); menu de escolha só com caixa + nome.
- (2026-10-09, pedido do usuário) Lista do CRM: Status, Responsáveis, **Vencimento** e Prioridade se
  mudam na própria lista; a célula inteira é o botão (`.crm-main td > .crm-prio-btn` com 100% da
  largura; clique no espaço da célula é repassado ao botão, nunca abre a tarefa). Vencimento:
  `[data-crm-due]` → `crmDueEdit(btn, tarefa)` troca a célula por um campo de data
  (`dpEnhanceDate`, digitar ou calendário), grava com `crmSetDue` (vazio = sem vencimento) e volta
  ao clicar fora ou Esc. Sem bolinhas de iniciais em todo o CRM (comentários e lista de @menção
  também; `crmAv` ficou sem uso).
- (2026-10-09, pedidos do usuário) Janela da tarefa do CRM: **Descrição ao lado** de Status /
  Responsáveis / Vencimento / Prioridade (`.crm-top` = `.crm-props` + `.field.crm-desc`, a caixa
  ocupa a altura dos campos; no celular fica embaixo). Lateral Atividade em cinza mais claro
  (`color-mix` 45% `--surface-2`). Regras de 13px/40px da janela só no computador (no celular os
  campos seguem 16px, inclusive Status e Prioridade).
- (2026-10-09, pedido do usuário) Prioridade do CRM só **Urgente, Alta, Normal** (padrão Normal):
  "Baixa" saiu de `CRM_PRIOS` e do filtro `#crmFPrio`; tarefa antiga gravada com "baixa" aparece,
  filtra e ordena como Normal (`crmPrio`). Sem SQL (o banco ainda aceita "baixa").
- (2026-10-09, pedido do usuário, SUBSTITUI "Descrição ao lado" e o "rótulo em cima" do computador)
  Janela da tarefa do CRM no computador: nome do campo à ESQUERDA (coluna de 120px) e o campo ao
  lado (`#ovCrm .crm-prop` em grid `120px 1fr`), nesta ordem por linha: Tarefa (linha toda);
  Status | Responsáveis; Vencimento | Prioridade; Descrição (linha toda, 3 linhas, `#crmDescBox`);
  depois "Dados do lead" na mesma ordem de antes e no mesmo formato. `.crm-top` saiu. No celular,
  nome em cima e um campo por linha.
- (2026-10-09, pedido do usuário) Lista do CRM, ordem das colunas: Status, (Lista, só em Minhas
  tarefas), **Paciente ou Lead, Tarefa**, Convênio, Responsáveis, Vencimento, Prioridade. Celular
  continua Status, Tarefa, Venc., Prio. (`:nth-child` ajustados: lista esconde 2,4,5; Minhas
  tarefas esconde 2,3,5,6).
- (2026-10-09, pedido do usuário: "CRM demora a carregar, o botão demora a aparecer") Velocidade
  do CRM: o menu CRM é montado já na abertura com as listas padrão (`crmRebuildNav()` no início de
  `subscribeTaskLists`), sem esperar o documento `config/task_lists`. As tarefas são lidas em
  segundo plano 1,5 s depois que o perfil chega (`crmPreload`, uma vez; também deixa o contador do
  topo certo sem abrir o CRM). Abrir o CRM de novo com o tempo real conectado (`CRM.live`, pelo
  `subscribe` do canal `pipo-tasks`) mostra na hora sem reler tarefas/pessoas/comentários
  (`crmOnShow`); a conexão que cai e volta relê uma vez. `CRM.loading` evita leituras em dobro;
  `crmLoad` só redesenha com a tela aberta e atualiza o contador. Medido com 2000 tarefas fictícias
  (CPU 4× mais lenta): Lista ~1,1 s, Quadro ~0,8 s, Calendário ~0,1 s, janela ~20 ms — o tempo é do
  navegador montando as linhas. Teste no fim de `tests/run_crm.js`.
- (2026-10-09, pedido do usuário) CRM abre em **Minhas tarefas**: sem lista escolhida (endereço `#crm`, F5,
  primeira abertura) ou com lista sem permissão, `crmOnShow` usa `CRM.list = "__mine"` (antes a 1ª lista).
- (2026-10-09, pedidos do usuário) **CRM ▾ → CRM** (1º item, `crm-home`, `CRM.list = "__home"`): cartões das listas
  visíveis (`crmHomeRender`, `.crm-home-grid`/`.crm-home-card` com a cor da lista; Minhas tarefas primeiro;
  abertas, vencidas, "comigo"); clicar abre a lista; a barra esconde visualização/filtros/+ Tarefa
  (`#tab-crm.crm-home`). A tela não fica mais presa em "Nenhuma lista disponível" quando abre antes das
  permissões: `crmResolveList()` roda em todo `crmRender` (e o `onProfile` redesenha o CRM);
  `crmFillFilters` sempre grava `.value` (o botão do filtro Responsável aparecia vazio).
  Janela da tarefa mais estreita (com a lateral 1060px; nome do campo em 96px, colunas a 14px).
- (2026-10-09, pedido do usuário) Janela da tarefa (computador): menos espaço entre a Descrição e "Dados do lead" (`.crm-props` sem margem embaixo, `#crmDesc` em bloco, `.crm-sec` com 4px; antes ~44px, agora 16px).
- (2026-10-09, pedidos do usuário) **Comentário do CRM: editar e excluir.** Nos cartões do feed, botões Editar /
  Excluir (`.crm-cmt-acts`, aparecem ao passar o mouse; no toque sempre): editar só o próprio comentário (caixa
  `.crm-cmt-ed` no lugar do texto, Enter salva, Esc cancela, "(editado)" com `edited_at`), excluir o próprio ou,
  para o Administrador, de qualquer pessoa (confirmação). `crmCommentEdit`, `crmCommentDelete`,
  `crmCommentActionsWire(feed, taskId, pending, rerender)` (na tarefa nova mexe só em `pendingCom`),
  `crmMentionsOf`. Tempo real de `task_events` com UPDATE/DELETE relê a atividade aberta e o contador.
  Migração `supabase/2026-10-09c-crm-editar-comentario.sql` (coluna `edited_at`, política `task_events_update` só
  para o autor, gatilho `task_events_edit_guard` deixa mudar só texto/menções; testada no PGlite). Sem a migração
  editar avisa "rode o SQL 2026-10-09c".
- (2026-10-09, pedido do usuário) Linhas da lista do CRM com a altura das listas de cadastro (40px): botões das
  células com `margin-block:-7px` (continuam ocupando a célula toda).
- Produção (2026-10-09): `2026-10-09c-crm-editar-comentario` rodada.
- (2026-10-09, pedido do usuário) Editar comentário do CRM abre a janela **Editar mensagem** (`crmEditDialog(old)` →
  texto ou null; mesma caixa `.crm-compose` com botão de enviar; Enter salva, Shift+Enter quebra linha, Esc/✕/clique
  fora cancela; no `#confirmHost`). Saiu a edição dentro do cartão (`.crm-cmt-ed`).
- (2026-10-09, pedido do usuário) Computador: na lateral Atividade o campo de comentar fica EM CIMA (logo abaixo do
  título, `order` no CSS do `@media (min-width:761px)`), com 3 linhas (`#crmCommentIn` height = 3 × 1,5em + 16px).
  No celular continua embaixo, na aba Atividade.
- (2026-10-09, pedido do usuário, celular) Quadro do CRM: a fileira de botões de status virou UM campo de escolha
  igual aos filtros (`.crm-pager` > `button.dp-btn.dp-plain.crm-pager-btn`, linha inteira) com o status da tela
  (bolinha, nome, quantidade); tocar abre a janela de baixo "Status" (`crmPop`, `.crm-pg-menu`) e escolher desliza
  até ele. `crmBoardPager(host, items, list)`.
- (2026-10-09, pedido do usuário, celular) Lista do CRM no celular: **Status, Paciente (ou lead), Venc., Prio.** (a
  Tarefa saiu). Lista esconde as colunas 3, 4, 5; Minhas tarefas esconde 2, 4, 5, 6. Paciente numa linha com "…"
  (etiqueta "lead" oculta), Venc. com 82px (data inteira dd/mm/aa), Prio. 44px, botões das células sem padding lateral.
- (2026-10-09, CORREÇÃO URGENTE) O texto da Ajuda do CRM ganhou aspas retas dentro de uma string entre aspas
  ("…") e quebrou o script inteiro (sistema em branco); os testes não acusaram porque o script de conferência
  contava só linhas com " false" — com a página quebrada o teste cai antes. **Ao conferir testes, confira também a
  linha "no JS errors? true" (ou o código de saída).** Texto novo na Ajuda: usar aspas curvas “ ” ou &quot;.
- (2026-10-09, pedido do usuário, celular) Linhas da lista do CRM sempre com UMA linha de altura (40px): todo `td`
  com `white-space:nowrap` (antes o nome quebrava e a linha crescia). Teste em `run_crm_mobile.js`.
- (2026-10-09, pedido do usuário) Níveis de permissão: o grupo **CRM** começa com **CRM – Listas e status** (módulo
  `crm_listas`, ver/incluir/editar/excluir) e depois uma linha por lista (`crm_<id>`, inclusive as criadas depois) —
  `window.pipoCrmModules()`. App: `crmListsCan(a)` (Administrador sempre); o menu "Listas e status" aparece com
  "ver"; a janela salva só o que o nível pode (lista nova = incluir, tirada = excluir, mudada = editar; senão
  aviso) e sem nenhuma das três fica só leitura ("Fechar"). Banco: sem SQL — `module_for_path('config/task_lists')`
  já era `crm_listas` e `documents_enforce` confere item a item.
- (2026-10-09, pedido do usuário, SUBSTITUI o item anterior) Permissão **CRM** (chave continua `crm_listas`, primeira
  linha do grupo CRM em Níveis de permissão): "ver" = botão CRM do topo (tela CRM, Minhas tarefas) E a janela Listas
  e status; incluir/editar/excluir = listas e status. Depois uma linha por lista (`crm_<id>`; lista nova ganha a
  dela). App: `crmMainCan()` (Administrador sempre; nível sem o item gravado = "ver" se enxerga alguma lista, via
  `pipoAuth.canDefault`), `crmListsCan(a)`; `tabCan("crm")`, itens CRM/Minhas tarefas e cada lista exigem
  `crmMainCan()`. Migração `supabase/2026-10-09d-permissao-crm.sql` (dá "ver" em CRM a quem já via alguma lista;
  testada no PGlite).
- (2026-10-09, pedido do usuário, celular) Cadastros com a mesma rolagem de Pacientes (barra parada, só a lista rola):
  `#tab-tratamentos`, `#tab-colaboradores`, `#tab-tiposcolab` e `#tab-salas` viraram coluna flex de altura fixa no
  `@media (max-width:760px)` (os outros cadastros já eram — regra `#tab-convenios,…,#tab-feriados`). Salas/Grupos:
  os cartões continuam iguais, só `#roomList` rola (`overflow-y:auto`). Status é janela (rola por dentro).
- (2026-10-09, pedido do usuário) **Cadastros → Status virou tela de cadastro** igual às outras (`#tab-status`,
  `REG_CFG.status`, `data-tab="status"` em `CAD_TABS`, permissão `cadastro_status`): busca, contador, "+ Incluir",
  tabela Status (bolinha da cor) | Regra (`statusRuleText`: finalizado/não compareceu/falta justificada), na ordem do
  cadastro; clicar abre `openStatusItem(item)` (nome + cor, Excluir com confirmação, nome repetido recusado). Mesma
  rolagem de Pacientes no celular. `openStatusesModal` ficou no código sem uso; `window.pipoOpenStatuses` abre a tela.
  Teste `tests/run_status_cad.js` (no `npm test`).
- (2026-10-09, pedido do usuário, celular) **Cadastros com a janela de baixo nas escolhas** (como no CRM), menos
  Salas/Grupos: `SHEET_SCOPE` ganhou as telas de cadastro (`#tab-pacientes`, `#tab-tratamentos`, … `#tab-status`) e as
  janelas deles (`#ovPat`, `#ovPf`, `#ovMg`, `#ovPp`, `#ovTreat`, `#ovCancTr`, `#ovRmBk`, `#ovReg`, `#ovConv`, `#ovHol`,
  `#ovStItem`, `#ovProf`, `#ovQuick`, `#ovIo`). Listas de cadastro (`DP_COMBO_SEL`, de digitar no computador) viram
  lista com busca dentro da janela de baixo quando `useSheet(el)` (`dpEnhanceTimeList`); `dpMakeButton` não passa a
  classe desses selects para o botão. Painéis de várias opções (`.ms-panel`, ex.: Tipos e Serviços do colaborador):
  ouvinte de clique em `.ms-btn` põe `.ms-sheet` (painel fixo embaixo, sombra de fundo) e o cabeçalho
  `.ms-sheet-head` (título + ✕) sem tirar o painel do lugar. `sheetTitleFor` ignora os rótulos das opções.
  Teste `tests/run_cad_sheets.js` (percorre telas e janelas de "+ Incluir"; no `npm test`).
- (2026-10-09, pedido do usuário) Cadastro do paciente (computador e celular): grupos na ordem Identificação, Endereço,
  Filiação, Responsáveis pela retirada, Medida protetiva, Contato, Responsável financeiro, **Saúde, Escola, Rotina atual**,
  Administrativo, Tratamento (`PAT_SECTIONS`; vale também para Campos obrigatórios e a ficha impressa).
- (2026-10-09, aprovado pelo usuário, celular) Listas dos cadastros (menos Salas/Grupos) com UMA linha por item
  (`white-space:nowrap` + "…") e 2–3 colunas: Pacientes = Nome, Idade, Tratamento; Tratamentos = Paciente, Início,
  Status; Convênios = Nome, Pacientes; Motivos = Nome, Tratamentos cancelados; Médicos = Nome, Especialidade,
  Pacientes; Escolas = Nome, Pacientes; Colaboradores = Nome, Tipos, Situação; Tipos de colaborador = Nome, Pessoas;
  Especialidades/Serviços = Nome, Sigla, Profissionais; CBO = Código, Descrição; Conselhos = Sigla, Nome; Feriados =
  Nome, Quando; Status = só Status. Nome com o espaço que sobra, colunas curtas com largura fixa (bloco "Cadastros no
  celular" do `@media (max-width:760px)`). Mudou a ordem das colunas no computador? Ajustar os `:nth-child`.
  Conferido em `tests/run_cad_sheets.js`.
- (2026-10-09, pedido do usuário, celular) Menu ☰: TODOS os grupos (Cadastros, Agenda, CRM, Prontuário, Acesso…)
  abrem recolhidos (`mnavGroup`: `aria-expanded="false"` e `.mnav-items` hidden); o grupo da tela aberta só fica com
  o título na cor do sistema (`.has-on`). (Substitui "o grupo que tem a tela aberta já abre".)
- (2026-10-09, pedido do usuário, celular) **Visão geral no celular**: busca "Filtrar paciente…" na linha toda;
  profissional, especialidade, sala e status dois por linha; data + ‹ Hoje › + ? numa linha; depois a contagem do dia.
  Etiquetas por especialidade (`.vg-chip`), título e tela cheia ocultos (bloco "Visão geral no celular" no CSS).
- (2026-10-09, pedido do usuário, REGRA FIXA) **No celular, TODO seletor do sistema abre a janela de baixo** (título
  + ✕ + opções grandes), não só CRM e cadastros: `useSheet(el)` = celular, sem exceção (Salas/Grupos e as
  janelas deles também). `SHEET_SCOPE` não existe mais. Vale para tela/janela nova sem fazer
  nada: usar `<select>`, campo de data, `.ms` ou `crmPop` (todos passam por `useSheet`). Seletor feito de outro jeito
  precisa chamar `useSheet`/`sheetWrap`. Teste em `tests/run_cad_sheets.js` (Visão geral, Agenda e Salas).
- (2026-10-09, pedido do usuário) **Responsável no CRM só com acesso**: só pode ser responsável quem tem "ver" no CRM
  (`crm_listas`; nível sem o item gravado vale se vê alguma lista) E "ver" na lista da tarefa (`crm_<lista>`), ou é
  Administrador. App: `crm_people()` devolve `admin`, `crm`, `lists`; `crmCanAssign(p, listId)` /
  `crmAssignable(listId, manter)` filtram o menu de Responsáveis (lista e janela; `crmPeopleMenu(..., {listId})`) e o
  painel `#crmPeople`; quem já estava e perdeu o acesso aparece marcado com "(sem acesso)" (`crmNoAccessTag`) e só pode
  ser tirado. Sem os campos novos (banco antigo/testes) vale todo mundo. Banco: migração
  `supabase/2026-10-09e-crm-responsavel-com-acesso.sql` (`crm_user_can(usuário, lista)`, `crm_people` novo, gatilho
  `tasks_assignees_guard`: recusa responsável NOVO sem acesso; mudar a tarefa de lista confere todos; testada no PGlite).
  @menção continua com todos os usuários.
- (2026-10-09, pedido do usuário) **Comentários do CRM com negrito, itálico e sublinhado**: botões B / I / U
  (`CRM_FMT_TOOLS`, `.crm-fmt`, 40px no celular) na barra `.crm-compose-tools` da caixa de comentar e da janela
  Editar mensagem; Ctrl+B/I/U também. O texto continua simples, com marcas como no WhatsApp (`*negrito*`,
  `_itálico_`, `__sublinhado__`; `crmFmtApply` envolve a seleção ou põe as marcas com o cursor no meio) e o feed
  mostra formatado (`crmFmt` em `crmCommentHtml`; marca só vale encostada no texto e separada por espaço, então
  `nome_sobrenome` e `2*3` não mudam). Sem SQL.
- (2026-10-09, pedido do usuário) **Ordem do menu principal** (computador e celular): Cadastros, Planner, Agenda,
  Prontuário, CRM, Relatórios (o CRM saiu de antes do Prontuário: `.crm-wrap` vem depois do bloco do Prontuário em
  `#mainTabs`; no ☰ `mnavRender` monta Cadastros, Agenda, Prontuário, CRM, abas soltas como Relatórios, e Acesso).
  O Planner continua fora do celular.
- (2026-10-09, pedido do usuário, SUBSTITUI "Enter envia") Comentários do CRM e janela Editar mensagem: **Enter quebra a
  linha e Ctrl+Enter (Cmd+Enter no Mac) envia/salva**; com a lista de @menção aberta, Enter ainda escolhe a pessoa.
- (2026-10-09, pedido do usuário, celular) Janela da tarefa do CRM: **deslizar o dedo para o lado** troca as abas
  (esquerda = Atividade, direita = Detalhes): `touchstart`/`touchend` em `#ovCrm .crm-modal`, gesto horizontal de
  60px+ (1,5× mais horizontal que vertical, até 800 ms); não começa em campo de texto, seletor nem área com rolagem
  lateral. Só no celular (`isMobileView`).
- (2026-10-09, pedido do usuário, REGRA FIXA) **"+ Incluir" no fim das listas que consultam um cadastro** (computador e
  celular), só para quem pode INCLUIR no cadastro do campo. Lista aprovada (12 campos): Diagnóstico (Paciente, lead do
  CRM), Médico e Escola (Paciente), Como conheceu / Origem (Paciente, lead), Convênio (Tratamento, lead), Especialidade
  (Tratamento, especialidades cobertas do Convênio, especialidade principal do Colaborador), Motivo do cancelamento
  (Tratamento, Inativar paciente), Tipo de colaborador, CBO e Conselho (Colaborador), Habilidade e Escala (Banco de
  objetivos, Plano Terapêutico). Filtros/relatórios/consultas, Serviço e Status do atendimento, Paciente/Profissional/
  Sala nas agendas ficam SEM (decisão do usuário).
  - Como fazer num campo novo: `<select data-reg-add="<chave do REG_CFG>">` (opcional `data-reg-val="name"` quando o campo
    guarda outra coisa que não o id). `regAddOptHtml(el)` põe o botão `.dp-opt.dp-add` no fim da lista (combo do
    computador `dpEnhanceCombo` e lista/janela de baixo `dpEnhanceTimeList`; a busca não o esconde; texto digitado vira o
    nome); `regAddRun(el, digitado)` → `REG_CFG[k].quick(nome)` ou `quickAddRegistry(k, nome)` → acrescenta a opção e
    escolhe (`dpCommit`). `regAddKind` confere `can(REG_CFG[k].module, "create")`.
  - Janela pequena numa camada própria `#quickHost` (`regQuickHost`), por cima até de janela no `#confirmHost`. Escala
    abre a janela completa por cima (`openScaleModal(null, {stack, name, onDone})`, `REG_CFG.escalas.quick`).
  - `regPickHtml` (Médico, Escola, CBO, Conselho) não tem mais o botão "+" ao lado. Tipos do colaborador: `.ms-add`
    no fim do painel `#sfTypes` (o tipo novo entra marcado). Convênio e Especialidade do tratamento (sugestões
    `.autolist`): último item "+ Incluir" (com texto: cria com o nome digitado; sem texto: janela de cadastro).
  - **Cadastros novos**: **Diagnósticos** (`config/diagnoses {list:[{id, code, name}]}`, `REG_CFG.diagnosticos`,
    permissão `diagnosticos`, `diagnosesList`/`diagLabel`/`diagOptionsHtml`) e **Origens** (`config/origins`,
    `REG_CFG.origens`, permissão `origens`, `originsList`/`originOptionsHtml`), em Cadastros depois de Escolas. O
    paciente (`cid`, `comoConheceu` — tipo de campo `regtext`) e o lead do CRM (`#crmLDiag`, `#crmLOrig`) continuam
    gravando o TEXTO ("F84.0 Autismo infantil"). Sem documento no banco valem as listas iniciais + o já gravado.
    Migração `supabase/2026-10-09f-diagnosticos-e-origens.sql` (caminhos, `module_for_path`, níveis copiam Pacientes,
    listas iniciais com o que já existe em pacientes, saúde e leads; testada no PGlite). Teste `tests/run_reg_add.js`.
- (2026-10-09, pedido do usuário) Janela do nível de permissão: os títulos das colunas (Tela, Ver, Incluir, Editar,
  Excluir) ficam presos no alto ao rolar (`.perm-grid thead th` sticky com fundo, em `injectStyles` de `js/usuarios.js`;
  vale também para as tabelas de Status e Relatórios da mesma janela).
- (2026-10-09, pedido do usuário) **Níveis de permissão em grupos**, na ordem do menu do topo: Cadastros (na ordem de
  `CAD_ITEMS`, com as linhas "– saúde/– campos/– valores" logo depois da tela delas), Planner (Planner, Bloqueio de
  horário, Resumo, Disponibilidade), Agenda (Agenda, Visão geral), Prontuário (Prontuário, Plano Terapêutico, Objetivos,
  Escalas, Habilidades), CRM (linhas do app, `pipoCrmModules`) e Menu Acesso. `MODULES` em `js/usuarios.js` nessa ordem
  (`group` no 1º item de cada grupo); `allModules()` põe o CRM antes do Menu Acesso. Depois vêm as tabelas de Status e
  Relatórios. Item novo de permissão: colocar no grupo do assunto.
- Produção (2026-10-09): `2026-10-09f-diagnosticos-e-origens` rodada (confirmado pelo usuário: "Feito").
- (2026-10-09, pedido do usuário, REGRA FIXA) **Altura única dos campos de uma linha** (busca, seleção e cadastro),
  em todo o sistema: **38px no computador, 44px no celular** (variável `--field-h`, bloco "Altura única dos campos de
  uma linha" no fim do `<style>`, com `!important`): inputs de texto/e-mail/telefone/número/senha/busca/data/hora,
  `select` simples, `.dp-btn` (listas, datas, combos), `.ms-btn`, `.crm-pager-btn`. Exceção: a grade de objetivos do
  Plano (`.pl-tbl`, linhas compactas pedidas antes). Campo novo herda sozinho; não definir altura própria.
- (2026-10-09) `supabase/conferencia-migracoes.sql`: script SÓ DE LEITURA que diz, para cada migração da pasta,
  se já foi rodada no banco (SIM / NÃO / — sem marca própria), com as pendentes primeiro. Migração nova: acrescentar
  uma linha com a marca que ela deixa (função, tabela, coluna, caminho em `documents_path_valid`, nível pendente).
  Testado no PGlite. 05h NÃO deve ser rodada (desfeita pela 05i).
- Produção (2026-10-09): a conferência mostrou NÃO em 30b (trava de excluir nível), 02m (atendimento com evolução),
  03c (um só Ativo) e 08c (Visão geral nos níveis). Criada `supabase/2026-10-09g-acerto-pendentes.sql` só com o que
  faltava (a 30b inteira recriaria `handle_new_user`/`roles_guard`/`roles_before_insert` antigos — NÃO rodar ela).
  Testada no PGlite (2 vezes; travas conferidas). 09d e 09e: SIM.
- Produção (2026-10-09): `2026-10-09g-acerto-pendentes` rodada (conferência 0 / 0 / 3). Com isso todas as migrações
  da pasta estão aplicadas.
- (2026-10-09) `supabase/conferencia-geral.sql`: SÓ LEITURA, compara o banco com `schema.sql` (tabelas, colunas,
  funções e a versão delas por md5 do texto SEM espaços e quebras de linha (texto colado no Windows tem CRLF), gatilhos, políticas RLS, RLS ligada, índices, tempo real, caminhos de
  `documents_path_valid`) e lista só o que falta ou difere. Gerado a partir do schema num PGlite (script em scratchpad:
  montar o banco com schema.sql e ler o catálogo); ao mudar o schema, gerar de novo. Conferido: o texto de cada função
  no schema é igual ao da última migração que a define.
- Produção (2026-10-10): a conferência geral (comparando sem espaços) acusou 11 funções com conteúdo diferente do
  schema (appointments_stamp, clinical_records_stamp, convenio_finance_stamp, documents_enforce, handle_new_user,
  patch_list, patient_health_stamp, profiles_nonadmin_guard, roles_guard, therapy_plans_stamp, treatment_finance_stamp).
  `supabase/2026-10-10-reinstala-funcoes.sql` = essas 11 copiadas do schema.sql (só `create or replace function`;
  testado no PGlite, 2 vezes e com CRLF). Ao mudar funções no schema, gerar a conferência geral de novo.
- Produção (2026-10-10): `2026-10-10-reinstala-funcoes` rodada (confirmado pelo usuário: "Feito").
- Produção (2026-10-10): conferência geral LIMPA ("No rows returned") — banco igual ao `schema.sql`. REGRA: toda
  migração nova que mudar estrutura ou função também atualiza `schema.sql` e regera `supabase/conferencia-geral.sql`.

## Auditoria de integridade dos dados (2026-10-10) — CONCLUÍDA (16 de 16)
Análise de excluir/editar/inativar/mesclar/cancelar em todos os cadastros. A resolver:
- ~~ALTA 1~~ FEITO (2026-10-10, ver "Cadastros em lista gravam só o item" abaixo).
- ~~ALTA 2~~ FEITO (2026-10-10). Era: Atendimento com status (Finalizado/Não compareceu/Falta justificada) ou com evolução: lixeira/Desmarcar
  (`agdDeleteRow` só confere evolução p/ não-admin) e mover/editar (`agdPlace`, janela) mudam data/paciente/profissional;
  a evolução guarda data própria e fica divergente; contagens de realizado/sessões usadas mudam.
- ~~ALTA 3~~ FEITO (2026-10-10, ver "Excluir ou editar evolução" abaixo).
- ~~ALTA 4~~ FEITO (2026-10-10, ver "Excluir paciente" abaixo).
- ~~ALTA 5~~ FEITO (2026-10-10, ver "Mesclar cadastros completo" abaixo).
- ~~ALTA 6~~ FEITO (2026-10-10, ver "Status protegidos" abaixo).
- ~~ALTA 7~~ FEITO (2026-10-10, ver "Excluir Plano Terapêutico" abaixo).
- ~~MÉDIA 8~~ FEITO (2026-10-10, ver "Grupo de suporte em uso na Agenda" abaixo).
- ~~MÉDIA 9~~ FEITO (2026-10-10, ver "Colaborador em uso" abaixo).
- ~~MÉDIA 10~~ FEITO (2026-10-10, ver "Especialidade, Escala e Habilidade em uso" abaixo).
- ~~MÉDIA 11~~ FEITO (2026-10-10, ver "CRM: lista ou status com tarefas" abaixo).
- ~~MÉDIA 12~~ FEITO (2026-10-10, ver "Importação de Tratamentos: valores do tratamento da migração" abaixo).
- ~~BAIXA 13~~ FEITO (2026-10-10, ver "Renomear Diagnóstico, Origem ou Convênio" abaixo).
- ~~BAIXA 14~~ FEITO (2026-10-10, ver "Excluir usuário: sai das tarefas do CRM" abaixo).
- ~~BAIXA 15~~ FEITO (2026-10-10): decisão do usuário = avisar. A confirmação de Excluir da tarefa do CRM diz quantos
  comentários (`CRM.comCount`) e o histórico serão apagados junto. Sem SQL. Ajuda (CRM).
- ~~BAIXA 16~~ FEITO (2026-10-10, ver "Clínica: agendamentos do Planner que deixam de aparecer" abaixo).
  **Auditoria concluída (16 de 16).**

## Cadastros em lista gravam só o item; aviso de alteração simultânea (2026-10-10, item 1 da auditoria)
Decisões do usuário: mesmo item alterado por duas pessoas = AVISAR e deixar escolher; vale para TODOS os cadastros em lista.
- `listPrepare(antiga, nova)` (perto de `writeSimpleList`): compara item a item (`listCanon`, JSON com chaves em
  ordem), carimba os novos/alterados com `_upd {por: trWho(), em: ISO}`, separa `ups`/`dels`, guarda em `expect[id]`
  o carimbo que o item alterado tinha quando foi aberto e só manda `order` quando a ordem mudou. `listCommit(path,
  prep, force)`: `ref.patchList2` (RPC `patch_list2`); conflito (`code "conflict"`, `e.conflicts`) → `confirmDialog`
  "Alterado enquanto você editava" (quem e a hora; "excluído por outra pessoa") com **Salvar assim mesmo** (força) /
  **Recarregar** (`ref.reload()` relê e avisa a tela; resolve false). Sem a função no banco (`nofunc`) ou nos testes
  (sem `patchList2`), grava a lista inteira como antes. `confirmDialog` aceita `cancelLabel`.
- Usado em: `writeSimpleList` (Médicos, Escolas, CBO, Conselhos, Feriados, Tipos, Diagnósticos, Origens, Escalas,
  Habilidades, Objetivos…), `writeCancelReasons`, Listas do CRM, `plbWrite`, `writePatients`, `writeSpecialties`,
  Status (janela), `writeServices`, `writeConvenios`, `writeProfessionals`, `writeRooms`, `writeTreatments`.
  O estado da tela recebe a lista JÁ carimbada (`prep.list`), senão a 2ª gravação seguida daria conflito falso.
  Edição sempre a partir do item ABERTO (`Object.assign({}, itemAberto, form)`) — é o carimbo dele que vale.
- `js/pipo-supabase.js`: `patchList2(ups, dels, {expect, order, force})` (reconhece `PIPO_CONFLITO:[…]`) e `reload()`.
- Banco: `supabase/2026-10-10b-gravar-so-o-item.sql` (`patch_list2`, security invoker: RLS e `documents_enforce`
  continuam; recusa com `PIPO_CONFLITO:`; `p_order` põe no fim os itens que a pessoa não via). Testada no PGlite.
- Ajuda: regra no tópico "Visão geral do sistema". Teste `tests/run_list_patch.js` (cria `tests/page_lp.html` com
  banco simulado que tem `patchList2`/`reload`).
- Produção (2026-10-10): `2026-10-10b-gravar-so-o-item` rodada (função criada = 1).

## Atendimento com status ou evolução protegido (2026-10-10, item 2 da auditoria)
Decisões do usuário (QUALQUER status conta): excluir = só Administrador; data/horário/profissional = só Administrador
(a evolução acompanha); trocar o paciente = ninguém.
- App: `agdDoneLockMsg(row, rec, temEvolução)` / `agdDoneCheck([{row, rec}])` (perto de `agdSplitByRecords`), usados
  no Salvar da janela (`agdOpenModal`, `doneOk`) e em `agdPlace` (mover, arrastar, trocar; 5º parâmetro = já conferido;
  colar cópia não é afetado). `agdSplitByRecords`: não-Administrador mantém os com status (sem consultar) e os com
  evolução; `AGD_KEPT_MSG` fala de status. Aviso `.agd-done-note` na janela quando há status. Atendimento antigo sem
  `patient_id` não conta como troca quando o código é preenchido. Regras travadas do Sistema `ag_evolucao_apagar`
  (texto novo) e `ag_realizado_fixo`.
- Banco: `supabase/2026-10-10c-atendimento-realizado-protegido.sql` — `appointments_delete_guard` (status também),
  `appointments_done_guard` (BEFORE UPDATE: paciente nunca; data/horário/profissional só admin; `pipo.merging` libera
  renomear/mesclar), `appointments_sync_record` (AFTER UPDATE: evolução recebe data/horário/profissional novos) e
  `rename_group` com `pipo.merging`. Testada no PGlite com usuário comum e Administrador.
- Teste `tests/run_agd_done.js` (cria `tests/page_ad.html`).
- Produção (2026-10-10): `2026-10-10c-atendimento-realizado-protegido` rodada (travas = 3).

## Excluir ou editar evolução (2026-10-10, item 3 da auditoria)
Decisões do usuário: evolução do atendimento Finalizado não é excluída; objetivos recalculados pela última
evolução; quem exclui continua igual (autor com permissão ou Administrador).
- App: `prDelFinalCheck(rec)` antes do `confirmDialog` do `[data-pr-del]` (`PR_DEL_FINAL_MSG`): recusa quando a
  evolução é a ÚNICA ligada a um atendimento com status `finalizado` e a regra `ag_final_evolucao` está em Bloquear
  (vale também para o Administrador). Depois de excluir evolução com objetivos, `planLoadAll(true)`.
- Banco: migração `supabase/2026-10-10d-excluir-evolucao.sql` — `clinical_records_delete_guard` (BEFORE DELETE, mesma
  regra) e `clinical_records_plan_goals_undo` (AFTER DELETE e AFTER UPDATE de `plan_goals`, só os objetivos que saíram):
  se a situação do objetivo no plano vigente ainda é a que a evolução gravou (`levelId` + `levelEm` = data dela), volta
  à da última evolução que sobrou (ou fica sem `levelId`/`levelEm`); Atingido/Ativo acompanha o nível final da escala.
  Testada no PGlite. Teste no fim de `tests/run_agd_done.js`.
- Produção (2026-10-10): `2026-10-10d-excluir-evolucao` rodada (funções criadas = 2).

## Excluir paciente (2026-10-10, item 4 da auditoria)
Decisões do usuário: paciente com evolução, Plano Terapêutico ou tarefa do CRM vira Inativar; dados de saúde apagados
junto ao excluir de verdade.
- `USAGE.pacientes` conta também `clinical_records`, `therapy_plans` e `tasks` pelo `patient_id` (`rowUseCount(tabela,
  coluna, valor, mem)`; sem sistema online lê `PLAN.evoMem`, `PLAN.mem`, `CRM.mem.tasks`).
- Excluir: depois de `writePatients` gravar, `healthDelete(id)` → RPC `delete_patient_health(p_id)` (security definer:
  Administrador ou `pacientes.delete`, e só se o paciente já saiu de `patients/all`). Migração
  `supabase/2026-10-10e-excluir-paciente.sql` (também apaga uma vez a saúde de pacientes que já não existem). Testada no
  PGlite. Teste no fim de `tests/run_agd_done.js`.
- Produção (2026-10-10): `2026-10-10e-excluir-paciente` rodada (função criada = 1, saúde solta = 0).

## Mesclar cadastros completo (2026-10-10, item 5 da auditoria)
Decisões do usuário: os dois com Plano Terapêutico vigente = NÃO mescla; saúde do 1º completada com a do 2º.
- Banco: `merge_patient_records` (migração `supabase/2026-10-10f-mesclar-completo.sql`) recusa com dois vigentes, move
  `therapy_plans` (patient_id/patient_name) e `tasks.patient_id`, junta `patient_health` (preenchido do 1º vence, vazio
  vem do 2º) e apaga a do 2º; devolve `{agenda, prontuario, planos, tarefas, saude: true}`. Testada no PGlite.
- App (`openPatientMergeModal`): prévia conta também planos e tarefas do CRM do 2º e, com dois vigentes, mostra o aviso e
  deixa Mesclar desativado. `patientMerge`: com `saude` na resposta só atualiza `HEALTH.map`; sem (banco antigo) junta
  a saúde no app (`healthSave` + `healthDelete`). Depois, `planLoadAll(true)`. Teste no fim de `tests/run_agd_done.js`.
- Produção (2026-10-10): `2026-10-10f-mesclar-completo` rodada.

## Status protegidos (2026-10-10, item 6 da auditoria)
Decisões do usuário: Finalizado / Não compareceu / Falta justificada só mudam a cor; status em uso na Agenda NÃO é
excluído (troque o status dos atendimentos antes).
- App: `STATUS_LOCKED`, `statusLocked(id)`, `statusUseCount(id)` (count em `appointments.status`; sem sistema online,
  `AD.rows`). `openStatusItem`: travado = nome desativado, sem Excluir, aviso; Excluir confere uso antes da confirmação;
  salvar mantém os outros campos do item (`Object.assign`) e mostra o motivo do banco.
- Banco: `statuses_guard` (BEFORE UPDATE em `documents`, `config/statuses`; migração
  `supabase/2026-10-10g-status-protegidos.sql`). Testada no PGlite. Teste no fim de `tests/run_agd_done.js`.
- Correção junto: `prDelFinalCheck` (sem sistema online) lia `AD.rows` como lista; é objeto por id.
- Produção (2026-10-10): `2026-10-10g-status-protegidos` rodada (trava criada = 1).

## Excluir Plano Terapêutico (2026-10-10, item 7 da auditoria)
Decisões do usuário: plano com evoluções que avaliaram objetivos NÃO é excluído (usar Revisar); excluir a versão
vigente faz a anterior voltar a ser a vigente.
- App: `planEvoUseCount(id)` (count em `clinical_records` com `plan_goals @> [{planId}]`; sem sistema online,
  `PLAN.evoMem`) antes da confirmação do `#plDel` (`PLAN_DEL_EVO_MSG`); a confirmação avisa quando a anterior volta.
  `planDelete` sem sistema online repete a regra de reabrir.
- Banco: `therapy_plans_delete_guard` (BEFORE DELETE) e `therapy_plans_reopen_prev` (AFTER DELETE: vigente excluída →
  `prev_id`, senão a encerrada de versão mais alta, vira vigente). Migração `supabase/2026-10-10h-excluir-plano.sql`.
  Testada no PGlite. Teste no fim de `tests/run_agd_done.js`.
- Produção (2026-10-10): `2026-10-10h-excluir-plano` rodada (travas criadas = 2).

## Grupo de suporte em uso na Agenda (2026-10-10, item 8 da auditoria)
Decisão do usuário: grupo com atendimentos na Agenda vira Inativar (não exclui). `USAGE.salas` com grupo
(`isGroup`) conta `apptGroupCount(g)`: `appointments.group_id` = id do grupo + os sem `group_id` com
`patient` = nome do grupo (sem a coluna, só pelo nome; sem sistema online, `AD.rows`). `room_id` não conta
para o grupo (é a sala que ele marca). Só no app, igual às salas; sem SQL. Ajuda (grupos) e teste no fim de
`tests/run_agd_done.js`.

## Colaborador em uso (2026-10-10, item 9 da auditoria)
Decisão do usuário: contar tudo; em uso = Inativar. `USAGE.profissionais` conta também evoluções
(`clinical_records.professional_id`, via `rowUseCount`; sem sistema online `PLAN.evoMem`) e bloqueios de horário
do Planner do profissional (`PLB.list`, `alvo "prof"`). A janela do colaborador procura o usuário ligado pelo
`staff_id` e, sem ele, pelo `professional_id` (`pipoAuth.userForProfessional`). Só no app; sem SQL. Ajuda
(colaboradores) e teste no fim de `tests/run_agd_done.js`.

## CRM: vencimento com atalhos e recorrência (2026-10-10)
- Janela própria `crmDuePicker` (#crmDuePop; celular = janela de baixo): atalhos à esquerda (Hoje, Amanhã, Próxima Segunda,
  Semana que vem = hoje + 7, 2 e 4 semanas — pedido do usuário 2026-10-10), calendário à direita, ✕ tira a data. Abre pelo
  campo Vencimento da janela da tarefa e pela data na lista (`el.__picker` no input faz o `dpEnhanceDate` abrir ela).
- Só data final (sem hora). `tasks.recurrence` jsonb {freq diaria|semanal|mensal|anual, dias[0..6], nova, sempre, ate,
  status}. Gera a próxima SÓ ao finalizar: gatilho `tasks_recur` (before update of status) em
  `supabase/2026-10-10i-crm-recorrencia.sql`; sem sistema online `crmMemRecur` faz igual. nova=false: mesma tarefa
  volta ao status com a próxima data; nova=true: insere cópia (a recorrência passa para ela). Evento
  `field/recorrencia`. Conta igual nos dois lados (`crm_rec_next` / `crmRecNext`; mês sem o dia = último dia).
- Produção (2026-10-10): 2026-10-10i rodada (conferência 1 | 1).
- Só nas listas com "Recorrência" ligada (config/task_lists: `recorrencia: true`, CRM ▾ → Listas e status; padrão
  desligado). Nas outras o Vencimento abre o calendário normal (sem `__picker`); `crmRecAllowed(listId)`.


## Especialidade, Escala e Habilidade em uso (2026-10-10, item 10 da auditoria)
Decisão do usuário: contar tudo; em uso = Inativar. `USAGE.especialidades` conta também áreas complementares dos
profissionais (`complementares`, sem contar quem já a tem como principal), habilidades com ela nas especialidades
sugeridas (`skillAreasList()[].specIds`), Banco de objetivos (`goalBankUseCount("specIds", id)` — objetivo sem
especialidade = todas, não conta) e objetivos de planos (`planSpecUseCount`). `USAGE.escalas` / `USAGE.habilidades`
somam `goalBankUseCount("scaleId"|"areaId", id)`. Só no app; sem SQL. Ajuda (especialidades, escalas, habilidades) e
teste no fim de `tests/run_agd_done.js`.

## CRM: lista ou status com tarefas (2026-10-10, item 11 da auditoria)
Decisão do usuário: não deixar excluir. Janela da lista (`crmOpenListEdit`): `crmListUsed(lista, status)` conta pela
RPC `crm_task_usage()` (security definer, só números por lista/status, Administrador ou `crm_listas.view`; conta TODAS as
tarefas, também as que a pessoa não vê; `crmLoadUsage` ao abrir a lista, em `CRM_USAGE`); sem a função / sem sistema online, as tarefas carregadas (`CRM.tasks`). Aviso
com a quantidade. Banco: gatilho `task_lists_guard` (BEFORE UPDATE em `documents`, `config/task_lists`) recusa tirar
lista ou status com tarefas. Migração `supabase/2026-10-10j-crm-lista-com-tarefas.sql` (testada no PGlite). Ajuda (CRM) e
teste no fim de `tests/run_agd_done.js`. `conferencia-migracoes.sql` ganhou as linhas 76 (10i) e 77 (10j).
- Produção (2026-10-10): `2026-10-10j-crm-lista-com-tarefas` rodada (conferência 1 | 1).
- (2026-10-10, pedido do usuário) Tabela da tela CRM e de Minhas tarefas: **Lista, Status, Tarefa, Paciente ou Lead**, Convênio, Responsáveis, Vencimento, Prioridade (`order` em `crmRender`; células montadas por chave). Listas continuam Status, Paciente ou Lead, Tarefa… Celular (`.crm-mine-t`): esconde 1, 3, 5, 6 (fica Status, Paciente, Venc., Prio.).


## Importação de Tratamentos: valores do tratamento da migração (2026-10-10, item 12 da auditoria)
Decisão do usuário: passar para o tratamento novo. `ioTrApply`: o tratamento da migração (`tr-<paciente>`) que é
apagado passa Valor/Descontos (`trMoney`) ao tratamento que recebe as especialidades quando a linha da planilha não
traz valor (com valor na planilha, vale o da planilha). A linha antiga de `treatment_finance` só é apagada depois de
gravar a nova e só por quem edita valores (`trCanEditVal`); sem essa permissão fica como estava. Sem SQL. Ajuda
(Planilhas) e teste em `tests/run_planilhas.js`.

## Renomear Diagnóstico, Origem ou Convênio (2026-10-10, item 13 da auditoria)
Decisão do usuário: atualizar todos junto. No salvar de `openRegistryItem` (item existente, texto mudou),
`regRenameEverywhere(kind, antigo, novo, id)` (`REG_RENAME_TEXT`): pacientes (`comoConheceu`; `cid` só sem a tabela de
saúde) por `writePatients` (precisa de `pacientes.edit`), tratamentos (`convenio` ao lado do código, ou só o nome nos
antigos) por `writeTreatments` (precisa de `tratamentos.edit`), quem não pode fica com o nome antigo e há aviso; saúde
(`patient_health.data.cid`) e leads das tarefas (`tasks.lead.diagnostico/origem/convenio`) pela RPC
`rename_registry_text(p_kind, p_old, p_new)` (security definer; Administrador ou "editar" no cadastro; compara sem
maiúscula e espaços). Migração `supabase/2026-10-10k-renomear-cadastros-de-texto.sql` (testada no PGlite). Ajuda
(Convênios, Diagnósticos, Origens) e teste no fim de `tests/run_agd_done.js`.
- Produção (2026-10-10): `2026-10-10k-renomear-cadastros-de-texto` rodada (função criada = 1).

## Excluir usuário: sai das tarefas do CRM (2026-10-10, item 14 da auditoria)
Decisão do usuário: tirar dos responsáveis. Banco: gatilho `profiles_tasks_cleanup` (AFTER DELETE em `profiles`, que
cai junto com `auth.users`): `array_remove` do id em `tasks.assignees` (a atividade da tarefa registra) e apaga
`task_reads` dele. RPC `crm_user_open_tasks(p_user)` (Administrador ou `usuarios.delete`): tarefas não finalizadas
(`crm_status_done`) com ele como responsável. `js/usuarios.js`: a confirmação de Excluir mostra quantas. Migração
`supabase/2026-10-10l-excluir-usuario-tarefas.sql` (testada no PGlite). Ajuda (Usuários).
- Produção (2026-10-10): `2026-10-10l-excluir-usuario-tarefas` rodada (conferência 1 | 1).
- (2026-10-10, pedido do usuário) **CRM: exportar e importar tarefas** (Outras opções ▾ na barra do CRM, `IO_KINDS.tarefas`, bloco "CRM: tarefas" nas Planilhas). Exporta a tela aberta (`crmScreenTasks()`, mesma conta do `crmRender`: lista/Minhas tarefas/tela CRM com busca, filtros e Finalizados); nome do arquivo pela tela. Importa pela coluna Código (com código = atualiza; sem = nova; sem Lista = lista aberta; mudar de lista = problema). Paciente pelo nome (`ioFindPatient`), senão lead. Responsáveis pelo nome (`ioTaskPerson`, só com acesso `crmCanAssign`). Lead só em lista `lead`. Comentários fora. `ioCanImport` aceita `K.canImport`. Teste `tests/run_crm_planilha.js` (no `npm test`).

## Clínica: agendamentos do Planner que deixam de aparecer (2026-10-10, item 16 da auditoria)
Decisão do usuário: avisar e oferecer apagar. No Salvar de `openClinicModal`, `clinicHiddenBookings(horarios, dur)`
(lê os documentos dos dias abertos hoje × 4 semanas com `plannerLoadDocs`) conta os agendamentos (paciente, sala,
bloqueio, reunião, treinamento) em dia que fecha ou horário que deixa de existir com a duração nova e lista por dia.
Com algum, a confirmação "Agendamentos do Planner fora do horário" mostra quantos/onde e (com `planner.delete`) a
caixa `#clHiddenDel` "Apagar esses agendamentos do Planner" (`applyBookingChanges(..., {noHistory: true})` antes de
gravar a clínica); sem marcar, ficam guardados e voltam se reabrir. Sem nenhum, vale a confirmação antiga de mudar a
duração. Sem SQL. Ajuda (Clínica) e teste no fim de `tests/run_agd_done.js`.

## Conferência de integridade (2026-10-10)
`supabase/conferencia-integridade.sql`: SÓ LEITURA, 25 verificações de "sobras" (registros que apontam para algo que
não existe mais): CRM (responsável que não é usuário, lista/status/paciente inexistente, "lido" solto), valores de
tratamento/convênio soltos, convênio do tratamento, saúde solta, Agenda (paciente, grupo, status, serviço, sala
inexistentes), Prontuário e Plano Terapêutico de paciente inexistente, evolução apontando para plano apagado, paciente
só com planos encerrados, Planner (paciente inexistente, dia fechado na Clínica), bloqueios de horário soltos,
usuário/colaborador/profissional desligados, id repetido nas listas. Complementa `conferencia-dos-dados.sql`.
Testada no PGlite (também com CRLF). Correções só depois do resultado, em migração própria.
- Produção (2026-10-10): conferência de integridade rodada — as 25 verificações deram 0 (nenhuma sobra).
- (2026-10-10, pedido do usuário) Barra do CRM numa linha só no computador a partir de 1260px (busca e filtros encolhem com "…"; até 1700px "Outras opções" vira "Opções"); abaixo de 1260px quebra linha.
- (2026-10-10, pedido do usuário) **CRM: "Dados do lead" só com Paciente ou Lead | Telefone / WhatsApp; Diagnóstico |
  Convênio** (duas linhas). Saíram Nascimento, Responsável, Origem e E-mail (e o Plano antigo) da janela, da busca, da
  planilha de tarefas e do "Cadastrar paciente" (leva nome, telefone e diagnóstico). Descrição da tarefa com 8 linhas
  (`rows="8"`). Migração só de dados `supabase/2026-10-10m-crm-dados-do-lead.sql`: tira `nascimento`, `responsavel`,
  `origem`, `email` e `plano` de `tasks.lead`; o que estava preenchido e ainda não aparece na Descrição vai para o fim
  dela ("Dados do lead (campos retirados): …"). Testada no PGlite (também com CRLF e rodando 2 vezes).
- Produção (2026-10-10): `2026-10-10m-crm-dados-do-lead` rodada (tarefas_com_campos_antigos = 0).
- (2026-10-10, pedido do usuário) **Lista que abre para CIMA fica colada no campo ao digitar.** Antes ela ficava presa
  pelo topo e, quando a busca diminuía a lista, abria um vão até o campo. `popPlaceV(pop, retânguloDoCampo, gap)`
  (perto de `dpPlace`) escolhe o lado UMA vez ao abrir (`pop.__dir`) e, para cima, prende pela parte de baixo
  (`style.bottom`); `popWatchSize(pop, fn)` (ResizeObserver) reposiciona quando a lista muda de tamanho. Usado nas
  listas do sistema (`#dpPop`: combos de cadastro, listas com busca, calendário), nos seletores do CRM (`crmPop`) e na
  lista de objetivos do Plano (`.pl-goal-pop`). Lista flutuante nova: posicionar com `popPlaceV` + `popWatchSize`.
  Teste no fim de `tests/run_combo.js`.
- (2026-10-10, pedido do usuário) **CRM: "Dados do Paciente/Lead" em TODAS as listas** (título novo; antes só na lista com funil de contatos): Paciente ou Lead | Telefone; Diagnóstico | Convênio. Com paciente cadastrado os campos NÃO somem: mostram o cadastro dele (`patFirstPhone`, `cid` da saúde, convênio do tratamento), desativados (`leadFill`, `#crmPatNote`); lead = editáveis e gravados em `lead` (`readLead` em todas as listas). "Cadastrar paciente" sempre na linha do título. Motivo de perda continua só no funil. Planilha de tarefas aceita telefone/diagnóstico/convênio em todas as listas. Testes em `run_crm.js`.

## PADRÕES OBRIGATÓRIOS PARA ELEMENTOS NOVOS (pedido do usuário, 2026-10-10)
"Essas correções de campos, listas, janelas, títulos de coluna devem se tornar um padrão para novos elementos."
Toda tela, lista, janela ou campo novo segue isto (e o que já existe foi corrigido para seguir):
1. **Visual**: reaproveitar componentes/classes que já existem (`.pat-toolbar`, `.pat-table` via `gtRender`,
   `.field`, `.dp-btn`, `.ms`, `.kind-opt`, `.therapist-row`, `.room-row`, `confirmDialog`…); nada de estilo próprio.
2. **Listas em tela**: `gtRender` dentro de uma seção `.panel.reg-panel` (coluna flex de altura fixa: barra parada,
   só a lista rola) → o **título das colunas fica preso no alto ao rolar** (computador e celular). Tabela em outro
   lugar (relatório, janela) precisa de um contêiner com altura limitada e `overflow:auto` com `thead th` sticky
   (ex.: `.rp-table-wrap{max-height:72vh}`). Teste fixo `tests/run_sticky_headers.js` (no `npm test`) — tela nova
   de lista: acrescentar a aba em `TABS`.
3. **Campos de uma linha**: altura única `--field-h` (38px computador / 44px celular), sem altura própria.
4. **Celular**: todo seletor abre a janela de baixo (`useSheet`/`sheetWrap`); opções numa linha só com "…";
   campos com 16px; listas de cadastro com 1 linha por item e 2–3 colunas.
5. **Listas que consultam um cadastro**: `data-reg-add` ("+ Incluir" no fim, para quem pode incluir).
6. **Barras**: numa linha só no computador quando couber (busca e filtros encolhem com "…"); "?" sempre o último.
7. **Listas flutuantes**: posicionar com `popPlaceV` + `popWatchSize` (abrindo para cima fica colada no campo).
   Lista de sugestões ao digitar: usar `<div class="autolist" hidden>` logo depois do campo — ao perder o
   `hidden`, ela vira flutuante sozinha (`autoPlace`, `.autolist.auto-fixed`, observador de `hidden`), colada
   no campo e sem aumentar a rolagem da janela.
8. **Janelas**: rodapé Excluir à esquerda, Cancelar, Salvar; sem permissão = só leitura (`modalApplyPerms`);
   item em uso = Inativar; toda exclusão com `confirmDialog`.
9. **Ajuda**: toda função nova entra no `HELP_TOPICS` (aspas curvas no texto).
10. **Título da tela**: toda tela de cadastro tem o título no começo da barra (`h2.cad-title`, posto por
   `cadTitlesInit()` no boot pelo mapa `cadTitleText`): no computador antes da busca, no celular na 1ª
   linha. Tela nova de cadastro: acrescentar a chave em `cadTitleText`/`cadTitlesInit` e em
   `tests/run_cad_titles.js`.
- (2026-10-10, pedidos do usuário) Janela da tarefa do CRM: etiqueta "Paciente cadastrado"/"Lead (sem cadastro)" (`#crmWhoTag`) ao lado do título "Dados do Paciente/Lead" (`.crm-sec-tw`), fora do campo. Janela com a altura da tela (`calc(100dvh - 32px)`, acompanha F11); a **Descrição ocupa o espaço livre** da coluna (`fitDesc` em `crmOpenTask`, refeito no `resize`; mínimo 4 linhas, só então a coluna rola) — o espaço entre os campos não muda.

## Tratamento: especialidades em quadros (2026-10-10)
Decisões do usuário: cada linha de especialidade vira um QUADRO (mesmo visual dos cartões de Salas/Grupos:
`.room-row.tl-row` com resumo + botão Editar; `#specRowsHost.room-list.tl-list`, `#specRowAdd` "+ Incluir especialidade").
A janela do quadro (`openTreatLineModal(ctx)`, camada própria `#tlHost` logo depois de `#modalHost`, ids `tlSpec`,
`tlHours`, `tlSvc`, `tlProf`, `tlAba`, `tlRoom`, `tlDia`, `tlHora`, `tlSem`, `tlSeg`, `tlObs`) tem: Especialidade, Sessões/mês,
Serviço (padrão Sessão), Profissional (Todos), ABA, Sala (Qualquer), Dia, Horário de início (vazios = qualquer),
Semanas (`TL_WEEKS`: Todas, 1ª e 3ª, 2ª e 4ª, 1ª…4ª), Sessões seguidas (1/2), Observação (só com serviço ≠ Sessão).
Mesma especialidade pode repetir. Base para o Planner se montar sozinho no futuro.
- Formato: `specHours = [{id, specId, hours, profId, aba, service, dia, hora, semanas, roomId, seguidas, obs}]`
  (`treatLines` normaliza e dá id às linhas antigas; `lineSvc`; "svc:<id>" antigo ainda é lido como serviço).
- **Atendimento → quadro**: `treatLineFor(lines, profId, service)` — mesmo serviço, especialidade principal do
  profissional primeiro (depois as complementares, na ordem): o quadro do próprio profissional, depois "Todos", depois
  outro; serviço ≠ Sessão sem quadro na área = o quadro com esse serviço. Usado em `bookingAbaOf`, `trMonthly`/
  `trMonthView`/`trPlannerCounts` (chave = id do quadro, `trLineKey`; `trSpecKey` saiu), relatório Pacote, `pkCompare`
  (Editar agendamento). `therapistMismatchMsg`: quadros da especialidade principal (ou da 1ª complementar com quadro)
  com o serviço; avisa só se nenhum é "Todos" nem do profissional. `lineLabel(r)` = "Psicologia · Acolhimento · Tiago".
- Avisos ao salvar o quadro (não bloqueiam): horário disponível do paciente (lê a tabela de horário da própria janela),
  horário de trabalho do profissional, clínica fechada no dia, semanas × sessões/mês × seguidas, sessões/mês ÷ seguidas,
  quadro repetido. Cobertura do convênio no cartão (especialidade e, fora de Sessão, o serviço).
- Trava (tratamento com Finalizados): `trQtyKey` só com Sessão/Mês e vencimento por sessões; `trLinesLockOk(antigos,
  novos)` exige que os quadros que existiam mantenham especialidade, sessões/mês e serviço. Na tela `ed.lock()` marca
  esses quadros (🔒) e a janela deles abre com esses 3 campos travados e sem Excluir; quadro novo sempre permitido.
- Também: `USAGE.salas` conta tratamentos com o quadro na sala; `USAGE.servicos` conta quadros com o serviço;
  `planTreatSpecs` sem repetir; `patientSpecSummary` mostra a sigla do serviço ("PS/AF 1").
- Testes: `tests/tl-helper.js` (`addLine(page, {spec, hours, svc, prof, aba, dia, hora, semanas, room, seguidas, obs}, editIndex)`,
  `lines(page)`) usado em run_registries, run_newfeatures, run_reg_add, run_convenios, run_aba_linha, run_treatments,
  run_treatment_history; teste próprio `tests/run_tr_quadros.js` (no `npm test`).
- Passo 1: migração só de dados `supabase/2026-10-10n-tratamentos-limpar-especialidades.sql` (limpa `specHours` de
  TODOS os tratamentos e as sobras em `patients/all`). Testada no PGlite.
- Produção (2026-10-10): `2026-10-10n` rodada (0 | 0 | 247 tratamentos).
- (2026-10-10, decisão do usuário) **Redistribuir sessões em tratamento com atendimento realizado:** as sessões/mês dos
  quadros que já existem podem mudar desde que a SOMA de todos os quadros fique igual (inclusive passando sessões para
  um quadro novo); especialidade e serviço continuam travados, Sessão/Mês também. `trLinesSum`, `trLinesHoursChanged`,
  `trLinesLockOk` (mesma especialidade/serviço e, se alguma quantidade mudou, mesma soma). Ao salvar uma
  redistribuição, confirmação "Redistribuir sessões" avisando que o contratado × realizado e o Pacote dos meses
  anteriores passam a usar a nova distribuição (o tratamento guarda só a quantidade atual). `#tlHours` não trava mais.
  Testes em `run_tr_quadros.js` e `run_treatment_history.js`.
- (2026-10-10, pedido do usuário) **Janelas de cadastro em grupos, no padrão do cadastro do paciente** (título azul em
  maiúsculas + linha entre os grupos). `.tr-sec` passou a ter esse visual (cor `--accent`, 13px); o 1º título da janela
  usa `.tr-sec.tr-sec-top` (sem linha). Grupos: **Tratamento** (Tratamento · Cancelamento `.tr-cancel-title` vermelho ·
  Convênio e valores · Pacote · Especialidades e serviços · Observações · Horário de atendimento · Contratado × realizado ·
  Histórico), **Plano Terapêutico** (Plano · Quadro clínico · Objetivos por habilidade · Evolução · Versões), **Evolução**
  (Objetivos trabalhados · Observações), **Clínica** (Dados da clínica · Aparência · Atendimento · Horário de atendimento;
  os cartões `#ovClinic .cl-card` viraram grupos sem caixa), **Salas/Grupos** (Sala/Grupo · Terapeutas), **Convênios**
  (Convênio · Especialidades e serviços cobertos), **Escalas** (Escala · Níveis), **CRM → Listas e status** (Lista ·
  Status), **Níveis de permissão** (Nível · Permissões, em `js/usuarios.js`). `.prof-section-head .prof-access-title` (títulos
  "Horário de atendimento", seções do Editar agendamento) no mesmo azul. Janela nova de cadastro com vários campos: usar
  `.tr-sec` (ou `.pm-sec`) nos grupos. Pacientes, Colaboradores e a tarefa do CRM já seguiam o padrão.

## Decisões do usuário para cadastro/retirada/CRM/link (2026-10-10)
Itens da revisão de campos repetidos que não foram respondidos NÃO devem ser alterados.
Ordem combinada: 1) Jornada semanal, 2) Retirada/medida protetiva, 3) CRM lead → paciente,
4) Link de cadastro rápido.
- **1. Colaborador sem "Jornada semanal"** (FEITO): saíram `#sf-jornada` e o aviso `#sfJornadaNote`;
  as horas vêm só do Horário de trabalho. O salvar apaga `jornada` de `staff.data`. Migração só de
  dados `supabase/2026-10-10o-colaborador-sem-jornada.sql`.
- **2. Retirada** (FEITO): Mãe/Pai não ficam gravados na lista; vêm da Filiação, com a caixa
  "Pode retirar o paciente" (`#pm-mae-retira`/`#pm-pai-retira`, marcada por padrão; desmarcada grava
  `mae.retira = false`). Resumo da Filiação em `#rotParents` (`rotParentsRender`). A lista `rotina` é só
  de outras pessoas `{nome, rel, telefone, doc}` (`.pm-ret`, `data-rk`); Mãe/Pai como "outra pessoa"
  (parentesco Mãe/Pai ou mesmo nome) é recusado ao salvar. Medida protetiva `{quem: "mae"|"pai"|"",
  nome, rel, obs, ate}`: `select[data-pk="quem"]` Outra pessoa / Mãe / Pai; Mãe/Pai mostram o nome da
  Filiação só leitura (`protResolve`, `protOut`, `PARENT_LABEL`). `patPickup` monta "podem retirar" =
  Mãe/Pai (com nome, `retira` ≠ false, Filiação visível e sem medida ativa) + outras pessoas (sem
  medida ativa), com telefone/documento no quadro da Agenda e na ficha. `patNormalize` converte o
  formato antigo (src mae/pai, `rotinaOff` → `retira: false`, medida com o nome da mãe/pai → `quem`);
  `rotinaOff` está em `PAT_LEGACY_KEYS`. Migração só de dados `supabase/2026-10-10p-retirada-pela-filiacao.sql`.
- **3. CRM** (FEITO): "Cadastrar paciente" leva os dados do lead ao cadastro e, ao salvar, a tarefa
  fica com `lead` vazio (só `motivoPerda`, se houver) e `crmLeadTreatment(pid, convênio)` grava um
  tratamento Ativo só com o convênio (resto em branco; sem `tratamentos.create`, avisa). Status da
  tarefa não muda. `tasks_history` registra `{campo: "paciente", de: nome do lead, para: patient_id}`
  ("cadastrou o lead “X” como paciente"). Migração `supabase/2026-10-10q-crm-lead-vira-paciente.sql`
  (gatilho + limpa leads de tarefas já ligadas a paciente).
- **4. Link de cadastro rápido** (FEITO): tabelas `intake_links` (token, kind novo|atualizacao|crm|geral,
  patient_id, task_id, nome, telefone, prefill, expires_at = 7 dias (geral não vence; um só geral
  ativo), used_at, canceled_at, reminded_at) e `intake_submissions` (data, status
  pendente|aprovado|descartado, result_patient_id). RLS: `intake_can()` = Administrador ou
  `pacientes.create`. Página pública **`cadastro.html`** (`/cadastro?t=token`, sem login): lê
  `/api/config` e chama as RPC `intake_form` / `intake_send` (security definer, anon; conferem o
  link; só as chaves conhecidas, até 300 caracteres; nome, telefone e consentimento obrigatórios; link
  geral até 40 envios por hora e cria lead novo no CRM, lista Atendimento, 1º status). A flag de sessão
  `pipo.intake` deixa só as funções marcarem `used_at`/`reminded_at`. `intake_remind()` (chamada pelo app
  uma vez por sessão) cria tarefa "Cobrar cadastro pelo link" para link sem resposta em 3 dias.
  Campos do formulário: nome, nascimento, CPF (válido), sexo, responsável + parentesco, telefone, e-mail,
  CEP (ViaCEP) e endereço, convênio, diagnóstico/suspeita, laudo, escola + turno, como conheceu, obs,
  consentimento LGPD (sem disponibilidade).
  App (bloco "Link de cadastro rápido" no fim do script): `INTAKE`, `intakeLoad` (pendentes + tempo
  real), `intakeBadge` (`#cadBadge` no botão Cadastros, `#intakeRevBtn` "Revisar cadastro" na tela
  Pacientes, número no grupo Cadastros do ☰ e ponto no `#mnavBtn`), `openIntakeLinkModal({kind,
  patient, task})` (Gerar link, Copiar, WhatsApp `wa.me/55…`, e-mail `mailto:`, Cancelar/Desativar),
  `openIntakeLinksList` (Links enviados), `intakePrefillFrom(p)` (Pedir atualização),
  `intakeToPatient(d)` → {patch, notes}, `intakeReview(sub)` (CPF igual a outro paciente = pergunta se é
  atualização), `intakeApplyReview` (aviso `.ik-banner` + "Descartar envio"; no existente, `.ik-diff`
  com "Usar enviado"/"Manter atual"; vazio já vem preenchido; telefone/e-mail novos entram na lista),
  `openIntakeReviewList`. Paciente novo aprovado = `crmLeadTreatment` com o convênio + liga a tarefa do
  CRM (se houver). Botões: Pacientes → Outras opções (Enviar link de cadastro, Link geral da clínica,
  Links enviados), janela do paciente (Pedir atualização, Revisar cadastro), tarefa do CRM (Enviar link
  de cadastro, `#crmSendLink`). Sem sistema online, tudo em `INTAKE.mem`. Migração
  `supabase/2026-10-10r-link-de-cadastro.sql`. Teste `tests/run_intake.js` (inclui a página pública
  com o Supabase simulado). Ajuda: tópico "link-cadastro".
- Produção (2026-10-10): `2026-10-10o` (0), `2026-10-10p` (0 | 0 | 0), `2026-10-10q` (0 | 1) e
  `2026-10-10r` (2 tabelas | 3 funções) rodadas.
- (2026-10-10, pedido do usuário) **Campos do link escolhidos em Campos obrigatórios**: a janela
  `openPatientFieldsModal` é UMA tabela (pedido do usuário) com as colunas Campo | Aparece | Link rápido
  (link do paciente) | Link fixo (link geral) | Obrigatório; Obrigatório vale no cadastro e nos links em que o
  campo aparece. `LINK_OF_FIELD` liga o campo do cadastro ao do link (`tr[data-pfk][data-lfk]`); `LINK_ONLY`
  (responsavel, convenio, laudo) fica no grupo "Só no link de cadastro" (`tr[data-lonly]`). No celular os
  títulos encolhem ("Obrig."). `LINK_FIELDS` (nome e telefone travados,
  padrão obrigatório: nascimento, CPF, responsável) e `linkFieldCfg(which, key)`; grava
  `config/patient_fields = {fields, link: {individual, geral}}` (`state.patientLink`). "Link do paciente"
  vale para Enviar link de cadastro, Pedir atualização e o link da tarefa do CRM. `cadastro.html` mostra só
  os campos que aparecem (`cfg`, `shown`, `required`; grupos responsavel = respNome+respParentesco,
  endereco = cep/numero/rua/compl/bairro/cidade/uf, obrigatório = cep, número, rua, cidade). Banco:
  `intake_form` devolve `campos`; `intake_send` recusa sem os obrigatórios (`motivo obrigatorio`, `campos`).
  Migração `supabase/2026-10-10s-campos-do-link.sql`. Mudou a lista de campos do formulário? Ajustar
  `LINK_FIELDS` no index.html, `cadastro.html` e as chaves de `intake_send`.
- Produção (2026-10-10): `2026-10-10s-campos-do-link` rodada (1 | 1).
- (2026-10-10, pedido do usuário) **Link do paciente vale 1 dia** (antes 7) e é **curto**: `/c/<10 letras e números>`
  (`intakeToken()` no app grava o `token`; `intakeUrl` = origem + `/c/` + token; `vercel.json` reescreve `/c/:t` para
  `/cadastro`, e `cadastro.html` lê o token do caminho ou do `?t=` antigo). O domínio continua o da Vercel (link mais
  curto que isso só com domínio próprio). Mensagem: "Olá! Para que possamos realizar seu agendamento, preencha por este
  link (vale 1 dia): …". Lembrete do CRM (`intake_remind`) sai quando o link VENCE sem resposta. Migração
  `supabase/2026-10-10t-link-vale-1-dia.sql` (links já enviados mantêm a validade).
- Produção (2026-10-10): `2026-10-10t-link-vale-1-dia` rodada (1 | 1).

## Redes sociais da clínica (2026-10-10)
Decisões do usuário: cadastro em Acesso → Clínica, grupo **Redes sociais** (rede + link, "+ Inserir", ▲▼, ✕;
"Outro" com nome e ícone de link); logos coloridas na cor de cada rede; aparecem na página do link de cadastro
(topo e agradecimento), na tela de login, no fim da mensagem do link (WhatsApp/e-mail) e no rodapé das impressões
(Relatórios, ficha do paciente, Plano Terapêutico). Sem rede cadastrada, nada aparece. Agradecimento do link (todos
os tipos): "Cadastro enviado! Obrigado. Nossa equipe irá continuar seu atendimento pelo WhatsApp." + "Conheça mais
sobre nosso trabalho em nossas redes sociais:" e as logos.
- **Banco de logos `js/redes.js`** (`window.PIPO_REDES`: `list` [{id, name, color, ph, g}], `icon(id, tam)` = SVG
  círculo na cor da rede + símbolo branco desenhado no arquivo, `url(item)` = endereço que abre — só http/https/mailto;
  WhatsApp aceita só o número → `wa.me/55…`; e-mail → `mailto:`, `label`, `clean(lista)`, `rowHtml(lista, {size,
  names})` (`.soc-row`/`.soc-link`, CSS injetado pelo próprio arquivo), `text(lista)` "Instagram: https://…"). Redes:
  instagram, facebook, youtube, tiktok, whatsapp, maps, site, linkedin, email, outro. Rede nova: só acrescentar na lista
  (e em `REDES` de `api/config.js`).
- Carregado por `index.html` (`<script src="/js/redes.js">` dentro do APP-HEAD; `tests/build.js` embute os scripts
  `/js/*.js` dos marcadores, porque a página de teste não serve a pasta js/), `cadastro.html` e a tela de login.
- Dados: `config/clinic.redes = [{rede, url, nome?}]` (sem SQL). `api/config.js` (`clinicInfo`) devolve `redes`
  (limpas, até 20) junto com `theme`, para o login e a página pública (que não têm acesso ao banco).
- App: janela `openClinicModal` (`#clSocs`, `.cl-soc`, `data-sk="rede|nome|url"`, `[data-socmv]`, `[data-socdel]`,
  `#clSocAdd` — a linha nova já vem com a próxima rede ainda não usada); salvar recusa link inválido.
  `clinicSocialText()` + `intakeMessage` ("\n\nConheça mais sobre nosso trabalho:\n…"); `printSocialHtml()` +
  `PRINT_SOC_CSS` no fim de `patientPrint`, `rpPrint` e `planPrint`. Login: `.pipo-login-soc` (`loginRedes` de
  `/api/config`). `cadastro.html`: `#cSoc` (topo) e o agradecimento (`socHtml()`).
- Ideias futuras com as redes (aguardando o usuário): assinatura de e-mail, rodapé de documentos novos, Início,
  mensagens automáticas do CRM.
- Teste `tests/run_redes.js` (no `npm test`) e checagens em `tests/run_intake.js`.
- (2026-10-10, pedido do usuário) **CRM: a 2ª coluna é sempre Tarefa.** Listas: Status, Tarefa, Paciente ou Lead,
  Convênio, Responsáveis, Vencimento, Prioridade; tela CRM e Minhas tarefas: Status, Tarefa, Lista, Paciente ou Lead…
  (`order` em `crmRender`). Celular: Status, Tarefa (título inteiro numa linha com "…"), Venc., Prio. — paciente/lead,
  lista, convênio e responsáveis ocultos. Na tela CRM do celular cada cartão de lista ocupa a largura da tela e desliza
  para o lado (`.crm-home-grid` com `scroll-snap` mandatory, cartão `flex:0 0 100%`).
- (2026-10-10, revisão de campos e listas) Listas de sugestões ao digitar (`.autolist`: Paciente ou Lead do
  CRM, paciente do agendamento no Planner/Agenda, convênio e especialidade do tratamento) flutuam por cima da
  janela (`autoAnchor`, `autoPlace`, `autoReplaceAll`; z-index 90): antes ficavam dentro da janela e aumentavam
  a rolagem. Teste `tests/run_autolist.js`. No celular, o painel de várias opções (`.ms-panel.ms-sheet`: Tipos e
  Serviços do colaborador) ficou igual às outras janelas de baixo (82% da tela, opções de 52px com linha,
  animação de subida).
- (2026-10-10, pedido do usuário) **Título nas telas de cadastro** ("não sei qual cadastro estou"): Pacientes,
  Tratamentos, Convênios, Motivos de cancelamento, Médicos, Escolas, Diagnósticos, Origens, Colaboradores, Tipos de
  colaborador, Especialidades, Serviços, CBO, Conselhos, Salas / Grupos de Suporte (troca com o botão), Feriados e
  recessos, Status, e os do Prontuário: Objetivos, Escalas, Habilidades. `.cad-title` (17px; celular 18px, `order:-10`,
  linha inteira). Teste `tests/run_cad_titles.js`.
- (2026-10-10, pedido do usuário) Campos obrigatórios: títulos das colunas presos no alto ao rolar a janela
  (`#ovPf .pf-table thead th` sticky, `top:-4px` = padding de cima do `.modal-body`). Teste em `run_intake.js`.
- (2026-10-10, pedido do usuário) **Página do link (`cadastro.html`) no padrão do sistema**: listas viram botão
  `.pk-btn` (select original oculto `.pk-native`, guarda o valor); no celular abrem a janela de baixo (`#pkSheet`:
  título do campo, ✕, opções de 52px), no computador flutuam coladas embaixo do campo (`#pkPop`, linhas entre itens,
  escolhido na cor da clínica, ↑ ↓ Enter, Esc); mais de 6 opções = busca. Data de nascimento digitável dd/mm/aaaa
  (`fmtDate`, `brToIso`: inválida ou futura = recusada) + botão de calendário (`openCalendar`, « ‹ › » ano/mês).
  Campos com 38px no computador e 44px no celular (16px). `pkOpen`, `enhanceSelect`, `pkClose`. Testes em
  `tests/run_intake.js`.
- (2026-10-10, pedido do usuário) `cadastro.html` no celular: TODO item de escolha abre a janela de seleção — a data
  fica só leitura (sem teclado, `inputmode=none`) e tocar abre o calendário na janela de baixo (o botão de calendário
  some); calendário com "Limpar" e lista de anos (tocar no "mês de ano ▾" → `.pk-cal-y`, 100 anos). No computador a
  data continua digitável + botão de calendário.
- (2026-10-10, pedido do usuário) Página do link (`cadastro.html`): as logos das redes aparecem SÓ no agradecimento
  (saiu a fila `#cSoc` do topo), com ícones de 28px (antes 34px). Login, mensagem e impressões continuam como estavam.

## ABA só nos quadros do tratamento (2026-10-10, SUBSTITUI o "ABA do tratamento" e o "ABA por linha" acima)
Decisões do usuário: o campo ABA único do tratamento (`#pAba`) saiu; o ABA fica só no quadro de cada especialidade.
Padrão **automático** (`abaAuto(p)`): **Sim** para todos, **Não** com nível de suporte 3 (`p.suporte` com "3", da
tabela de saúde) ou **17 anos ou mais** (`patientAgeYears`); pode ser trocado à mão no quadro. Antes de mudar, o usuário
conferiu a lista (`supabase/conferencia-aba.sql`, só leitura) e escolheu **manter o ABA antigo até criar os quadros**.
- `abaAntigo` no tratamento (TREAT_FIELDS também lê o `aba` antigo ainda não convertido — `abaLegacy(t)`). Vale só
  enquanto o tratamento NÃO tem nenhum quadro e é o padrão do 1º quadro (`abaNewLine` no `treatFieldsEditor`; sem ele,
  `abaAuto` do paciente do `#trPat`). O salvar grava `aba: undefined` e mantém `abaAntigo`.
- `bookingAbaOf(p, prof, serviço)`: sem quadros → `abaFallback` (antigo, senão automático); com quadros → o quadro do
  atendimento (`treatLineFor`) ou, sem quadro para ele, `abaAuto`. `bookingPatient` devolve o paciente com `_aba`.
  `patientAba(p)` (bolinha das listas, `patientIsNaoABA`, `patientColor`): `_aba` do atendimento; senão com quadros = Não
  só se TODOS forem Não; sem quadros = `abaFallback`. `trPatObj(t)` = paciente + saúde + campos de um tratamento
  (bolinha da lista de Tratamentos, `trAbaText`). Cartão/resumo do tratamento e coluna ABA mostram `trAbaText`.
- Limitação: o automático usa o nível de suporte da tabela de saúde; quem não vê "Pacientes – saúde" calcula só pela
  idade (só importa para atendimento sem quadro).
- Planilha de Tratamentos: coluna ABA saiu (planilha com ABA = coluna ignorada). Tratamento da migração passa o
  `abaAntigo` ao Ativo. CRM "Cadastrar paciente" não grava mais `aba`.
- Migração só de dados `supabase/2026-10-10u-aba-so-nos-quadros.sql`: `aba` → `abaAntigo` (vazio = Sim), quadro sem ABA
  recebe esse valor, fim das Observações ganha "ABA (antigo): Sim/Não", apaga `aba` dos tratamentos e de `patients/all`
  (testada no PGlite, 2 vezes e com CRLF; linha 88 em `conferencia-migracoes.sql`). Ajuda (tratamentos-terapeuta,
  pacientes). Testes: `run_aba_linha.js` (regra automática, padrão do quadro), `run_treatments.js`, `run_newfeatures.js`,
  `run_registries.js`, `run_planilhas.js`, `run_treatment_history.js`.
- Produção (2026-10-10): `2026-10-10u-aba-so-nos-quadros` rodada (0 | 0 | 162 Sim | 85 Não).
- (2026-10-10, pedido do usuário) **CRM: pesquisa na lista de Status** (janela da tarefa e lista): `crmStatusMenu` sempre com o
  campo `.crm-pop-q` "Pesquisar status…" (antes só no celular); no computador o campo já vem com o foco (`crmPop`), sem
  resultado mostra "Nenhum status encontrado" (`.crm-pop-none`), Enter escolhe o 1º. Teste em `run_crm.js`.

## Conector do Supabase (2026-10-10)
O usuário ligou um conector do Supabase: a sessão pode rodar SQL direto (`mcp__Supabase__execute_sql`, projeto
`gnieydlriercezqowpqe` = "clinicadeautismopipo", produção; `msnzsfwuxhjsmllqfiho` = "agenda-pipo-teste", inativo).
Consultas SÓ DE LEITURA (conferências) podem ser rodadas direto e o resultado relatado. Qualquer SQL que ALTERA dados ou
estrutura continua exigindo a confirmação do usuário antes (mostrar o script e perguntar) — é o banco de produção, com
dados de saúde. Nunca copiar dados reais de pacientes para arquivos do repositório.
- Primeira conferência pelo conector (2026-10-10): 10u confirmada (0 | 0 | 162 | 85); conferência de migrações 79 SIM e
  1 NÃO = 10m, porque 15 tarefas importadas do ClickUp (`created_by_name = 'ClickUp'`, chave `lead.clickup`) chegaram
  depois da 10m com nascimento/email/origem/responsavel no lead.
- (2026-10-10, pedido do usuário "leve os dados para descrição") 10m rodada de novo pelo conector nessas 15
  tarefas: os campos antigos saíram do lead; nada foi acrescentado porque os valores já estavam nas descrições.
  Conferência: 0 tarefas com campos antigos.
- (2026-10-10, pedido do usuário "quero permitir sempre") `.claude/settings.json` libera sem perguntar as ferramentas
  do conector Supabase (`execute_sql`, `list_tables`, `list_projects`, `get_project`, `list_migrations`,
  `list_extensions`, `get_advisors`, `query_logs`, `search_docs`). A regra acima continua: SQL que ALTERA dados ou
  estrutura só depois da confirmação do usuário no chat.

## Barras das telas: uma linha no computador, até 3 no celular (2026-10-10, REGRA FIXA do usuário para todo o sistema)
Busca, filtros e botões de cada tela: **computador numa linha só** (a partir de 1280px; entre 761 e 1279px no máximo 2
linhas e nunca passando da tela — busca, filtros e avisos encolhem com "…"); **celular no máximo 3 linhas abaixo do
título**. Bloco "Barras das telas" no fim do `<style>` (`index.html`). Teste fixo `tests/run_toolbar_rows.js` (no
`npm test`; mede todas as telas em 1280, 1440, 1024 e 390px) — tela nova com barra: acrescentar a aba em `TABS`.
- Celular: "Inativos" (e Cancelados/Renegociados em Tratamentos) fica na linha do título, à direita
  (`.pat-toolbar:has(> .cad-title) > .inact-toggle{order:-9}`; substitui o "Inativos na linha de baixo" de antes).
  Tratamentos = título+caixas / busca+status / contador, Opções, Incluir, ? (aviso "N pacientes sem tratamento" embaixo,
  só quando há). Plano Terapêutico = busca / filtro, contador, Incluir, ?. CRM = título+visualização / busca / 3 filtros /
  contador, Finalizados, Opções, ?. Visão geral = data, ‹ Hoje ›, ? / busca + profissional / especialidade, sala, status.
- Filtros 3 por linha no celular usam rótulo curto na opção vazia (Profissional, Especialidade, Sala, Status,
  Responsável, Prioridade, Vencimento — `vgFillFilters`, `crmFillFilters`; trocar a largura refaz).
- Planner: entre 761 e 1100px a barra quebra em 2 linhas (antes a 1024px o "?" saía da tela).
- (2026-10-10, pedido do usuário) Janela da tarefa do CRM: **Enviar link de cadastro** (`#crmSendLink`) e **Cadastrar paciente** (`#crmRegPat`) ficam no menu **Outras opções ▾** na linha do título "Dados do Paciente/Lead", à direita (`#crmMoreBtn`/`#crmMoreMenu`, `.crm-more-wrap`, mesmo padrão do menu do Tratamento, posição por `placeToolsMenu`); saíram da linha do título "Dados do Paciente/Lead". O menu some quando nenhuma opção vale (paciente cadastrado ou sem permissão; `crmMoreSync` em `whoRefresh`). Teste em `run_crm.js`.

## Revisão geral do sistema (2026-10-10)
Pedido do usuário: "verificação completa de todo o sistema… sempre pergunte tudo antes de fazer alterações".
Resultado (só leitura, pelo conector): banco igual ao `schema.sql`, todas as migrações aplicadas, 25 conferências de
integridade zeradas, 1.313 checagens dos testes OK, sem erros nos registros do banco, quem não fez login não lê dados.
Pontos encontrados e decisões do usuário (todas as correções aprovadas):
- **Backup não levava o CRM** (839 tarefas, 2.177 comentários/históricos), links de cadastro nem usuários. Agora
  `BACKUP_TABLES` inclui `tasks`, `task_events`, `intake_links`, `intake_submissions` (restaurar) e `profiles` (só
  consulta; `task_reads` fica de fora). `api/admin-backup.js` restaura essas 4 pela RPC `backup_restore_crm(p_table,
  p_rows)` (só service_role): marca `pipo.restore` na transação e os gatilhos `tasks_stamp`, `task_events_stamp`,
  `tasks_history`, `tasks_assignees_guard`, `tasks_recur`, `task_events_edit_guard`, `intake_links_stamp`,
  `intake_submissions_stamp` deixam passar o que veio (datas e autores originais, sem histórico novo). Usuário que não
  existe mais vira null (e sai de `assignees`/`mentions`); comentário de tarefa que não existe é pulado; link geral
  antigo volta cancelado se já há um ativo. Teste `tests/run_backup_api.js` (no `npm test`).
- `planner_backups` (cópia de 02/10, 40 linhas, sem uso) apagada.
- Segurança: EXECUTE das funções do `public` tirado de `public`/`anon` (ficam `intake_form`, `intake_send`,
  `intake_link_state` para a página do link); padrão novo: função criada pelo postgres NÃO nasce aberta para anon —
  função nova para a página pública precisa de `grant execute ... to anon` explícito. `search_path` fixo em
  `treatments_one_active`, `treatments_cancel_rules`, `module_for_path`, `crm_rec_next`, `intake_link_state`.
  A opção "senhas vazadas" do Supabase Auth é ligada pelo usuário no painel.
- Velocidade: 6 políticas com `(select auth.uid())` (clinical_records update/delete, profiles_select, task_events
  update/delete, task_reads_own).
- Tudo na migração `supabase/2026-10-10v-revisao-geral.sql` (testada no PGlite 2× com CRLF; linha 89 da conferência
  de migrações; `schema.sql` e `conferencia-geral.sql` atualizados).
- `conferencia-dos-dados.sql` atualizada (profissional `nome`, bloqueio `lock`, paciente pelo código).
- CPF do paciente: em produção já NÃO é obrigatório (`config/patient_fields.fields.cpf.req = false`).
- Dados a completar (planilha entregue ao usuário FORA do repositório): 96 pacientes ativos sem CPF; 11 tratamentos
  ativos incompletos (valor, Sessão/Mês, convênio, horário); 113 tratamentos ativos sem quadros (limpos em 10/10, a
  recadastrar); 341 atendimentos passados sem status (Agenda → Outras opções → Pendências / Status em lote; Finalizado
  não entra no lote, exige evolução).
- Produção (2026-10-10): 10v aplicada pelo conector em partes (funções 9/9 iguais ao schema, 0 funções abertas sem login,
  link de cadastro aberto, 5 caminhos de busca fixos, 6 regras rápidas — feitas com `alter policy`). FALTA só
  `drop table if exists public.planner_backups;` — o conector trava em comando que apaga (espera uma confirmação que
  não aparece); esse o usuário roda no SQL Editor. Dica: no conector, mudar regra com `alter policy` (não drop/create).
- (2026-10-10, pedido do usuário) Tela CRM no celular: um cartão de lista por vez, na largura da tela, deslizando para o
  lado (`.crm-home-grid` flex + scroll-snap); dentro do cartão o nome e, embaixo, UMA informação por linha (abertas /
  vencidas / comigo), com altura fixa de três linhas (`.crm-home-nums` em coluna, `min-height:64px`) para todos os
  cartões terem a mesma altura. (Os "três cartões por linha" foram testados e desfeitos.) Teste em `run_crm_mobile.js`.
- Produção (2026-10-10): `drop table planner_backups` rodado pelo usuário (copia_antiga = 0). Migração 10v completa.
- (2026-10-10, escolha do usuário: opção C da prévia) Cartões da tela CRM (computador e celular): números em DUAS
  colunas (`.crm-home-nums` grid 2): abertas | vencidas (vermelho), vencem hoje | urgentes (laranja `.urg`), comigo
  (em Minhas tarefas: menções não lidas, `CRM.unread`); zero apagado (`.zero`). Embaixo, faixa com as tarefas ABERTAS
  por status na cor do status (`.crm-home-strip`, mesmo nome = um pedaço) + legenda (`.crm-home-leg`). Só na lista com
  funil (`lead`): linha `.crm-home-extra` com leads sem cadastro (abertas sem `patient_id`), contratos no mês (status
  `done` sem `lost`, `closed_at` no mês) e perdidos no mês (`lost`). Celular continua um cartão por vez deslizando.
  Teste em `run_crm_mobile.js`.
- (2026-10-10, pedido do usuário) Cartões da tela CRM no celular com ALTURA FIXA e sem sobra: todos com a altura do
  cartão de conteúdo mais alto (`crmHomeRender` mede `scrollHeight` e grava `--crm-card-h` no `#crmHomeGrid`;
  `.crm-home-grid{align-items:flex-start}`). Legenda de status no máximo 2 linhas (`max-height:34px`); linha do funil
  numa linha só ("N leads sem cadastro · N contratos · N perdidos no mês", texto completo no `title`).

## Conector Claude — servidor MCP remoto (2026-10-10)
Pedido do usuário: o Claude (claude.ai/desktop) usa o sistema como conector personalizado, com as regras
e o histórico do sistema. Decisões: Edge Function (plano B Vercel); login OAuth do Supabase Auth com
registro dinâmico (novas conexões futuras), barrado pela página de autorização + permissão; só testes
locais; permissão própria **Conector Claude** (`conector_claude`, ver; grupo Menu Acesso).
- Função `supabase/functions/pipo-mcp/` (`app.ts` = servidor MCP SDK 1.25.3 sem estado, `index.ts` =
  entrada com supabase-js e o token DA PESSOA — nunca service role). Detalhes, publicação, roteiro de
  teste e como acrescentar ferramenta: `supabase/functions/pipo-mcp/README.md`.
- Migração `supabase/2026-10-10w-conector-claude.sql` (funções `security invoker`, `pipo_origem()`
  marca `{origem:"conector", app}` na atividade da tarefa e no `_upd` do paciente; `tasks_stamp` acerta
  `closed_at`; `mcp_calls` = registro; `mcp_permitido()` = permissão + 60 chamadas/min). Nada exclui;
  lotes até 50; toda alteração devolve antes/depois. Escrita só com `PIPO_MCP_ESCRITA=1`.
- Página `oauth-consent.html` (`/oauth/consent`, rewrite no `vercel.json`): login do sistema,
  confere `mcp_permitido`, Autorizar/Negar.
- App: “· via Claude” na atividade do CRM (`crmViaHtml`), tópico de Ajuda `conector-claude`.
- Teste local: `deno run -A --no-lock --config supabase/functions/pipo-mcp/deno.json supabase/functions/pipo-mcp/teste_local.ts` (30 checagens).
- Produção (2026-10-10): `2026-10-10w-conector-claude` rodada pelo conector em partes (1 | 1 | 15; 2 políticas;
  0 funções abertas sem login; closed_at coerente). `drop policy` no conector trava (pede confirmação): como a
  tabela era nova, as políticas foram criadas sem o drop. Painel OAuth configurado pelo usuário (servidor ligado, registro dinâmico, `/oauth/consent`, Site URL
  `https://sistemaclinicadeautismopipo.vercel.app`); página `/oauth-consent` conferida no ar. Função `pipo-mcp`
  publicada pelo conector (versão 1, `verify_jwt` false, SÓ LEITURA — `PIPO_MCP_ESCRITA` ainda não definida).
- (2026-10-10, pedido do usuário) Redes sociais SAÍRAM da tela de login (`js/pipo-supabase.js`: sem `.pipo-login-soc`/`loginRedes`).
  Continuam na página do link (agradecimento), na mensagem do link e nas impressões. `api/config.js` ainda devolve `redes`
  (a página do link usa).
- Produção (2026-10-10): conector "Clínica Pipo" ligado no Claude pelo usuário (registro automático/DCR) e testado
  (listar_listas, listar_tarefas OK; `mcp_calls` grava `app = "Claude"`). Escrita ligada pelo usuário (secret `PIPO_MCP_ESCRITA=1`, 2026-10-10).

## App instalável no celular (PWA) (2026-10-11)
Decisão do usuário: continuar com o site adaptado (sem app de loja) e torná-lo instalável.
- `manifest.webmanifest` (nome "Clínica de Autismo Pipo", `short_name` "Pipo", `display: standalone`, fundo branco)
  e ícones em `icons/` (192, 512, `maskable-512` e `apple-touch-icon` 180 com fundo branco e a logo ocupando ~82–91% do quadrado, como o ícone do Chrome; trocou o ícone = mudar o `?v=` no link e no manifesto e o `VERSION` do sw.js),
  gerados a partir do `favicon.png` (128px, ampliado — uma logo maior deixaria o ícone mais nítido). Metas
  `apple-mobile-web-app-*`, `theme-color` no `<head>` (dentro do APP-HEAD).
- `sw.js` (service worker, na raiz; `vercel.json` com `no-cache` para ele e o manifesto): guarda página + `js/` +
  ícones + supabase-js; abre com a cópia guardada e confere no servidor a página E cada `js/` (`refreshShell`: compara o
  texto; qualquer um mudou = guarda todos JUNTOS e avisa as abas com `pipo-update`). NUNCA guarda dados: `/api/`, Supabase,
  `/c/`, `/cadastro`, `/oauth` passam direto. Eventos `push`/`notificationclick` prontos para as notificações (etapa
  futura). Arquivo novo do sistema em `js/`: acrescentar em `SHELL` e trocar `VERSION`.
- Script depois de `js/pipo-supabase.js` (FORA dos marcadores; só registra em https): registra o `sw.js`, mostra a
  barra "Nova versão do sistema disponível — Atualizar / Agora não" (`#pwaUpdate`, z-index acima do login) — na tela de
  login (sem ninguém logado) recarrega sozinho; vale para `pipo-update` e para `controllerchange` (sw.js novo assumiu), pede conferência ao voltar para o
  app (`visibilitychange`), `window.pipoInstallApp` (pedido de instalação do Android/computador ou abre a Ajuda),
  `window.pipoIsInstalled`. Menu Acesso → **Instalar app** (`data-act="instalar"`, some quando já aberto pelo ícone).
  Ajuda: tópico `instalar-app` (`window.pipoOpenHelpTopic`).
- (2026-10-11, pedido do usuário) Tela de login: logo + nome da clínica + subtítulo embaixo do nome ("Clínica
  Multidisciplinar"), depois E-mail e Senha (saiu a frase "… — entre com seu e-mail e senha"). Nome e subtítulo vêm do
  cadastro da Clínica (`config/clinic.nome`/`subtitulo`, entregues por `api/config.js` em `clinica`; `loginBrand` em
  `js/pipo-supabase.js`), senão o padrão.
- (2026-10-11, pedido do usuário) Cartões da tela CRM no celular sem espaço vazio embaixo e com altura fixa igual:
  legenda dos status sempre com o espaço de 2 linhas (`.crm-home-leg{height:34px}`); no cartão do funil a linha de
  leads/contratos/perdidos ocupa o lugar da 2ª linha da legenda (legenda 16px, `.crm-home-extra` 20px sem borda). Altura
  = 176px. Teste em `run_crm_mobile.js` (sobra embaixo ≤ 18px nos cartões com tarefas).

## Notificações no celular/computador (2026-10-11)
Decisões do usuário: tarefas vencidas = 1 resumo por dia às 8h (Brasília), segunda a sexta, para cada
responsável (só listas em que ele tem acesso; status que finaliza não conta); @menção = na hora, só para quem
foi mencionado (o autor não recebe) e tem acesso à lista; cada pessoa liga no PRÓPRIO aparelho em
**Acesso → Notificações** e escolhe Vencidas / Menções.
- Banco (migração `supabase/2026-10-11-notificacoes.sql`, testada no PGlite): `push_subscriptions` (um por
  aparelho, RLS: cada um só os seus; `prefs {vencidas, mencoes}`), `push_config` (senha interna + chaves VAPID,
  sem acesso pelo app), `push_call` (pg_net → função), gatilho `task_events_push` (comentário com menções; não no
  restaurar), `push_mention_targets`, `push_overdue_counts` (só service_role), pg_cron `pipo-push-vencidas`
  (`0 11 * * 1-5`). Envio pela Edge Function `pipo-push` (`supabase/functions/pipo-push/`, ver README).
- App (bloco "Notificações" depois de `window.pipoOpenHelpTopic`): `openNotifModal` (`window.pipoOpenNotif`,
  `#ovNotif`, `#nfOn`/`#nfOff`/`#nfTest`, caixas `[data-nf]`), `notifEnable`/`notifDisable`/`notifState`;
  **Sair** desliga o aparelho (`window.pipoNotifSignOut` em `js/pipo-supabase.js`). iPhone sem o app instalado =
  a janela pede para instalar (`pipoNotifAvailable` mostra o item). Tocar na menção abre `/?tarefa=<id>#crm`
  → `notifOpenFromUrl()` (chamado no fim de `applyPermissionsUI`) abre a tarefa. sw.js `pipo-v5`.
  Ajuda: tópico `notificacoes`. Teste `tests/run_notif.js`.
- (2026-10-11, pedido do usuário) Página do link: no link geral (permanente) o campo Nome começa em branco, com
  o texto de ajuda "Digite o nome completo do paciente" (`nomeInicial` em `cadastro.html`). Antes vinha o nome
  interno do link ("Link geral"). Um nome que já veio do cadastro continua; "Link geral/permanente/fixo" nunca.
- (2026-10-11, pedido do usuário) **Campos do link: todos podem ser escolhidos** em Campos obrigatórios, inclusive
  Nome e Telefone (antes travados) nas colunas Link rápido e Link fixo. Obrigatório continua UMA coluna (vale no
  cadastro e nos links em que o campo aparece); no cadastro o Nome segue obrigatório. O envio precisa da autorização e
  de pelo menos nome, telefone, CPF ou e-mail (`motivo "vazio"`). Configuração antiga sem nome/telefone no link = os
  dois obrigatórios. Migração `supabase/2026-10-11b-link-campos-escolhidos.sql` (`intake_send`). Lead do link geral
  sem nome: título com o telefone/e-mail.
- (2026-10-11, pedido do usuário) **CRM: filtro de Status** em toda tela do CRM (`#crmFSt`, classe `.crm-fst`, antes de
  Responsável): opções = status da lista aberta; em Minhas tarefas e na tela CRM, os de todas as listas visíveis (mesmo
  nome = uma opção; valor = `normText(nome)`; `crmFillStatus`, `crmStKey`, `crmFilters().st`). Status escolhido mostra
  também as finalizadas; no Quadro fica só a coluna dele. Celular: Status na linha da busca. Filtros com rótulo curto em
  todo tamanho (Status, Responsável, Prioridade, Vencimento); no computador a busca encolhe antes dos filtros.
- (2026-10-11, pedido do usuário) **Verificação de português** pelo conector Supabase (só leitura): cadastros quase
  sem erros (só "Cordenação" em Tipos de colaborador e 2 nomes de paciente com espaço duplo); no CRM ~570 textos com
  acento faltando ou digitação errada. Decisões: corrigir títulos, descrições E comentários, só palavras com um único
  jeito certo (as/às, esta/está, pais/país, analise… ficam), e marcar Nome e Telefone obrigatórios no cadastro e nos
  dois links. Migração só de dados `supabase/2026-10-11c-correcoes-de-texto.sql` (lista de palavras, palavra inteira,
  mantém maiúsculas, não mexe em e-mail/site; `pipo.restore` = sem linhas novas no histórico das tarefas; texto antigo
  em `public.correcoes_texto_2026_10_11` para desfazer — pode ser apagada depois). Testada no PGlite.
- Produção (2026-10-11): `2026-10-11-notificacoes` rodada (1 | 1 | 1 | 1); `2026-10-11b` rodada (1); função
  `pipo-push` publicada pelo conector (verify_jwt false) e testada pelo banco (devolveu a chave pública).
- (2026-10-11, pedido do usuário) **Minhas tarefas sem o filtro Responsável** (são todas da pessoa): `#tab-crm.crm-mine-view`
  esconde `#crmFWho` (e zera o valor); o Status fica na linha dos filtros, no lugar dele (no celular a busca volta à
  linha toda). Nas listas e na tela CRM o Responsável continua.
- Produção (2026-10-11): `2026-10-11c-correcoes-de-texto` rodada (o SQL Editor mostrou "Load failed", mas a conferência
  pelo conector confirmou: 569 textos guardados em `correcoes_texto_2026_10_11`, "Cordenação" 0, nomes com espaço duplo 0,
  Nome/Telefone obrigatórios no cadastro e nos links). A tabela de cópia pode ser apagada depois.
- (2026-10-11, pedido do usuário) Aviso "Nova versão do sistema disponível" (`#pwaUpdate`): texto na 1ª linha e
  Atualizar / Agora não dividindo a 2ª linha com a mesma largura (`flex:1 1 0`); aviso com `min(420px, 100vw − 32px)`.

## Link de cadastro: todos os campos do paciente; profissão da mãe/pai (2026-10-11)
Decisões do usuário: parentesco do responsável Mãe, Pai, Avó, Avô, Tia, Tio, Padrasto, Madrasta, Outro (`PARENTESCOS` em
`cadastro.html`); Mãe/Pai → Filiação (com a profissão), os outros → Telefones (nome + "(parentesco)", WhatsApp) e ele é o
responsável financeiro; convênio = cadastrados + Particular + Outro ("Qual convênio?" `convenioOutro`), vai para a observação
e, se cadastrado, também para o tratamento; profissão em todos os lugares; **todo campo do cadastro pode ir no link**.
- Paciente: `mae`/`pai` = {nome, cpf, profissao, retira}; campo `#pm-<role>-prof` na Filiação, `parentNow`, ficha, planilha
  de Pacientes (`maeProf`/`paiProf`), Mesclar completa CPF/profissão.
- `LINK_FIELDS` ganhou os demais campos com `off: true` (começam fora; `linkFieldCfg` sem configuração = `show: !off`) e
  `LINK_OF_FIELD` cobre todos os `PAT_FIELDS` (médico = chave de link `medico`). Campos obrigatórios mostra Link rápido/Link
  fixo em toda linha.
- `cadastro.html`: `OFF`, `GROUP`/`GROUP_REQ` (mae→maeNome, pai→paiNome, financeiro→finNome…), seções Mãe, Pai, Responsáveis
  pela retirada e Medida protetiva (listas `.lrow`, "+ Incluir pessoa", até 10 → `retirada`/`protetiva`), Responsável
  financeiro (`finNome/finDoc/finTelefone/finEmail`), Saúde, Escola, Rotina atual (`rt-<dia>-<m|t>` + `-txt` →
  `rotinaAtual`); `respProfissao` só aparece com Mãe/Pai quando os campos da mãe/do pai não estão no link (`data-when`).
- `intakeToPatient` mapeia tudo; revisão de paciente existente: `intakeApplyReview` compara também RG, CNS, saúde, escola,
  mãe/pai (CPF/profissão) e financeiro; retirada/protetiva novas entram na lista e a rotina completa os vazios
  (`openPatientModal`, `intakeAdded`). `intakePrefillFrom` (Pedir atualização) leva os campos novos, menos a medida protetiva.
- (pedido do usuário, SUBSTITUI o "Responsável e parentesco" acima) O grupo **Responsável e parentesco** saiu do link
  (`LINK_ONLY` = convênio, laudo): no lugar, Contato com **De quem é este telefone?** (`telNome` → nome do contato do
  telefone) e, no Responsável financeiro, **Quem é o responsável financeiro?** (`finQuem` Mãe/Pai/Outra pessoa, só com
  mãe ou pai no link; Mãe/Pai liga o financeiro à Filiação e esconde nome/CPF). `intakeToPatient` ainda entende
  `respNome`/`respParentesco` de envios antigos. O banco ignora `responsavel` em configurações antigas.
- Banco: `supabase/2026-10-11d-link-todos-os-campos.sql` (`intake_send` aceita as chaves novas, listas e rotina com limite e
  confere os obrigatórios novos). Testada no PGlite. Teste em `tests/run_intake.js`.
- Produção (2026-10-11): `2026-10-11d-link-todos-os-campos` rodada (`funcao_nova = 1`).

## Cadastro de Fornecedores (2026-10-11)
Pedido do usuário: "Crie um cadastro de fornecedores dentro de cadastros". Campos escolhidos por padrão (o usuário não
detalhou): Nome / Razão social (`name`), Nome fantasia, CNPJ ou CPF (`documento`), Categoria (texto livre), Pessoa de
contato, Telefone, E-mail, Endereço, PIX / dados bancários e Observações.
- Cadastros → **Fornecedores** (`#tab-fornecedores`, `REG_CFG.fornecedores`, `SIMPLE_LISTS.fornecedores` → documento
  `config/suppliers {list:[…]}`, `state.suppliers`, permissão `fornecedores` ver/incluir/editar/excluir), logo depois de
  Conselhos em `CAD_ITEMS`/`CAD_TABS`; título `cadTitleText`. Lista: Nome (+ nome fantasia), Categoria, CNPJ / CPF,
  Telefone, E-mail; celular = Nome + Categoria. Busca por nome, fantasia, categoria, documento (com ou sem pontuação) e contato.
- Campo de documento na janela genérica: `fields[].doc` → máscara (`formatDoc`: CPF até 11 dígitos, CNPJ 14) e conferência
  dos dígitos verificadores (`docValido`, `cnpjValido`, `cpfValido`) em `readRegFields`. Repetido = mesmo documento
  (`supplierDocDigits`) ou, sem documento, mesmo nome (`dupKey`). Sem "Inativar" (nada no sistema usa o fornecedor ainda).
- Migração `supabase/2026-10-11e-fornecedores.sql`: caminho em `documents_path_valid`, `module_for_path`
  (`config/suppliers` → `fornecedores`, mantendo `search_path`), níveis começam com o acesso de Convênios. Testada no
  PGlite (2×, CRLF). Linha 95 de `conferencia-migracoes.sql`; `schema.sql` e `conferencia-geral.sql` atualizados.
- Ajuda: tópico `fornecedores`. Teste `tests/run_fornecedores.js` (no `npm test`); `run_cad_titles`, `run_toolbar_rows`,
  `run_sticky_headers` e `run_cad_sheets` incluem a tela.
- Ideias ainda não feitas (aguardando o usuário): categoria como cadastro próprio com "+ Incluir", planilha de
  importar/exportar, ligar fornecedor a contas a pagar/despesas.

## Link de cadastro: "Possui diagnóstico?" / "Qual diagnóstico?" (2026-10-11)
Pedido do usuário: "Tem laudo?" virou **Possui diagnóstico?** (Sim/Não, chave `laudo`) e, com Sim, aparece **Qual diagnóstico?**
(chave `diagnostico`) como lista dos diagnósticos cadastrados (Cadastros → Diagnósticos, "código nome", sem os inativos)
+ **Outro** no fim, SEM nenhum escolhido por padrão; com Outro aparece "Qual?" (`diagnosticoOutro`, só da página: o envio
leva o texto digitado em `diagnostico`). Não → `diagnostico` vai vazio. Aberto por `data-when` "diag-sim"/"diag-outro"
(`whenSync`). A revisão grava `Possui diagnóstico: Sim/Não` na observação e o diagnóstico em `cid`. `intake_form` devolve
`diagnosticos`; migração `supabase/2026-10-11f-link-diagnosticos.sql` (só essa função; linha 96 da conferência de migrações;
testada no PGlite). Teste em `tests/run_intake.js`.
- Produção (2026-10-11): `2026-10-11f-link-diagnosticos` rodada (`funcao_nova = true`; o link entrega 41 diagnósticos). A `2026-10-11e-fornecedores` ainda NÃO foi rodada (caminho não aceito, 0 níveis).

## Diagnósticos só pelo nome (2026-10-11)
Pedido do usuário: nas listas de escolha aparece SÓ o nome do diagnóstico, em ordem alfabética pelo nome (não mais "F84.0 Autismo
infantil" ordenado pelo CID); no cadastro o nome e o código CID são campos separados (janela: Diagnóstico, depois Código (CID); lista:
Diagnóstico, Código (CID), Pacientes). `diagLabel(d)` = nome; o paciente (`cid`) e o lead do CRM guardam o NOME. Texto antigo
"código nome" ainda é reconhecido por `diagMatch(d, texto)` (contagem de uso, opção marcada). O formulário do link recebe só os
nomes (`intake_form`). Migração `supabase/2026-10-11g-diagnostico-so-nome.sql`: função do link + troca "código nome" por "nome"
em `patient_health.cid` e `tasks.lead.diagnostico` (só quando é exatamente um diagnóstico cadastrado; testada no PGlite 2×; em
produção 2 saúdes a trocar, 0 leads). Linha 97 da conferência de migrações.
- Produção (2026-10-11): `2026-10-11e-fornecedores` rodada (`true | true | 6`). A `2026-10-11g-diagnostico-so-nome` ainda NÃO foi rodada.
- Produção (2026-10-11): `2026-10-11g-diagnostico-so-nome` rodada pelo conector, a pedido do usuário ("por que você mesmo não envia o SQL?") — resultado `0 | 0 | true`. Daqui em diante, SQL que altera o banco pode ser rodado pelo conector quando o usuário pedir ou autorizar; sem pedido, continua valendo mostrar o script e esperar.

## Link de cadastro: Escola e Médico da lista, com "Outra/Outro" (2026-10-11)
Pedido do usuário: no link, Escola e Médico mostram os cadastrados (Cadastros → Escolas / Médicos, sem os inativos) + **Outra**
(escola) / **Outro** (médico); com a opção, abre "Nome da escola" / "Nome do médico" para digitar (`escolaOutro`, `medicoOutro`,
`data-when` `esc-outro`/`med-outro`). O envio leva o texto digitado em `escola`/`medico`. Sem nenhum cadastrado, o campo continua
texto livre. Na revisão (`intakeToPatient`) o nome que não está no cadastro vira aviso "digitada pela família — confira o nome e
inclua em Cadastros". `intake_form` devolve `escolas` e `medicos` — migração `supabase/2026-10-11h-link-escolas-medicos.sql`
(testada no PGlite; linha 98 da conferência de migrações). Teste em `tests/run_intake.js`.
- Produção (2026-10-11): `2026-10-11h-link-escolas-medicos` rodada (`funcao_nova = true`).

## Convênio no cadastro do paciente (2026-10-11)
Decisões do usuário: convênio, plano, nº da carteirinha e validade no cadastro do paciente; tratamento novo já vem com o
convênio e o plano do cadastro (pode trocar no tratamento); mudar o convênio/plano do cadastro com tratamento Ativo
PERGUNTA se aplica ao tratamento ativo; Guia/autorização ficam para depois da parte financeira.
- Grupo **Convênio** (`PAT_SECTIONS`, depois de Responsável financeiro). Chaves PRÓPRIAS no paciente — `convenioPadrao` (id),
  `planoPadrao`, `carteirinha`, `carteirinhaValidade` — para não se misturar com `convenio`/`plano` do tratamento
  (`TREAT_FIELDS`, somados ao paciente em `state.patients`). `patConvDefault(p)`, `patCardState(p)`/`patCardChip(p)`
  (vencida ou vence em até 30 dias; etiqueta na lista de Pacientes, só no computador).
- `openTreatmentModal`: tratamento NOVO sem cópia usa o padrão do cadastro (vence o convênio antigo do paciente); renegociar
  continua copiando o tratamento anterior. Dica `#trConvHint` sob o Convênio (cadastro, carteirinha, aviso de validade, "usa
  outro convênio").
- `offerApplyConvenio(antigo, novo)` (depois de salvar o paciente): só com tratamento ativo diferente e `tratamentos.edit`;
  "Aplicar ao tratamento" grava convênio/plano e uma entrada `acao: "convenio"` no histórico; "Só no cadastro" não mexe.
  Tratamentos antigos nunca mudam sozinhos.
- Link: `convenioPadrao` ↔ link `convenio` (o convênio cadastrado vira o do paciente; "Outro"/"Particular" ficam na
  observação); novos campos do link `plano`, `carteirinha`, `carteirinhaValidade` (começam fora; `cadastro.html` aceita
  validade no futuro). `LINK_ONLY` = só `laudo`. Pedir atualização leva os quatro. Planilha de Pacientes ganhou as colunas
  Convênio, Plano, Nº da carteirinha e Validade. CRM: lead com convênio cadastrado vira `convenioPadrao` ao cadastrar paciente;
  `crmConvName` cai no convênio do cadastro. Ficha impressa tem o grupo Convênio.
- Migração `supabase/2026-10-11i-convenio-no-paciente.sql` (`intake_send` aceita as chaves novas + copia o convênio/plano do
  tratamento Ativo, ou mais recente, para o paciente que ainda não tem; testada no PGlite 2×; linha 99 da conferência de
  migrações; `schema.sql` e `conferencia-geral.sql` atualizados). Teste `tests/run_convenio_padrao.js` (no `npm test`).
- Ideias futuras (aguardando o usuário): Guia/autorização (nº, sessões autorizadas, saldo, validade, ligadas ao tratamento),
  relatório "Pacientes por convênio", aviso na Agenda quando o convênio não cobre a especialidade, troca de convênio em lote.

## CRM: Mover tarefa, barra mobile e ordenar visível (2026-10-11)
Pedidos do usuário.
- **Outras opções ▾ no topo da janela da tarefa** (`#crmTopBtn`/`#crmTopMenu`, dentro de `.modal-head-acts`, canto superior direito, ao lado do ✕;
  só em tarefa já salva, com "editar" e outra lista onde dá para editar — `crmMoveDests`). Item **Mover tarefa** → `crmMoveDialog(task)`
  (`#ovMove`: lista de destino, status na nova lista, avisos). `crmMoveStatusFor(origem, statusId, destino)`: mesmo id ou mesmo nome = mantém
  (aviso verde); senão a janela diz que a lista não tem o status e sugere o equivalente (perda → perda, encerra → encerra, demais → o primeiro que
  não encerra). Responsáveis sem acesso à lista nova saem; recorrência sai se a lista nova não permite (`crmRecAllowed`). Grava
  `crmUpdate(id, {list_id, status, assignees?, recurrence?})`; o gatilho `tasks_history` já registra `campo: "lista"` (e `crmMemHistory` no teste).
  O "Outras opções" de Dados do Paciente/Lead (Enviar link / Cadastrar paciente) continua onde estava.
- **Barra do CRM no celular**, de cima para baixo: 1) Lista / Quadro / Calendário (+ Tarefa ao lado); 2) busca + Status; 3) Responsáveis,
  Prioridade, Vencimento (em Minhas tarefas só Prioridade e Vencimento); 4) título da lista, Finalizados, Opções e ?. O contador (`#crmCount`)
  fica oculto no celular (SUBSTITUI "Status na linha dos filtros" de Minhas tarefas).
- **Ordenar ▲▼ sempre visível** no título de todas as colunas das tabelas do CRM (`#crmHost .pat-table thead th`): o texto do título
  (`.th-label`) é que encurta com "…" (`max-width: calc(100% - 22px)`); no celular as colunas Venc. e Prio. ficam com 94px/66px (a regra que
  escondia o botão saiu). Testes: `tests/run_crm.js` (Mover tarefa, ordenar), `tests/run_crm_mobile.js` (linhas da barra, ordenar), `run_toolbar_rows.js`.
- (2026-10-11, pedido do usuário) Filtro **Responsável** (`#crmFWho`) do CRM também só lista quem tem acesso: na lista aberta, quem vê o CRM e essa lista (`crmCanAssign`); em Minhas tarefas/tela CRM, quem vê o CRM. Menus de responsável da tarefa já seguiam a regra.

## Financeiro — Fase 1: base (2026-10-11)
Decisões do usuário: financeiro no regime de **caixa**; a planilha `Financeiro_Pipo.xlsx` é de UMA unidade (dois CNPJs existem, o projeto
"Unidades / nível de organização" fica para depois do financeiro); **sem tela de Unidades por enquanto** — a conta bancária tem o campo "CNPJ da
empresa" (texto) e lançamentos/empréstimos/plano vão se ligar à CONTA; quando houver o cadastro de Unidades, esse campo vira ligação. Permissões novas
começam SÓ para o Administrador (nenhum nível recebe). Fase 0 (limpeza da planilha) fechada: saldos de 01/01/2026 Viacredi 208.724,77, Bradesco
945.549,97, Caixa 106.644,22 (total 1.260.918,96); DRE × FLUXO conferidos de jan a ago.
- Cadastros → **Categorias de fornecedor** (`#tab-catfornecedor`, `REG_CFG.catfornecedor`, `config/supplier_categories`, permissão
  `categorias_fornecedor`), **Contas bancárias** (`#tab-contas`, `REG_CFG.contas`, `config/bank_accounts` {id, name, tipo Banco|Caixa|Cartão|Outra,
  banco, cnpj, agencia, numero}, permissão `contas_bancarias`) e **Plano de contas** (`#tab-planocontas`, `REG_CFG.planocontas`,
  `config/chart_accounts` {id, name = subcategoria, categoria, tipo Receita|Despesa|Entrada|Saída, convenioId}, permissão `plano_contas`). Grupo novo no
  menu Cadastros depois de Fornecedores: Categorias de fornecedor | Contas bancárias, Plano de contas | Salas…
  `PLANO_TIPOS`, `planoTipoNorm` (aceita plural: Despesas, Saídas). Receita/Despesa entram no resultado (DRE); Entrada/Saída não (sócios,
  empréstimos, aplicações, transferências, repasses). Chaves de aba: `catfornecedor`, `contas`, `planocontas`.
- **Saldo inicial protegido**: tabela `public.bank_account_finance (account_id pk, saldo_inicial, data_saldo)` com RLS por permissão
  **Financeiro – valores** (`financeiro_valores`, ver/editar). Na janela da conta, grupo "Saldo inicial" (`extraHtml`/`extraWire`) só para quem vê;
  `finLoadAccounts`, `finSaveAccount`, `FIN.acc`; sem sistema online (testes) fica em `saldoInicial`/`dataSaldo` na conta. Atenção: agência/conta/CNPJ
  ficam no documento `config/bank_accounts`, legível por qualquer usuário ativo (só o saldo é protegido). Backup inclui `bank_account_finance` (optional).
- Ganchos NOVOS no cadastro genérico (`REG_CFG`): campo de lista `fields[].select` (array ou função; `regAdd` = cadastro com "+ Incluir"; `empty` =
  texto da opção vazia; valor atual que não está na lista é mantido) e `extraHtml`/`extraWire`({read, apply, after})/`onDelete` na janela.
- **Fornecedores**: a Categoria virou lista de Categorias de fornecedor (com "+ Incluir"); `supplierCatNames`, `supplierCatUse`, `supplierKey`.
- **Planilhas** (Outras opções ▾ nas telas Plano de contas e Fornecedores): `ioListPlan`/`ioListApply` genéricos (chave decide novo/atualiza; célula vazia
  não apaga), `IO_PLANO` (chave = subcategoria; Convênio pelo nome), `IO_FORNEC` (chave = CNPJ/CPF ou nome; categoria nova entra em Categorias de fornecedor).
- Migração `supabase/2026-10-11j-financeiro-base.sql` (caminhos, `module_for_path`, tabela protegida, semeia as 67 subcategorias revisadas — 19 receitas
  ligadas a convênios — e as 3 contas com o saldo de 01/01/2026; roda de novo sem estragar; testada no PGlite com CRLF e RLS; linha 100 da conferência
  de migrações; `schema.sql` e `conferencia-geral.sql` atualizados). Ajuda: tópicos `catfornecedor`, `contas-bancarias`, `plano-de-contas` e
  Fornecedores. Teste `tests/run_financeiro_base.js` (no `npm test`).
- Próximas fases (aguardando o usuário): lançamentos (importar o FLUXO), contas a pagar/receber, empréstimos, relatórios (fluxo de caixa e DRE
  calculados dos lançamentos), conciliação; depois o projeto Unidades.
- Produção (2026-10-11): `2026-10-11j-financeiro-base` rodada pelo conector, a pedido do usuário ("Pode rodar") — 67 subcategorias | 3 contas | saldo total 1.260.918,96 | 4 políticas na tabela protegida.

## Financeiro — Fase 2: Lançamentos (2026-10-11)
Decisões do usuário: **dois valores** por lançamento (Valor = o que entra no saldo e na DRE; Valor do extrato = o que passou no banco,
para conferir); importar o FLUXO por planilha (com prévia, nada duplica); permissão própria **Financeiro** (ver/incluir/editar/excluir,
`financeiro`; nenhum nível recebe, só o Administrador); entrega = lançamentos + saldo por conta (fluxo de caixa e DRE calculados ficam
para a Fase 3). O saldo de cada conta da planilha (aba DRE) = saldo inicial + Σ sinal × **Valor** (não o Valor Extrato) — conferido mês a mês.
- Menu do topo **Financeiro ▾** (`#finBtn`/`#finMenu`, `FIN_ITEMS`/`FIN_TABS`, depois do CRM; com uma opção só vira o botão "Lançamentos";
  grupo "Financeiro" no ☰ do celular) → tela `#tab-lancamentos` (aba `lancamentos`, endereço `#lancamentos`, bloco "Financeiro: Lançamentos"
  no fim do script: `FL`, `flLoad`, `flSaveRow`, `renderLancamentos`, `openLancamento`, `flOnShow`). Filtros mês (padrão = o mais recente
  que tem lançamentos, até a pessoa escolher), conta, tipo e busca; cartões de resumo (`.fl-sum`): receitas, despesas, resultado, outras
  entradas/saídas, "Valor ≠ extrato" e **saldo de cada conta** ao fim do mês filtrado (só com `financeiro_valores`.ver; `flBalances`,
  `flOpening`). Tabela `gtRender` "lancamentos": Descrição, Data, Conta, Subcategoria, Categoria, Tipo, Valor (com sinal, vermelho/verde),
  Extrato; celular = Descrição, Data, Valor.
- Janela do lançamento (`#ovFl`): Conta e Subcategoria são listas de cadastro com "+ Incluir" (`data-reg-add="contas"`/`"planocontas"`),
  data, descrição, valor sempre positivo (**o sinal vem do tipo da subcategoria**: Receita/Entrada somam, Despesa/Saída subtraem — `flSign`),
  data/valor do extrato, observações; lançamento igual (conta+data+descrição+valor) pede confirmação; Excluir com `confirmDialog`.
- Conta ou subcategoria com lançamentos não é excluída: Inativar (`USAGE.contas`, `USAGE.planocontas`).
- Banco: tabela `public.finance_entries (id uuid, account_id, data, descricao, plan_id, valor ≥ 0, data_extrato, valor_extrato, obs,
  origem_key único, created/updated_at/by)` com RLS `has_perm('financeiro', view/create/edit/delete)`, gatilho `finance_entries_stamp`,
  tempo real. Migração `supabase/2026-10-11k-financeiro-lancamentos.sql` (testada no PGlite com RLS; linha 101 de
  `conferencia-migracoes.sql`; `schema.sql` e `conferencia-geral.sql` atualizados). Backup inclui `finance_entries`
  (`BACKUP_TABLES`, `api/admin-backup.js`).
- Planilha (Outras opções ▾, `IO_KINDS.lancamentos`, `ioFlPlan`/`ioFlApply`): colunas da aba FLUXO — Conta, Descrição, Data, Valor,
  (Tipo, Categoria: só conferem), Sub-Categoria, Data Extrato, Valor Extrato, Observações. Conta e subcategoria vêm pelo nome (sem
  acento/maiúscula); desconhecida = "Com problema". Identidade = conta|data|descrição|valor|subcategoria + nº da repetição
  (`flSig`; linhas idênticas no mesmo dia contam como várias): já existe = Igual (ou Atualizar se só o extrato/observação difere);
  importar de novo não duplica. Grava em lotes de 200.
- Permissão **Financeiro** em Níveis de permissão (`MODULES` nos dois js, grupo "Financeiro" antes de "Menu Acesso";
  `allModules()` põe as linhas do CRM antes dele). Ajuda: tópico `lancamentos` (grupo "Financeiro").
- Correção junto: `finCanSee`/`finCanEdit` do saldo inicial (Fase 1) se chamavam como as do Relatório financeiro e as sobrescreviam;
  agora `bankCanSee`/`bankCanEdit`.
- Teste `tests/run_lancamentos.js` (no `npm test`); `run_cad_titles`, `run_toolbar_rows`, `run_sticky_headers` e `run_cad_sheets`
  incluem a tela.
- Próximas fases: fluxo de caixa e DRE calculados dos lançamentos, contas a pagar/receber, empréstimos, conciliação; depois Unidades.
- (2026-10-11, pedido do usuário) **Os cadastros que envolvem o financeiro moveram-se para o menu Financeiro ▾**: Lançamentos | Fornecedores,
  Categorias de fornecedor | Contas bancárias, Plano de contas (`FIN_ITEMS`/`FIN_TABS`; saíram de `CAD_ITEMS`/`CAD_TABS`). Mesmas telas, abas
  (`fornecedores`, `catfornecedor`, `contas`, `planocontas`), permissões e endereços; Ajuda no grupo "Financeiro". Cadastro financeiro novo:
  colocar em `FIN_ITEMS`. Convênios continua em Cadastros.
- Produção (2026-10-11): `2026-10-11k-financeiro-lancamentos` rodada pelo conector, autorizada pelo usuário ("Sim"). O script inteiro estourou o tempo do conector (60 s) sem criar nada; foi aplicado em 3 partes (tabela e índices | função, gatilho e 4 políticas | tempo real). Conferido: tabela, RLS ligada, 4 políticas, gatilho, tempo real, função fechada para anon. Falta o usuário importar `lancamentos-fluxo-2026.xlsx` e conferir os saldos mensais com a aba DRE.
- (2026-10-11, correção) **Importar planilha no iPhone não concluía**: a cópia de segurança baixada antes de gravar abria a visualização do arquivo e a página parava (0 lançamentos gravados). Agora a cópia só é baixada quando há dados a guardar (`K.exportRows().length`) e fora do celular (`isMobileView()`); a gravação roda sempre. Vale para todas as importações (`ioOpenImport`).
- Produção (2026-10-11): FLUXO 2026 importado pelo usuário (2.206 lançamentos, 02/01 a 31/08/2026, 0 sem subcategoria). Saldo de fim de mês das 3 contas (jan–ago) conferido pelo conector: os 24 valores batem com a aba DRE da planilha (Viacredi 27.343,66, Bradesco 138.359,41, Caixa 128.201,70 em 31/08). Próxima fase: fluxo de caixa e DRE calculados dos lançamentos.

## Financeiro — Demonstrativos: Fluxo de caixa, DRE e Lançamentos (2026-10-12, Etapa 1)
Decisões do usuário (prévia aprovada, `previa-financeiro`): a janela do menu Financeiro se chama **Demonstrativos** e tem três
botões, nesta ordem: **Fluxo de caixa** (abre por ele), **DRE** e **Lançamentos** (a lista de antes). Sem seletor "Valores em";
Exportar fica dentro de **Outras opções**; DRE modular com visões salvas com nome; clicar num valor leva a Lançamentos
filtrado (faixa + Voltar); comparação com o mês anterior ou com um mês de referência (padrão = o mais recente), em %, R$ ou nos dois.
- A aba continua `lancamentos` (`#tab-lancamentos`, endereço `#lancamentos`, permissão `financeiro`); item do menu e título "Demonstrativos".
  Bloco "Financeiro: Demonstrativos" logo antes de `USAGE.contas`: `DM` (estado; `DM.view` = flu|dre|lan, configurações guardadas em
  `agendaPipo:demSettings`), `demBuildIndex` (soma por subcategoria×mês e saldos por conta, refeito a cada desenho), `demColumns`
  (ano mês a mês / trimestres / um mês; coluna "previsto" só no Fluxo do ano = média dos 3 últimos meses), linhas `demFluxoLines` /
  `demDreLines` (`fn(ms)` por linha), `demRowHtml`, `demNote` (comparação), gráficos `demChartDre` / `demChartSaldo` (saldo dia a dia, real +
  previsto), `demAlerts` (categoria de despesa >15% acima da média; valor ≠ extrato), `demChanges`, `demGo` / `demOpenFilter` (abrem Lançamentos
  com `FL.dm` = {tit, chips, plans, ms, ext, back}; `flFiltered` obedece), `demStripRender`, editor de visões, `demMenuHtml`, `demExportXlsx`, `demPrint`.
- Toda a tela passa por `renderLancamentos()` (decide por `DM.view`); `demSyncBar()` mostra/esconde os controles com a classe `dem-off`
  (nunca `hidden`: os seletores viram `.dp-btn`). Saldo (inicial/final, por conta, gráfico) só com **Financeiro – valores**.
- Receita/Despesa entram no DRE; Receita/Entrada e Despesa/Saída no Fluxo de caixa (mesma regra do saldo das contas).
- Visões do DRE: `config/dre_views {list:[{id, name, cats:[“categoria|tipo”], open}]}` (`SIMPLE_LISTS.visoesdre`, `state.dreViews`); salvar/excluir
  segue a permissão Financeiro (incluir/editar/excluir). Migração `supabase/2026-10-12-demonstrativos.sql` (caminho permitido + `module_for_path`;
  linha 102 de `conferencia-migracoes.sql`; `schema.sql` e `conferencia-geral.sql` atualizados). SQL rodado em produção pelo conector em 2026-10-12, a pedido do usuário (caminho aceito = true, função = true).
- Teste `tests/run_demonstrativos.js` (no `npm test`); `run_lancamentos.js` passa pelo botão Lançamentos. Ajuda: tópico `lancamentos` (Demonstrativos).
- Próximas etapas combinadas: **E2** fechamento de mês (permissão "Fechamento de mês"; reabrir qualquer mês com aviso de que o saldo dos meses
  seguintes muda; mês reaberto edita todos os campos), resumo mensal em PDF; **E3** custo e receita por atendimento.
- Regras de custo por atendimento decididas (E3, ainda não construída): custo do slot = remuneração mensal ÷ slots disponíveis do mês (13 por dia útil);
  custo de equipe por atendimento = custo do slot do terapeuta ÷ pacientes DELE no horário + custo do slot do apoio (coordenador/aplicador ABA) ÷ todos os
  pacientes das salas que ele cobre; demais custos (fixos, variáveis, não profissionais, impostos — vindos dos Lançamentos — e outros) por hora de sala ocupada,
  divididos entre os pacientes presentes; ociosidade de equipe e de sala à parte; matriz convênio × especialidade; contar todas as sessões agendadas.
  Antes: campo "Natureza do custo" no Plano de contas e sugestão de classificação das subcategorias.
- (2026-10-12, pedido do usuário) Cartões da tela CRM no computador: dividem TODA a largura (`.crm-home-grid` com `auto-fit`, antes `auto-fill` deixava espaço vazio à direita) e ficam compactos como no celular (padding 12/14, legenda com espaço fixo de 2 linhas, no funil a linha de leads/contratos no lugar da 2ª linha — regras saíram do `@media` do celular e valem para os dois).
- (2026-10-12, pedido do usuário) Barra de Tratamentos no celular em 3 linhas: título + Cancelados + Renegociados (12,5px, título encolhe com "…") / busca + status / contador (mín. 90px, "…") + Opções + Incluir + ?. Aviso "N pacientes sem tratamento" embaixo.
- (2026-10-12, pedido do usuário: "quando atualizo a página em CRM vai para Minhas tarefas") A lista aberta do CRM fica no endereço: `navHashKey` devolve `crm-home`, `crm-mine` ou `crm-<lista>` (as chaves de `CRM_ITEMS`) e `crmRender` chama `navSaveHash`; o F5 volta para a mesma lista. Endereço antigo `#crm` continua abrindo (Minhas tarefas).

## Financeiro — Demonstrativos separado de Lançamentos; largura da tabela (2026-10-12, pedido do usuário)
- Menu Financeiro ▾ (ordem): **Lançamentos**, **Demonstrativos**, Fornecedores, Categorias de fornecedor, Contas bancárias, Plano de contas.
  **Substitui** a seção de Etapa 1 que dizia que Lançamentos era um dos botões: agora são DUAS telas. `#tab-lancamentos` (aba `lancamentos`) é só a
  lista de antes (busca, mês, conta, tipo, + Incluir, Outras opções = exportar/importar planilha e Fechamento de mês, `#flMenu`); `#tab-demonstrativos`
  (aba `demonstrativos`, endereço `#demonstrativos`, permissão `financeiro`) tem os botões **Fluxo de caixa | DRE** e a barra própria (`#demSearch`, ano,
  período, mês, conta `#demAcc`, visão, comparação, referência, `#demModo`, Outras opções `#demMenu`). A conta (`FL.acc`) é compartilhada.
  Clicar num valor chama `demGo` → vai para Lançamentos (`demGoTab`) com `FL.dm` e a faixa `#demStrip`; **Voltar** volta à tela Demonstrativos.
  Funções novas: `renderDemonstrativos`, `demOnShow`, `demRefresh` (redesenha a tela de financeiro aberta), `demWireMenu`, `flMenuHtml`.
- Largura da tabela do Fluxo/DRE: `table-layout:fixed`, `<colgroup>` — coluna de linhas `--df` (230px; 150px no celular), a de tendência
  `--dt = clamp(120px, 14%, 360px)` (cresce quando sobra espaço) e as demais (meses, previsto, total) dividem igualmente o resto; `min-width` =
  `--df + n × 104px + 120px` (abaixo disso rola para o lado).
- Ajuda: tópicos `lancamentos` e `demonstrativos`. Testes: `run_demonstrativos.js`, `run_lancamentos.js` (cada um abre a sua tela).

## Financeiro — Demonstrativos, Etapa 2: Fechamento de mês e Resumo mensal (2026-10-12)
Decisões do usuário: mês fechado trava incluir/editar/excluir/importar lançamentos (vale para todos, inclusive Administrador); **qualquer mês** pode
ser reaberto, com aviso de que o saldo dos meses seguintes muda (e confirmação); mês reaberto edita todos os campos (sem lançamento de ajuste);
fechar/reabrir por permissão em Níveis de permissão; resumo mensal em PDF. **Anotações (comentários) nas células foram pedidas e DEPOIS REMOVIDAS pelo usuário (2026-10-12): não existem no Fluxo nem no DRE.**
- Permissão **Fechamento de mês** (`fechamento_mes`, grupo Financeiro; ver = histórico, incluir = fechar, excluir = reabrir; `MODULES` nos dois js e
  `PERM_MODULE_LABELS`). Nenhum nível recebe: só o Administrador até liberar. Quem vê o Financeiro vê os meses fechados (cadeado).
- Banco (migração `supabase/2026-10-12b-fechamento-de-mes.sql`; linha 103 de `conferencia-migracoes.sql`; `schema.sql` e `conferencia-geral.sql` atualizados):
  `finance_closings (ym pk, closed_at, closed_by, closed_by_name)` (só leitura direta; escrita pelas funções `finance_close_month(p_ym)` e
  `finance_reopen_month(p_ym, p_motivo)`, que conferem a permissão), `finance_closing_log` (histórico: fechou/reabriu, quem, quando, motivo),
  e o gatilho `finance_entries_lock` (recusa insert/update/delete — e mudar a data para dentro — de lançamento em mês fechado com
  `PIPO_MES_FECHADO:aaaa-mm`; restauração sem usuário passa). `fcErrMsg` traduz o erro.
- App (bloco "Demonstrativos, etapa 2" depois do bloco de Demonstrativos): `FC` (estado), `fcLoad`, `fcCan`, `fcIsClosed`, `fcDateClosed`, `openFechamento(ym)`
  (janela: mês, situação, pendências = valor ≠ extrato com "estou ciente", aviso de saldo ao reabrir com saldo inicial dos meses seguintes, motivo, histórico),
  cadeado (`DEM_LK`) no cabeçalho do mês e na data dos lançamentos, janela do lançamento em leitura quando o mês é fechado, salvar/importar recusam mês fechado,
  alerta "mês ainda não foi fechado" (só para quem pode fechar).
  Resumo mensal: `openResumoMensal` → `fcFigures` (todas as contas) + `fcResumoHtml` + `demPrintFrame` (KPIs com variação, gráfico 6 meses, DRE resumido,
  fluxo e saldo por conta, o que mais mudou, pendências, situação do mês).
- Teste: `tests/run_demonstrativos.js` (fechar, reabrir com aviso, histórico, trava no app, importação, resumo, permissões; sem campos de anotação).
- Produção (2026-10-12): rodado pelo conector, a pedido do usuário, em partes — tabelas, políticas, `finance_close_month`, `finance_entries_lock`, publicação; o conector trava em comando com `delete`/`drop`, então o usuário rodou no SQL Editor a função `finance_reopen_month`, o gatilho `finance_entries_lock` com `delete` e a remoção de `finance_notes` (conferência `true | true | true`). Migração completa em produção.

## Financeiro — Demonstrativos, Etapa 3: Custo por atendimento (2026-10-12)
Terceiro botão de Demonstrativos (**Custo por atendimento**, `data-dv="cus"`), um mês por vez. Decisões do usuário: a **categoria do Plano de contas**
já define a natureza do custo (nenhum campo novo "Natureza do custo"): Despesas com Funcionários = equipe; Despesas Fixas; Despesas Variáveis; Imposto;
Despesas Financeiras ficam FORA do custo por atendimento (mostradas à parte); qualquer outra despesa = como fixa. **Equipe**: o que foi PAGO no mês
em Despesas com Funcionários (Lançamentos) é dividido entre os colaboradores pela **remuneração cadastrada** (Colaboradores – valores; quem está sem
remuneração entra com a média e é listado); a parte de quem não é Profissional vai para o rateio por hora de sala. Custo do slot = parte da pessoa ÷
slots disponíveis no mês (horário de trabalho × horários da clínica, sem feriados; usa o maior entre disponíveis e usados). Terapeuta: slot ÷ pacientes
DELE no horário; apoio (coordenador/aplicador ABA agendados num Grupo de Suporte com a sala): slot ÷ todos os pacientes da sala no horário. Demais
custos (fixos, variáveis, impostos, outras e pessoal que não atende) por hora de sala ocupada, divididos entre os pacientes da sala-hora. Conta TODAS as
sessões agendadas (qualquer status). Receita por convênio = Lançamentos de receita com `convenioId` no Plano de contas, dividida entre as
especialidades pelas sessões (receita sem convênio ligado e financeira ficam à parte); impostos vêm dos Lançamentos (valor mensal).
- Código (bloco "Demonstrativos, etapa 3" depois do bloco de fechamento): `cuClassOf`, `cuAvailSlots`, `cuCompute(ym, appts, pays)` (puro; devolve pools,
  pessoas, itens por atendimento, `bySpec`, `byConv`, `matrix`, `byN`, ociosidade, conciliação, avisos), `cuLoadAppts` (Agenda do mês), `cuLoadPays`
  (`staff_pay`), `cuRender`/`cuHtml` (cartões, "De onde vem o custo", Por especialidade, Por convênio, matriz convênio × especialidade com resultado por
  sessão, custo por nº de pacientes no horário, ociosidade de equipe), `cuExportXlsx`, `cuPrint`. Menu: Exportar Excel, Imprimir/PDF, Atualizar os dados,
  Fechamento de mês. Sem a permissão "Colaboradores – valores" a tela explica e não calcula; para quem só vê a própria agenda os números ficam parciais.
- Sem SQL. Teste `tests/run_custo.js` (no `npm test`, junto com `run_demonstrativos.js`).
- (2026-10-12, pedidos do usuário) **Financeiro no celular**: cartões de resumo (Lançamentos e Demonstrativos) numa fileira que desliza com um pedaço do próximo cartão à mostra (escolha B do usuário: `.fl-card` 42% da largura, `scroll-snap`, sem barra de rolagem); barra de Lançamentos em 3 linhas abaixo do título (busca / mês, conta, tipo / contador com "…", + Incluir, "Opções", ?); data curta dd/mm/aa na lista (`.pm-lg`/`.pm-sm` em `#reg-lancamentos-host`); gráficos dos Demonstrativos com desenho mais estreito e letras maiores no celular (`demFz`, `W`/`H`/margens por `isMobileView()`); Plano de contas no celular só Subcategoria e Tipo.

## Financeiro — Contas a pagar e a receber (2026-10-12)
Pedido do usuário: "Meta e alerta de saldo baixo", "Contas a pagar e a receber", "Empréstimos" e "Conciliação com o extrato", nesta
ordem de entrega: **2 (contas) → 1 (saldo mínimo) → 3 → 4** (cada um usa o anterior). Este bloco é o item 2.
Decisões do usuário: cadastro à parte + **Baixar** (a conta vira Lançamento; Lançamentos continuam sendo só o que aconteceu);
recorrência mensal + parcelas; previsão = contas cadastradas e, onde faltar, a média dos 3 últimos meses; mesma permissão **Financeiro**.
- Menu Financeiro ▾ → **Contas a pagar e receber** (2º item, `#tab-pagar`, aba `pagar`, endereço `#pagar`, `FIN_ITEMS`/`FIN_TABS`,
  `tabModule.pagar = "financeiro"`). Bloco "Contas a pagar e a receber" no script, antes de Demonstrativos: `FP` (estado: `rows`, filtros
  `st` aberta|vencida|paga|"", `tipo`, `ym`, `q`), `fpLoad`, `fpSave`, `fpInsertMany`, `fpDelete`, `fpSettle`, `fpKind` (Receita/Entrada = receber,
  Despesa/Saída = pagar, pelo tipo da subcategoria), `fpStatus`, `fpLabel` (descrição + “(i/n)”), `fpAddMonths` (mês curto = último dia),
  `renderPagar`, `openConta`, `openBaixa`, `pagarOnShow`, `wirePagar`. Sem sistema online tudo fica em memória (`FP.rows`, e a baixa cria em `FL.rows`).
- Tabela `public.finance_payables (id, vencimento, descricao, plan_id, account_id, supplier_id, valor, entry_id → finance_entries on delete set null,
  grupo, parcela, parcelas, obs, carimbos)` com RLS `has_perm('financeiro', …)`; sem `entry_id` = em aberto. Função **`finance_payable_settle`**
  (security invoker: cria o lançamento e liga, numa transação; precisa de incluir lançamento e editar conta; mês fechado barra pelo gatilho
  `finance_entries_lock`). Apagar o lançamento reabre a conta (`flDeleteRow` também zera `entry` em `FP.rows`). Migração
  `supabase/2026-10-12c-contas-a-pagar-e-receber.sql` (testada no PGlite com RLS e CRLF; linha 104 de `conferencia-migracoes.sql`;
  `schema.sql` e `conferencia-geral.sql` atualizados). Backup inclui `finance_payables` (`BACKUP_TABLES`, `api/admin-backup.js`).
- Repetição só ao incluir: “Todo mês” + quantas contas ao todo (2–60), todas com o mesmo `grupo`. Editar/excluir uma conta de grupo: caixa
  “Aplicar também às próximas contas em aberto” (`#fpNext`). Conta paga é só leitura (**Desfazer baixa** apaga o lançamento).
- **Previsto do Fluxo de caixa** (`demForecast(col)`, chamado em `demColumns`): por subcategoria, soma das contas em aberto com vencimento até o fim
  do mês previsto (as vencidas entram nele); sem conta cadastrada na subcategoria, média dos meses-base. O resultado é gravado em `DM.ix.plan` como se
  fosse um mês real e `demVal` usa `line.fn(col.ms)` quando `col.inj`. Gráfico de saldo: contas no dia do vencimento + média espalhada pelo desenho
  dos dias do último mês (`demDaily(ym, only)`). Texto: `demForecastText`. Alerta “N contas vencidas em aberto” (leva à tela com o filtro Vencidas).
- Conta bancária e subcategoria que têm contas a pagar/receber viram **Inativar** (`USAGE.contas`, `USAGE.planocontas`). Ajuda: tópico
  `contas-pagar-receber`. Teste `tests/run_pagar.js` (no `npm test`); `run_cad_titles`, `run_toolbar_rows`, `run_sticky_headers` e `run_cad_sheets` incluem a tela.
- Fornecedor apagado deixa a conta com o fornecedor em branco (`fpSupName`); ainda não há Inativar para fornecedor.
- (2026-10-12, pedido do usuário) **Duas telas, uma tabela**: Financeiro ▾ tem **Contas a pagar** (`#tab-pagar`, ids `fp*`) e **Contas a receber**
  (`#tab-receber`, ids `fr*`), ambas sobre `finance_payables` (sem mudança no banco). A tela vem do tipo da subcategoria (`fpKind`): Despesa/Saída = pagar,
  Receita/Entrada = receber. `FP.f[pagar|receber]` guarda situação/mês/busca de cada tela; `fpScr()` = tela aberta, `fpId(k, nome)` = id do elemento,
  `renderContas(k)` (`renderPagar()` = a da tela aberta). Pagar: coluna Fornecedor, botão “Pagar”, cartões A pagar/Vencidas/Vence em 7 dias; subcategorias
  só despesas e saídas. Receber: coluna Convênio (o convênio ligado à subcategoria no Plano de contas, `fpConvName`), botão “Receber”, cartões
  A receber/Atrasadas/Vence em 7 dias, subcategorias só receitas e entradas, sem campo Fornecedor. Saiu o filtro de tipo e o cartão “Resultado previsto”,
  que foi para o Fluxo de caixa (cartão “Contas em aberto: resultado”). Alertas do Fluxo separados (vencidas a pagar / atrasadas a receber), cada um leva
  à sua tela com o filtro Vencidas/Atrasadas. Mesma permissão **Financeiro** nas duas; permissão separada por tela só se pedirem.

- (2026-10-12, item 1 do pedido: Meta e alerta de saldo baixo) **Saldo mínimo por conta bancária** (`saldoMinimo` no item de `config/bank_accounts`, campo
  "Saldo mínimo" no grupo "Alerta de saldo baixo" da janela da conta; só aparece/edita com **Financeiro – valores**; vazio = sem alerta). `smProject()` (bloco
  "Saldo mínimo e alerta", antes de `renderContas`): por conta com mínimo, saldo de hoje (`flBalances(hoje)`) + contas a pagar/receber EM ABERTO daquela conta
  (`acc`) até o fim do horizonte (as vencidas contam hoje); menor saldo, 1ª data abaixo do mínimo, saldo final; contas em aberto sem conta bancária prevista
  não entram (`sem`, avisado). Horizonte `smHorizon()`: **Até o fim do mês** ou **Próximos 30 dias** (seletor `[data-sm-h]` dentro do quadro, lembrado em
  `agendaPipo:saldoHorizonte`). Quadro `smHtml()` (`.sm-box`, vermelho `.sm-low` quando alguma conta fica abaixo) no Fluxo de caixa (antes dos gráficos) e nas
  telas Contas a pagar / Contas a receber (`#fpAlert` / `#frAlert`); só com `bankCanSee()`. A média dos meses anteriores NÃO entra (só o que está cadastrado).
  Sem SQL. Teste no fim de `tests/run_pagar.js`.
- (2026-10-12, pedido do usuário) **Vincular conta a um lançamento que já existe** (sem criar lançamento): botão **Vincular a um lançamento…** (`#fpLink`) na janela da conta em aberto
  → `openLinkEntry(p)`; na janela do lançamento a caixa **Conta a pagar / a receber** (`#flLinkBox`: ligada ou "Vincular a uma conta em aberto…" `#flLinkBtn` →
  `openLinkPayable(e)`; `#flUnlinkBtn`); conta paga ganha **Desvincular** (`#fpUnlink`, mantém o lançamento; **Desfazer baixa** continua apagando). Lista de escolha `fpPickModal`
  (busca, "Mais parecido" marcado); `fpScore(p, e)` (subcategoria +3, valor/extrato igual +3, data ≤3 dias +2/≤15 +1, descrição contida +1), `fpEntryCands`, `fpPayCands`,
  `fpSuggest(p)` (≥6 e ≤15 dias: banner `.fp-sugg` "Parece que esta conta já foi paga" com `#fpSugg`), `fpLinkSet(payId, entryId|"")` (recusa lançamento já ligado). Mês fechado
  não vincula/desvincula pelo lançamento. Migração `supabase/2026-10-12d-um-lancamento-uma-conta.sql` (índice único parcial em `entry_id`; linha 105 da conferência de migrações; schema
  atualizado; o app funciona antes dela).

## Financeiro — Rateio das contas e Empréstimos (2026-10-12, pedido do usuário)
Decisões do usuário: **Empréstimos** = tabela única e duas telas (tomados / concedidos), igual a Contas a pagar/receber; tipos de juros **Simples, Composto, Price e SAC**; **Composto** = montante
capital × (1 + taxa)ⁿ dividido em n parcelas IGUAIS; **taxa ao mês**; o cadastro gera as parcelas como contas (com prévia editável). **Rateio**: uma conta a pagar/receber pode ter várias
subcategorias (ex.: parcela = principal "Pagamento de Empréstimos" Saída + juros "Juros" Despesa financeira; liberação do tomado = "Empréstimos Recebidos" Entrada, sem ser receita). Em duas entregas:
- **Entrega 1 (feita): rateio.** `finance_payables.linhas` jsonb `[{plan, valor}]` (≥2 partes; vazio = subcategoria única `plan_id`; `plan_id` = 1ª parte, `valor` = soma; todas as partes na mesma direção:
  pagar = Despesa/Saída, receber = Receita/Entrada). `fpLines(r)` devolve sempre a composição. Janela da conta: grupo "Composição do valor" (`#fpSplitBox`, "Dividir em subcategorias…" `#fpSplitOn`, linhas
  `.fp-ln`, "+ Parte" `#fpSplitAdd`, "Voltar para uma subcategoria só"); valor = soma, subcategoria única travada. Baixa (`openBaixa`): valor por parte (`.fpb-ln-val`), sem extrato →
  `fpSettleSplit` → RPC `finance_payable_settle_split(p_id, p_acc, p_date, p_linhas [{plan, valor, desc}], p_obs)` (um lançamento por parte, todos com `finance_entries.payable_id`; `entry_id` = 1º).
  Desfazer baixa (`fpUndoSettle`) apaga todos os lançamentos com `pay === conta` (ou o ligado). `fpUsedEntries` conta os `pay`; conta com rateio não oferece vínculo com lançamento. Previsto do Fluxo
  e `USAGE.planocontas` leem as partes. Lista mostra "Rateio (N)". Migração `supabase/2026-10-12e-rateio-das-contas.sql` (testada no PGlite; linha 106 da conferência; `schema.sql` e
  `conferencia-geral.sql` atualizados). Backup: `linhas` entra; `finance_entries.payable_id` NÃO é restaurado (evita chave estrangeira circular). Testes no fim de `tests/run_pagar.js`.
- **Entrega 2 (feita, 2026-10-12): Empréstimos.** Menu Financeiro ▾ → **Empréstimos tomados** (`#tab-emptomados`, aba `emptomados`, ids `lt*`) e
  **Empréstimos concedidos** (`#tab-empconcedidos`, aba `empconcedidos`, ids `lc*`), logo depois de Contas a receber (`FIN_ITEMS`/`FIN_TABS`, `tabModule`
  = `financeiro`, `cadTitleText`, ajuda `emprestimos`). Tabela única `public.finance_loans` (sentido tomado|concedido, descricao, contraparte, account_id, valor,
  tipo simples|composto|price|sac, taxa ao MÊS em %, parcelas, liberacao, primeiro_venc, obs; RLS `financeiro`) e `finance_payables.loan_id`. Migração
  `supabase/2026-10-12f-emprestimos.sql` (também semeia no Plano de contas “Pagamento de Empréstimos” Saída, “Recebimento de Empréstimos” Entrada e “Juros de
  Empréstimos Concedidos” Receita/Receita Financeira; testada no PGlite; linha 107 da conferência de migrações; schema e conferência geral atualizados; backup
  inclui `finance_loans` e `loan_id`). Bloco “Financeiro: Empréstimos” antes de Demonstrativos: `LN`, `lnSchedule(tipo, P, taxa%, n, venc1)` (simples = flat; composto
  = montante P(1+i)ⁿ em parcelas iguais; price = PMT; sac = amortização constante; centavos fecham na última parcela), `lnBuildPayables` (liberação = parcela 0 sem
  “i/n”; parcela k com rateio principal + juros), `openEmprestimo` (prévia de parcelas EDITÁVEL antes de salvar — vencimento/principal/juros —, aviso se o principal
  não soma o valor), `lnStats`/`lnTotalBalance` (saldo devedor = principal da 1ª linha do rateio das parcelas em aberto), `lnDeleteLoan` (recusa se há conta
  baixada; apaga as abertas). Empréstimo salvo: valor/juros/parcelas travados (só descrição, credor/tomador, conta e observações mudam). Tomado: liberação = conta a
  RECEBER em Empréstimos Recebidos (Entrada, não é receita), parcelas a PAGAR (Pagamento de Empréstimos + Juros); concedido: o inverso. O Fluxo de caixa ganhou os
  cartões “Saldo devedor de empréstimos” e “Empréstimos a receber”. Ao procurar um input melhorado (data) pela classe, usar `input.<classe>`. Teste
  `tests/run_emprestimos.js` (no `npm test`).
- Produção (2026-10-12): `2026-10-12f-emprestimos` rodada pelo conector (tabela | RLS | 4 políticas | loan_id | 3 subcategorias = true | true | 4 | true | 3).
- Próximos: **Conciliação com o extrato** e a revisão de capitalização (“Contas a Receber”) em todo o sistema.

## Autorização permanente para rodar SQL (2026-10-12)
Pedido do usuário: "A partir de agora não me pergunte mais, pode rodar os SQL". SQL de migração que altera dados ou
estrutura pode ser rodado direto pelo conector do Supabase (em partes pequenas; comando com delete/drop trava no
conector — nesses, o usuário roda no SQL Editor), sem pedir confirmação antes. Depois de rodar, conferir e relatar o
resultado. Continua valendo: nunca copiar dados reais de pacientes para o repositório.
- Produção (2026-10-12): `2026-10-12e-rateio-das-contas` rodada (linhas | payable_id | funcao = true | true | true).

## Padrão de maiúsculas nos nomes da interface (2026-10-12, REGRA FIXA do usuário)
Menus, títulos de telas, títulos de janelas, rótulos de campos, cabeçalhos de colunas e botões usam **Title Case**: cada palavra com
inicial maiúscula, exceto as de ligação (a, e, o, as, os, de, da, do, das, dos, em, no, na, para, por, com, ou, um, uma, ao, sem, até, que…), que
ficam minúsculas; a primeira palavra sempre maiúscula. Ex.: “Contas a Receber”, “Plano de Contas”, “Data de Nascimento”, “Pagamento de
Empréstimos”. Frases, dicas, mensagens, placeholders e textos de Ajuda continuam em frase normal; nomes de telas citados na Ajuda
(`<b>…</b>` e “…”) seguem o padrão. Helper `ttl(s)` (perto de `normText`) para montar títulos a partir de texto dinâmico. Texto novo de
interface: já escrever assim (aplicado em index.html, js/, cadastro.html e oauth-consent.html).

## Financeiro — Conciliação com o extrato (2026-10-12)
Decisões do usuário: o extrato entra por **arquivo (OFX, Excel ou CSV)**; o sistema **sugere e a pessoa confirma**; lançamento conciliado só ganha a
marca (continua editável, com aviso). Menu Financeiro ▾ → **Conciliação** (`#tab-conciliacao`, aba `conciliacao`, ids `cn*`, depois de Empréstimos
Concedidos), permissão **Financeiro** (ver, editar = conciliar/desfazer, incluir = importar/criar lançamento, excluir = apagar linhas pendentes).
- Tabela `public.finance_statement_lines (id, account_id, data, descricao, valor COM SINAL, doc, key, entry_id → finance_entries on delete set null,
  matched_at/by, created_at/by)`; `unique (account_id, key)` (importar de novo não duplica) e índice único parcial em `entry_id` (um lançamento, uma
  linha). Migração `supabase/2026-10-12g-conciliacao.sql` (testada no PGlite; linha 108 da conferência; schema e conferência geral atualizados; backup
  inclui `finance_statement_lines`). Apagar o lançamento solta a linha (FK) e `flDeleteRow` atualiza `CN.rows`.
- Bloco “Financeiro: Conciliação” antes de Demonstrativos: `CN` (estado: acc, ym, st pend|conc|sem|"", q), `cnLoad`, `cnParseOfx`, `cnParseRows`
  (acha Data / Descrição ou Histórico / Valor ou Crédito+Débito), `cnReadFile` (OFX direto; Excel/CSV por `xlReadFile`), `cnKeys` (FITID → `id:<doc>`;
  senão data|valor|descrição + nº da repetição), `cnCandidates`/`cnSuggest` (mesma conta, valor do extrato do lançamento — `extVal` se houver, senão
  `valor`, com sinal pela subcategoria — e data até 10 dias; melhor = menor diferença de dias + palavras em comum), `cnAutoConfirm` (só um candidato,
  até 2 dias), `cnPickModal`, `cnCreateFrom(line)` (abre `openLancamento(null, {pre, onSaved})` preenchido; só liga se a subcategoria tem o mesmo sentido
  da linha), `cnOpenImport` (prévia: lidas / novas / já importadas), `cnWireMenu` (Importar Extrato, Excluir Linhas Pendentes do Período).
  `openLancamento(row, opts)` ganhou `opts.pre` e `opts.onSaved`. Lançamentos: ✓ (`cnMatched`) na coluna Extrato e aviso “Lançamento Conciliado” ao
  mudar valor, data ou conta. Cartões: Linhas do Extrato, Conciliadas, Pendentes (soma com sinal), Lançamentos sem Extrato (`cnEntriesWithoutLine`).
- Ajuda: tópico `conciliacao`. Teste `tests/run_conciliacao.js` (no `npm test`).
- Produção (2026-10-12): `2026-10-12g-conciliacao` rodada pelo conector (tabela | RLS | 4 políticas | gatilho | índice = true | true | 4 | true | true).
- Próximos (aguardando o usuário): Unidades (dois CNPJs), metas e orçamento, Guia/autorização do convênio, Planner montado pelos tratamentos.

## CRM → Automações (2026-10-12)
Pedido do usuário: lista de automações para o CRM, com tela para ligar/desligar, escolher a lista de destino e um ou mais
responsáveis; "inclua todas". Decisões: cada regra nasce DESLIGADA; as regras só criam tarefas/comentários (nada altera cadastros);
"Contrato assinado" e "Cadastro recebido pelo link" criam a tarefa para a pessoa agir (o paciente/tratamento não é criado sozinho).
- Menu **CRM ▾ → Automações** (`#tab-automacoes`, aba `automacoes`, endereço `#automacoes`, depois de Listas e Status; permissão `crm_listas`:
  ver = consultar, editar = ligar/desligar/rodar). Bloco "CRM → Automações" do script: `CRMA_RULES` (26 regras: id, grupo, nome, descrição,
  quando roda, lista padrão `def`, `param` {label, def, min, max} = campo `dias`, `motivo`, `listMode: "monitorada"` = lista vigiada em
  vez de destino), `CRMA_GROUPS` (Funil de Leads, Tratamentos e Cadastro, Agenda e Presença, Financeiro, Rotina da Equipe), `subscribeCrmAuto`,
  `crmaSave`, `renderAutomacoes` (tabela gtRender: Automação, Grupo, Lista, Responsáveis, Ligada, Criou (30 Dias)), `crmaToggle`
  (etiqueta Ligada/Desligada), `crmaOpen` (janela da regra: ligada, lista, dias, motivo, Responsáveis por `crmPeopleMenu`, Últimas Ocorrências
  de `crm_auto_log`), `crmaSetAll`, `crmaRunNow` (RPC `crm_auto_run_now`), `wireAutomacoes`. "Outras Opções": Ligar Todas / Desligar Todas.
- Documento `config/crm_automations {rules: {<regra>: {on, listId, assignees: [uuid], dias, motivo}}}` (`module_for_path` = `crm_listas`).
  Regra nova: acrescentar em `CRMA_RULES` E criar a função `crm_auto_r_<regra>` (rotina do dia) ou um gatilho no banco; manter os ids iguais
  (o teste `tests/run_crm_auto.js` confere os 26).
- Banco (migração `supabase/2026-10-12h-crm-automacoes.sql`, testada no PGlite; linha 109 de `conferencia-migracoes.sql`; `schema.sql` e
  `conferencia-geral.sql` atualizados): `crm_auto_log (rule, key único, task_id)` = nada se repete (chave regra|item|período);
  `crm_auto_state` (rodízio); `crm_auto_cfg(regra)` (null = desligada), `crm_auto_make(...)` (cria a tarefa na lista escolhida ou padrão,
  só com responsáveis que têm acesso à lista, status = 1º que não finaliza), `crm_auto_comment(...)` (comentário com @menção, que vira aviso
  no celular). Autor "Automação": o GUC `pipo.auto` é lido por `crm_my_name`, `pipo_origem` (marca `app: "Automação"` → "· via Automação"
  na atividade), `tasks_stamp` e `task_events_stamp`. Hoje = Brasília (`crm_auto_today`).
  - Gatilhos (na hora): `tasks_auto_assign` (rodízio, antes do insert), `tasks_auto_status` (lead perdido com o motivo escolhido, contrato
    assinado), `intake_auto` (cadastro recebido pelo link), `appointments_auto_status` (falta = "nao-compareceu" — falta justificada não conta —
    e faltas seguidas), `appointments_auto_first` (1º atendimento do paciente; só atendimento com `patient_id`, sem grupo/bloqueio).
    Todos com `exception when others` (nunca impedem a gravação original).
  - Rotina do dia: `crm_auto_run(p_force)` roda cada `crm_auto_r_<regra>` isolada (erro de uma não derruba as outras); cron
    `pipo-crm-automacoes` às 11:10 UTC (8h10 de Brasília), todo dia. Resumos semanais só na segunda; "a partir do dia" (abaixo do contratado,
    mês sem fechar) respeita o dia escolhido; `p_force` (Rodar Agora = `crm_auto_run_now`, só quem edita CRM) ignora dia da semana/do mês.
  - Regras: lead_parado, link_respondido, link_segunda_cobranca, lead_perdido, contrato_assinado, rodizio_leads, trat_vencendo,
    trat_cancelado, abaixo_contratado (sessões agendadas no mês × Sessão/Mês, tratamentos que começaram antes do mês), carteirinha_vencendo,
    sem_tratamento, falta, faltas_seguidas, pendencias_status, primeiro_atendimento, conta_vencendo, conta_vencida (pagar e receber),
    saldo_baixo (saldo de hoje × `saldoMinimo` da conta), mes_sem_fechar, conciliacao_pendente, rotinas_prontas (2 tarefas recorrentes
    criadas uma vez: sexta semanal e mensal), plano_vencendo, tarefa_parada e tarefa_atrasada (comentam e mencionam o responsável + pessoas
    escolhidas), aniversario, encaminhamento_vencendo (lê o encaminhamento da saúde do paciente).
- Teste `tests/run_crm_auto.js` (no `npm test`); `run_cad_titles`, `run_toolbar_rows`, `run_sticky_headers`, `run_cad_sheets` incluem a tela.
  Ajuda: tópico `crm-automacoes`.

## Encaminhamento no cadastro do paciente (2026-10-12)
Pedido do usuário: data do encaminhamento, vencimento (3 meses, 6 meses, 1 ano) e especialidades do encaminhamento no estilo das
especialidades do tratamento (Especialidade + Quantidade Semanal).
- Fica no grupo **Saúde** (`PAT_FIELDS` chave `encaminhamento`, tipo `referral`; também em `HEALTH_KEYS`, então vai para a tabela protegida
  `patient_health` e só aparece com "Pacientes – Saúde"). Formato: `encaminhamento = {data, validade: "3m"|"6m"|"1a", venc (iso), esp:
  [{id, specId, semanal}]}`. Sem SQL.
- Janela: Data do Encaminhamento, Validade e Vencimento (calculado, só leitura; mesma conta do tratamento — 6 meses a partir de 01/01 =
  válido até 30/06, `encVenc` com `trAddMonths`), aviso quando vencido/vence em 30 dias (`encState`), quadros por especialidade
  (`.room-row.tl-row`, "+ Incluir Especialidade", janela `openEncLineModal`: Especialidade com "+ Incluir" e Quantidade Semanal **opcional e sem limite** (pedido do usuário: plano que não pede quantidade no encaminhamento — fica vazia, "Quantidade semanal não informada"; só aceita inteiro ≥ 1);
  a mesma especialidade não repete). `encHtml`, `encWire(root, valor, nomeDoPaciente)` → `{read}`.
- Lista de Pacientes: etiqueta `Enc. vencido` / `Enc. vence` ao lado do nome (`encChip`, só no computador). Ficha impressa: linha
  "Encaminhamento" (`encSummary`). Automação `encaminhamento_vencendo` do CRM lê `patient_health.data.encaminhamento.venc`.
- **Fora do link de cadastro** (decisão: documento clínico entregue à clínica): `LINK_OF_FIELD` não tem o campo e `tests/run_intake.js`
  confere os demais campos, exceto `encaminhamento`.
- Teste `tests/run_encaminhamento.js` (no `npm test`).
- Produção (2026-10-12): `2026-10-12h-crm-automacoes` rodada pelo conector, em 6 partes (sem `drop trigger`/`unschedule`, porque tudo era novo): caminho aceito, 31 funções, 5 gatilhos, cron `pipo-crm-automacoes` (1), só `crm_auto_run_now` aberta para usuários logados. Todas as automações começam desligadas; nada é criado até o usuário ligar em CRM ▾ → Automações.

- (2026-10-12, pedido do usuário: "em editar automação tem que ter campo da lista e do status quando necessário") A janela da automação ganhou **Status da Tarefa Criada** (`#crmaStatus`, os status que NÃO finalizam da lista escolhida — ou da padrão —, refeito ao trocar a lista; em branco = o 1º; `rules.<regra>.statusId`; não existe nas regras de lista vigiada: rodízio, tarefa parada e vencida) e **Status que Dispara** (`#crmaGat`, só `lead_perdido` = status de perda e `contrato_assinado` = status que finaliza sem ser perda, dos funis; `rules.<regra>.gatilho`; em branco = qualquer um; `CRMA_RULES[].gat`). A coluna Lista mostra "Gestão › Em andamento". Banco: migração `supabase/2026-10-12i-crm-automacoes-status.sql` (`crm_auto_make` usa `crm_rec_status(lista, statusId)` — status que não existe na lista cai no 1º — e `tasks_auto_status` lê `gatilho`; testada no PGlite, linha 110 da conferência de migrações; `schema.sql` e `conferencia-geral.sql` atualizados). Testes em `tests/run_crm_auto.js`.
- Produção (2026-10-12): `2026-10-12i-crm-automacoes-status` rodada pelo conector (`status_na_criacao` e `gatilho` = true, 0 funções abertas).

## Planner ▾ Outras Opções → Auto Planner (2026-10-12)
Pedido do usuário: "Janela Auto Planner". Primeira entrega = modo **Completar o que Falta** (decisões anteriores do usuário
sobre rotina fixa, sessões seguidas, listar quem não coube etc. valem; ficam para depois: reorganizar um paciente/tudo,
irmãos juntos, folga por turno, intervalo entre "não ABA", marca "montado pelo tratamento").
- Botão `#autoPlannerBtn` em Outras Opções (permissão: incluir no Planner) → `openAutoPlannerModal()` (bloco antes de "Planner → Agenda").
  Paciente (ou todos com tratamento ativo) → **Montar Proposta** (`apBuild(pacientes)`) → prévia por paciente (caixa para tirar) +
  tabela **Não Couberam** (paciente, quadro, faltam, motivo) → **Aplicar (N)**: reconfere cada sugestão com o Planner de agora e grava
  tudo num único `applyBookingChanges` (entra no desfazer, Ctrl+Z). Nada é gravado antes.
- Regras: lê `patientSpecRows(p)` (quadros com sessões/mês > 0); conta o que o paciente já tem por quadro (`treatLineFor`) e propõe só a
  diferença; sessões/mês divididas pelas semanas permitidas (`semanas` do quadro), semana com sessão a mais recebe o resto. Colunas:
  sala (não grupo), profissional do quadro (ou quem tem a especialidade como principal), sala do quadro; dia/horário do quadro quando preenchidos.
  Célula livre, `seatAvailable`, `plLockInfo`, `patientSlotOk`, rotina atual (`routineConflictMsg`) e `plannerConflict`. Pontuação: repetir o
  MESMO dia/horário/coluna das outras semanas (rotina da família), dias diferentes na semana, sessões seguidas (`seguidas`). As sugestões
  entram temporariamente em `state.scheduleDocs` durante o cálculo (`apPut`/`apRestore`) para as regras enxergarem umas às outras.
- Ajuda: tópico `planner-ferramentas`. Teste `tests/run_auto_planner.js` (no `npm test`). Sem SQL.
- (2026-10-12, pedido do usuário) **Auto Planner: destino, prioridade e grupos ABA.** Campo **Gravar em**: Só no Planner / Planner e Agenda / Só na Agenda (+ mês da Agenda; `apAgendaPlan(items, ym)` usa `genMonthWeeks`, pula datas passadas, feriados, fora do horário, duplicados e `agdConflictIn`; insere por `agdInsertBatches`, entra no desfazer da Agenda). Respostas do usuário: manuais ficam fixos e entram primeiro (atraem os grupos); ordem de cálculo = individuais (quadro com ABA Não ou serviço ≠ Sessão) e depois ABA Sim, ordenados por faixa etária e especialidade. **ABA Sim em grupo** na mesma sala e horário (`apOcc`, `apOccAba`): só com a MESMA faixa etária (`apBandId` = `ageBandOf`) e a especialidade da sessão em comum nos tratamentos (`apSpecIds`); tamanho = nº de colunas da sala com o profissional do quadro (`roomK`): 2 colunas = 2, 3 colunas = 2 a 3, 4 colunas (ou 2 profissionais × 2) = 3 a 4 (`pref`); salas com "ABA" no nome preferidas para grupos (-20) e evitadas pelos individuais (+20); a prévia mostra "grupo de N / sozinho(a)" e o resumo "ABA Sim: X em grupo, Y sozinhas". Testes em `tests/run_auto_planner.js` (grupo e faixa diferente).

## Sala com campo ABA; máximo de 4 pacientes por sala (2026-10-12)
Pedido do usuário: o nome da sala não decide mais se ela é ABA. Cadastro da sala (`openRoomModal`) tem **ABA (Sim/Não)** (`rec.aba = true|false`; grupos de
suporte não têm). O nome da sala continua guardado COMPLETO ("Fonoaudiologia ABA"): o cadastro mostra o nome sem "ABA" e, com Sim, acrescenta " ABA" ao salvar
(assim nada que guarda o nome — células dos grupos no Planner, Agenda — mudou). `roomAba(r)` (perto de `PL_ROOM_MAX`) lê só `r.aba === true`; nenhuma regra consulta
o nome (as regras "não ABA" já não olhavam desde 2026-10-08; só o Auto Planner usava `/aba/i`). Auto Planner prefere salas ABA para grupos e evita-as nos individuais.
- **Máximo 4 pacientes por sala no mesmo horário** (`PL_ROOM_MAX`): `plannerConflict` ganhou a regra do Sistema `pl_sala_max` (padrão **Avisar** = pede confirmação;
  Bloquear/Desligado possíveis); conta pacientes (sem Bloqueado/Reunião/Treinamento) nas colunas da sala. O Auto Planner nunca passa de 4 (`apOcc` ≥ 4 = pula).
  A Agenda por data não tem essa regra.
- Migração só de dados `supabase/2026-10-12j-sala-aba.sql` (aba = true nas salas com "ABA" no nome, false nas outras, grupos intactos; linha 111 da conferência).
  Produção (2026-10-12): rodada pelo conector (5 salas ABA | 6 sem ABA). Teste `tests/run_sala_aba.js` (no `npm test`).
- (2026-10-12, respostas do usuário) **Auto Planner: irmãos, folga por turno, marca e terapeutas compatíveis.** (1) Irmãos = mesmo nome ou CPF de mãe/pai (`apSibIds`): "sempre que possível" no mesmo horário (-25) ou colado (-15). (2) Por profissional e turno: sempre que possível um horário livre que NÃO seja o primeiro nem o último do turno (+30 se o encaixe tira a última folga do meio) e 3 a 4 horários cheios (+25 para abrir o 5º horário do turno, só ABA Sim). (3) Tudo que o Auto Planner grava leva `auto: true` no agendamento; botão **Remover o que o Auto Planner Colocou** (`#apRemove`, paciente escolhido ou todos, permissão excluir no Planner, entra no desfazer) apaga só as marcadas. Copiar/mover leva o `auto` junto. (4) Terapeutas na mesma sala e horário (grupo ABA Sim): mesma especialidade principal OU um deles com Aplicador ABA (especialidade com "aplicador" no nome, principal ou complementar) — `apProfCompat`/`apIsAplicador`; com Aplicador a regra de "especialidade em comum dos pacientes" não vale; tamanho do grupo = colunas compatíveis da sala. A faixa etária igual continua obrigatória. Testes em `tests/run_auto_planner.js`.

## Unidades (nível de organização) — DECISÕES E PLANO (2026-10-12, ainda não implementado)
Pedido do usuário: gerenciar várias unidades; os dados atuais são da **Unidade 1**. Decisões:
- **Por unidade:** pacientes, tratamentos, prontuário, planos terapêuticos, colaboradores (cada um pertence a UMA unidade), Planner, Agenda,
  salas e grupos de suporte, CRM (listas, tarefas, links, automações), Financeiro inteiro (contas bancárias passam a pertencer a uma unidade — o
  campo de texto "CNPJ da empresa" vira ligação —, lançamentos, contas a pagar/receber, empréstimos, conciliação, fechamento de mês, custo), Fornecedores,
  Médicos, Escolas, **Dados da Clínica inteiros** (nome fantasia, CNPJ, logo, redes, horário, duração, cores; duas unidades podem ter o MESMO nome fantasia com CNPJ diferente).
- **Da empresa (únicos):** Níveis de permissão (+ novo nível), Diagnósticos, Origens, Motivos de cancelamento, Tipos de colaborador, CBO, Conselhos,
  Status, Escalas, Habilidades, Banco de objetivos, Plano de contas, Categorias de fornecedor.
- **Empresa + ocultar por unidade** (lista única; cada unidade esconde o que não usa): Convênios, Especialidades, Serviços, Feriados e recessos (nacionais valem para todos; municipais só da unidade).
- **Permissão:** novo nível **Gestão** acima do Administrador, acesso total a todas as unidades; só a Gestão cria unidades e define qual Administrador pertence a qual unidade.
  **Administrador** = total, só na própria unidade; vincula usuários só à sua unidade (Gestão, a qualquer uma).
- **Seleção de unidade:** lista "Unidade" na TELA DE LOGIN (só o nome da unidade é público; última escolha lembrada no aparelho; sem acesso à unidade = recusa).
  Dentro do sistema só a Gestão vê o seletor, no topo à direita (celular: no ☰); demais níveis veem o nome da unidade fixo. Opção "Todas as unidades"
  (visão consolidada de Financeiro e Relatórios) entra na fase do Financeiro.
- **Fases:** 1) cadastro de Unidades, nível Gestão, vínculo usuário↔unidade, seletor no login e no topo (Unidade 1 criada; todos os atuais nela; nada muda no uso);
  2) coluna de unidade nas tabelas + regras do banco + carga/tempo real filtrados; 3) Salas, Planner, Agenda, Clínica; 4) pessoas e clínico (pacientes, tratamentos,
  prontuário, planos, colaboradores, transferência entre unidades); 5) Financeiro por unidade + visão consolidada; 6) CRM, automações (rotinas diárias por unidade), link de
  cadastro, notificações, conector Claude, backup por unidade, Relatórios; 7) comparativo entre unidades, conferência de integridade, revisão de segurança.

### Unidades — Fase 1 FEITA (2026-10-12): base, sem separar dados ainda
Respostas finais do usuário: o **nome na lista do login** é editável no cadastro de Unidades (`config/units.list[].name`); "Todas as unidades" abrirá menus
novos no lugar dos outros (a desenhar na fase do Financeiro/Relatórios, "mais adiante"); o Administrador vincula usuários só à sua unidade, a Gestão a qualquer uma;
**Dados da Clínica inteiros por unidade** (duas unidades com o mesmo nome fantasia e CNPJs diferentes).
- Banco (migração `supabase/2026-10-12k-unidades-fase1.sql`, rodada em produção pelo conector, testada no PGlite; linha 112 da conferência de migrações; `schema.sql` e
  `conferencia-geral.sql` atualizados): cadastro de unidades em `config/units {list:[{id, name, fantasia, cnpj, telefone, email, endereco, cidade, inativo}]}`
  (módulo `unidades`, nenhum nível tem; gatilho `documents_a_units_guard`/`units_guard`: só a Gestão grava, a Unidade 1 e unidade com usuários não saem);
  `roles.is_manager`; nível **Gestão** (`gestao`, `is_admin` + `is_manager`, travado como o Administrador; o Administrador mais antigo foi promovido a Gestão);
  `profiles.unit_id` (padrão `unidade-1`, todos os usuários atuais nela); funções `is_manager()`, `my_unit()`, `unit_exists()`, `login_units()` (id + nome das unidades
  ativas, aberta ao anon para a lista do login); gatilho `profiles_unit_guard` (Administrador não muda unidade, não mexe em Gestão/outro Administrador, não dá nível
  Administrador/Gestão); políticas `profiles_select/update` por unidade (Gestão vê todos); `roles_insert/update/delete` só `is_manager()`.
- Gestão = `is_admin` + `is_manager`: todo `is_admin()` antigo continua valendo para ela. O que ficou SÓ da Gestão: Cadastros → Unidades, Níveis de Permissão, Acesso → Sistema,
  restaurar o Backup (`api/admin-backup.js` exige `is_manager`), dar nível Administrador/Gestão e escolher a unidade do usuário.
- `js/pipo-supabase.js`: `pipoAuth.isManager()`, `unit()`, `units()`, `unitName()`; `can("unidades")` só para a Gestão (Administrador não); lista **Unidade** na tela de login
  (`login_units()`, última escolha em `agendaPipo:unit`; sem unidades no banco o campo some e o login segue como antes); `resolveUnit`: nível comum com unidade diferente da
  dele é recusado ("Você não tem acesso a esta unidade."); Gestão usa a escolhida; seletor `select[data-unit-switch]` no topo (Gestão; troca grava e recarrega a página) ou
  etiqueta `.user-unit` (demais); no celular o mesmo no ☰ (`.mnav-unit`). **A unidade ainda não filtra nenhum dado** (Fase 2 em diante).
- `api/admin-users.js`: `currentActor` traz `isManager` e `unit`; criar usuário aceita `unit_id` (Gestão escolhe, demais = a própria); recusa mexer em usuário de outra unidade e em
  Gestão/outro Administrador. `js/usuarios.js`: campo Unidade (Gestão edita; demais veem), coluna Unidade na lista para a Gestão, Níveis de Permissão só pela Gestão.
- App (`index.html`): `REG_CFG.unidades` (cadastro genérico, CNPJ único, Inativar se há usuários), tópico de Ajuda `unidades`.
- Testes: `tests/run_unidades.js` (cadastro) e `tests/run_login_units.js` (login com Supabase simulado: lista, recusa, Gestão, seletor).
- Próximas fases (ver plano acima): 2) coluna de unidade nas tabelas + regras do banco + carga/tempo real filtrados; 3) salas/Planner/Agenda/Clínica; 4) pessoas e clínico;
  5) Financeiro + visão consolidada; 6) CRM, automações, link de cadastro, notificações, conector, backup por unidade; 7) comparativo e revisão.

### Unidades — Fase 2 (2026-10-12): infraestrutura de separação no banco (sem mudar o uso)
Migrações (rodadas em produção pelo conector, testadas no PGlite com 2 unidades; linhas 113–115 de `conferencia-migracoes.sql`; `schema.sql` e `conferencia-geral.sql` atualizados):
- `2026-10-12l-unidades-fase2a-documentos.sql`: `documents.unit_id` (`'empresa'` para os documentos da empresa, definido por `doc_scope(path)`; unidade para os demais), índice único `(path, unit_id)`
  (a PK antiga `(path)` continua até a etapa final), `active_unit()`, gatilho `documents_0_unit_stamp`, política RESTRICTIVE `documents_unit`; `patch_bookings`/`patch_list`/`patch_list2` e
  `documents_enforce` usam `(path, unit_id)`.
- `2026-10-12m-unidades-fase2b-tabelas.sql`: `unit_id` + `unit_stamp()` (gatilho `<t>_0_unit_stamp`) + política RESTRICTIVE `<t>_unit` nas 19 tabelas com dados da unidade.
- `2026-10-12n-unidades-fase2c-funcoes.sql`: view `documents_u` (definer, sem acesso direto) e 31 funções security definer reescritas para ler dela; `crm_people`, `intake_form`/`intake_send`
  (marcam `pipo.unit` pelo link), `intake_remind` e relatórios filtram pela unidade.
- Regra: a unidade ativa vem do token (`user_metadata.active_unit`, só vale para `is_manager()`), senão `profiles.unit_id`; sem usuário (cron, link público, restauração) vale o GUC `pipo.unit`.
- App: `js/pipo-supabase.js` usa `onConflict: "path,unit_id"` e, para a Gestão em outra unidade, `syncTokenUnit` grava `active_unit` (`updateUser` + `refreshSession`) antes de abrir; `api/config.js`
  lê a Clínica da `unidade-1` (marca por unidade vem na Fase 3); `api/admin-backup.js` leva/restaura `unit_id` (documentos por `path,unit_id`). Testes: `run_login_units.js`, `run_backup_api.js`.
- Etapa final (2D): `supabase/2026-10-12o-unidades-fase2d-chave-final.sql` troca a PK de `documents` para `(path, unit_id)` (linha 116 da conferência; tem `drop constraint`, então roda no SQL Editor; `schema.sql` já nasce com a chave final). Só depois dela uma segunda unidade pode ter o mesmo caminho.
- Próximas fases: 3) Salas/Planner/Agenda/Clínica por unidade (marca no login por unidade); 4) pessoas e clínico; 5) Financeiro; 6) CRM e demais; 7) revisão.

### Unidades — Fase 3 (2026-10-12): Clínica, Salas, Planner e Agenda por unidade
- Os dados já eram separados pelo banco na Fase 2 (`doc_scope`: `config/clinic`, `config/rooms`, `config/planner_blocks`, `schedule/*` e a tabela `appointments` são da unidade); a Fase 3 fecha a parte visível. Chave final de `documents` = `(path, unit_id)` (migração 2D, rodada em produção).
- `api/config.js` devolve a marca pública de CADA unidade (`unidades: {id: {theme, redes, clinica}}`, lida de `config/clinic` com a service role) e, no nível de cima, a da Unidade 1 (compatibilidade e página do link).
- Tela de login (`js/pipo-supabase.js`): `applyLoginBrand(unitId)` troca nome, subtítulo e cor dos botões ao escolher a unidade; unidade sem Clínica cadastrada usa o nome padrão e as cores do sistema.
- Link de cadastro: `intake_form` devolve também `clinica.redes` da unidade do link (migração `supabase/2026-10-12p-unidades-fase3a-link-redes.sql`, linha 117; rodada em produção); `cadastro.html` usa essas redes.
- Testes: `tests/run_login_units.js` (marca por unidade) e `tests/run_config_api.js` (API, no `npm test`).
- Falta nesta fase: nada de código; conferir com a primeira Unidade 2 real (cadastrar em Cadastros → Unidades, trocar pelo seletor da Gestão, preencher Clínica, Salas e Colaboradores).
- Próximas: 4) pessoas e clínico (pacientes, tratamentos, prontuário, planos, colaboradores, transferência entre unidades); 5) Financeiro; 6) CRM e demais; 7) revisão.
- (2026-10-13, pedido do usuário) **Unidades saiu de Cadastros e foi para o menu Acesso**, antes de Clínica (só a Gestão; `data-act="unidades"` em `js/pipo-supabase.js` clica no botão oculto `#mainTabs [data-tab="unidades"]`, como Usuários). **Ajuda é o último item do Acesso antes de Sair** (ordem: Unidades, Clínica, Usuários, Backup, Sistema | Senha, Notificações, Instalar App, Ajuda | Sair). Endereço `#unidades` continua abrindo a tela.
- (2026-10-13, correção) Erro "Cannot read properties of null (reading 'insertBefore')" ao trocar de unidade: o seletor de unidade do topo é melhorado pelo `dpScan`, mas o menu do usuário é redesenhado logo depois e o campo já estava fora da tela. `dpEnhanceOne` agora ignora campo sem `parentNode`. Teste em `tests/run_login_units.js`. (`run_autolist.js` — sugestões de "Paciente ou Lead" — é instável quando a máquina está carregada: passa sozinho.)
- (2026-10-13, pedido do usuário) **A tela de login NÃO tem mais a lista "Unidade"** (nem pública): cada pessoa entra na unidade do próprio perfil (`profiles.unit_id`) e só a Gestão escolhe, depois de entrar, no seletor do topo (a última escolha fica em `agendaPipo:unit`). `resolveUnit` não tem mais recusa por unidade errada; `applyLoginBrand`/marca por unidade no login saíram (o login mostra a marca da Unidade 1; `api/config.js` ainda devolve `unidades` — sem uso no login). Migração `supabase/2026-10-12q-unidades-login-sem-lista.sql` (linha 118) tira o acesso de `anon` a `login_units()`: o nome das unidades deixa de ser público.
- (2026-10-13, pedido do usuário) **CRM, janela da tarefa:** "Outras Opções ▾" no canto superior direito (`.crm-modal .modal-head-acts{margin-left:auto}`) com **Gerar Tarefa a Partir Desta** (`crmGenDialog`, `crmGenDests`: lista onde pode incluir, status, responsáveis com acesso; leva título, descrição, prioridade e paciente/lead; as duas tarefas ganham comentário uma da outra) e **Mover Tarefa**. @menção na caixa de comentário: ↑ ↓ andam, Tab/Enter escolhem, Esc fecha (`crmMentionWire`). Sem SQL. Teste em `run_crm.js`.
- (2026-10-13, pedido do usuário) **CRM: Duplicar, Seguir e Resumo do Dia.** Menu Outras Opções da tarefa ganhou **Seguir Tarefa / Deixar de Seguir** (`crmFollow` → RPC `task_follow(p_task, p_on)`, `tasks.followers uuid[]`; quem vê a lista pode seguir, mesmo sem editar), **Duplicar Tarefa** (cópia na mesma lista: status, título, descrição, prioridade, vencimento, responsáveis, paciente/lead; sem comentários nem recorrência; abre a cópia) e, antes, Cadastro do Paciente / Gerar Tarefa / Mover / Copiar Link. Aviso aos seguidores: gatilho `task_events_push` chama a função `pipo-push` com `tipo: "seguindo"` (comentário, status ou campo alterado; autor e mencionados não recebem; `push_follow_targets`), preferência nova **Tarefas que Sigo** (`seguindo`) em Acesso → Notificações. Tela CRM: cartão **Resumo do Dia** (`crmDayHtml`/`crmDayPeople`/`crmDayOpen`, por pessoa: vencidas e vencem hoje, "Sem responsável" junta as sem dono; clicar lista as tarefas). Migração `supabase/2026-10-13-seguir-tarefa.sql` (linha 119 da conferência; schema e conferência geral atualizados; função `pipo-push` precisa ser publicada de novo). Teste em `run_crm.js`.

## CRM: anexos das tarefas no Google Drive (2026-10-13)
Decisões do usuário: **Drive compartilhado** do Google Workspace (código `0AG9M-7u7X14uUk9PVA`, guardado na variável da Vercel
`GOOGLE_DRIVE_ID`); **uma pasta por paciente** com as subpastas **Documentos** e **Relatórios**, criadas sozinhas no primeiro anexo; na janela de
anexar há o seletor **Pasta** (Documentos / Relatórios) e o campo **Nome do Arquivo**: o nome final é o digitado + **primeiro nome do paciente** +
extensão original ("Carteirinha" para João = "Carteirinha João.pdf"; não repete o nome se já está no texto); renomear depois do envio incluído;
limite 4 MB (limite de corpo da Vercel); tarefa sem paciente cadastrado não anexa (pede cadastrar antes); **Documentos** só para quem também tem
"Pacientes – Saúde" (ver); anexar/renomear/excluir exigem poder editar a lista da tarefa; nome repetido na pasta = recusa (nunca sobrescreve);
excluir manda o arquivo para a lixeira do Drive.
- O navegador nunca fala com o Google. `api/task-files.js` (`upload`, `rename`, `delete`, `download`) confere o login e as permissões pelo banco com o
  token DA PESSOA (RPC `task_attachment_can` e `task_attachment_ctx`, RLS) e usa a **conta de serviço** do Google (`GOOGLE_SERVICE_ACCOUNT_JSON`, só no
  servidor; JWT RS256 assinado com `crypto`, sem biblioteca). A conta de serviço é membro do Drive compartilhado (Gerenciador de conteúdo). Abrir o
  arquivo = o servidor baixa e entrega (`crmAttOpen`), então quem usa o sistema não precisa ter acesso ao Drive.
- Banco (migração `supabase/2026-10-13b-anexos-de-tarefas.sql`, rodada em produção pelo conector; linha 120 da conferência de migrações; `schema.sql` e
  `conferencia-geral.sql` atualizados): `task_attachments` (task_id, patient_id, kind, drive_file_id, name, mime, size, autor, `unit_id`; RLS por
  `task_attachment_can`), `patient_drive_folders` (pastas já criadas por paciente/unidade; só a service role mexe), gatilhos de carimbo, unidade e
  **histórico da tarefa** (`campo: "anexo"`, `acao: anexou|renomeou|excluiu`, texto em `crmEventTextBase`). Apagar a tarefa apaga os registros dos
  anexos (os arquivos ficam no Drive, na pasta do paciente). O Backup NÃO leva `task_attachments` (os arquivos estão no Drive).
- App (bloco "CRM: anexos no Drive" antes de `crmEditDialog`): seção **Anexos** na janela da tarefa salva (`#crmAttBox`, `#crmAttAdd`, `#crmAttList`),
  `crmAttDialog(task, att)` (enviar ou renomear, com prévia "Será salvo como: …"), `crmAttFinal` (mesma regra do servidor: se mudar uma, mudar a outra),
  `crmAttRender`/`crmAttWire`. `pipoAuth.token()` entrega o token. Sem sistema online (testes) tudo fica em `CRM.mem.att`.
- Variáveis na Vercel: `GOOGLE_SERVICE_ACCOUNT_JSON` (arquivo JSON da conta de serviço inteiro) e `GOOGLE_DRIVE_ID`. NUNCA colocar o JSON no repositório
  nem no chat. Sem elas, anexar devolve "O Google Drive ainda não está configurado".
- Testes: `tests/run_task_files.js` (servidor com Supabase e Google simulados, no `npm test`) e o bloco "anexos" em `tests/run_crm.js`. Ajuda: tópico
  "CRM: Listas e Tarefas".
- Produção (2026-10-13): função `pipo-push` publicada de novo pelo conector (versão 2, `verify_jwt` false) com o aviso aos seguidores (`tipo: "seguindo"`): `{acao:"chave"}` devolve a chave (200) e `{tipo:"seguindo", evento: <inexistente>}` pelo `push_call` devolve `{enviados:0, falhas:0}` (reconhece o tipo e a senha interna). Dica do conector: ao publicar uma NOVA versão de função que já existe, passar `import_map_path: "deno.json"` junto com `deno.json` nos arquivos (sem isso o conector reaproveita o caminho `file://` da versão anterior e falha com "import map path does not exist"). Anexos no Drive: `GOOGLE_DRIVE_ID` é o código do Drive compartilhado que a conta de serviço enxerga (o erro de acesso lista os Drives visíveis); testado em produção pelo usuário ("funcionou").

- (2026-10-13, pedidos do usuário) Anexos na janela da tarefa: grupo **recolhido** por padrão com seta (`#crmAttTog`, contagem `#crmAttN`), cada anexo em duas linhas (`.crm-att-l1` = nome + Renomear/Excluir; `.crm-att-meta` = pasta · tamanho · autor · data), espaçamento compacto. **Excluir pergunta** (`crmAttDeleteChoice`, `#ovAttDel`): Excluir no Drive (lixeira) / Manter no Drive (`api/task-files.js` delete com `keep:true`, só tira da tarefa) / Cancelar. O anexo é achado pelo `drive_file_id`, então renomear no Drive não quebra o vínculo (o nome mostrado na tarefa continua o gravado). Sem SQL.

- (2026-10-13, correção) Na janela **Editar mensagem** o @ não abria a lista de pessoas: `crmMentionWire(ta, pop)` agora recebe a caixa e a lista (`#ceMentionPop`); Enter escolhe a 1ª pessoa, Esc fecha só a lista. Teste em `run_crm.js`.

- (2026-10-13, pedido do usuário) **Anexar arrastando e soltando**: soltar um arquivo sobre a janela da tarefa (`.crm-modal`, só com paciente cadastrado e permissão de editar a lista) abre a janela Anexar já com o arquivo (`crmAttDialog(task, null, arquivo)`); a janela também tem a área tracejada `#atDrop` para soltar. Limite de 4 MB igual. Sem SQL.

## Padrão de campos (2026-10-13, aprovado pelo usuário)
Título de grupo: sempre `.tr-sec` (`.tr-sec-top` no 1º da janela, `.tr-sec-in` dentro de caixas), Title Case; saíram `.pm-sec-title`, `.prof-access-title`, `.crm-sec-t`. Texto longo: 3 linhas, 5 em Observações
(CRM Descrição segue `fitDesc`). Hora: digitável HH:MM (`input.cl-time` texto + `staffTime` ao sair do campo; Clínica e Horário do paciente; a Agenda `#agdHora` continua lista).
Calendário padrão: título clicável abre lista de anos; "Limpar" em campo não obrigatório. Sim/Não: caixa de marcar para ligar/desligar; `.kind-opt` só para 2+ opções excludentes.

Atualização (2026-10-13): Sim/Não de ligar/desligar agora são caixas — Intervenção ABA (quadro do tratamento, `#tlAba`), Sala Intervenção ABA (`#rmAba`) e Tem Mediador / AT (campo `type: "check"` em `PAT_FIELDS`, grava "Sim"/"Não"). Dinheiro: `data-money` no input (teclado decimal, vira 0,00 ao sair); quantidade: `inputmode="numeric"`. Campo somente leitura/desativado: fundo cinza, sem foco. "(Opcional)": só em grupo do cadastro do paciente em que a maioria dos campos é obrigatória (`optMode`). `showToast` termina a frase com ponto quando falta.

### REGRA FIXA: estilo novo só com confirmação (pedido do usuário, 2026-10-13)
Todo campo, título, janela ou tela nova segue o "Padrão de campos" e os "Padrões obrigatórios para elementos novos" acima, reaproveitando classes que já existem. Se for preciso um estilo que NÃO existe (cor, tipo de campo, componente ou layout novo), parar e perguntar ao usuário ANTES de criar, mostrando a opção (prévia ou descrição) e esperando a escolha.

- (2026-10-13, pedido do usuário) Celular: o seletor de unidade (Gestão) ou o nome da unidade fica DENTRO do grupo **Acesso** do ☰ (primeiro item, `mnavRender` → `unitHtml`), não mais no topo do painel.

- (2026-10-13, pedidos do usuário) **Celular: seletor de ordem (▲▼) em TODA coluna de TODA lista**: regra geral em `.pat-table thead th` (título encurta com "…", botão `.sort-btn` sempre visível e dentro da célula; no celular th com padding menor e `overflow:visible`). Teste fixo `tests/run_sort_visible.js` (no `npm test`, 24 telas a 390px). **Número de notificações do CRM** (`crmBadgeCount()` = minhas tarefas vencidas + menções não lidas): ao lado de CRM no topo (`#crmBadge`), no título do grupo CRM do ☰ (`.mnav-n`), no botão ☰ (`#mnavBtn[data-n]`, soma os cadastros do link a revisar) e no ícone do app instalado (`navigator.setAppBadge`, `crmBadgeRender`). Testes em `run_crm.js`.

- (2026-10-13, pedido do usuário) **ABA geral do tratamento voltou** (caixa `#pAba` "Intervenção ABA" ao lado de Sessão/Mês, gravada em `abaAntigo`). Regra: o quadro do atendimento manda; atendimento sem quadro (ou tratamento sem quadros) usa o ABA geral (`abaFallback`); sem ele, a regra automática (`abaAuto`: suporte 3 ou 17+ = Não). O padrão do campo no tratamento sem valor acompanha o paciente escolhido; é também o padrão do quadro novo. Mudar o geral NÃO altera quadros existentes. Substitui "ABA só nos quadros" nos pontos em que ela dizia que o campo saiu da tela. Sem SQL.
- (2026-10-13, pedido do usuário) **Nome do anexo = nome digitado + NOME COMPLETO do paciente** (antes, só o primeiro nome): "Agenda" + Melinda Spindler-Salmeron = "Agenda Melinda Spindler-Salmeron.pdf"; não repete se o nome completo já está no texto (sem diferenciar acento/maiúscula). `crmAttFinal` (index.html) e `finalName` (api/task-files.js) usam a mesma regra. Anexos já enviados mantêm o nome. Sem SQL.

## Paciente Bloqueado (2026-10-13)
Pedido do usuário. Decisões: todos veem o bloqueio e o motivo; agendamento manual na Agenda bloqueado; atendimentos futuros na Agenda são mantidos (só a tarja) e o sistema oferece removê-los a partir de uma data.
- Cadastro do paciente, grupo **Bloqueio de Agendamento** (`PAT_SECTIONS` id `bloqueio`): `bloqueado` ("Sim"/"Não", caixa), `bloqueioMotivo` (id do cadastro **Motivos de Bloqueio**, com "+ Incluir"), `bloqueioObs`. Salvar bloqueado sem motivo é recusado. O salvar carimba `bloqueioDesde`, `bloqueioPor` e acrescenta em `bloqueioHist`; desbloquear apaga motivo/obs/desde/por (o histórico fica). Helpers `patBlocked`, `patBlockText`, `patBlockNote`, `blockTagHtml`.
- Cadastro **Motivos de Bloqueio** (Cadastros, `REG_CFG.motivosbloq`, documento `config/block_reasons`, permissão `motivos_bloqueio`); sem documento valem `DEFAULT_BLOCK_REASONS`. Em uso por paciente bloqueado = Inativar. Migração `supabase/2026-10-13c-motivos-de-bloqueio.sql`.
- Travas: regras do Sistema `pl_paciente_bloqueado` (em `plannerConflict`) e `ag_paciente_bloqueado` (em `agdConflictIn`), padrão Bloquear. Quem já está na célula/horário continua editável (`held`); mover, colar ou marcar horário novo é recusado. "Enviar para a Agenda"/Gerar mês pulam com o motivo "Paciente Bloqueado"; Auto Planner e Horário Livre não aceitam o paciente.
- Tarja vermelha "Bloqueado" no canto inferior direito das células do Planner e da Agenda (igual ao status; com status na Agenda fica logo acima dele) e etiqueta na coluna Status da lista de Pacientes.
- Ao bloquear um paciente que já tinha atendimentos, abre `trOfferRemoveBookings(id, {agendaOnly: true})` (só Agenda, a partir da data; o Planner fica).
- Teste `tests/run_bloqueio_paciente.js`.
- (2026-10-13, pedido do usuário) **Inativar paciente também pergunta se remove os agendamentos**: depois de inativar (e da pergunta de cancelar o tratamento ativo), abre `trOfferRemoveBookings(id)` — remover do Planner (4 semanas) e/ou da Agenda a partir de uma data. Cancelar tratamento já perguntava. Sem SQL. Teste em `run_perm_buttons.js`.
- (2026-10-13, pedido do usuário) **Permissões do CRM separadas** em Níveis de Permissão (grupo CRM, nesta ordem): **CRM** (`crm_listas`, SÓ ver: botão CRM, tela CRM e Minhas Tarefas; continua sendo o que o banco usa para o acesso — `crm_user_can`, `crm_people`), **CRM – Listas e Status** (`crmlistas`, ver/incluir/editar/excluir; documento `config/task_lists`), **CRM – Automações** (`crmautomacoes`, ver/editar; `config/crm_automations`, Rodar Agora, log) e uma linha por lista (`crm_<id>`) com ver/incluir/editar/excluir das tarefas. App: `crmListsCan(a)` e `crmaCan(a)` leem as chaves novas. Migração `supabase/2026-10-13d-permissoes-crm-separadas.sql` (`module_for_path`, `crm_auto_run_now`, política do log; os níveis começam com o que tinham em `crm_listas`; linha 122 da conferência; rodada em produção pelo conector: 6 níveis, política OK). `conferencia-geral.sql` não foi regerado.
- (2026-10-13, pedido do usuário) **Cartões da tela CRM dividem toda a largura**: o Resumo do Dia ocupava todas as colunas da grade e ela criava colunas vazias (cartões de 265px sobrando espaço). `.crm-home-grid` virou flex com quebra (`.crm-home-card{flex:1 1 240px}`, Resumo do Dia `flex:1 1 100%`; no celular `flex-wrap:nowrap`). Dentro do cartão: `.crm-home-body` com `.crm-home-l` (linhas 1–3: números) e `.crm-home-r` (4–6: faixa, legenda, funil); cartão com 520px ou mais (`@container`) põe `.crm-home-r` ao lado de `.crm-home-l`, título sempre em cima. Testes `run_crm_mobile.js`, `run_crm.js`.

- (2026-10-13, correção) **Nível só com permissão de CRM ficava "somente leitura"** (Status e campos travados na tarefa): `canWriteAnything()` em `js/pipo-supabase.js` só olhava os módulos da lista fixa `MODULES`, e as linhas `crm_<lista>` não estão nela, então `state.writable` virava false e `can()` negava incluir/editar/excluir. Agora também confere qualquer chave de permissão do nível. Sem SQL.

- (2026-10-13, correção) **OFX da Caixa na Conciliação**: o banco manda o mesmo FITID `000000` em todas as linhas, e `cnKeys` o usava como identidade (as linhas colidiriam). Agora FITID só de zeros ou repetido no arquivo é ignorado e vale a chave data|valor|descrição + nº da repetição. Sem SQL. Teste em `run_conciliacao.js`.

- (2026-10-13, pedido do usuário) Cadastro do paciente: campo de caixa (`type: "check"`, ex.: Bloqueado, Tem Mediador / AT) mostra a caixa ao LADO do nome, na mesma linha (`.pm-grid .field .chk-line`; antes `.field label{display:block}` e `.field input{width:100%}` deixavam a caixa em cima do texto) e alinhada com os campos da linha. Sem SQL.

- (2026-10-13, pedidos do usuário) **Aviso ao sair de janela de cadastro alterada** (`GUARD_IDS`, bloco antes de "Sistema: regras com chave"): campo mudado pela pessoa (evento `isTrusted`; busca/`.dp-filter`/comentário do CRM não contam) marca a janela; ✕, Cancelar/Fechar, clique fora e Esc abrem `#ovGuard` em `#guardHost` com **Salvar** (clica no botão Salvar da janela) | **Sair sem Salvar** (repete o fechamento com `__noGuard`) | **Continuar Editando**. Janela de cadastro nova: acrescentar o id em `GUARD_IDS`. Teste que fecha janela depois de digitar precisa clicar `#gdSair`. **Criar Tarefa** em Outras Opções (`mmHtml`/`mmWire`, `mmTaskItem`) nas janelas de Paciente, Tratamento (`#trCreateTask`), Lançamento e Conta a Pagar/Receber (só já salvos): `crmCreateFrom(pre)` escolhe a lista (`crmGenDests`, `#ovTaskPick` em `#quickHost`) e abre `crmOpenTask(null, {stack:true, title, description, patient_id})` por cima. Teste `tests/run_guard.js`. Sem SQL.

## Banco de Atividades (2026-10-13, 1ª entrega)
Primeiro passo do projeto "Síntese do plano": Prontuário ▾ → **Atividades** (`#tab-atividades`, `REG_CFG.atividades`, `SIMPLE_LISTS.atividades` → `config/activities {list:[{id, name, descricao, materiais, duracao (min), faixas, specIds (vazio = todas), goalIds, inativo}]}`, permissão `atividades`, cadastro da EMPRESA como os Objetivos). Janela `openActivityModal` (`#ovAct`): nome, descrição, materiais, duração, faixas etárias, especialidades e **Objetivos que Esta Atividade Trabalha** (lista de caixas `#acGoals` + combo `#acGoalAdd` para incluir; desmarcar tira). Muitos-para-muitos: `activitiesForGoal(goalId)` devolve as atividades ativas de um objetivo (para o plano, a evolução e a Agenda nas próximas entregas); `actGoalIds` ignora objetivo apagado. Objetivo com atividade ligada vira Inativar (`USAGE.objetivos`). Migração `supabase/2026-10-13e-atividades.sql` (caminho, módulo, níveis copiam Objetivos; linha 123 da conferência; `schema.sql` atualizado; `conferencia-geral.sql` NÃO regerado). Teste `tests/run_atividades.js`. Próximas entregas combinadas: atividades sugeridas no objetivo do plano e nos Detalhes do Agendamento, resumo do quadro clínico (individual e geral) por regras, botão "Gerar síntese", planilha de atividades.
- (2026-10-13) **Planilha de Atividades** (Outras Opções ▾ da tela Atividades, `IO_KINDS.atividades`, `ioActPlan`/`ioActApply`): colunas Atividade (chave), Descrição, Materiais, Duração (Min), Faixas Etárias, Especialidades, Objetivos (`Habilidade: Objetivo` separados por `;`; habilidade opcional quando o objetivo só existe numa; preenchido substitui a lista). Célula vazia não muda nada. Ajuda: tópicos Atividades e Planilhas. Lista de telas com o menu de planilha: array do `forEach` com `ioToolsMenuHtml` (só entram tipos que existem em `IO_KINDS`).
- (2026-10-13, pedido do usuário) **Plano Terapêutico → Outras Opções ▾ → Exportar / Importar Planilha** (`IO_KINDS.planos`, `ioPlanPlan`/`ioPlanApply`/`ioPlanExportRows`, menu inserido antes do `#planAdd`). Uma linha por objetivo do plano VIGENTE (Paciente, Data de Nascimento, Data do Plano, Revisão Até, Resumo do Quadro Clínico, Habilidade, Objetivo, Especialidades, Prazo, Escala, Situação, Status). Paciente = chave: com plano vigente atualiza (objetivo novo entra; existente muda só o preenchido; nada sai); sem plano cria plano novo (data padrão hoje, revisão +6 meses). Objetivo só do Banco de Objetivos (`goalId`); sem especialidade na linha usa as do objetivo/habilidade. Importar exige incluir (plano novo) ou editar completo (`planFull`). Sem SQL. Teste `tests/run_plano_planilha.js`.

## Banco de Atividades: planilhas geradas (2026-10-13)
Planilhas de objetivos (especialidades ampliadas, Aplicador ABA em todos) e de atividades (666, 10–20 por objetivo) foram geradas FORA do repositório e entregues ao usuário; importar objetivos antes das atividades.

## CRM: Caixa de Entrada (2026-10-13)
Pedido do usuário: CRM ▾ → **Caixa de Entrada** logo depois de Minhas Tarefas (`#tab-caixa`, aba `caixa`, endereço `#caixa`, `CRM_ITEMS` `crm-caixa`, `CRM_TABS`).
Abas **Principal | Histórico de Movimentações | Lidas**, busca, filtros de tipo e de lista, linhas agrupadas por data (`.cx-grp`), uma linha por tarefa com o resumo das últimas
movimentações e os botões **Limpar** / **Adiar** / **Marcar como não lida** no fim. Visual do próprio sistema (`.pat-toolbar`, `.seg`, `.pat-table`, `.btn`).
- Entram tarefas em que a pessoa é responsável, segue, foi @mencionada ou criou. Movimento próprio nunca cria novidade. Tipos (`cxType`): mencao, comentario, status,
  prazo, responsavel, anexo, outro; Preferências (Opções ▾) escolhem tipos e período (`agendaPipo:cxPrefs`, padrão 30 dias).
- Estado por pessoa em `public.task_inbox` (`cleared_at` = hora do último evento quando limpou, `snoozed_until`, `mark_unread`, RLS `task_inbox_own`); função `crm_inbox(p_days)`
  (security invoker) devolve por tarefa último movimento, total, novidades, não vistas, mencionada e os 5 últimos eventos. Evento novo depois de limpar devolve a linha à Principal sozinho.
- Atalhos: **E** limpa a linha marcada, **Shift+E** limpa tudo (Limpar Tudo com confirmação); Desfazer logo após limpar (`cxUndoRun`); abrir a linha abre a tarefa na Atividade com
  os comentários novos destacados (`.crm-cmt.cx-new`). Contador na Principal, no botão CRM, no ☰ e no ícone do app (`cxPrincipalCount` dentro de `crmBadgeCount`).
- Permissão **CRM – Caixa de Entrada** (`crmcaixa`, só ver; níveis começam com o que tinham em `crm_listas.view`); `cxCan()`.
- Migração `supabase/2026-10-13f-caixa-de-entrada.sql` (linha 124 da conferência; `schema.sql` atualizado; `conferencia-geral.sql` NÃO regerado). Rodada em produção pelo conector
  (tabela 1 | função 1 | níveis 6 | política 1). Sem sistema online (testes) a Caixa lê `CRM.mem` (`cxMemRows`).
- NÃO feito: aviso de celular apontando para a linha da Caixa (o push abre a tarefa por `/?tarefa=<id>#crm`; mudar o link exige publicar de novo a função `pipo-push`).
- Teste `tests/run_caixa.js` (no `npm test`); a aba `caixa` entra nas listas de `run_toolbar_rows`, `run_sticky_headers` e `run_cad_titles`. Ajuda: tópico `crm-caixa`.

- (2026-10-13) **Plano Terapêutico: atividades sugeridas no objetivo** (1ª entrega do projeto "Síntese do plano"). Embaixo do botão do Objetivo (`goalCell` → `actsHint`) aparece "N atividades sugeridas" (`.pl-hint.pl-acts-link[data-acts]`, sublinhado pontilhado, só nesta linha) quando `planObjActs(o, faixaDoPaciente)` acha atividades do Banco ligadas ao `goalId` que servem à faixa etária (sem faixa = todas) e a alguma especialidade do objetivo (sem especialidade = todas). Clique → `planActsModal(o, band, nome)` (`#ovPlActs` no `#quickHost`: nome, duração, descrição, materiais, faixas e especialidades; Fechar/Esc). Só leitura; escolher quais atividades o paciente trabalha, mostrar nos Detalhes do Agendamento/Evolução e a síntese do quadro clínico ficam para as próximas entregas. Sem SQL. Teste no meio de `tests/run_atividades.js`. Ajuda: tópico Plano Terapêutico.
- (2026-10-13, pedido do usuário "faça as 3") **Atividades no Plano: Detalhes do Agendamento, Evolução e Gerar Síntese.** (1) Detalhes do Agendamento: cada objetivo ganha "N atividades sugeridas" (`agdActsHint(o, band, nome)`, `AGD_ACTS`, `agdActsClick`; faixa do paciente da linha, sem faixa nos objetivos em comum do grupo) e abre `planActsModal`. (2) Evolução: em cada objetivo, "Atividades realizadas" (`planEvoActsHtml`, caixas `[data-act-on]` `.pr-goal-acts`; marcar uma atividade marca o objetivo); `planEvoGoalsRead` grava `plan_goals[].acts = [ids]` (sem SQL: o gatilho só lê planId/objId/levelId) e a linha do tempo mostra "Atividades: …" (`prGoalsWorkedHtml`; id removido do Banco = "Atividade removida"). `planEvoGoalsFor` devolve `band`. (3) Plano: botão **Gerar Síntese** (`#plSynth`, só com edição completa) → `planSynthesis(p, sections, treatSpecs)`: texto por regras com idade, diagnóstico (CID e data), suporte, comunicação, alergias, medicações, restrições (só com "Pacientes – saúde"), escola/série/turno/mediador, especialidades do tratamento, totais de objetivos ativos/atingidos/suspensos e uma linha por especialidade (ativos, habilidades, atingidos); com texto já no campo pergunta antes de substituir. A síntese não usa a situação das escalas nem as evoluções (próximo passo possível). Testes no meio de `tests/run_atividades.js`. Ajuda: Plano Terapêutico, Agenda e Prontuário.
- (2026-10-13, pedidos do usuário) **Atividade com registro**: se alguma evolução a marcou como realizada (`clinical_records.plan_goals[].acts`), `actUseCount(id)` > 0 → a janela abre só leitura (`modalReadOnly`, sem Salvar, aviso no subtítulo), Excluir vira **Inativar** (`setupInactivate`, `USAGE.atividades`) e a planilha recusa alterá-la (`ACT_USED`, `actUsedLoad` no `prepare`). Só no app (sem trava no banco: a lista fica em `config/activities`). **Evolução**: "Atividades Realizadas" recolhida dentro de cada objetivo (`[data-acts-toggle]`, contador `[data-acts-count]`, abre sozinha se já há marcada); no celular uma atividade por linha (`.pr-acts-list`).

- (2026-10-13, pedido do usuário) **Esc fecha a janela aberta em todo o sistema**: tratador global no bloco do aviso de alterações (`GUARD_IDS`): em captura grava a janela de cima (`.overlay` visível, fora `ovConfirm`/`ovGuard`); em bolha, se nenhum outro tratador resolveu a tecla (`defaultPrevented`) e não há lista/menu flutuante aberto, clica no ✕ (`.modal-close`) ou no Cancelar/Fechar/Voltar do rodapé — mesmo caminho do clique, então a pergunta Salvar / Sair sem Salvar e as regras de cada janela continuam valendo. Janelas empilhadas fecham uma por vez. Janela nova: ter ✕ ou Cancelar/Fechar. Sem SQL. Teste em `tests/run_guard.js`. Ajuda: Visão Geral do Sistema.

- (2026-10-14, pedido do usuário) **Gerar Síntese em parágrafo corrido** (`planSynthesis`): "Nome, N anos, com diagnóstico de X, apresenta plano terapêutico com prioridade nas áreas de A, B e C." (até 5 habilidades, as com mais objetivos ativos primeiro; empate = ordem do plano; uma só = "na área de"), depois "O acompanhamento é realizado por …", comunicação e nível de suporte, escola, alergias/medicações/restrições (os de saúde só com "Pacientes – saúde") e, só se houver objetivo atingido, "O plano soma N objetivos ativos e M já atingidos." Sem objetivos ativos a frase das áreas some. Saíram as linhas por especialidade. Sem SQL. Testes em `tests/run_atividades.js`. Ajuda: Plano Terapêutico.
- (2026-10-14, pedido do usuário, SUBSTITUI o item anterior de Gerar Síntese) **Gerar Síntese em frases curtas** (`planSynthesis`): "Nome, N anos, com prioridade nas áreas de A, B e C." (até 5 habilidades com mais objetivos ativos; uma só = "na área de"; sem ativos só "Nome, N anos."), "Diagnóstico: X (desde dd/mm/aaaa), nível de suporte N.", "Comunicação: …", "Acompanhamento: especialidades do tratamento." (só com tratamento), "Alergias: …", "Medicações em uso: …", "Restrições alimentares: …". Diagnóstico, suporte, comunicação e os três de saúde só com "Pacientes – saúde" (ver); campo vazio não aparece. Escola e totais do plano saíram. Teste em `tests/run_atividades.js`.
- (2026-10-14, pedido do usuário) **Gerar Síntese** (`#plSynth`) fica no canto direito da mesma linha do rótulo “Resumo do Quadro Clínico” (`.pl-sum-head`), não mais no título “Quadro Clínico”. Sem SQL.

- (2026-10-14, pedido do usuário) **Caixa de Entrada avisa quando a tarefa vence.** Tarefa em aberto (status que não finaliza) da qual a pessoa é responsável ou seguidora, com `due_date` chegando (8h de Brasília do dia), vira uma movimentação "Vencimento" na Principal ("Venceu em dd/mm/aaaa"); finalizada não avisa; nova data = novo aviso; tipo `vencimento` em `CX_TYPES` (Preferências, 8 tipos). Feito DENTRO de `crm_inbox` (união com eventos sintéticos, `data.due = true`; `cxMemRows` faz igual nos testes). O resumo diário por push das vencidas (8h) já existia. Migração `supabase/2026-10-14-caixa-vencimento.sql` (rodada em produção pelo conector; linha 125 da conferência; `schema.sql` atualizado). Teste em `tests/run_caixa.js`.

## Empréstimo a colaborador e abatimento (2026-10-14, etapa 1 de 3)
Pedido do usuário: no empréstimo CONCEDIDO o **Tomador** aceita um colaborador (lista) ou qualquer nome digitado; cada parcela pode virar **Lançamento** (Receber…) ou
**Abatimento** (desconto numa conta a pagar do MESMO colaborador). Decisões: abatimento = desconto na conta a pagar escolhida; Tomador = colaborador ou texto livre.
Etapas combinadas depois: (2) saldo devedor por colaborador + margem de desconto, quitação antecipada, rescisão; (3) Acesso → **Contratos** (modelos de termo editáveis com
variáveis, assinatura digital no futuro) e Termo do empréstimo em PDF.
- Banco (migração `supabase/2026-10-14b-emprestimo-colaborador.sql`, rodada em produção pelo conector; linha 126 da conferência; `schema.sql` atualizado):
  `finance_loans.staff_id`, `finance_payables.staff_id` (colaborador da conta) e `finance_payables.abate_id` (na PARCELA: conta a pagar onde ela é descontada, `on delete set null`);
  gatilho `finance_payables_abate_guard`: só parcela de empréstimo, não baixada, conta escolhida em aberto, sem ser de empréstimo e do mesmo colaborador.
- App: `fpDone(r)` = baixada OU abatida (as contagens de "em aberto" usam ele); `fpAbatidas(r)`, `fpDisc(r)`, `fpNet(r)` (valor − descontos), `fpAllLines(r)` (previsto do Fluxo),
  `fpStaffList()` (colaboradores ativos; id = linha do RH `prof-…`), `fpStaffName`, `fpWho` (coluna Fornecedor/Colaborador/Tomador). Conta a pagar ganhou o campo **Colaborador** e o quadro
  **Descontos de Empréstimo** (com Desfazer Abatimento). **Baixa** com abatimento (`openBaixa`): vira rateio — linhas do bruto + linhas fixas da parcela (principal “Entrada”, juros “Receita”),
  valor líquido no campo; `finance_payable_settle_split` já aceita partes de direções diferentes (o sinal vem da subcategoria). Parcela abatida fica com status “Abatida” (conta como paga no saldo
  do empréstimo, `lnStats`) e sai da lista de em aberto. `lnAbaterDialog(parcela, loan, done)` escolhe a conta (só do mesmo colaborador, líquido ≥ parcela). Janela do empréstimo salvo com
  botões Receber… / Abater… / Desfazer Abatimento por parcela. Tomador: input + `.autolist` (`#lnParteSug`), nome escolhido grava `staff`; texto livre grava só `parte`.
- Teste `tests/run_emprestimo_colab.js` (no `npm test`). Ajuda: tópico “Empréstimos Tomados e Concedidos”.
- (2026-10-14, etapa 2 de 3) **Margem, quitação, refazer, saldo por colaborador e rescisão.** `config/clinic.margemDesconto` (% máximo de desconto de empréstimo numa conta a pagar de colaborador, padrão 30; `clinicMargem()`; campo no cartão **Financeiro** da janela Clínica): `lnAbaterDialog` mostra o % e pede confirmação “Acima da Margem de Desconto”. Contrato salvo: **Quitar Antecipadamente…** (`lnQuitarDialog`: principal das abertas + juros só das já vencidas até a data) e **Refazer Parcelas em Aberto…** (`lnRefazerDialog`, usa `lnSchedule`); ambos trocam as parcelas abertas por novas via `lnReplaceOpen` (apaga as abertas, cria as novas numeradas depois da maior parcela que sobrou e acerta `parcelas` do contrato; abatidas/baixadas ficam). Empréstimos Concedidos: botão **Por Colaborador** (`openSaldoColaboradores`, `lnStaffBalance(sid)`: saldo, abatido aguardando pagamento, parcelas em aberto, próximo vencimento, já devolvido). Desligamento de colaborador (`openStaffModal`): a confirmação cita o saldo de empréstimo (`lnRescisaoMsg`) e depois oferece criar a conta a pagar da rescisão (`lnRescisaoOffer` → `openConta(null, {pre})`; `openConta` ganhou o 2º parâmetro). Sem SQL. Testes no fim de `tests/run_emprestimo_colab.js`.

## Contratos e Termo do empréstimo (2026-10-14, etapa 3 de 3)
Pedido do usuário: Acesso → **Contratos**, onde se cria e edita um termo para usar no sistema (futuramente com assinatura digital), e o **Termo em PDF** do empréstimo.
- Cadastro da EMPRESA `config/contract_templates {list:[{id, name, tipo ("emprestimo"|"geral"), content (HTML sanitizado por `prSanitize`), inativo, _upd}]}`
  (`SIMPLE_LISTS.contratos` → `state.contracts`, `REG_CFG.contratos`, permissão **Contratos** `contratos` ver/incluir/editar/excluir no grupo Menu Acesso; menu Acesso → Contratos
  clica no botão oculto `#mainTabs [data-tab="contratos"]`, tela `#tab-contratos` como Unidades). Sem modelo cadastrado vale `CONTRACT_DEFAULT` (Termo de Empréstimo a Colaborador);
  salvar o padrão cria o modelo do usuário (`contractsList()`).
- Janela `openContractModal`: Nome, Tipo, Inativo, barra de formatação (mesma do Prontuário: `.pr-toolbar`/`.pr-editor`) e segunda barra com botões de VARIÁVEIS (`CONTRACT_VARS`,
  texto `{{nome}}` inserido no cursor), Pré-Visualizar (dados de exemplo, `contractContext(null, true)`) e Imprimir/PDF.
- `contractRender(html, ctx)` troca `{{var}}` (texto escapado; `tabela_parcelas` já é HTML; desconhecida fica e é avisada), `contractContext(loan, sample)` monta as informações
  (clínica = `state.clinic`; tomador = colaborador do `loan.staff` — CPF/cargo — ou o nome digitado; parcelas de `lnPayables`), `numExtenso(v)` (reais por extenso), `contractPrint` →
  `demPrintFrame` (CSS `CONTRACT_PRINT_CSS`; `prSanitize` tira classes, então a tabela usa o estilo de `table`). Variável nova: acrescentar em `CONTRACT_VARS` e em `contractContext`.
- Empréstimo concedido salvo: botão **Termo em PDF…** (`lnTermoDialog`: escolhe o modelo — tipo Empréstimo ou Geral, ativos —, prévia, Imprimir / PDF).
- Migração `supabase/2026-10-14c-contratos.sql` (caminho em `documents_path_valid` e `module_for_path`; tem `drop constraint`, então roda no SQL Editor; linha 127 da conferência;
  `schema.sql` atualizado). Nenhum nível recebe a permissão: o Administrador libera. Ajuda: tópico “Contratos”. Teste `tests/run_contratos.js` (no `npm test`).

## Agenda ▾ Agendamentos (2026-10-14)
Pedido do usuário: lista de todos os agendamentos dos pacientes na Agenda; clicar abre os Detalhes do Agendamento, com botão **Ver na Agenda**.
Decisões: lista corrida com busca por paciente e resumo no alto que acompanha busca/filtros; extras: filtros e período, resumo e alertas por paciente, exportar/imprimir, ações rápidas.
- Menu Agenda ▾ → **Agendamentos** (`#tab-agendamentos`, aba `agendamentos`, endereço `#agendamentos`, `AG_ITEMS`/`AG_TABS`; permissão = a da Agenda, ver; `tabModule.agendamentos = "agenda"`; sem SQL). Bloco "Agenda ▾ → Agendamentos" depois da Visão Geral: `LG` (estado), `lgPeriod` (Hoje, Esta Semana, Este Mês [padrão], Próximos/Últimos 30 Dias, Mês Passado, Personalizado + De/Até, máx. 13 meses), `lgLoad` (`agdFetchRange`), `lgOnRealtime` (canal da Agenda), `lgShown`, `lgAnalyse`, `lgRender`, `lgExportCsv`, `lgPrint`, `wireAgendamentos`.
- Só atendimentos de PACIENTES (sem bloqueio/reunião/treinamento/grupo). Colunas: Data, Hora, Paciente, Profissional, Especialidade, Serviço, Sala, Status, Ações (Status ▾ e Ver na Agenda); até 1500 linhas na tela (CSV leva todas). Celular: Data, Hora, Paciente, Status.
- Resumo (`.fl-card`): Pacientes, Agendamentos, Realizados (Finalizado), Faltas (`LG_ABSENT`), Próximos; com um paciente só: Paciente (idade), Próximo e Último atendimento. Alertas (botões `.tr-due-btn` que filtram; só computador): sem status já passado, 2+ faltas, sem próximo atendimento (período que chega a hoje), paciente bloqueado.
- `agdOpenDetails` mostra **Ver na Agenda** (`#agdDetGo`) quando a tela aberta não é a Agenda; `prGoToAppointment(rec, noDetails)` vai à Agenda no dia/profissional e destaca a célula. `agdSetStatus` chama `lgPatch`.
- Teste `tests/run_agendamentos.js` (no `npm test`); a aba entra em `run_toolbar_rows`, `run_sticky_headers`, `run_cad_titles`. Ajuda: tópico `agendamentos`.

## Caixa de Entrada: coluna Responsável (2026-10-14)
Pedido do usuário: coluna **Responsável** (`.cx-resp`, `crmAvatars(t.assignees)`) logo depois de "O que Mudou". No celular fica oculta (colunas 3 a 5 escondidas).

- (2026-10-14, correção) **Abrir Tratamento / + Incluir na janela do paciente fechava a janela do paciente sem salvar**: `openTreatmentModal(t, {stack: true})` agora abre por cima (`regQuickHost()`, `.confirm-overlay`), como as outras janelas empilhadas; Esc fecha só a do tratamento. Janela aberta a partir de outra janela: usar `stack`. Ainda fecham a janela de origem de propósito (sem aviso de alterações): Tratamento → Cadastro do paciente / Plano Terapêutico, Conta → Pagar/Receber.

- (2026-10-14, pedido do usuário) **Data de Revisão da Intervenção ABA** no tratamento: campo `#pAbaRev` (`abaRevisao`, iso, em `TREAT_FIELDS`) ao lado da caixa Intervenção ABA, que agora alinha com os campos da linha (rótulo vazio em cima). Lista de Tratamentos: coluna **Data de Revisão** (`trAbaRevCell`) logo depois de ABA, com `(Vencida)` em vermelho quando a data passou e o tratamento está Ativo; no celular o Status passou a ser a 9ª coluna. Sem SQL. Abrir Tratamento a partir do paciente usa a camada `#stackHost` (z-index 55; `#tlHost .overlay` 56; `.overlay.confirm-overlay` 60).

- (2026-10-14, pedido do usuário) **Avisos de vencimento: revisão do ABA, tratamento e encaminhamento.** Nova automação do CRM `aba_revisao_vencendo` ("Revisão da Intervenção ABA Vencendo", grupo Tratamentos e Cadastro, padrão lista Atendimento, avisa N dias antes) cria a tarefa "Revisar a Intervenção ABA de [paciente]" para tratamento Ativo com `abaRevisao` perto de vencer/vencida; ela cai na Caixa de Entrada de quem é responsável (como `trat_vencendo` e `encaminhamento_vencendo`, que já existiam; as três nascem DESLIGADAS e se ligam em CRM ▾ Automações). Banco: `crm_auto_r_aba_revisao` + `crm_auto_run` com a regra nova — `supabase/2026-10-14d-crm-aba-revisao.sql` (linha 128 da conferência; `schema.sql` atualizado; `conferencia-geral.sql` NÃO regerado). Tratamentos: botões de alerta "N revisões ABA vencem nos próximos 30 dias" / "N revisões ABA vencidas" e filtros `abavencendo`/`abavencida` (`trAbaRevState`). Testes: `run_crm_auto.js` (27 regras), `run_tr_monthly.js`.

- (2026-10-14, pedido do usuário) **Contratos: 13 tipos e alinhamento do texto.** `CONTRACT_TIPOS` (Empréstimo, Tratamento, Confissão de Dívida, Locação, Serviços, Visita Técnica, Patrocínio Educacional, Capacitação, Compromisso, Interrupção Contratual, Responsabilidade de Material, Visita Técnica e Observação Profissional, Geral; ids `emprestimo`/`geral` mantidos). Só o Termo do Empréstimo usa um tipo hoje (`contractsFor("emprestimo")` + Geral); os outros tipos já podem ser cadastrados e serão ligados às telas (paciente, tratamento, colaborador) depois. A barra do editor ganhou Esquerda / Centro / Direita / Justificar (`justifyLeft/Center/Right/Full`); `prSanitize` agora preserva só `text-align` (left|center|right|justify) em P, H1–H4, LI, TD, TH e DIV (vale também para o Prontuário). Sem SQL. Teste em `run_contratos.js`.

- (2026-10-14, pedido do usuário) **Contratos: as variáveis mudam conforme o Tipo.** `CV` (catálogo por assunto: clínica, data, tomador, empréstimo, colaborador, paciente, responsável, tratamento, devedor, dívida, locação, serviço, visita, patrocínio, capacitação, compromisso, interrupção, material) e `CONTRACT_VARS_BY[tipo]` (quais grupos cada tipo usa; Clínica e Data valem para todos); `contractVarsFor(tipo)`/`contractVarsHtml(tipo)` montam a barra `#ctVars`, que se refaz ao trocar o Tipo. Grupos com `manual: true` (dívida, locação, serviço, visita, patrocínio, capacitação, compromisso, interrupção, material) não vêm de cadastro: o título mostra “(Preencher ao Gerar)”, a tela de cada tipo vai pedir esses dados. Pré-visualização usa dados de exemplo de todas as variáveis (`contractContext(null, true)`). Só o contexto real do Empréstimo (`contractContext(loan)`) existe; contextos de paciente/tratamento/colaborador entram quando cada tipo ganhar a sua tela. Tipo “Termo de Visita Técnica” (simples) removido a pedido do usuário: ficou só “Visita Técnica e Observação Profissional” (12 tipos).

- (2026-10-14, pedido do usuário) Contratos: barra de variáveis (`#ctVars`) organizada em UMA LINHA POR GRUPO (`.ct-vgrp`: nome do grupo + botões, alinhados à ESQUERDA e centralizados na vertical, divisória entre os grupos); sem os separadores verticais de antes. Sem SQL.

## Agenda ▾ Agenda Planner (2026-10-14)
Pedido do usuário: a agenda REAL (por data) no visual do Planner, com o mês no primeiro campo da barra. Decisões: **um dia por vez** (mês · data · ‹ Hoje › ·
filtros de sala, profissional, especialidade e status · busca · tela cheia · + Incluir · ?); **visualizar e editar**; atendimento de profissional sem coluna
na sala vai para a coluna **Outros** da sala. Sem SQL.
- Menu Agenda ▾ (ordem): Agenda, **Agenda Planner**, Agendamentos, Visão Geral (`AG_ITEMS`/`AG_TABS`); aba `agendaplanner`, `#tab-agendaplanner`, grade `#agpGrid`
  (tabela `table.sched.agp-table`, cabeçalhos `.grouphead`/`.seathead`, células `td.slotcell.agp-slot` com `data-d/t/p/rm/grp`); permissão = a da Agenda
  (`tabModule.agendaplanner = "agenda"`); fora do celular (`MOBILE_HIDDEN_TABS`); endereço `#agendaplanner`.
- Bloco "Agenda ▾ Agenda Planner" antes de "Planner: Limpar Semana": prefixo **`agp`** (o `ap*` é do Auto Planner — nunca reutilizar: funções com o mesmo nome se
  sobrescrevem). `AGP` (filtros), `agpOnShow`, `agpBuild` (sala/grupo → colunas por terapeuta; `agpRoomOfRow`; profissional com 2+ colunas na sala recebe um
  atendimento por coluna no mesmo horário; "Outros" e "Sem Sala" só aparecem quando há atendimento), `agpRender`, `agpFillFilters`, `agpTarget`, `agpRefuse`,
  `wireAgendaPlanner`.
- Usa os MESMOS dados e regras da Agenda: `AD.rows` (semana da data aberta; a data `AD.date` é compartilhada), `agdLoadWeek`, `agdEventHtml`, `agdOpenDetails`,
  `agdOpenModal`, `agdPlace` (ganhou o ramo `fromAp`: a coluna define profissional e sala; no grupo a sala marcada não muda), `agdDeleteRow`, desfazer/refazer,
  barra de copiar/mover (`agdRenderClipboardBar` desenha nas duas telas) e Ctrl+Z/Y/Esc. `agdRender()` redireciona para `agpRender()` quando a aba aberta é a Agenda Planner.
- Grupo de suporte só recebe atendimento de grupo e coluna de sala só de paciente (`agpRefuse`); bloqueio/reunião/treinamento valem em qualquer coluna.
  Não tem os botões liberar/bloquear/limpar por coluna e linha (ficam na Agenda).
- Ajuda: tópico `agenda-planner`. Teste `tests/run_agenda_planner.js` (no `npm test`); a aba entra em `run_toolbar_rows.js`.

## Tratamento: "+ Incluir Todas" nas Especialidades e Serviços (2026-10-14)
Menu **Outras Opções ▾** (`#specMoreBtn`) ao lado de "+ Incluir Especialidade" (`treatFieldsEditor`) com **Incluir Todas** (`#specRowAddAll`), **Remover Todas** (`#specRowRemoveAll`, confirma; quadros travados ficam) e **Distribuir** (`#specRowDistribute`: divide o Sessão/Mês inteiro igualmente, resto nos primeiros; total menor que o nº de quadros = avisa e não muda; confirma). Incluir Todas cria um quadro de **1 sessão/mês** (serviço Sessão, ABA padrão do quadro novo, terapeuta
"Todos") para cada especialidade ATIVA, menos as de nome com "Aplicador" (Aplicador ABA) e as que já têm quadro de Sessão; clicar de novo não duplica. Sem SQL.
Ajuda: tópico "Tratamento: Terapeuta e Horário do Paciente". Teste `tests/run_tr_incluir_todas.js` (no `npm test`).
- (2026-10-14, pedido do usuário) Agenda Planner: **sem o "+" de marcar mais um atendimento** na célula e **com as travas visuais do Planner** (`slot-off prof-busy` / `aba-lock`, listras cinza e branco, motivo no `title`, clique mostra o motivo): célula vazia da coluna de um profissional que atende em outra sala/grupo ou está em reunião/treinamento no horário, e salas com paciente "não ABA" (`isNaoABABooking`); calculadas dos atendimentos reais do dia (sem os filtros) e respeitam as regras do Sistema `ag_prof_dois`, `ag_reuniao_prof`, `ag_nao_aba`. Bloqueio de horário (`planner_blocks`) é só do Planner.

## NOMES ANTIGOS SUPERADOS (aviso de leitura, 2026-10-14)
Este arquivo é um histórico: seções antigas usam nomes que já mudaram. Vale sempre o mais novo:
- Aba/seção/permissão do Planner = `planner` (`#tab-planner`; antes `agenda`); aba/permissão da Agenda por data = `agenda` (`#tab-agenda`; antes `agendadia`/`agendamentos`); Resumo = `resumo` (antes `relatorio`).
- Permissões `rh_funcionarios`/`rh_remuneracao` = `colaboradores`/`colaboradores_valores`; abas `funcionarios`/`tiposfunc` = `colaboradores`/`tiposcolab`. O botão/menu **RH** não existe mais (Cadastros → Colaboradores).
- Tratamento: `pacoteHoras`/`despesas` = `sessoesMes`/`descontos`; profissional: `name` = `nome`. A permissão `profissionais` saiu dos Níveis.
- Menu Planner ▾ e Agenda ▾ (Agenda, Agenda Planner, Agendamentos, Visão Geral) substituem os botões soltos antigos; Status e Unidades saíram de Acesso/Cadastros para os lugares descritos nas seções mais novas.

## Revisão de títulos e desempenho (2026-10-14)
- Title Case aplicado em: diálogos de confirmação ("Tem Certeza?", "Mesclar Cadastros?", "Finalizar sem Evolução?", "Descartar Alterações?", "Restaurar o Backup?", "Lançamento Repetido?", "Substituir Agendamento?"), títulos da Disponibilidade, "Contratado × Realizado (Mês a Mês)", "Sessões/Mês", títulos de tarefas criadas por conta, botão "Não Lida" e TODOS os rótulos de `SYS_RULES` (tela Acesso → Sistema).
- Agenda Planner: `agpRender` monta o HTML sem marcas de busca e aplica com `agdPatchGrid(host, html, "table.agp-table")` (só troca as células que mudaram); busca e status usam `agpApplySearch()` (liga/desliga `search-hit`, `search-dim-item`, `match` sem redesenhar); busca com espera de 150 ms; `agpFillFilters` só refaz as listas quando as opções mudam.
- Financeiro/CRM: `gtRender` mostra 300 linhas (`GT_PAGE`) nas listas de `GT_PAGED` (lancamentos, conciliacao, pagar, receber, crm-lista, crm-mine, crm-all) com botão "Mostrar Mais" (`data-gt-more`); `GT_MORE`/`gtMoreReset(id)` zeram ao buscar; `debounce150(fn)` nas buscas de Lançamentos, Contas, Conciliação e CRM. Lista nova grande: acrescentar o id em `GT_PAGED`.

## Vendas dos tratamentos (2026-10-15, etapas 1 a 4)
Pedido do usuário: cada tratamento é uma venda e cada alteração é uma nova venda; controlar vendas e comissões; gerar parcelas (opcional) no Contas a Receber; cancelar
tratamento pergunta das parcelas e das sessões. Decisões: valor da venda **mensal** (× meses); **comissão** nasce no primeiro atendimento FINALIZADO do tratamento (etapa 5, NÃO feita);
no cancelamento a pergunta é "remover as sessões do Planner e da Agenda a partir da data X" (já existia: `trOfferRemoveBookings`) — a trava de alteração com sessões agendadas NÃO foi feita.
- Banco (migração `supabase/2026-10-15-vendas.sql`, rodada em produção pelo conector; linha 129 da conferência de migrações; `schema.sql` atualizado; `conferencia-geral.sql` NÃO regerado):
  `treatment_sales` (treatment_id, patient_id, tipo nova|renovacao|aditivo, data, seller_id/name, valor_mensal, meses, total, forma, status ativa|substituida|cancelada, replaced_by, obs, unit_id; RLS pela
  permissão **Vendas** `vendas` ver/incluir/editar/excluir — nenhum nível recebe, o Administrador libera; `MODULES` nos dois js, grupo Financeiro) e `finance_payables.sale_id`. Backup inclui `treatment_sales`.
- App (bloco "Vendas dos tratamentos", antes de "Mostrar inativos"): `SALES`, `slLoad`, `slInsert`, `slPatch`, `slOf`, `slKey` (valor, descontos, Sessão/Mês, soma dos quadros, convênio, vencimento — mudou = venda),
  `slPlanParcels` (entrada no 1º vencimento + n parcelas iguais; centavos na última), `slOnTreatmentSaved(ctx)` (chamado ao salvar em `openTreatmentModal`; devolve Promise ou null),
  `slSaleDialog` (`#ovSale`: tipo, data, vendedor, forma, valor mensal, meses, total, parcelas opcionais com prévia, parcelas em aberto da venda anterior manter/excluir; a anterior vira Substituída),
  `slCancelFlow`/`slCancelDialog` (`#ovSlCanc`: excluir todas as em aberto / só as que vencem a partir de uma data / manter; recebidas não mudam; venda ativa vira Cancelada),
  `trSalesHtml` (grupo **Vendas** recolhível na janela do tratamento). Parcelas = contas a receber com `sale` (id da venda) e `grupo` = id da venda.
- Regra do Sistema `tr_cancel_pendencias` ("Perguntar das Sessões e Parcelas ao Cancelar", Avisar/Desligado, padrão Avisar): desligada, o cancelamento não pergunta nem das parcelas nem das sessões.
- Sem o sistema online (testes) a janela de venda só abre com `window.__pipoSales = true`. Teste `tests/run_vendas.js` (no `npm test`). Ajuda: tópico `vendas`.
- Próximas etapas combinadas: 5) Regras de Comissão (cadastro; percentual por tipo; conta a pagar ao vendedor no fechamento; estorno no cancelamento), 6) Painel de Vendas (relatório: conversão lead→venda, ticket, churn),
  7) extras (contrato automático, inadimplência, metas, aprovação de desconto).

## Comissões de venda (2026-10-15, etapa 5)
Decisão do usuário: a comissão nasce no **primeiro atendimento FINALIZADO do tratamento**. Menu Financeiro ▾ → **Comissões** (item com `open`, sem aba: `openComissoes()`; permissão
`comissoes` ver/incluir/editar/excluir, nenhum nível recebe; `MODULES` nos dois js, `PERM_MODULE_LABELS`).
- Banco (migração `supabase/2026-10-15b-comissoes.sql`, rodada em produção pelo conector em partes — o script inteiro estourou os 60 s; linha 130 da conferência; `schema.sql` atualizado;
  `conferencia-geral.sql` NÃO regerado): `commission_rules` (name, tipo todas|nova|renovacao|aditivo, percentual, seller_id opcional, plan_id = subcategoria de DESPESA, account_id, pay_day 1–28, inativo)
  e `sale_commissions` (sale_id ÚNICO = no máximo uma por venda, base, percentual, valor, status gerada|estornada, payable_id, obs). Backup inclui as duas.
- App (bloco "Comissões de venda", depois do bloco de Vendas): `comRuleFor(sale)` (mais específica vence: vendedor+tipo, vendedor, tipo, todas; inativa não vale), `comBase` (aditivo = total − total da venda
  que ele substituiu; os outros = total), `comApurar(silent)` (venda ativa com vendedor e sem comissão + `trDoneCount(t) > 0` com `trLoadLast(true)`; cria a conta a pagar do vendedor — `staff` = vendedor,
  vencimento no `pay_day` do mês seguinte — e a comissão; erros por venda vão em `skip[]`), `comApuraAuto()` (chamado em `agdSetStatus` ao finalizar), `comReverse(saleIds)` (chamado em `slCancelFlow`:
  conta a pagar em aberto é excluída; já paga só avisa o valor a descontar), `openComissoes` (filtros vendedor/situação, resumo A Pagar/Paga/Estornada, Apurar Agora), `openComRules`/`openComRuleDialog`.
  Situação mostrada = Estornada, Paga (conta com lançamento) ou A Pagar (`comStatusText`).
- Sem o sistema online (testes) as comissões só funcionam com `window.__pipoSales = true`. Teste `tests/run_comissoes.js` (no `npm test`). Ajuda: tópico `comissoes`.
- Próximas: 6) Painel de Vendas (relatório), 7) extras (contrato automático, inadimplência, metas, aprovação de desconto).

## Painel de Vendas, metas, contrato do tratamento, inadimplência e desconto máximo (2026-10-15, etapas 6 e 7)
Pedido do usuário ("Faça tudo"). Permissão `vendas` em tudo (Financeiro ▾ → **Painel de Vendas**, item com `open`, sem aba).
- **Painel** (`openPainelVendas`, `pvCompute(from, to, seller)`): período + vendedor; cartões (vendas e total, ticket médio, novas/renovações/aditivos, canceladas, conversão de leads, parcelas vencidas);
  tabelas por vendedor (com comissão gerada), tipo, mês, metas do mês e parcelas vencidas; Exportar Excel (`xlDownload`). Venda cancelada não entra no total. Conversão = vendas Novas ÷ leads criados no
  período em listas do CRM com `lead` (`CRM.tasks`, só quando o CRM já carregou).
- **Metas**: tabela `sale_goals` (seller_id nulo = equipe, ym, valor, qtd; único por unidade+vendedor+mês), `GOALS`, `goalLoad/goalSave/goalDelete`, janela `openMetasVendas`. Migração
  `supabase/2026-10-15c-metas-de-vendas.sql` (rodada em produção em partes; linha 131 da conferência; `schema.sql` atualizado). Backup inclui.
- **Inadimplência**: `pvOverdue(saleIds)` = contas a receber da venda (`sale_id`) não recebidas e vencidas; aparece no painel e como “N vencida(s)” na lista Vendas do tratamento.
- **Contrato do tratamento**: botão **Contrato** em cada venda do grupo Vendas → `slContratoDialog(sale)` (modelos do tipo Tratamento/Geral de Acesso → Contratos), `contractContextSale(sale)` (paciente,
  responsável financeiro/mãe/pai, tratamento, venda) e variáveis do grupo `venda` (`CV.venda`, incluída em `CONTRACT_VARS_BY.tratamento`; `tabela_parcelas_venda` é HTML como `tabela_parcelas`).
- **Desconto máximo na venda**: campo `descontoMax` (%) no cadastro da Clínica (`clinicDescMax()`); ao salvar tratamento com desconto acima, quem NÃO tem Vendas (editar) é barrado e quem tem confirma
  “Desconto Acima do Limite” (aprovação). Vazio = sem limite.
- Teste `tests/run_painel_vendas.js` (no `npm test`). Ajuda: tópico `painel-vendas`.
- NÃO feito: aviso automático ao agendar paciente inadimplente e automação do CRM de cobrança (ideias para depois).

## Relatório Elegibilidade (2026-10-15)
Relatórios → **Elegibilidade** (`RP_TYPES` id `elegibilidade`, `RP_BUILDERS.elegibilidade`; permissão `relatorios.elegibilidade` em `REPORTS` de `js/usuarios.js`): pacientes atendidos na Agenda no período (um registro por paciente, sem bloqueio/reunião/treinamento) com Paciente, Convênio, Plano e Carteirinha (convênio/plano do tratamento vigente na última data atendida; carteirinha do cadastro). Para ver um dia, De e Até iguais. Filtro de convênio. Sem SQL. Teste `tests/run_elegibilidade.js`. Ajuda: tópico Relatórios.

## Rede Social no cadastro do paciente (2026-10-15)
Grupo **Contato**: campo de uma linha **Rede Social** (`redeSocial`, `PAT_FIELDS` tipo `line`, input `#pf-redeSocial`, depois dos e-mails; aparece/obrigatório em Campos obrigatórios; ficha impressa; Ajuda do paciente). Fora do link de cadastro (não está em `LINK_OF_FIELD`; `run_intake.js` o ignora). Sem SQL.
- (2026-10-15, pedido do usuário) **Incluir Todas** (quadros do tratamento) inclui nesta ordem: Fonoaudiologia, Psicologia, Terapia Ocupacional, Psicopedagogia, Psicomotricidade, Fisioterapia, Musicoterapia, Nutrição (pelo começo do nome, `ORD` no clique de `#specRowAddAll`); outras especialidades vão depois, na ordem do cadastro. Sem SQL.

- (2026-10-15, pedido do usuário, com imagem do modelo) **Tratamento: quadro de informações do paciente** acima de "Especialidades e Serviços" (`trInfoBoxHtml(v)` em `treatFieldsEditor`, reaproveita `.pl-clin`/`.pl-clin-it` do Plano Terapêutico): Idade, Diagnóstico e Nível de Suporte numa linha ("—" quando vazio; Diagnóstico e Suporte mostram "Sem permissão" sem "Pacientes – Saúde"). Sem SQL.
- (2026-10-15, pedido do usuário) Salvar tratamento: o tratamento (e os valores) é gravado ANTES de abrir "Registrar Venda"; "Agora Não" só pula a venda e nunca desfaz a alteração. Agora aparece o aviso "Tratamento salvo." e o subtítulo da janela diz "já salvo". Teste: `run_vendas.js` (e conferido que o tratamento fica salvo após "Agora Não").

- (2026-10-15, pedido do usuário) **Quadro do tratamento: Dia aceita vários dias.** `#tlDia` virou lista de marcar (`.ms`, painel `#tlDia`, resumo `#tlDiaMs`); `dia` é gravado como texto separado por vírgula ("seg,qua"; um dia só e vazio = como antes). Helpers `tlDays(r)`/`tlDaysText(r)`; o horário (`#tlHora`) mostra a união dos horários dos dias marcados; avisos conferem cada dia (sessões/mês esperado = semanas × seguidas × nº de dias); quadro repetido compara os dias ordenados; Auto Planner só usa os dias marcados. `tests/tl-helper.js` aceita `dia: "seg,qua"`. Sem SQL.

- (2026-10-15, correção) **Janela do paciente → Abrir Tratamento abria a versão antiga**: o botão usava o tratamento lido na abertura da janela. Agora busca o tratamento ativo atual (`activeTreatment(v.id)`) ao clicar, e o cartão do tratamento na janela do paciente se atualiza sozinho quando o tratamento muda (`window.__patTrRefresh`, chamado em `afterTreatmentsChange`). Conferidas as outras janelas abertas por cima/de dentro de outra (CRM → paciente, lista de pacientes, Tratamento → paciente): todas já buscam o registro atual. Regra: ao abrir janela a partir de outra, buscar o registro pelo id na hora do clique, nunca usar objeto guardado. Sem SQL.

- (2026-10-15, pedido do usuário) **Botão Remover em cada quadro do tratamento** (`[data-tl-rm]`, ao lado de Editar; `btn danger`): confirma com `confirmDialog` e tira o quadro do rascunho (vale ao salvar o tratamento). Quadro travado por atendimentos realizados não tem o botão. Sem SQL. Teste em `run_tr_quadros.js`.

- (2026-10-15, pedido do usuário) **Diagnóstico (CID) pesquisa pelo nome ou pelo código CID**: as opções de `diagOptionsHtml` levam `data-search` = código; os campos de digitar (`dpEnhanceCombo`) e as listas com busca (`dpEnhanceTimeList`) incluem `data-search` no filtro (`data-n`) e aceitam o código exato ao sair do campo. A lista continua mostrando só o nome. Qualquer `<select>` pode usar o mesmo `data-search`. Sem SQL. Teste no fim de `tests/run_combo.js`.

- (2026-10-15, pedido do usuário) **Quadros da mesma especialidade com ABA e Semanas diferentes**: `treatLineFor(lines, profId, service, week)` e `bookingAbaOf/bookingPatient/isNaoABABooking(..., week)` escolhem o quadro da SEMANA do atendimento (`tlPickWeek`: os com `semanas` marcadas antes dos de "Todas"). Semana: Planner pelo documento (`dia-semana`), Agenda pela data (`tlWeekOfDate`: a 1ª semana começa na primeira segunda-feira do mês, como em Enviar para a Agenda; fora das semanas 1–4 = 0 = sem filtro). `trLineKey(lines, {prof, svc, d | wk})` (Contratado × Realizado, Planner/Agenda do tratamento), `pkCompare`, Disponibilidade, Auto Planner (`apOcc.wk`) e as regras "não ABA" usam a semana. Sem SQL. Teste `tests/run_aba_semana.js`.

- (2026-10-15, pedido do usuário) **Remover quadro do tratamento não pede confirmação** (`[data-tl-rm]` tira do rascunho na hora; só vale ao Salvar o tratamento, e o aviso de alterações cobre o resto). Substitui o confirmDialog da nota anterior.

- (2026-10-15, pedido do usuário) **Vendas só Nova ou Aditivo**: a janela Registrar Venda oferece só esses dois (`SALE_TIPOS_NEW`; "Renovação" fica só nas vendas antigas). **Renegociar sem mudar valor, descontos, Sessão/Mês nem a soma dos quadros NÃO gera venda** (`slKeyQty`, `ctx.reneg` em `slOnTreatmentSaved`); renegociar com mudança vira Aditivo (comissão sobre a diferença para a venda anterior). Edição de tratamento já existente segue `slKey` (como antes). Sem SQL.

- (2026-10-15, correção) **Renegociar a partir da janela do paciente dava erro** (“Cannot read properties of null (reading 'patientId')”): o tratamento aberto por cima (`stack`) ficava na tela e a janela nova abria por baixo; os dois `#ovTreat` embaralhavam os campos. Agora Renegociar e a troca de paciente reabrem na mesma camada (`stack: opts.stack`) e `trMonthSectionWire` ignora tratamento nulo. Sem SQL.

- (2026-10-15, pedido do usuário) **Listas de marcar da Agenda (Outras Opções) com “Marcar Todos”** (`agdPickHtml`: caixa `[data-pick-all]` acima da lista, marca/desmarca os itens visíveis do filtro e acompanha as marcações). **Exportar Excel abre com todos os profissionais e salas marcados.** As outras ferramentas continuam abrindo só com o profissional/sala da tela marcado. Sem SQL.

- (2026-10-15, pedido do usuário) **Venda do tratamento renegociado = diferença.** `slPlan(rec, vMes, vDesc, renegId, others)`: tratamento novo = valor final integral (Nova); `rec.tipo === "renegociado"` = valor final − valor final do tratamento anterior (`slPrevTreatment`: o de onde se renegociou, o ativo que virou Renegociado ou o mais recente que começou antes), tipo Aditivo; diferença ≤ 0 não gera venda (aviso na tela). A venda anterior continua ATIVA (não é mais Substituída nem mexe nas parcelas). **Uma venda por tratamento** (`slHasSale`): salvar de novo não pergunta. Botão **Gerar Venda** (`#trGenSale`, antes de Cancelar, só tratamento Ativo já salvo sem venda; `slManualSale`) usa os valores salvos. Sem SQL. Teste `tests/run_vendas.js`.

- (2026-10-15, pedido do usuário) **Renegociar salva antes**: se a janela do tratamento aberto tem alterações (`overlay.__dirty`), o botão Renegociar clica em Salvar (`sv._thenReneg`; repassado nos re-cliques de "Redistribuir"/"Soma diferente") e, depois de gravar e de passar a pergunta da venda, abre o tratamento renegociado a partir do registro salvo (`afterAll`). Sem alterações, abre direto. Sem SQL. Teste `tests/run_reneg_salva.js`.

- (2026-10-15, pedido do usuário, SUBSTITUI "Regras 'não ABA' só para Sessão" no que ela diz de outros serviços) **Especialidade cadastrada no tratamento = vale o ABA do quadro, em qualquer serviço.** `abaLineFor` (quadro do serviço; sem ele, o quadro de Sessão da especialidade do profissional) e `abaRuleApplies(b, profId, week)`: Sessão sempre; outro serviço só se há quadro para o profissional (sem quadro continua isento, como antes). `isNaoABABooking`, `bookingAbaOf`, `plannerConflict` e `agdConflictIn` usam. Sem SQL. Testes em `run_aba_linha.js`.
- (2026-10-15, pedido do usuário, SUBSTITUI a isenção da nota anterior) Sem quadro para o atendimento, vale o ABA geral do tratamento (`abaFallback`) — a regra "não ABA" vale em TODOS os serviços; `abaRuleApplies` ficou sempre verdadeiro.

- (2026-10-15, pedido do usuário) Nas telas/janelas ligadas ao paciente ou ao tratamento o rótulo é **Intervenção ABA** (não só "ABA"): Detalhes do Agendamento (aba Tratamento), cartão do tratamento, resumo do quadro, coluna da lista de Tratamentos, avisos de revisão, Níveis de permissão. Lista de Tratamentos ganhou a coluna **Sessão/Mês** logo antes de Valor Final (celular não muda: Paciente + Status). Sem SQL.

- (2026-10-15, pedido do usuário) **Contas nos campos de dinheiro**: começando com `=` o campo calcula (`=1500-200`, `= 3 x 450,50`, `=(100+50)/2`; + - * x / ( ), vírgula ou ponto decimal) ao sair do campo e preenche o resultado. `calcMoneyExpr(txt)` (sem `eval`, leitor próprio; null se inválida ou divisão por zero) fica antes de `parseMoney`, que também entende `=`; vale nos `data-money` (foco fora) e em Valor/Descontos do tratamento (`#trVal`/`#trDesp`, atualizam o Valor Final). Conta inválida limpa o campo e avisa. Sem SQL. Teste `tests/run_money_calc.js`.

- (2026-10-15, pedido do usuário) **Comissão de venda nasce no que vier primeiro: a 1ª parcela da venda paga (recebida) OU o 1º atendimento finalizado do tratamento.** `comSalePaid(s)` (conta a receber com `sale` = venda e `entry`); `comApurar` só espera quando nenhum dos dois aconteceu. `comApuraAuto()` também roda depois de baixar uma parcela (`fpSettle`, `fpSettleSplit`) e ao vincular lançamento (`fpLinkSet`). Uma comissão por venda continua valendo. Ajuda (Comissões) e janela atualizadas. Sem SQL. Teste em `run_comissoes.js`.

## Financeiro ▾ Vendas (2026-10-15)
Pedido do usuário: botão **Vendas** depois de Demonstrativos, listando todas as vendas dos tratamentos. Aba `vendas` (`#tab-vendas`, `#reg-vendas-host`, endereço `#vendas`, permissão `vendas` ver; `FIN_ITEMS`/`FIN_TABS`, `tabModule`, `cadTitleText`, `GT_PAGED`). Bloco "Financeiro ▾ Vendas" antes de `slContratoDialog`: `VN` (filtros: busca, mês, situação, vendedor, pagamento, alerta), `vnInfo(s)` (parcelas do Contas a Receber com `sale`: recebido, em aberto, em atraso, pagamento Em Dia/Em Atraso/Quitada/Sem Parcelas, comissão), `vnShown`, `renderVendas`, `vnOnShow`, `vnExport` (Excel), `openVendaDetalhe` (valores, parcelas com situação, comissão, Abrir Tratamento, Contrato), `wireVendas`. Cartões: Vendas, Ticket Médio, Recebido, A Receber, Em Atraso, Comissões Geradas (só com ver Comissões); cancelada aparece na lista mas fora dos totais. Alertas (`.tr-due-btn`): parcela em atraso, sem parcelas, sem vendedor, aguardando comissão. Outras Opções: Exportar Excel, Painel de Vendas, Comissões, Metas. Celular: Data, Paciente, Total e Pagamento (Tipo, Vendedor, Recebido, Comissão e Situação ocultos). Sem SQL. Ajuda: tópico `lista-vendas`. Teste `tests/run_vendas_lista.js` (no `npm test`); a aba entra em `run_toolbar_rows`, `run_sticky_headers`, `run_cad_titles`, `run_cad_sheets`.

- (2026-10-15, pedido do usuário) Menu **Prontuário ▾** (`PR_ITEMS`): Prontuário, Plano Terapêutico | **Habilidades, Escalas, Objetivos, Atividades** (nesta ordem; antes Objetivos, Atividades, Escalas, Habilidades). Sem SQL.

## Auto Planner — Etapa 1: grade própria (2026-10-16)
Pedido do usuário: Planner ▾ → **Auto Planner**, uma grade igual à do Planner mas com registros próprios (começa vazia); as funções do antigo
"Auto Planner" do Outras Opções do Planner saíram de lá e vieram para cá. Decisões (perguntas respondidas em 2026-10-16): grade editável como o Planner;
bloqueios de horário = os do Planner + extras só do Auto Planner; meta de 60%–80% em grupo para ABA Sim **por paciente, no mês** (etapa 2); só monta quem tem
"Pacientes – Saúde" (regra de nível de suporte, etapa 2); grupos ABA Sim de 2 a 4 em sala de 4 colunas e 1 a 2 nas demais (etapa 2); serviços que não são Sessão
primeiro, na sala do quadro (sem sala, na do terapeuta); apoio (Aplicador ABA) preenchido em grupos de 3 ou 4; "um horário vago por sala por turno" = preferência
forte; campo **"Não agrupar com"** no TRATAMENTO (etapa 2); até 5 rascunhos com nome (etapa 4); permissões **Auto Planner** (ver/incluir/editar/excluir) e
**Auto Planner – Enviar** (nenhum nível recebe, o Administrador libera).
- **Como funciona (sem duplicar a tela):** o Auto Planner usa a seção `#tab-planner` e `state.tab` continua `"planner"`; o flag `PLA.on` (perto de `can()`) diz qual
  conjunto de registros está aberto. O botão oculto `data-tab="autoplanner"` e o item do menu (`PL_ITEMS`, endereço `#autoplanner`) chamam `plAutoSet(true)` no
  `wireTabs`; qualquer outra aba chama `plAutoSet(false)`. `plAutoSet` desliga as assinaturas, zera `state.scheduleDocs`/`pendingBookingChanges`, troca a pilha do
  desfazer (`bookingHistory` ↔ `PLA.hist`) e limpa a área de copiar; depois `subscribeSchedule()` refaz tudo.
- `schedPath(docId)` = `autoplan/<dia>-<semana>` com `PLA.on`, senão `schedule/…`; todos os `db.doc("schedule/…")` do Planner (assinatura, `currentBookingsFor`, gravação em
  `applyBookingChanges`, Limpar Semana, Editar Agendamento, Trocar/Enviar etc.) passam por ele; só `subscribeReportDocs` (Resumo) continua direto em `schedule/`. `repDoc(docId)`
  substitui `state.reportDocs[docId]` como reserva (no Auto Planner nunca serve o Planner de verdade). **Código novo do Planner que lê/grava `schedule/` precisa usar
  `schedPath`** (ou, se for do Planner de verdade de propósito, `"schedule/"` explícito como `apPatchReal`).
- `can("planner"|"bloqueio_horario", incluir/editar/excluir)` vira `can("autoplanner", …)` com `PLA.on` (ver não muda). `plAutoUi()` mostra/oculta título "Auto Planner"
  (`#plAutoTitle`), Montar Proposta (`#autoPlannerBtn`), Enviar para o Planner (`#apSendPlannerBtn`), Remover do Planner o que o Auto Planner Enviou (`#apUnsendBtn`),
  Enviar para a Agenda (exige Enviar) e esconde Trocar Profissional (mexe nas salas, que são compartilhadas).
- Bloqueios extras: `config/autoplan_blocks` (`PLB.autoList`; `plbCur()` escolhe a lista que a janela Bloquear/Liberar edita; `plbIndex()` soma as duas com `PLA.on`).
- **Enviar para o Planner** (`apSendToPlanner`): `apReadReal()` lê os 20 documentos reais; `apSendPlan` troca temporariamente `state.scheduleDocs`/`PLA.on` e confere cada
  atendimento (`effectiveBooking` livre + `plannerConflict` duro), um por vez; prévia com `confirmDialog` (quantos vão e os motivos dos que ficam de fora); grava por
  `apPatchReal` direto em `schedule/*` (sem desfazer); o registro enviado perde `auto` e ganha `via: "autoplanner"` — é por essa marca que `apUnsendFromPlanner` remove só
  o que foi enviado. Bloqueios do Auto Planner e `blocked` antigo não vão. A Reunião Clínica automática de segunda 11:20 aparece também no Auto Planner (não é gravada).
- **Montar Proposta** (`openAutoPlannerModal`) continua com as regras do antigo Auto Planner (ver seções anteriores) e agora só grava na grade do Auto Planner (saiu "Gravar
  em"/mês da Agenda e `apAgendaPlan`); "Remover o que a Proposta Colocou" apaga do Auto Planner o que tem `auto: true`.
- Banco (migração `supabase/2026-10-16-auto-planner.sql`, rodada em produção pelo conector; linha 132 da conferência de migrações; `schema.sql` atualizado;
  `conferencia-geral.sql` NÃO regerado): caminhos `autoplan/(seg…dom)-[1-4]` e `config/autoplan_blocks` em `documents_path_valid`, `doc_scope` (por unidade),
  `module_for_path` = `autoplanner`, `patch_bookings` aceita `autoplan/%`, `documents_enforce` confere `autoplanner:create|edit|delete` nesses documentos (bloqueios
  `lock:true` também usam `autoplanner`).
- Teste `tests/run_auto_planner_grade.js` (separação, trocar de tela, enviar, remover, permissões) + `run_auto_planner.js` adaptado; `run_toolbar_rows.js` mede o Auto Planner.
  Ajuda: tópico `auto-planner` (e “Outras Opções do Planner” sem a montagem).
- Próximas etapas combinadas: **E2** regras novas do motor (60%–80% em grupo por paciente/mês, nível de suporte, "Não agrupar com" no tratamento, horário vago por sala por turno,
  apoio Aplicador ABA, serviços fora de Sessão primeiro, painel de capacidade); **E3** relatório de qualidade, "por que aqui?", cadeado nos atendimentos, remontar só um
  paciente/terapeuta; **E4** até 5 rascunhos com nome, comparar, impressão/Excel.

## Auto Planner — Etapa 2: regras novas do motor (2026-10-16)
- **Montar Proposta exige "Pacientes – Saúde"** (o nível de suporte vem da tabela protegida): `healthCanSee()` no `openAutoPlannerModal` e no botão (`plAutoUi`).
- **Ordem de cálculo** (`tasks[].cls`): 0 = serviços que não são Sessão, 1 = Sessão de paciente ABA Não, 2 = Sessão ABA Sim (agrupada por faixa etária e especialidade). Dentro de cada classe, ordem alfabética.
- **Campo "Não Agrupar com"** no TRATAMENTO (`naoAgrupar: [ids de paciente]`, em `TREAT_FIELDS`; lista de marcar `#pNaoAg` ao lado de Sessão/Mês). `apForbid(p)` junta os dois sentidos; o motor nunca põe o paciente numa sala/horário onde já está um deles.
- **Tamanho do grupo**: sala com 4 colunas com profissional → grupos de 2 a 4 (preferência 3+); demais salas → de 1 a 2 (`maxG`/`pref` em `apBuild`).
- **Meta de grupo por paciente** (`AP_GROUP_MIN/MAX`, `apGroupGoal(horas)` → {lo, hi, target}; sem inteiro dentro da faixa, como 2 sessões, usa o mais próximo de 70%). `patStat(p)` conta as sessões ABA Sim em grupo hoje; entrar numa sessão que está sozinha pesa +80 se o ocupante já está na meta máxima (a sessão dele viraria grupo). Relatório `plan.goal` (Paciente, Sessões, Em Grupo, %, Meta) na prévia.
- **Nível de suporte** (`apSupport`: 1, 2 ou 3 do texto de `suporte`): ao entrar num grupo, mesmo nível −12, nível diferente +12 (preferência).
- **Um horário vago por sala por turno** (preferência forte): +45 quando o encaixe ocuparia o último horário vazio da sala no turno (`roomBusy`). **Intercalar grupo e individual** na agenda do profissional (`profKinds`, ±5).
- **Aplicador ABA nos grupos de 3 ou 4**: depois de montar, para cada sala/horário com 3+ pacientes ABA Sim sem grupo de suporte apontando para a sala, procura uma coluna de grupo de suporte com profissional "Aplicador ABA" livre (`plannerConflict` duro) e propõe `{patient: <nome da sala>, auto: true}`; caixa `#apSupport` (padrão marcada) e `plan.support`; Aplicar leva só os dos horários com paciente escolhido.
- **Capacidade por especialidade** (`plan.capacity`): sessões a colocar × vagas livres (células de terapeuta da especialidade principal) antes de montar × colocadas × não couberam.
- `apBuild(patients, opts)`: `opts.support === false` desliga o apoio. Teste `tests/run_auto_planner_e2.js` (no `npm test`). Ajuda: Auto Planner e Tratamento.
- Ainda não feito (etapas 3 e 4): relatório de qualidade completo, "Por que aqui?", cadeado nos atendimentos, remontar só um paciente/terapeuta, rascunhos com nome, impressão/Excel.
- (2026-10-16, pedido do usuário) **Horário do quadro e semanas alternadas.** O dia/horário do quadro mandam: com `line.hora` o Horário de Atendimento do paciente NÃO é conferido (`patientSlotOk` só quando o quadro não tem horário; quadro só com dia ainda segue o horário do paciente naquele dia). Quadro com **só 2 sessões no mês** alterna semanas — 1ª e 3ª, ou 2ª e 4ª (`altPat` em `apBuild`; com sessão já existente escolhe o padrão que a contém). `tryPlace(w)` + reforço: o que não cabe na semana prevista tenta as outras semanas permitidas (semana mais vazia primeiro). Testes em `run_auto_planner_e2.js`.

## Auto Planner — Etapa 3: Por que aqui?, Fixar, Remontar e Relatório de Qualidade (2026-10-16)
- **Por que aqui?**: a Montar Proposta grava `rec.porque` (códigos: quadro, atend, alterna, grupo:n, suporte:n, sozinho, salaaba, individual, irmao, vago, intercala, rotina, rotina2, seguidas, apoio) pelo `rs` de cada candidato em `apBuild`; `AP_WHY`/`apWhyText(code)` dão o texto. Aparece no `title` da linha da prévia e na janela do atendimento (`openBookingModal`, bloco "Por que aqui?", só no Auto Planner). Código novo de motivo: acrescentar em `AP_WHY`.
- **Fixar**: caixa `#bkFixo` na janela do atendimento (só `PLA.on`) grava `rec.fixo = true`; a célula ganha só o `title` (sem visual novo). Salvar a janela mantém `auto` e `porque` se o paciente não mudou. Montar Proposta nunca altera registro existente; **Remontar** só apaga `auto && !fixo`.
- **Remontar** (modo no `#apMode` da Montar Proposta, campo `#apTher`): `apRemovals(pacienteId, terapeutaId)` acha os atendimentos auto não fixos (e o apoio Aplicador ABA dos mesmos horários), `apDel` tira só na memória, `apBuild` monta de novo para os pacientes afetados, a prévia mostra quantos saem; Aplicar reconfere cada remoção (ainda auto, não fixa, mesmo paciente), tira e põe tudo num único `applyBookingChanges` (Ctrl+Z desfaz). Itens e remoções seguem as caixas por paciente.
- **Relatório de Qualidade** (`#apQualityBtn`, `openApQualityModal`, `apQuality()`, `apGroupStat`): total de atendimentos/pacientes/terapeutas; colocadas × contratadas por paciente (só os com diferença); meta de grupo (fora da faixa); ocupação por terapeuta (horários ocupados ÷ horários em que alguma coluna dele está disponível, `seatAvailable`); turnos de sala sem horário vago; alertas (Não Agrupar com juntos; fora do Horário de Atendimento quando o quadro não tem horário); "Não Couberam" por simulação (`apBuild` com `support:false`, não grava). Só leitura.
- Testes `tests/run_auto_planner_e3.js` (no `npm test`). Ajuda: tópico Auto Planner. Ainda falta a etapa 4: até 5 rascunhos com nome, comparar, impressão/Excel.

## Auto Planner — Etapa 4: rascunhos, comparar, imprimir e Excel (2026-10-16)
- **Rascunhos** (Outras Opções → Rascunhos, `openApDraftsModal`): até 5 (`AP_DRAFTS`), cada um num documento `autoplan/rascunho-<1..5>` = `{name, criadoEm, por, docs:{"seg-1":{chave: registro}}}` (sem os bloqueios extras). Salvar clona a grade atual (`currentBookingsFor` devolve referências vivas — sempre `cloneJson`), escolher um número já usado pede para substituir; Renomear muda só o nome; Excluir grava `{}` (o adaptador não tem delete). **Carregar** calcula a diferença contra a grade atual e aplica num único `applyBookingChanges` (com `patientHoursOk/routineOk/therapistOk/areaOk` para não perguntar; Ctrl+Z desfaz).
- **Comparar** A × B entre Auto Planner atual, Planner atual (`apReadReal`) e rascunhos: `apStatsFor(docs)` roda `apQuality()` com a grade trocada (`apWithDocs`) e `apDiffDocs` conta acrescentados/retirados/trocados. A diferença B − A marca "(melhor)/(pior)" só onde há juízo claro.
- **Imprimir e Exportar** (`openApPrintModal`): Grade por Terapeuta (`apPrintTherapists`, uma página A4 paisagem por terapeuta e semana), Horário da Família (`apFamilyLines` consolida o mesmo dia/hora/terapeuta/sala das várias semanas em "1ª e 3ª semanas"; `apPrintFamily`; `apFamilyText` = texto do WhatsApp, copiado com `navigator.clipboard`) e Exportar Excel (`plannerExportCsv`, arquivo `autoplanner.csv` no Auto Planner). Impressão por `demPrintFrame` + `AP_PRINT_CSS`.
- Banco (migração `supabase/2026-10-16b-auto-planner-rascunhos.sql`, rodada em produção pelo conector; linha 133 da conferência de migrações; `schema.sql` atualizado; `conferencia-geral.sql` NÃO regerado): caminho `autoplan/rascunho-[1-5]` em `documents_path_valid` e `documents_enforce` tratando rascunho como documento que não é lista (mudar = `autoplanner:edit`).
- Teste `tests/run_auto_planner_e4.js`. Com isso o Auto Planner está completo nas 4 etapas combinadas; ideias ainda não feitas: modo "Reorganizar tudo" mais agressivo (trocar sessões já colocadas), comparar rascunhos lado a lado em grade, pesos das preferências configuráveis em Acesso → Sistema.

## Auto Planner: viabilidade e "ABA Não" sem sala toda (2026-10-16)
Análise dos tratamentos ativos (pedido do usuário): 63 de 111 ainda sem quadros (serão cadastrados); nos 48 com quadros, a janela do paciente tem mediana de 5 horários/semana para 4,5 sessões — a falta de lugar vem da janela estreita e das regras empilhadas, não de terapeuta ou sala.
- **"ABA Não" não ocupa mais a sala toda**: as regras do Sistema `pl_nao_aba` e `ag_nao_aba` agora nascem **Desligadas** (o Administrador liga em Acesso → Sistema para voltar à regra antiga). O Auto Planner prefere salas SEM Intervenção ABA para quem não faz ABA (`+60` na pontuação das salas ABA). Os testes que exercitam a regra fazem `state.sysRules = {pl_nao_aba: "block", ag_nao_aba: "block"}`.
- Motor (`apBuild`): ordena por folga (`plan.viab`: horários da semana em que o paciente pode vir ÷ sessões/semana; quadro com horário = 0) dentro de cada classe; o que não coube tenta `tryPlace(w, 1)` (fora da janela do paciente, motivo `fora`, +30) e, no grupo ABA Sim, `tryPlace(w, 2)` (faixa etária vizinha, `apBandNear`, motivo `faixa_viz`, +20). A prévia mostra “fora do horário do paciente” e a tabela **Viabilidade dos Horários**. Teste `tests/run_auto_planner_e5.js`.
- (2026-10-16, pedido do usuário, SUBSTITUI a tentativa "fora da janela") **O Auto Planner NUNCA sugere sessão fora do Horário de Atendimento do paciente** (cadastro do tratamento), nem quando o quadro tem horário: `patientSlotOk` vale sempre em `tryPlace`; o que não couber vai para Não Couberam. Saíram o motivo `fora` e a 2ª tentativa fora da janela; ficou só a 2ª tentativa de faixa etária vizinha (`tryPlace(w, 2)`). O Relatório de Qualidade alerta qualquer sessão fora do horário, também com horário no quadro.

## Importação do histórico da Agenda (2026-10-16)
Planilha "Agendamentos por Período" do sistema antigo (jan–set/2026) importada direto no banco pelo conector, em `appointments` (`source = 'importacao-2026-10-16'`). Decisões do usuário: tarde +30 min (13:00 → 13:30); só segunda a sexta; vários atendimentos do mesmo profissional no mesmo horário ficam (só as 6 linhas idênticas foram puladas); fora da grade ou do horário de trabalho entra assim mesmo; Motricidade = Psicomotricidade; Avaliação, Avaliação Neuropsicológica e Triagem = serviço; Reunião Clínica e Treinamento = horários especiais; paciente em 2 lugares no mesmo horário: a linha do Aplicador ABA (ou a segunda) virou atendimento do grupo de suporte Aplicador ABA (sem paciente); status Finalizado/Não compareceu/Falta justificada preservados (Em Aberto = sem status; horários especiais sem status); sala só quando o arquivo trazia. Resultado: 15.239 linhas (14.546 de paciente, 327 do grupo Aplicador ABA, 364 Reunião Clínica, 2 Treinamento); os 961 atendimentos anteriores (out–dez/2026) ficaram intactos. Para desfazer: `delete from appointments where source = 'importacao-2026-10-16'`. Sobras para apagar depois (conector não roda `drop`): tabelas `appointments_bkp_20261016` (cópia dos 961 antigos) e `imp_ag_pats`, `imp_ag_profs`, `imp_ag_raw`, `imp_ag_notes` e a view `imp_ag_rows`. As regras só da tela (conflitos, horário de trabalho) não foram aplicadas à carga.

## Agendamentos: Gerenciar Status (2026-10-16)
Pedido do usuário. Agenda ▾ Agendamentos → **Outras Opções → Gerenciar Status** (`lgManageStatus`, janela `#ovLgManage`): lista os agendamentos da tela (`LG.last`, respeita período, busca e filtros), caixas de marcar + "Marcar Todos", status de destino (`#lgmSt`, sem Finalizado e só os que `canUseStatus`) e **Aplicar aos Marcados** (confirmação; usa `agdSetStatusQuiet`, RPC `set_appointment_status`). Permissão nova **Gerenciar Status** (`gerenciar_status`, só "ver", grupo Agenda de Níveis de Permissão; nenhum nível recebe — o Administrador libera); o item só aparece com ela. Sem SQL (a conferência por status continua no banco). Ajuda: tópico `agendamentos`. Teste em `tests/run_agendamentos.js`.

## Importação de agendamentos de 01 a 06/10/2026 e evoluções (2026-10-17)
- Planilha "Agendamentos por Período" (519 linhas, 01–06/10/2026) importada direto no banco pelo conector com as mesmas regras da importação de 2026-10-16: tarde +30 min, paciente pelo nome do cadastro (`patient_id` pelo gatilho), serviço Avaliação/Triagem pela especialidade, Reunião Clínica e Bloqueio como horários especiais, status Finalizado/Não compareceu (Em Aberto = sem status), **sala preenchida quando a planilha traz** (nesta o arquivo traz a sala em ~metade das linhas). Linhas de Aplicador ABA e Coordenador viram atendimento de grupo (`group_id`); quando o Aplicador acompanha um paciente, o nome do paciente vai na observação ("Paciente: …"); observação "Importado" descartada. Marca `source = 'importacao-2026-10-17'` (desfazer: `delete from appointments where source = 'importacao-2026-10-17'`). Resultado: 519 linhas (438 de paciente, 64 de grupo, 16 Reunião Clínica, 1 Bloqueio); 3 pacientes em dois lugares no mesmo horário viraram grupo Aplicador ABA.
- Evoluções (planilha "Histórico de Atendimentos", jun–set/2026) **importadas em 2026-10-16** direto no banco pelo conector, em `clinical_records`: 4.852 evoluções de 151 pacientes (de 10/06 a 30/09/2026). 4.689 ligadas ao atendimento da Agenda (paciente + profissional + data + hora; tarde +30 min como nas outras importações) e 163 avulsas (sem atendimento correspondente). Autor = usuário ligado ao profissional (`profiles.professional_id`); 25 evoluções de "Camila da Silva" (27–31/07, profissional sem cadastro) ficaram sem `professional_id`/`author_id`, só com `author_name`. `created_at` = data da importação; `plan_goals` = `[]`.
  - Regras aplicadas: sem "Atendimento:" no começo, quebra de linha vira parágrafo `<p>`, espaços duplos juntados, fragmentos de outros alfabetos e entidades HTML cortadas ("&ccedil", "&nb…") removidos, só correções de digitação seguras (estructurado→estruturado, socias→sociais etc.). Mesmo texto no mesmo atendimento entrou uma vez só (3 repetidas); vazias e não-pacientes (Reunião Clínica, Aplicador ABA) ficaram de fora.
  - **57% dos textos (2.775) vinham cortados em ~500 caracteres no sistema antigo** e o resto não existe no arquivo. Resumo feito: o texto fica até a última frase completa (se isso preservar ao menos 60%; senão corta no último termo inteiro e põe "…") e termina com o parágrafo em itálico "(Texto cortado na exportação do sistema antigo.)". O conteúdo perdido não é recuperável.
  - Tabelas de apoio para o usuário apagar no SQL Editor (o conector não roda `drop`): `imp_ev2` (texto original, bruto, com os dados reais), `imp_ev3` (versão limpa), `imp_ev_raw`, `appointments_bkp_20261016`, `imp_ag_pats`, `imp_ag_profs`, `imp_ag_raw`, `imp_ag_notes` e a view `imp_ag_rows`. Desfazer a importação das evoluções: `delete from clinical_records where created_at::date = '2026-10-16'` (só se ninguém criou evolução nova nesse dia).
- Produção (2026-10-16): tabelas de apoio das importações (`imp_*`, `appointments_bkp_20261016` e a view `imp_ag_rows`) apagadas pelo usuário; conferido: 0 sobras e 4.852 evoluções importadas no Prontuário. Para apagar objetos com dependência, apagar a view antes das tabelas.
- Produção (2026-10-16, pedido do usuário): a nota em itálico "(Texto cortado na exportação do sistema antigo.)" foi removida das 2.772 evoluções que a tinham; os textos continuam resumidos/cortados como antes.
- Produção (2026-10-17, pedido do usuário "verificar os textos das evoluções, corrigir, traduzir, se preciso reescrever, sem anotações"): revisão das 4.852 evoluções importadas, direto no banco pelo conector. As 482 de Miguel Antonio Higuera Cancino (portunhol e muita digitação) foram reescritas em português, lote a lote, sem inventar conteúdo (listas numeradas, siglas mantidas, trechos cortados terminam na última ideia completa). Nos demais autores: "Obj>", "Atividade>", "Estratégia>", "Comp. Positivo>" etc. viraram ":" (`&gt;` zerado), erros de digitação repetidos corrigidos (atividade, atenção, avaliação, aplicação, anamnese, bullying…) e ponto final acrescentado a 646 textos que terminavam sem pontuação. Nenhuma anotação foi acrescentada. Cópia dos textos originais em `evolucoes_texto_original_20261017` e controle em `evo_revisadas_tmp` (apagar depois no SQL Editor; para desfazer, copiar `content` de volta pelo `id`).
