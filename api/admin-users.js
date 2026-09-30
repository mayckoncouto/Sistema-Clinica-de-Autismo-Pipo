// Administração de usuários (só administradores ativos).
//
// Criar/remover usuário, trocar a senha de outra pessoa e bloquear o login
// exigem a service role key do Supabase, que não pode ir para o navegador —
// por isso estas ações passam por aqui. Editar nome/nível e as permissões dos
// níveis é feito direto pelo app (as políticas RLS só deixam admin alterar).
//
// POST /api/admin-users   Authorization: Bearer <access_token do usuário>
//   { action: "create", email, password, full_name, role_id }
//   { action: "set_password", id, password }
//   { action: "set_active", id, active }
//   { action: "delete", id }

// Aceita a URL colada com sufixo (ex.: ".../rest/v1/") ou barra no fim.
var SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
var SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Aceita os dois formatos de chave do Supabase:
// - nova "secret key" (sb_secret_...): vai só no header apikey; o gateway do
//   Supabase a troca por um token de service role. Ela não é um JWT, então
//   não pode ir no Authorization.
// - antiga "service_role" (JWT eyJ...): vai no apikey e no Authorization.
function adminHeaders() {
  var h = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!/^sb_/.test(SERVICE_KEY)) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}

async function call(path, opts) {
  var r = await fetch(SUPABASE_URL + path, opts);
  var text = await r.text();
  var body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body: body };
}

function errMsg(resp, fallback) {
  var b = resp.body || {};
  return b.msg || b.message || b.error_description || b.error || fallback;
}

async function currentAdmin(req) {
  var auth = req.headers.authorization || "";
  var token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  var me = await call("/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token }
  });
  if (!me.ok || !me.body || !me.body.id) return null;
  var prof = await call(
    "/rest/v1/profiles?select=id,active,role:roles(is_admin)&id=eq." + encodeURIComponent(me.body.id),
    { headers: adminHeaders() }
  );
  var row = prof.ok && Array.isArray(prof.body) ? prof.body[0] : null;
  if (!row || !row.active || !row.role || !row.role.is_admin) return null;
  return row;
}

function validPassword(p) {
  return typeof p === "string" && p.length >= 8;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas na Vercel." });
    return;
  }

  var admin = await currentAdmin(req);
  if (!admin) {
    res.status(403).json({ error: "Apenas administradores podem gerenciar usuários." });
    return;
  }

  var body = await readJson(req);
  var action = body.action;

  try {
    if (action === "create") {
      var email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        res.status(400).json({ error: "E-mail inválido." }); return;
      }
      if (!validPassword(body.password)) {
        res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." }); return;
      }
      var roleId = String(body.role_id || "");
      var roleCheck = await call("/rest/v1/roles?select=id&id=eq." + encodeURIComponent(roleId), { headers: adminHeaders() });
      if (!roleId || !roleCheck.ok || !Array.isArray(roleCheck.body) || !roleCheck.body.length) {
        res.status(400).json({ error: "Escolha um nível de permissão válido." }); return;
      }
      var created = await call("/auth/v1/admin/users", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          email: email,
          password: body.password,
          email_confirm: true,
          user_metadata: { full_name: String(body.full_name || "").trim() }
        })
      });
      if (!created.ok) {
        var m = errMsg(created, "Não foi possível criar o usuário.");
        if (/already|registered|exists/i.test(m)) m = "Já existe um usuário com este e-mail.";
        res.status(400).json({ error: m }); return;
      }
      var newId = created.body.id || (created.body.user && created.body.user.id);
      // O trigger handle_new_user já criou o perfil; completa nome e nível.
      var patch = { full_name: String(body.full_name || "").trim(), role_id: roleId };
      var upd = await call("/rest/v1/profiles?id=eq." + encodeURIComponent(newId), {
        method: "PATCH",
        headers: Object.assign(adminHeaders(), { Prefer: "return=representation" }),
        body: JSON.stringify(patch)
      });
      if (!upd.ok) {
        res.status(500).json({ error: "Usuário criado, mas o nível não foi salvo: " + errMsg(upd, "") }); return;
      }
      res.status(200).json({ ok: true, profile: Array.isArray(upd.body) ? upd.body[0] : null });
      return;
    }

    if (action === "set_password") {
      if (!body.id) { res.status(400).json({ error: "Usuário não informado." }); return; }
      if (!validPassword(body.password)) {
        res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." }); return;
      }
      var pw = await call("/auth/v1/admin/users/" + encodeURIComponent(body.id), {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ password: body.password })
      });
      if (!pw.ok) { res.status(400).json({ error: errMsg(pw, "Não foi possível trocar a senha.") }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "set_active") {
      if (!body.id) { res.status(400).json({ error: "Usuário não informado." }); return; }
      if (body.id === admin.id && !body.active) {
        res.status(400).json({ error: "Você não pode desativar a sua própria conta." }); return;
      }
      var act = await call("/rest/v1/profiles?id=eq." + encodeURIComponent(body.id), {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ active: !!body.active })
      });
      if (!act.ok) { res.status(400).json({ error: errMsg(act, "Não foi possível alterar o usuário.") }); return; }
      // Bloqueia (ou libera) o login de verdade, não só o acesso aos dados.
      var ban = await call("/auth/v1/admin/users/" + encodeURIComponent(body.id), {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ ban_duration: body.active ? "none" : "876000h" })
      });
      if (!ban.ok) { res.status(400).json({ error: errMsg(ban, "Não foi possível bloquear o login.") }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "delete") {
      if (!body.id) { res.status(400).json({ error: "Usuário não informado." }); return; }
      if (body.id === admin.id) {
        res.status(400).json({ error: "Você não pode excluir a sua própria conta." }); return;
      }
      var del = await call("/auth/v1/admin/users/" + encodeURIComponent(body.id), {
        method: "DELETE",
        headers: adminHeaders()
      });
      if (!del.ok) { res.status(400).json({ error: errMsg(del, "Não foi possível excluir o usuário.") }); return; }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Ação desconhecida." });
  } catch (e) {
    res.status(500).json({ error: "Erro inesperado: " + (e && e.message ? e.message : String(e)) });
  }
};
