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
  (azul-claro `#8FD3F4`, `training:true`). Com uma marcada, o campo de paciente
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
  "salas" e "grupos" (vira "← Voltar para salas"; "+ Nova sala" vira
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
- O botão do prontuário chama "Registrar Atendimento" (ou "Editar Atendimento"
  quando o usuário já lançou a evolução deste atendimento — `prLabelApptButton`)
  e fica no canto superior
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
