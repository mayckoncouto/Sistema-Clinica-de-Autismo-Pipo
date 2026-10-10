# Conector Claude (servidor MCP remoto) — `pipo-mcp`

Deixa o Claude (claude.ai e app desktop) consultar e alterar o CRM e os pacientes **em nome da pessoa
logada**, com as mesmas regras do sistema.

## Como funciona

```
Claude ──(OAuth: login do sistema + página /oauth/consent)──► Supabase Auth
Claude ──(token da pessoa)──► Edge Function pipo-mcp ──rpc──► funções SQL (security invoker)
                                                              │ RLS, has_perm, documents_enforce,
                                                              │ gatilhos de histórico
                                                              ▼
                                               tasks / task_events / patients/all
```

- **Sem service role.** A função usa a chave pública + o token da pessoa: vale o nível de permissão
  dela, as regras do banco e o histórico normal.
- **Regras e histórico ficam no SQL** (migração `supabase/2026-10-10w-conector-claude.sql`):
  `crm_tarefas_listar`, `crm_tarefa_obter`, `pacientes_buscar`, `crm_tarefa_criar`,
  `crm_tarefas_alterar`, `crm_comentar`, `pacientes_definir_inativo`.
- **Origem:** `pipo_origem()` lê o `client_id` do token e o nome do aplicativo em
  `auth.oauth_clients`; a atividade da tarefa grava `{origem:"conector", app:"Claude"}` e a tela
  mostra “· via Claude”. Paciente alterado leva o mesmo no `_upd`.
- **Quem pode:** Administrador ou nível com **Conector Claude** marcado (Níveis de permissão → Menu
  Acesso). `mcp_permitido()` confere isso e o limite de **60 chamadas por minuto**.
- **Registro:** toda chamada vai para `public.mcp_calls` (ferramenta, ok, ids, erro, app).
- **Nada é excluído.** Lotes com no máximo 50 ids; toda alteração devolve `antes` e `depois`.
- Ferramentas de leitura com `readOnlyHint`; de escrita com `destructiveHint: false`.
- Sem tabelas clínicas nem financeiras (prontuário, saúde, valores) por enquanto.

## Ferramentas

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `listar_listas` | leitura | listas do CRM que a pessoa vê, com status |
| `listar_tarefas` | leitura | filtros: lista, status, responsável (id, `eu`, `ninguem`), prazo de/até, atrasadas, texto, paciente, finalizadas, limite (≤200) |
| `obter_tarefa` | leitura | tarefa + atividade (comentários e histórico) |
| `buscar_paciente` | leitura | por nome (sem acento) — precisa de Pacientes “ver” |
| `listar_responsaveis` | leitura | pessoas que podem ser responsáveis numa lista |
| `criar_tarefa` | escrita | lista, título, status, prazo, prioridade, responsáveis, paciente ou lead, descrição |
| `comentar_tarefa` | escrita | comentário (com @menções por id) |
| `alterar_status` | escrita | lote; status de perda pede `motivo_perda` |
| `alterar_prazo` | escrita | lote; `nova_data` vazia tira o prazo |
| `alterar_prioridade` | escrita | lote; urgente / alta / normal |
| `alterar_responsavel` | escrita | lote; modo definir / adicionar / remover |
| `vincular_paciente_tarefa` | escrita | lote; liga tarefas a um paciente |
| `ativar_paciente` / `inativar_paciente` | escrita | lote; avisa se o paciente tem tratamento Ativo |

## Publicar (uma vez)

1. **Banco:** rodar `supabase/2026-10-10w-conector-claude.sql` no SQL Editor (conferência esperada
   `1 | 1 | 15`).
2. **Supabase → Authentication → OAuth Server:** ligar o servidor OAuth 2.1, ligar **Dynamic client
   registration** e pôr **Authorization path** = `/oauth/consent`.
   **Authentication → URL Configuration:** Site URL = endereço do sistema na Vercel.
