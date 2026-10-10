// Teste local do conector, sem internet nem Supabase: banco PGlite montado pelo schema.sql (dados
// fictícios) + o servidor MCP de verdade (app.ts), chamado por HTTP como o Claude chama.
// Rodar na raiz do repositório:  deno run -A supabase/functions/pipo-mcp/teste_local.ts
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { createHandler, type Db } from "./app.ts";

const ROOT = new URL("../../", import.meta.url);
const db = new PGlite();
await db.exec(`create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table auth.oauth_clients(id uuid primary key, client_name text);
do $$ begin create role authenticated; exception when others then null; end $$; do $$ begin create role anon; exception when others then null; end $$; do $$ begin create role service_role; exception when others then null; end $$;
create publication supabase_realtime;`);
await db.exec(await Deno.readTextFile(new URL("schema.sql", ROOT)));
await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant select on auth.oauth_clients to authenticated;`);

// pessoas e níveis fictícios
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222", C = "33333333-3333-3333-3333-333333333333";
const CLAUDE = "99999999-9999-9999-9999-999999999999";
await db.exec(`insert into auth.users(id,email) values('${A}','a@x'),('${B}','b@x'),('${C}','c@x');
insert into auth.oauth_clients values('${CLAUDE}','Claude');
insert into public.roles(id,name,is_admin,permissions) values
 ('sec','Sec',false,'{"crm_atendimento":{"view":true,"create":true,"edit":true},"pacientes":{"view":true,"edit":true},"conector_claude":{"view":true}}'),
 ('ver','Ver',false,'{"crm_atendimento":{"view":true}}') on conflict do nothing;
