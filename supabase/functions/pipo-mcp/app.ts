// Servidor MCP da Clínica Pipo (conector do Claude).
// Toda a regra de negócio fica no banco (funções SQL da migração 2026-10-10w); aqui só:
// login (token OAuth do Supabase Auth), descrição das ferramentas, chamada da função e registro.
// Sem service role: cada chamada roda com o token da própria pessoa (nível + RLS + gatilhos).
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.1.13";

export type Db = {
  /** id do usuário do token, ou null se o token não vale */
  user(): Promise<string | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
};
export type Config = {
  /** endereço público do servidor, ex.: https://<ref>.supabase.co/functions/v1/pipo-mcp */
  publicUrl: string;
  /** servidor de login, ex.: https://<ref>.supabase.co/auth/v1 */
  authServer: string;
  /** ferramentas de escrita ligadas? (desligadas na 1ª publicação) */
  escrita: boolean;
  /** cria o acesso ao banco com o token da pessoa */
  db(token: string): Db;
};

const NAME = "pipo-mcp";
const VERSION = "1.0.0";
const ID = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "id inválido");
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD");
const LOTE = z.array(ID).min(1).max(50);

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, mcp-session-id",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });
}

/** O que vem depois do nome da função no caminho ("/", "/.well-known/oauth-protected-resource"…) */
function subPath(url: URL) {
  const i = url.pathname.indexOf("/" + NAME);
  return i >= 0 ? url.pathname.slice(i + NAME.length + 1) || "/" : url.pathname;
}

export function createHandler(cfg: Config) {
  const metaUrl = cfg.publicUrl + "/.well-known/oauth-protected-resource";
  const unauthorized = (err?: string) =>
    json({ error: err ? "invalid_token" : "unauthorized", error_description: err || "Faça login para usar o conector." }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${metaUrl}"` + (err ? `, error="invalid_token"` : ""),
    });

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const sub = subPath(url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Onde fazer login (RFC 9728). Público.
    if (sub.startsWith("/.well-known/oauth-protected-resource")) {
      return json({
        resource: cfg.publicUrl,
        authorization_servers: [cfg.authServer],
        bearer_methods_supported: ["header"],
        resource_name: "Clínica de Autismo Pipo",
      });
    }
    if (sub !== "/" && sub !== "/mcp") return json({ error: "not_found" }, 404);

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return unauthorized();
    const db = cfg.db(token);
    let uid: string | null = null;
    try { uid = await db.user(); } catch { uid = null; }
    if (!uid) return unauthorized("Login vencido ou inválido. Conecte de novo.");

    const server = buildServer(db, cfg.escrita);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  };
}

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Out => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (msg: string): Out => ({ content: [{ type: "text", text: msg }], isError: true });

