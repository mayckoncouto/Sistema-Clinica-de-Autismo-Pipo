// Função "pipo-push": envia as notificações do sistema (Web Push).
// Pedidos (POST, JSON):
//   {acao: "chave"}                         → chave pública VAPID (cria o par no primeiro uso)
//   {acao: "teste"} + login da pessoa       → aviso de teste para os aparelhos dela
//   {tipo: "mencao", evento} + x-pipo-push  → @menção num comentário (chamado pelo gatilho do banco)
//   {tipo: "seguindo", evento} + x-pipo-push → comentário/mudança em tarefa que a pessoa segue (gatilho do banco)
//   {tipo: "exclusao", log} + x-pipo-push  → muitas exclusões de uma vez no Planner/Agenda (gatilho do histórico)
//   {tipo: "vencidas"}       + x-pipo-push  → resumo diário das vencidas (chamado pelo agendamento)
import { sendPush, vapidGenerate, type PushSub } from "./webpush.ts";

export type Sub = PushSub & { id: string; user_id: string; prefs: Record<string, boolean> | null };
export type Db = {
  config(): Promise<{ secret: string; vapid_public: string | null; vapid_private: JsonWebKey | null }>;
  saveVapid(pub: string, priv: JsonWebKey): Promise<void>;
  userFromToken(token: string): Promise<string | null>;
  subsFor(userIds: string[]): Promise<Sub[]>;
  mentionTargets(eventId: string): Promise<{ user_id: string; task_id: string; title: string; author: string }[]>;
  followTargets(eventId: string): Promise<{ user_id: string; task_id: string; title: string; author: string; acao: string }[]>;
  deleteTargets(logId: number): Promise<{ user_id: string; area: string; author: string; n: number }[]>;
  overdue(): Promise<{ user_id: string; n: number }[]>;
  deleteSub(id: string): Promise<void>;
  markSub(id: string, ok: boolean): Promise<void>;
};
type Opts = { db: Db; subject: string; send?: typeof sendPush };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export function createHandler(o: Opts) {
  const send = o.send || sendPush;

  async function vapid() {
    const c = await o.db.config();
    if (c.vapid_public && c.vapid_private) return { publicKey: c.vapid_public, privateJwk: c.vapid_private, subject: o.subject };
    const k = await vapidGenerate();
    await o.db.saveVapid(k.publicKey, k.privateJwk);
    const again = await o.db.config();   // outra chamada pode ter criado ao mesmo tempo: vale a gravada
    return { publicKey: again.vapid_public || k.publicKey, privateJwk: again.vapid_private || k.privateJwk, subject: o.subject };
  }

  // Envia para todos os aparelhos das pessoas (respeitando a escolha do aparelho: vencidas/menções).
  async function deliver(items: { user_id: string; pref: string | null; data: unknown }[]) {
    if (!items.length) return { enviados: 0, falhas: 0 };
    const v = await vapid();
    const subs = await o.db.subsFor([...new Set(items.map((i) => i.user_id))]);
    let ok = 0, bad = 0;
    for (const it of items) {
      for (const s of subs.filter((x) => x.user_id === it.user_id)) {
        if (it.pref && s.prefs && s.prefs[it.pref] === false) continue;
        let st = 0;
        try { st = await send(s, it.data, v); } catch (_e) { st = 0; }
        if (st === 404 || st === 410) { await o.db.deleteSub(s.id); bad++; }
        else if (st >= 200 && st < 300) { await o.db.markSub(s.id, true); ok++; }
        else { await o.db.markSub(s.id, false); bad++; }
      }
    }
    return { enviados: ok, falhas: bad };
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "use POST" }, 405);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_e) { /* vazio */ }
    try {
      if (body.acao === "chave") return json({ publicKey: (await vapid()).publicKey });
      if (body.acao === "teste") {
        const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const uid = tok ? await o.db.userFromToken(tok) : null;
        if (!uid) return json({ error: "entre no sistema" }, 401);
        const r = await deliver([{ user_id: uid, pref: null, data: {
          title: "Notificações ligadas", body: "Este aparelho vai receber os avisos do sistema.", url: "/#crm", tag: "teste" } }]);
        return json(r);
      }
      // Daqui em diante, só o próprio banco (gatilho / agendamento) pode chamar.
      const c = await o.db.config();
      if (!c.secret || req.headers.get("x-pipo-push") !== c.secret) return json({ error: "não autorizado" }, 401);
      if (body.tipo === "mencao" && typeof body.evento === "string") {
        const t = await o.db.mentionTargets(body.evento);
        return json(await deliver(t.map((x) => ({ user_id: x.user_id, pref: "mencoes", data: {
          title: x.author + " mencionou você", body: x.title, url: "/?tarefa=" + x.task_id + "#crm", tag: "mencao-" + body.evento } }))));
      }
      if (body.tipo === "seguindo" && typeof body.evento === "string") {
        const t = await o.db.followTargets(body.evento);
        return json(await deliver(t.map((x) => ({ user_id: x.user_id, pref: "seguindo", data: {
          title: x.author + " " + x.acao, body: x.title, url: "/?tarefa=" + x.task_id + "#crm", tag: "seguindo-" + x.task_id } }))));
      }
      if (body.tipo === "exclusao" && typeof body.log === "number") {
        const t = await o.db.deleteTargets(body.log);
        return json(await deliver(t.map((x) => ({ user_id: x.user_id, pref: "exclusoes", data: {
          title: x.author + " excluiu " + x.n + " " + (x.area === "agenda" ? "atendimentos da Agenda" : "agendamentos do Planner"),
          body: "Confira em Outras Opções → Histórico de Alterações. Dá para restaurar.", url: "/#" + (x.area === "agenda" ? "agenda" : "planner"), tag: "exclusao-" + body.log } }))));
      }
      if (body.tipo === "vencidas") {
        const t = await o.db.overdue();
        return json(await deliver(t.filter((x) => x.n > 0).map((x) => ({ user_id: x.user_id, pref: "vencidas", data: {
          title: "Tarefas vencidas",
          body: x.n === 1 ? "Você tem 1 tarefa vencida no CRM." : "Você tem " + x.n + " tarefas vencidas no CRM.",
          url: "/#crm", tag: "vencidas" } }))));
      }
      return json({ error: "pedido desconhecido" }, 400);
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  };
}
