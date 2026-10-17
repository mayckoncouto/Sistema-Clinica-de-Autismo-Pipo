---
name: verificacao-completa
description: Protocolo de Verificação Completa do Agenda Pipo (testes, código, banco, telas, títulos, campos, celular, desempenho, dados desnecessários). Use quando o usuário pedir "verificação completa", "verificar tudo", "revisão geral" ou "/verificacao-completa".
---

# Verificação Completa — Agenda Pipo

Falar com o usuário em português, linguagem de negócio. **Corrija sozinho** só o que é pequeno e seguro
(texto, nome de classe, aspas, rótulo, código sem efeito em dados). **Pergunte antes** de qualquer coisa que
apague ou altere dados, estrutura do banco, permissões ou regras de negócio. Nunca copie dados reais de
pacientes para arquivos do repositório. Termine sempre com o relatório (passo 9).

## 1. Código (sem navegador)
- `node tests/verificar_estatico.js` — sintaxe de todos os scripts, função/var repetida na raiz, ids repetidos,
  nomes que o AdBlock esconde (`ad`, `banner`, `sponsor`, `promo`…), cinza escuro do Bloqueado, arquivo de dados
  reais versionado, migração sem linha em `supabase/conferencia-migracoes.sql`.
- Qualquer "PROBLEMA" é corrigido na hora (e refeito o script até "tudo certo").

## 2. Testes automáticos
- `node tests/build.js && npm test > /tmp/testes.log 2>&1` (leva vários minutos; pode ir em segundo plano).
- Conferir a saída: cada teste termina com `no JS errors? true` e nenhuma linha de checagem com `false` no
  fim do texto. Lembrete: com a página quebrada o teste cai antes; ver também o código de saída.
- `run_autolist.js` é instável com a máquina carregada: se falhar, rodar sozinho antes de concluir.
- Falha = investigar a causa; corrigir o código (ou o teste, se a regra mudou de propósito — dizer qual).

## 3. Banco (conector Supabase, projeto `gnieydlriercezqowpqe`, SÓ LEITURA)
- Rodar `supabase/verificacao-banco.sql` com `execute_sql` (operação, dados desnecessários, segurança,
  integridade). "ok" não precisa de ação; "atenção" vai para o relatório; "limpar" pede decisão do usuário.
- `get_advisors` de segurança e de desempenho. Ignorar o que já é conhecido e aceito: funções de gatilho
  executáveis por `authenticated`, `pg_net` em public, índices "sem uso" em tabelas novas, FKs `created_by/updated_by`.
  Novo aviso fora disso = relatar.
- Opcional, se mudou estrutura recentemente: `supabase/conferencia-geral.sql` (deve voltar vazio) e
  `supabase/conferencia-migracoes.sql` (nenhuma linha NÃO).
- Tabelas temporárias/de cópia (`*_2026_10_*`, `*_2026101*`, `backup_*`, `imp_*`, `*_bkp*`, `agil_stage*`):
  listar nome, linhas e tamanho; **só apagar com autorização**. O conector trava em `drop`/`delete`: entregar o
  script `drop table if exists …;` para o usuário rodar no SQL Editor (apagar views antes das tabelas).
- Logs de erro: `query_logs` (api, postgres, auth) das últimas horas, só para achar erro repetido.

## 4. Telas, títulos e campos (conferência no código + testes de tela)
- **Title Case** em menus, títulos de tela/janela, rótulos de campo, cabeçalhos de coluna e botões (palavras de
  ligação em minúscula; ver "Padrão de maiúsculas" no CLAUDE.md). Frases, dicas e Ajuda ficam em frase normal.
- Todo botão que inclui registro = "+ Incluir". Título da tela de cadastro (`cadTitleText`). Janela: rodapé
  Excluir / Cancelar / Salvar, ✕ ou Fechar (Esc fecha), `GUARD_IDS` para aviso de alteração, sem permissão = leitura.
- Campos de uma linha com `--field-h` (sem altura própria); texto longo 3 linhas (5 em Observações);
  dinheiro com `data-money`; telefone com `data-phone`; hora digitável; Sim/Não de ligar/desligar = caixa.
- Ajuda: toda tela/função tem tópico em `HELP_TOPICS`; texto com aspas curvas; sem "agora"/"antes era".
- Português: acentos e digitação nos textos novos (`git diff` desde a última verificação).
- Rodar os testes de padrão: `run_cad_titles`, `run_sticky_headers`, `run_sort_visible`, `run_toolbar_rows`,
  `run_cad_sheets`, `run_help`.

## 5. Celular (390px)
- Barras com no máximo 3 linhas abaixo do título; ▲▼ de ordenar em toda coluna; todo seletor abre a janela de
  baixo; campos com 16px; Planner, Auto Planner, Resumo, Disponibilidade e Agenda Planner fora do ☰.
- Testes: `run_crm_mobile`, `run_cad_sheets`, `run_toolbar_rows`, `run_sort_visible`, `run_nav_single`.

## 6. Desempenho das janelas
- Medir com dados fictícios volumosos (ver "Planner mais leve" e "Fluidez" no CLAUDE.md): abrir Planner
  (Todos × Todos), Agenda, CRM (2000 tarefas), Lançamentos, Prontuário; tempo de abertura e de uma gravação.
- Listas grandes usam `GT_PAGED`; buscas com `debounce150`; grades trocam só células mudadas. Olhar `performance`
  dos advisors só para consultas lentas reais (`query_logs`).
- Relatar o que passar de ~1 s; não otimizar às cegas.

## 7. Dados desnecessários
- No banco (passo 3) e no repositório: arquivos sem uso (`tests/page*.html` gerados, restos de `tests/`),
  código morto óbvio (funções sem chamada — só listar), `console.log`/`debugger` esquecidos.
- `.gitignore` bloqueia `export/` e `import*.sql`; `tests/page*.html` são gerados (não versionar se ainda estiverem).

## 8. Correções
- Aplicar as pequenas e seguras; rodar de novo o passo 1 e os testes da área mexida; atualizar `CLAUDE.md` (uma
  linha datada) e a Ajuda se mudou comportamento; commit com os trailers do projeto e push na `main`.
- SQL que altera banco: só com pedido/autorização do usuário (regra vigente: pode rodar pelo conector em partes).

## 9. Relatório final (sempre, curto, em português)
1. **O que conferi** (uma linha por frente: código, testes, banco, telas, celular, desempenho, dados).
2. **O que corrigi** (e já está publicado).
3. **O que precisa da decisão do usuário** (apagar tabelas, dados operacionais pendentes, avisos de segurança
   do painel como "proteção contra senhas vazadas", permissões) — com a recomendação.
4. **Números** (testes passados/total, itens "atenção" do banco).
Se o usuário só disse "verificação completa" e nada mais, executar os 9 passos sem perguntar antes; perguntar só
no passo 9 item 3.
