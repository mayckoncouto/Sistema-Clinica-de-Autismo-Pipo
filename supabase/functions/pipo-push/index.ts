// Entrada da Edge Function "pipo-push" (publicar com --no-verify-jwt: quem chama é o banco, com a
// senha interna x-pipo-push, ou o app; a própria função confere cada caso). Usa a chave de serviço
// (lê as inscrições de todos para entregar os avisos); nunca devolve dados além da chave pública.
import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { createHandler, type Db } from "./app.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
function serviceKey(): string {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (k) return k;
  try { const all = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return Object.values(all)[0] as string; } catch (_e) { return ""; }
}
const sb = createClient(URL_, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// (tipos das respostas do banco conferidos em tempo de execução por must())
const db = {
  async config() {
    return must(await sb.from("push_config").select("secret, vapid_public, vapid_private").eq("id", 1).single());
  },
  async saveVapid(pub: string, priv: JsonWebKey) {
    must(await sb.from("push_config").update({ vapid_public: pub, vapid_private: priv, updated_at: new Date().toISOString() })
      .eq("id", 1).is("vapid_public", null));
  },
  async userFromToken(token: string) {
    const { data, error } = await sb.auth.getUser(token);
    return error || !data?.user ? null : data.user.id;
  },
  async subsFor(ids: string[]) {
    return must(await sb.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, prefs").in("user_id", ids));
  },
  async mentionTargets(ev: string) {
    return must(await sb.rpc("push_mention_targets", { p_event: ev })) || [];
  },
  async followTargets(ev: string) {
    return must(await sb.rpc("push_follow_targets", { p_event: ev })) || [];
  },
  async overdue() {
    return must(await sb.rpc("push_overdue_counts")) || [];
  },
  async deleteSub(id: string) {
    must(await sb.from("push_subscriptions").delete().eq("id", id));
  },
  async markSub(id: string, ok: boolean) {
    if (ok) must(await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", id));
    else {
      const r = must(await sb.from("push_subscriptions").select("fail_count").eq("id", id).maybeSingle());
      const n = ((r as { fail_count?: number } | null)?.fail_count || 0) + 1;
      if (n >= 10) must(await sb.from("push_subscriptions").delete().eq("id", id));
      else must(await sb.from("push_subscriptions").update({ fail_count: n }).eq("id", id));
    }
  },
} as unknown as Db;

Deno.serve(createHandler({ db, subject: Deno.env.get("PIPO_PUSH_SUBJECT") || "https://sistemaclinicadeautismopipo.vercel.app" }));
