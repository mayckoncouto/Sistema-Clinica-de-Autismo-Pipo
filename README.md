# Sistema Clínica de Autismo Pipo — Agenda Pipo

Sistema web de agendamento de atendimentos para a Clínica de Autismo Pipo, substituindo a antiga planilha de controle. Publicado como um Claude Artifact (aplicação de página única, sem backend próprio — os dados ficam armazenados na capability `db` da plataforma Claude, compartilhados entre todas as pessoas com acesso à página).

**App publicado:** https://claude.ai/artifact/C46pNNootZV5QNyjB4AS8o

## Estrutura

- `agenda.html` — código-fonte completo do app (HTML + CSS + JS em um único arquivo, como exigido pelo formato de Claude Artifact). É este arquivo que é publicado via Artifact para atualizar o app ao vivo.
- `tests/` — suíte de testes automatizados (Playwright) usando dados fictícios de exemplo, cobrindo agendamento por arrastar-e-soltar, cópia/movimentação, bloqueio de horários, cadastro de pacientes/profissionais/salas/convênios/especialidades, cores por especialidade, relatório de atendimentos, busca sem acento/maiúsculas, zoom e visualização "todos os dias/semanas", entre outros.

## Como rodar os testes

Requer Node.js e o pacote `playwright` (com o Chromium baixado):

```bash
npm install
npx playwright install chromium   # se ainda não tiver o Chromium do Playwright instalado
npm test
```

Ou, para rodar um teste específico após qualquer alteração em `agenda.html`:

```bash
node tests/build.js        # gera tests/page.html com o agenda.html atual
node tests/run_dnd.js       # roda só esse teste
```

## Funcionalidades

- Grade semanal por sala/terapeuta/paciente, com 4 semanas e 5 dias, bloqueio de horários, reunião clínica semanal automática.
- Cadastro de pacientes (convênio, plano, ABA, especialidades e carga horária), profissionais e salas, com cores personalizáveis.
- Cópia, movimentação e desmarcação de agendamentos.
- Relatório de atendimentos por profissional/especialidade, com busca (ignora acentos e maiúsculas/minúsculas).
- Controle de acesso somente-leitura vs. edição, conforme a permissão do Compartilhamento do Claude Artifact.

## Observação sobre dados

Este repositório contém apenas o código do aplicativo e dados de teste fictícios. Nenhum dado real de pacientes é versionado aqui — os dados reais da clínica ficam apenas no armazenamento (`db`) do Artifact publicado, acessível apenas a quem tem permissão na página.