export function buildServer(db: Db, escrita: boolean) {
  const server = new McpServer({ name: NAME, version: VERSION }, {
    instructions:
      "Sistema da Clínica de Autismo Pipo (CRM de tarefas e cadastro de pacientes). Use listar_listas para conhecer as " +
      "listas e os status válidos antes de mudar status. Datas no formato AAAA-MM-DD. Toda alteração devolve o valor " +
      "anterior e o novo: mostre isso ao usuário. Nada é excluído por este conector.",
  });
  let gate: Promise<{ ok: boolean; motivo?: string }> | null = null;
  const allowed = () => gate ??= db.rpc("mcp_permitido", {}).then((r) =>
    r.error ? { ok: false, motivo: r.error.message } : (r.data as { ok: boolean; motivo?: string }));

  // Chama a função do banco com conferência de permissão/limite e registro (sem nomes nem textos).
  async function call(tool: string, fn: string, args: Record<string, unknown>, ids: string[] = []): Promise<Out> {
    const g = await allowed();
    if (!g.ok) return fail(g.motivo || "Sem acesso ao conector.");
    const r = await db.rpc(fn, args);
    const parciais = (r.data as { erros?: unknown[] } | null)?.erros?.length || 0;
    const erro = r.error ? r.error.message : parciais ? `${parciais} item(ns) com erro` : null;
    await db.rpc("mcp_registrar", { p_ferramenta: tool, p_ok: !erro, p_ids: ids.slice(0, 50), p_erro: erro }).catch(() => {});
    if (r.error) return fail(r.error.message);
    return ok(r.data);
  }

  // ---------------- leitura ----------------
  server.registerTool("listar_listas", {
    title: "Listar listas do CRM",
    description: "Lista as listas do CRM que você pode ver (Atendimento, Agendas, Fature, Gestão…) com os status de cada uma, " +
      "na ordem do quadro. Indica quais status finalizam a tarefa e quais são de perda (exigem motivo).",
    inputSchema: {},
    annotations: READ,
  }, () => call("listar_listas", "crm_listas_mcp", {}));

  server.registerTool("listar_tarefas", {
    title: "Listar tarefas",
    description: "Lista tarefas do CRM com filtros. Sem filtro de status, mostra só as abertas (use incluir_finalizadas para ver todas). " +
      "Ordena pelo vencimento. Devolve o total encontrado e até 'limite' tarefas.",
    inputSchema: {
      lista: z.string().optional().describe("id da lista, ex.: atendimento, agendas, fature, gestao"),
      status: z.string().optional().describe("id do status (veja listar_listas)"),
      responsavel: z.string().optional().describe("id do usuário, 'eu' ou 'ninguem'"),
      prazo_de: DATA.optional().describe("vencimento a partir de (AAAA-MM-DD)"),
      prazo_ate: DATA.optional().describe("vencimento até (AAAA-MM-DD)"),
      atrasadas: z.boolean().optional().describe("só as abertas com vencimento antes de hoje"),
      texto: z.string().max(200).optional().describe("busca no título, descrição e nome do paciente/lead (ignora acentos)"),
      patient_id: z.string().optional().describe("código do paciente"),
      incluir_finalizadas: z.boolean().optional(),
      limite: z.number().int().min(1).max(200).optional().describe("padrão 50"),
    },
    annotations: READ,
  }, (a) => call("listar_tarefas", "crm_tarefas_listar", { p_filtros: a }));

  server.registerTool("obter_tarefa", {
    title: "Ver tarefa",
    description: "Mostra uma tarefa com descrição, dados do lead, comentários e o histórico de alterações (quem, quando, de/para).",
    inputSchema: { task_id: ID },
    annotations: READ,
  }, (a) => call("obter_tarefa", "crm_tarefa_obter", { p_id: a.task_id }, [a.task_id]));

  server.registerTool("buscar_paciente", {
    title: "Buscar paciente",
    description: "Busca pacientes pelo nome (ignora acentos e maiúsculas). Devolve código, nome, se está inativo, nascimento, " +
      "telefones, e-mails e nomes da mãe e do pai. Exige a permissão de ver Pacientes.",
    inputSchema: {
      nome: z.string().min(2).max(120),
      limite: z.number().int().min(1).max(50).optional().describe("padrão 20"),
      incluir_inativos: z.boolean().optional().describe("padrão true"),
    },
    annotations: READ,
  }, (a) => call("buscar_paciente", "pacientes_buscar", { p_texto: a.nome, p_limite: a.limite ?? 20, p_incluir_inativos: a.incluir_inativos ?? true }));

  server.registerTool("listar_responsaveis", {
    title: "Listar responsáveis",
    description: "Lista as pessoas (usuários ativos) que podem ser responsáveis por tarefas, com o id de cada uma. " +
      "Informe a lista para ver só quem tem acesso a ela.",
    inputSchema: { lista: z.string().optional() },
    annotations: READ,
  }, async (a) => {
    const g = await allowed();
    if (!g.ok) return fail(g.motivo || "Sem acesso ao conector.");
    const r = await db.rpc("crm_people", {});
    await db.rpc("mcp_registrar", { p_ferramenta: "listar_responsaveis", p_ok: !r.error, p_ids: [], p_erro: r.error?.message ?? null }).catch(() => {});
    if (r.error) return fail(r.error.message);
    const rows = (r.data as { id: string; full_name: string; admin: boolean; crm: boolean; lists: string[] }[]) || [];
    const out = rows.filter((p) => !a.lista || p.admin || (p.crm && (p.lists || []).includes(a.lista)))
      .map((p) => ({ id: p.id, nome: p.full_name }));
    return ok(out);
  });

  if (!escrita) return server;

  // ---------------- escrita (nada exclui; tudo devolve antes/depois) ----------------
  server.registerTool("criar_tarefa", {
    title: "Criar tarefa",
    description: "Cria uma tarefa numa lista do CRM. Sem status, entra no primeiro status da lista. Prioridade: urgente, alta ou normal. " +
      "Ligue a um paciente (patient_id de buscar_paciente) ou informe o nome de um lead (contato ainda sem cadastro).",
    inputSchema: {
      lista: z.string(),
      titulo: z.string().min(1).max(300),
      descricao: z.string().max(20000).optional(),
      status: z.string().optional(),
      prioridade: z.enum(["urgente", "alta", "normal"]).optional(),
      vencimento: DATA.optional(),
      responsaveis: z.array(ID).max(20).optional(),
      patient_id: z.string().optional(),
      lead_nome: z.string().max(200).optional(),
    },
    annotations: { ...WRITE, idempotentHint: false },
  }, (a) => call("criar_tarefa", "crm_tarefa_criar", { p: a }));

  server.registerTool("comentar_tarefa", {
    title: "Comentar tarefa",
    description: "Escreve um comentário numa tarefa, em seu nome (aparece com \"via Claude\" na atividade). " +
      "Menções: ids de listar_responsaveis (a pessoa é avisada no sistema).",
    inputSchema: { task_id: ID, texto: z.string().min(1).max(5000), mencoes: z.array(ID).max(20).optional() },
    annotations: { ...WRITE, idempotentHint: false },
  }, (a) => call("comentar_tarefa", "crm_comentar", { p_task: a.task_id, p_texto: a.texto, p_mencoes: a.mencoes ?? [] }, [a.task_id]));

  const alterar = (tool: string, campo: string) => (ids: string[], valor: unknown, motivo?: string) =>
    call(tool, "crm_tarefas_alterar", { p_ids: ids, p_campo: campo, p_valor: valor, p_motivo: motivo ?? null }, ids);

  server.registerTool("alterar_status", {
    title: "Alterar status",
    description: "Muda o status de 1 a 50 tarefas. Use os ids de status de listar_listas. Status de perda (ex.: Cancelado no Atendimento) " +
      "exige motivo_perda. Devolve, por tarefa, o status anterior e o novo; erros por tarefa não impedem as outras.",
    inputSchema: { task_ids: LOTE, status: z.string(), motivo_perda: z.string().max(500).optional() },
    annotations: WRITE,
  }, (a) => alterar("alterar_status", "status")(a.task_ids, a.status, a.motivo_perda));

  server.registerTool("alterar_prazo", {
    title: "Alterar vencimento",
    description: "Muda o vencimento de 1 a 50 tarefas. nova_data em AAAA-MM-DD, ou null para tirar o vencimento. Devolve antes e depois.",
    inputSchema: { task_ids: LOTE, nova_data: DATA.nullable() },
    annotations: WRITE,
  }, (a) => alterar("alterar_prazo", "vencimento")(a.task_ids, a.nova_data));

  server.registerTool("alterar_prioridade", {
    title: "Alterar prioridade",
    description: "Muda a prioridade de 1 a 50 tarefas (urgente, alta ou normal). Devolve antes e depois.",
    inputSchema: { task_ids: LOTE, prioridade: z.enum(["urgente", "alta", "normal"]) },
    annotations: WRITE,
  }, (a) => alterar("alterar_prioridade", "prioridade")(a.task_ids, a.prioridade));

  server.registerTool("alterar_responsavel", {
    title: "Alterar responsáveis",
    description: "Muda os responsáveis de 1 a 50 tarefas. modo: definir (substitui todos), adicionar ou remover. " +
      "Só aceita quem tem acesso à lista (veja listar_responsaveis). Devolve antes e depois.",
    inputSchema: { task_ids: LOTE, modo: z.enum(["definir", "adicionar", "remover"]), responsaveis: z.array(ID).max(20) },
    annotations: WRITE,
  }, (a) => alterar("alterar_responsavel", "responsaveis")(a.task_ids, { modo: a.modo, ids: a.responsaveis }));

  server.registerTool("vincular_paciente_tarefa", {
    title: "Vincular paciente",
    description: "Liga 1 a 50 tarefas a um paciente cadastrado (patient_id de buscar_paciente). Devolve o vínculo anterior (paciente ou lead) e o novo.",
    inputSchema: { task_ids: LOTE, patient_id: z.string().min(1) },
    annotations: WRITE,
  }, (a) => alterar("vincular_paciente_tarefa", "paciente")(a.task_ids, a.patient_id));

  const inat = (tool: string, valor: boolean) => (a: { patient_ids: string[] }) =>
    call(tool, "pacientes_definir_inativo", { p_ids: a.patient_ids, p_inativo: valor }, a.patient_ids);
  const PIDS = { patient_ids: z.array(z.string().min(1)).min(1).max(50) };

  server.registerTool("ativar_paciente", {
    title: "Ativar paciente",
    description: "Reativa 1 a 50 pacientes (campo inativo = false). Não mexe em tratamento nem agenda. Devolve antes e depois.",
    inputSchema: PIDS,
    annotations: WRITE,
  }, inat("ativar_paciente", false));

  server.registerTool("inativar_paciente", {
    title: "Inativar paciente",
    description: "Inativa 1 a 50 pacientes (campo inativo = true). Não cancela tratamento nem apaga agendamentos: se houver " +
      "tratamento ativo, o resultado avisa para resolver no sistema. Devolve antes e depois.",
    inputSchema: PIDS,
    annotations: WRITE,
  }, inat("inativar_paciente", true));

  return server;
}
