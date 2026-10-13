// Teste local da função pipo-push (sem tocar na produção): banco simulado + serviço de push simulado.
// deno run -A --no-lock --config supabase/functions/pipo-push/deno.json supabase/functions/pipo-push/teste_local.ts
import ece from "npm:http_ece@1.2.0";
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";
import { createHandler, type Db, type Sub } from "./app.ts";
import { b64u } from "./webpush.ts";

let fails = 0;
function check(name: string, ok: boolean, info?: unknown) { console.log(name, ok, ok ? "" : JSON.stringify(info)); if (!ok) fails++; }

// "navegadores": cada um com sua chave; o servidor de push simulado guarda o que chegou (ou responde 410)
const got: Record<string, string[]> = {};
const browsers: Record<string, { ecdh: ReturnType<typeof createECDH>; auth: Uint8Array }> = {};
const gone = new Set<string>();
const srv = Deno.serve({ port: 8133, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const id = new URL(req.url).pathname.slice(1), b = browsers[id];
  const body = new Uint8Array(await req.arrayBuffer());
  if (gone.has(id)) return new Response("", { status: 410 });
  const txt = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: b.ecdh, authSecret: Buffer.from(b.auth) }).toString("utf8");
  (got[id] ||= []).push(txt);
  return new Response("", { status: 201 });
});
function mkSub(id: string, user: string, prefs: Record<string, boolean> | null = null): Sub {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  browsers[id] = { ecdh, auth };
  return { id, user_id: user, endpoint: "http://127.0.0.1:8133/" + id, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth), prefs };
}
let subs: Sub[] = [mkSub("a1", "ana"), mkSub("a2", "ana", { mencoes: false, vencidas: true }), mkSub("b1", "bia"), mkSub("c1", "caio")];
const cfg = { secret: "s3gr3d0", vapid_public: null as string | null, vapid_private: null as JsonWebKey | null };
let created = 0;
const marks: string[] = [];
const db: Db = {
  async config() { return { ...cfg }; },
  async saveVapid(p, k) { if (!cfg.vapid_public) { cfg.vapid_public = p; cfg.vapid_private = k; created++; } },
  async userFromToken(t) { return t === "tok-ana" ? "ana" : null; },
  async subsFor(ids) { return subs.filter((s) => ids.includes(s.user_id)); },
  async followTargets(ev) { return ev === "ev2" ? [{ user_id: "ana", task_id: "t1", title: "Ligar para a família", author: "Bia", acao: "comentou" }] : []; },
  async mentionTargets(ev) { return ev === "ev1" ? [{ user_id: "ana", task_id: "t1", title: "Ligar para a família", author: "Bia" }, { user_id: "caio", task_id: "t1", title: "Ligar para a família", author: "Bia" }] : []; },
  async overdue() { return [{ user_id: "ana", n: 3 }, { user_id: "bia", n: 1 }, { user_id: "zé", n: 0 }]; },
  async deleteSub(id) { subs = subs.filter((s) => s.id !== id); },
  async markSub(id, ok) { marks.push(id + ":" + ok); },
};
const h = createHandler({ db, subject: "https://exemplo.test" });
const call = (body: unknown, headers: Record<string, string> = {}) =>
  h(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

const k1 = await (await call({ acao: "chave" })).json(), k2 = await (await call({ acao: "chave" })).json();
check("chave pública criada uma vez só e sempre a mesma?", created === 1 && k1.publicKey === k2.publicKey && k1.publicKey.length === 87, { created, k1, k2 });
check("pedido do banco sem a senha é recusado?", (await call({ tipo: "vencidas" })).status === 401);
check("pedido do banco com senha errada é recusado?", (await call({ tipo: "vencidas" }, { "x-pipo-push": "x" })).status === 401);
check("teste sem login é recusado?", (await call({ acao: "teste" })).status === 401);
const t = await (await call({ acao: "teste" }, { Authorization: "Bearer tok-ana" })).json();
check("teste vai para os 2 aparelhos da Ana?", t.enviados === 2 && got.a1?.length === 1 && got.a2?.length === 1 && /ligadas/.test(got.a1[0]), { t, got });
gone.add("c1");
const m = await (await call({ tipo: "mencao", evento: "ev1" }, { "x-pipo-push": "s3gr3d0" })).json();
const ma = JSON.parse(got.a1[1] || "{}");
check("menção: Ana recebe no aparelho que aceita menções, não no que desligou?", got.a1.length === 2 && got.a2.length === 1 && ma.title === "Bia mencionou você" && ma.body === "Ligar para a família" && ma.url === "/?tarefa=t1#crm", { got, ma });
check("aparelho que não existe mais (410) é apagado?", !subs.some((s) => s.id === "c1") && m.falhas === 1, { m, subs: subs.map((s) => s.id) });
const v = await (await call({ tipo: "vencidas" }, { "x-pipo-push": "s3gr3d0" })).json();
const va = JSON.parse(got.a2[1] || "{}"), vb = JSON.parse(got.b1[0] || "{}");
check("vencidas: 1 resumo por aparelho, texto com a quantidade?", v.enviados === 3 && va.body === "Você tem 3 tarefas vencidas no CRM." && vb.body === "Você tem 1 tarefa vencida no CRM." && va.url === "/#crm", { v, va, vb });
check("quem tem 0 vencidas não recebe?", !got["zé"]);
const sg = await (await call({ tipo: "seguindo", evento: "ev2" }, { "x-pipo-push": "s3gr3d0" })).json();
const sga = got.a2.map((x: string) => JSON.parse(x)).filter((x: { tag?: string }) => x.tag === "seguindo-t1")[0];
check("seguindo: quem segue recebe 'Bia comentou' no aparelho que aceita?", sg.enviados >= 1 && sga && sga.title === "Bia comentou" && sga.url === "/?tarefa=t1#crm", { sg, sga });
check("pedido desconhecido = 400?", (await call({ tipo: "x" }, { "x-pipo-push": "s3gr3d0" })).status === 400);
await srv.shutdown();
console.log(fails ? fails + " FAILED" : "ALL PASS");
if (fails) Deno.exit(1);