3. **Função:**
   ```bash
   supabase functions deploy pipo-mcp --no-verify-jwt --project-ref gnieydlriercezqowpqe
   ```
   (`--no-verify-jwt` porque a própria função responde 401 com o endereço do login, como o MCP pede.)
4. **Variáveis da função** (Edge Functions → Secrets). `SUPABASE_URL` e `SUPABASE_ANON_KEY` já existem.
   | Variável | Uso |
   |---|---|
   | `PIPO_MCP_ESCRITA` | `1` liga as ferramentas de escrita. **Comece sem** (só leitura). |
   | `PIPO_PUBLISHABLE_KEY` | só se `SUPABASE_ANON_KEY` não existir: a chave `sb_publishable_...` |
   | `PIPO_MCP_URL` | só se o endereço público for outro (ex.: plano B na Vercel) |
5. **Níveis de permissão:** marcar **Conector Claude** em quem vai usar.

## Ligar no Claude

claude.ai (ou app desktop) → **Configurações → Conectores → Adicionar conector personalizado**:

- Nome: `Clínica Pipo`
- URL: `https://gnieydlriercezqowpqe.supabase.co/functions/v1/pipo-mcp`

Clicar em **Conectar** → abre a página do sistema → entrar com e-mail e senha → **Autorizar**.
Para desconectar: remover o conector no Claude.

## Testes

**Local (sem tocar na produção):** monta o banco a partir do `schema.sql` num Postgres em memória
(PGlite) e chama cada ferramenta como três usuários (Administrador, Secretária com a permissão, nível
sem a permissão):

```bash
deno run -A --no-lock --config supabase/functions/pipo-mcp/deno.json supabase/functions/pipo-mcp/teste_local.ts
```

**Roteiro no Claude** (primeiro com a escrita desligada; depois com `PIPO_MCP_ESCRITA=1`, numa lista
e paciente de teste):

1. “Quais listas do CRM eu vejo?” → `listar_listas`
2. “Minhas tarefas atrasadas” → `listar_tarefas` (`responsavel: eu`, `atrasadas`)
3. “Abra a tarefa X” → `obter_tarefa`
4. “Procure o paciente Teste” → `buscar_paciente`
5. “Quem pode ser responsável na lista Agendas?” → `listar_responsaveis`
6. “Crie uma tarefa de teste na lista Gestão para amanhã” → `criar_tarefa` — conferir no CRM: atividade
   com “via Claude”
7. “Comente ‘teste’ nessa tarefa” → `comentar_tarefa`
8. “Mude o status / prazo / prioridade / responsável” → as quatro `alterar_*` — a resposta traz antes e
   depois; o CRM mostra no histórico
9. “Ligue a tarefa ao paciente Teste” → `vincular_paciente_tarefa`
10. “Inative e depois reative o paciente Teste” → `inativar_paciente` / `ativar_paciente`
11. Com um usuário sem **Conector Claude**: a página de autorização recusa; chamadas dão “sem permissão”.
12. Conferir o registro: `select * from mcp_calls order by id desc limit 20;`

## Acrescentar uma ferramenta

1. **SQL:** função nova `security invoker` (as regras do banco valem), que devolva `antes`/`depois`
   quando alterar algo, recuse lote acima de 50 e não exclua nada. `revoke ... from public, anon;
   grant execute ... to authenticated;`. Pôr no `schema.sql`, numa migração nova e regerar
   `conferencia-geral.sql`.
2. **`app.ts`:** `server.registerTool("nome", { title, description, inputSchema: { ... zod ... },
   annotations: READ | WRITE }, (a) => call("nome", "funcao_sql", { p_...: a... }, ids))`. Escrita só
   dentro do bloco `if (escrita)`.
3. **`teste_local.ts`:** uma checagem para a ferramenta (com permissão e sem permissão).
4. **Ajuda:** atualizar o tópico “Conector Claude” no `index.html`.
