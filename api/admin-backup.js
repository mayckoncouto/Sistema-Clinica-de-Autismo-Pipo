// Cópia de segurança — restaurar (só administradores ativos).
//
// Baixar a cópia é feito no próprio navegador (o Administrador lê tudo pelo
// RLS). Restaurar passa por aqui porque precisa da service role key: grava
// com os ids, datas e autores originais, sem esbarrar nas regras de permissão
// que valem para quem usa o app (os triggers deixam passar quando não há
// usuário logado — ver supabase/2026-10-03-copia-de-seguranca.sql).
//
// POST /api/admin-backup   Authorization: Bearer <access_token do usuário>
//   { action: "restore", table: "documents" | "appointments" | "clinical_records" | "treatment_finance" | "convenio_finance" | "staff" | "staff_pay", rows: [...] }
//
// Só acrescenta ou sobrescreve (upsert): nada que foi criado depois da cópia
// é apagado. O app manda as linhas em lotes pequenos (limite de 4,5 MB da Vercel).

var SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
var SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Mesmo tratamento dos dois formatos de chave de api/admin-users.js.
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
  return b.msg || b.message || b.error_description || b.error || b.details || fallback;
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

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

// Colunas aceitas por tabela (o resto do arquivo é ignorado) e a chave do upsert.
// Colunas de usuário apontam para auth.users: usuário que não existe mais vira null.
var TABLES = {
  documents: {
    key: "path",
    cols: ["path", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  appointments: {
    key: "id",
    cols: ["id", "date", "time", "professional_id", "room_id", "patient", "note", "blocked", "service",
           "source", "status", "created_by", "updated_by", "created_at", "updated_at"],
    users: ["created_by", "updated_by"]
  },
  treatment_finance: {
    key: "treatment_id",
    cols: ["treatment_id", "valor", "despesas", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  convenio_finance: {
    key: "id",
    cols: ["id", "convenio_id", "spec_id", "valor", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  staff: {
    key: "id",
    cols: ["id", "professional_id", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  staff_pay: {
    key: "staff_id",
    cols: ["staff_id", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  clinical_records: {
    key: "id",
    cols: ["id", "patient_id", "patient_name", "appointment_id", "appointment_date", "appointment_time",
           "professional_id", "author_id", "author_name", "content", "created_at", "updated_at"],
    users: ["author_id"]
  }
};

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
    res.status(403).json({ error: "Apenas administradores podem restaurar a cópia de segurança." });
    return;
  }
  var body = await readJson(req);
  if (body.action !== "restore") { res.status(400).json({ error: "Ação desconhecida." }); return; }
  var cfg = TABLES[body.table];
  if (!cfg) { res.status(400).json({ error: "Tabela inválida." }); return; }
  var rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) { res.status(200).json({ ok: true, count: 0 }); return; }

  try {
    // Usuários que existem hoje (todo usuário do Auth tem perfil).
    var users = await call("/rest/v1/profiles?select=id", { headers: adminHeaders() });
    if (!users.ok) { res.status(500).json({ error: "Não foi possível ler os usuários: " + errMsg(users, "") }); return; }
    var known = {};
    (users.body || []).forEach(function (u) { known[u.id] = true; });

    var clean = [];
    rows.forEach(function (r) {
      if (!r || typeof r !== "object" || r[cfg.key] == null || r[cfg.key] === "") return;
      var o = {};
      cfg.cols.forEach(function (c) { if (Object.prototype.hasOwnProperty.call(r, c)) o[c] = r[c]; });
      cfg.users.forEach(function (c) { if (o[c] && !known[o[c]]) o[c] = null; });
      clean.push(o);
    });
    // PostgREST exige as mesmas colunas em todas as linhas de um upsert em lote:
    // linhas com conjuntos de colunas diferentes vão em envios separados (sem
    // inventar null, que quebraria colunas obrigatórias).
    var groups = {};
    clean.forEach(function (o) { var k = Object.keys(o).sort().join(","); (groups[k] = groups[k] || []).push(o); });
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      var up = await call("/rest/v1/" + body.table + "?on_conflict=" + cfg.key, {
        method: "POST",
        headers: Object.assign(adminHeaders(), { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(groups[keys[i]])
      });
      if (!up.ok) { res.status(400).json({ error: errMsg(up, "Não foi possível gravar.") }); return; }
    }
    res.status(200).json({ ok: true, count: clean.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