update public.profiles set role_id=(select id from public.roles where is_admin limit 1), full_name='Admin Teste', active=true where id='${A}';
update public.profiles set role_id='sec', full_name='Beatriz Teste', active=true where id='${B}';
update public.profiles set role_id='ver', full_name='Carlos Teste', active=true where id='${C}';`);
await db.query(`insert into public.documents(path,data) values('config/task_lists',$1),('patients/all',$2),('treatments/all',$3)
  on conflict (path) do update set data=excluded.data`, [
  JSON.stringify({ list: [{ id: "atendimento", name: "Atendimento", lead: true, statuses: [{ id: "triagem", name: "Triagem" }, { id: "avaliacao", name: "Avaliação" },
    { id: "cancelado", name: "Cancelado", done: true, lost: true }, { id: "finalizado", name: "Finalizado", done: true }] }] }),
  JSON.stringify({ list: [{ id: "p1", nome: "João Ávila Teste", telefones: [{ numero: "47999990000", nome: "Mãe" }] }, { id: "p2", nome: "Maria Teste" }] }),
  JSON.stringify({ list: [{ id: "t1", patientId: "p1", status: "ativo" }] })]);

// Banco "como o Supabase": cada chamada roda como o dono do token (token de teste = id do usuário)
const SIG: Record<string, string[]> = {
  mcp_permitido: [], mcp_registrar: ["p_ferramenta::text", "p_ok::boolean", "p_ids::text[]", "p_erro::text"],
  crm_listas_mcp: [], crm_tarefas_listar: ["p_filtros::jsonb"], crm_tarefa_obter: ["p_id::uuid"],
  pacientes_buscar: ["p_texto::text", "p_limite::int", "p_incluir_inativos::boolean"], crm_people: [],
  crm_tarefa_criar: ["p::jsonb"], crm_comentar: ["p_task::uuid", "p_texto::text", "p_mencoes::uuid[]"],
  crm_tarefas_alterar: ["p_ids::uuid[]", "p_campo::text", "p_valor::jsonb", "p_motivo::text"],
  pacientes_definir_inativo: ["p_ids::text[]", "p_inativo::boolean"],
};
function fakeDb(token: string): Db {
  return {
    user: () => Promise.resolve([A, B, C].includes(token) ? token : null),
    async rpc(fn, args) {
      const sig = SIG[fn]; if (!sig) return { data: null, error: { message: "função desconhecida " + fn } };
      const names = sig.map((s) => s.split("::")[0]);
      const vals = names.map((n) => { const v = args[n]; return v === undefined || v === null ? null : (typeof v === "object" && !Array.isArray(v)) || sig[names.indexOf(n)].endsWith("jsonb") ? JSON.stringify(v) : v; });
      const call = `public.${fn}(${sig.map((s, i) => `${s.split("::")[0]} => $${i + 1}::${s.split("::")[1]}`).join(", ")})`;
      const sql = fn === "crm_people" ? `select * from ${call}` : `select ${call} as r`;
      await db.exec(`reset role; select set_config('test.uid','${token}',false); select set_config('request.jwt.claims','${JSON.stringify({ sub: token, client_id: CLAUDE })}',false); set role authenticated;`);
      try {
        const rows = (await db.query(sql, vals)).rows as Record<string, unknown>[];
        return { data: fn === "crm_people" ? rows : rows[0]?.r ?? null, error: null };
      } catch (e) { return { data: null, error: { message: (e as Error).message } }; } finally { await db.exec("reset role"); }
    },
  };
}

const URLB = "https://exemplo.supabase.co/functions/v1/pipo-mcp";
const handler = createHandler({ publicUrl: URLB, authServer: "https://exemplo.supabase.co/auth/v1", escrita: true, db: fakeDb });
const handlerRO = createHandler({ publicUrl: URLB, authServer: "https://exemplo.supabase.co/auth/v1", escrita: false, db: fakeDb });

let falhas = 0, n = 0;
const check = (nome: string, cond: boolean, info?: unknown) => { n++; if (!cond) falhas++; console.log((cond ? "ok  " : "FALHOU ") + nome + (cond ? "" : " → " + JSON.stringify(info))); };
let rid = 0;
async function rpc(h: typeof handler, token: string | null, method: string, params: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = "Bearer " + token;
  const res = await h(new Request(URLB, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }) }));
  const txt = await res.text();
  return { status: res.status, headers: res.headers, body: txt ? JSON.parse(txt) : null };
}
const tool = async (token: string, name: string, args: unknown = {}, h = handler) => {
  const r = await rpc(h, token, "tools/call", { name, arguments: args });
  const c = r.body?.result;
  return { err: !!c?.isError, text: c?.content?.[0]?.text ?? JSON.stringify(r.body?.error), data: (() => { try { return JSON.parse(c?.content?.[0]?.text); } catch { return null; } })() };
};

// 1. login
const semLogin = await rpc(handler, null, "tools/list");
check("sem login = 401 com endereço do login", semLogin.status === 401 && (semLogin.headers.get("www-authenticate") || "").includes('resource_metadata="' + URLB + '/.well-known/oauth-protected-resource"'), semLogin.headers.get("www-authenticate"));
const meta = await handler(new Request(URLB + "/.well-known/oauth-protected-resource"));
const mj = await meta.json();
check("metadados do recurso (RFC 9728)", meta.status === 200 && mj.resource === URLB && mj.authorization_servers[0] === "https://exemplo.supabase.co/auth/v1", mj);
const tokRuim = await rpc(handler, "token-invalido", "tools/list");
check("token inválido = 401 invalid_token", tokRuim.status === 401 && (tokRuim.headers.get("www-authenticate") || "").includes("invalid_token"));

// 2. ferramentas e anotações
const lst = await rpc(handler, B, "tools/list");
const tools = (lst.body?.result?.tools || []) as { name: string; annotations?: Record<string, boolean> }[];
const nomes = tools.map((t) => t.name).sort().join(",");
check("14 ferramentas", tools.length === 14, nomes);
check("leitura marcada como somente leitura", ["listar_tarefas", "obter_tarefa", "buscar_paciente", "listar_responsaveis", "listar_listas"].every((k) => tools.find((t) => t.name === k)?.annotations?.readOnlyHint === true));
check("escrita marcada como não destrutiva", tools.filter((t) => !t.annotations?.readOnlyHint).every((t) => t.annotations?.destructiveHint === false));
const ro = await rpc(handlerRO, B, "tools/list");
check("só leitura publicada = 5 ferramentas", (ro.body?.result?.tools || []).length === 5);

// 3. permissão do conector
const semPerm = await tool(C, "listar_listas");
check("nível sem 'Conector Claude' é recusado", semPerm.err && semPerm.text.includes("Conector Claude"), semPerm.text);

// 4. leitura + escrita
const listas = await tool(B, "listar_listas");
check("listar_listas traz status reais", !listas.err && listas.data[0].status.some((s: { id: string; perda: boolean }) => s.id === "cancelado" && s.perda), listas.text);
const cri = await tool(B, "criar_tarefa", { lista: "atendimento", titulo: "Ligar para família (teste)", prioridade: "alta", vencimento: "2026-01-05", responsaveis: [B], lead_nome: "Lead Teste" });
check("criar_tarefa", !cri.err && cri.data.criada.status === "triagem", cri.text);
const tid = cri.data.criada.id as string;
const prioRuim = await tool(B, "criar_tarefa", { lista: "atendimento", titulo: "x", prioridade: "baixa" });
check("prioridade inválida recusada antes do banco", prioRuim.err, prioRuim.text);
const atr = await tool(B, "listar_tarefas", { atrasadas: true, responsavel: "eu", texto: "familia" });
check("listar_tarefas (atrasadas, eu, sem acento)", !atr.err && atr.data.total === 1, atr.text);
const prazo = await tool(B, "alterar_prazo", { task_ids: [tid], nova_data: "2026-12-01" });
check("alterar_prazo devolve antes e depois", !prazo.err && prazo.data.alteradas[0].antes.vencimento === "2026-01-05" && prazo.data.alteradas[0].depois.vencimento === "2026-12-01", prazo.text);
const semMot = await tool(B, "alterar_status", { task_ids: [tid], status: "cancelado" });
check("perda sem motivo vira erro da tarefa", !semMot.err && semMot.data.erros.length === 1 && semMot.data.alteradas.length === 0, semMot.text);
const st = await tool(B, "alterar_status", { task_ids: [tid], status: "cancelado", motivo_perda: "Sem retorno" });
check("alterar_status com motivo + finalizada", !st.err && st.data.alteradas[0].tarefa.finalizada === true, st.text);
const st2 = await tool(B, "alterar_status", { task_ids: [tid], status: "triagem" });
check("voltar status reabre (sem data de finalização)", !st2.err && st2.data.alteradas[0].tarefa.finalizada === false, st2.text);
const resp = await tool(B, "alterar_responsavel", { task_ids: [tid], modo: "adicionar", responsaveis: [A] });
check("alterar_responsavel (adicionar)", !resp.err && resp.data.alteradas[0].depois.responsaveis.length === 2, resp.text);
const pr = await tool(B, "alterar_prioridade", { task_ids: [tid, "00000000-0000-0000-0000-000000000000"], prioridade: "urgente" });
check("lote com uma inexistente: uma alterada, um erro", !pr.err && pr.data.alteradas.length === 1 && pr.data.erros.length === 1, pr.text);
const lote = await tool(B, "alterar_prioridade", { task_ids: Array(51).fill(tid), prioridade: "normal" });
check("mais de 50 recusado", lote.err, lote.text);
const pac = await tool(B, "buscar_paciente", { nome: "joao avila" });
check("buscar_paciente sem acento", !pac.err && pac.data[0].id === "p1" && pac.data[0].telefones.length === 1, pac.text);
const vin = await tool(B, "vincular_paciente_tarefa", { task_ids: [tid], patient_id: "p1" });
check("vincular_paciente_tarefa", !vin.err && vin.data.alteradas[0].antes.lead === "Lead Teste" && vin.data.alteradas[0].depois.patient_id === "p1", vin.text);
const com = await tool(B, "comentar_tarefa", { task_id: tid, texto: "Liguei, sem resposta.", mencoes: [A] });
check("comentar_tarefa com menção", !com.err && com.data.mencoes[0] === "Admin Teste", com.text);
const ob = await tool(B, "obter_tarefa", { task_id: tid });
const ativ = ob.data?.atividade || [];
check("obter_tarefa traz histórico com origem via Claude", !ob.err && ativ.length >= 6 && ativ.every((e: { dados: { app?: string } }) => e.dados.app === "Claude"), ativ.map((e: { tipo: string; dados: unknown }) => [e.tipo, e.dados]));
check("histórico com autor", ativ.every((e: { autor: string }) => e.autor === "Beatriz Teste"));
const ina = await tool(B, "inativar_paciente", { patient_ids: ["p1"] });
check("inativar_paciente avisa tratamento ativo", !ina.err && ina.data.alterados[0].depois.inativo === true && !!ina.data.alterados[0].aviso, ina.text);
const rea = await tool(B, "ativar_paciente", { patient_ids: ["p1", "p2"] });
check("ativar_paciente (um muda, outro já estava ativo)", !rea.err && rea.data.alterados.length === 1 && rea.data.sem_mudanca.length === 1, rea.text);
const doc = (await db.query(`select p->'inativo' i, p->'_upd' u from public.documents d, jsonb_array_elements(d.data->'list') p where path='patients/all' and p->>'id'='p1'`)).rows[0] as { i: boolean; u: { por: string; app: string } };
check("paciente gravado como booleano com quem mudou", doc.i === false && doc.u.por === "Beatriz Teste" && doc.u.app === "Claude", doc);
const resps = await tool(B, "listar_responsaveis", { lista: "atendimento" });
check("listar_responsaveis", !resps.err && resps.data.length === 3, resps.text);
const log = (await db.query(`select count(*)::int n, count(*) filter (where not ok)::int e from public.mcp_calls`)).rows[0] as { n: number; e: number };
check("chamadas registradas (com erros marcados)", log.n >= 15 && log.e >= 1, log);
const semNomes = (await db.query(`select count(*)::int n from public.mcp_calls where array_to_string(ids, ' ') ilike '%joão%'`)).rows[0] as { n: number };
check("registro sem nomes", semNomes.n === 0);

console.log(`\n${n - falhas} de ${n} checagens OK`);
if (falhas) Deno.exit(1);
