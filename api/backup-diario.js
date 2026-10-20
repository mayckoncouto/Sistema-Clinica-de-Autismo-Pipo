// Backup diário automático para o Google Drive (cron da Vercel, 22:00 UTC = 19:00 de Brasília).
//
// Lê no banco (service role, só no servidor) as mesmas tabelas do Backup do menu Acesso, grava
// backup-agenda-pipo-AAAA-MM-DD-HHMM.json.gz na pasta do Drive e apaga (lixeira) os backups automáticos
// mais antigos que BACKUP_KEEP_DAYS (padrão 30). O arquivo tem dados de saúde: a pasta deve ser privada.
//
// Chamada: GET /api/backup-diario  com  Authorization: Bearer <CRON_SECRET>  (a Vercel manda sozinha).
// Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, CRON_SECRET,
//            BACKUP_DRIVE_FOLDER (padrão: pasta "Sistema Backup"), BACKUP_KEEP_DAYS (padrão 30).
// Obs.: a conta de serviço do Google não tem espaço próprio; a pasta precisa estar no Drive compartilhado.

var crypto = require("crypto");
var zlib = require("zlib");

var SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
var SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
var DEFAULT_FOLDER = "18aK9o4AlwOfeLufSpCKjif6YA7p3wrKa";
var PREFIX = "backup-agenda-pipo-";

// Mesmas tabelas de BACKUP_TABLES (index.html); optional = a tabela pode não existir ainda.
var TABLES = [
  ["documents", "path"], ["appointments", "id"], ["clinical_records", "id"], ["patient_health", "patient_id"],
  ["treatment_finance", "treatment_id"], ["convenio_finance", "id"], ["bank_account_finance", "account_id"],
  ["finance_entries", "id"], ["finance_statement_lines", "id"], ["finance_statement_links", "entry_id"], ["treatment_sales", "id"], ["anamneses", "id"],
  ["commission_rules", "id"], ["sale_commissions", "id"], ["sale_goals", "id"], ["finance_loans", "id"],
  ["finance_payables", "id"], ["staff", "id"], ["staff_pay", "staff_id"], ["therapy_plans", "id"],
  ["tasks", "id"], ["task_events", "id"], ["intake_links", "token"], ["intake_submissions", "id"],
  ["roles", "id"], ["profiles", "id"]
];

function readEnv(name) { return (process.env[name] || "").trim(); }
function svcHeaders() {
  var h = { apikey: SERVICE_KEY };
  if (!/^sb_/.test(SERVICE_KEY)) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}

async function fetchAll(table, order) {
  var out = [], page = 1000, from = 0;
  for (;;) {
    var r = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?select=*&order=" + order + ".asc", {
      headers: Object.assign({ Range: from + "-" + (from + page - 1), "Range-Unit": "items" }, svcHeaders())
    });
    if (!r.ok) {
      if (r.status === 404 || r.status === 400) return null; // tabela ainda não existe
      throw new Error(table + ": " + r.status + " " + (await r.text()).slice(0, 200));
    }
    var rows = await r.json();
    out = out.concat(rows);
    if (rows.length < page) return out;
    from += page;
  }
}

// ---------- Google Drive ----------
var tokenCache = { value: "", exp: 0 };
function serviceAccount() {
  var raw = readEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  var o;
  try { o = JSON.parse(raw); } catch (e) {
    try { o = JSON.parse(raw.replace(/\r?\n/g, "\\n")); } catch (e2) { return null; }
  }
  return o && o.client_email && o.private_key ? o : null;
}
function b64u(buf) { return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
async function googleToken() {
  var now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && tokenCache.exp - 60 > now) return tokenCache.value;
  var sa = serviceAccount();
  if (!sa) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON na Vercel.");
  var aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  var head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claim = b64u(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive", aud: aud, iat: now, exp: now + 3600 }));
  var sig = crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(sa.private_key);
  var r = await fetch(aud, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + claim + "." + b64u(sig)
  });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok || !j.access_token) throw new Error("O Google não aceitou a conta de serviço: " + (j.error_description || j.error || r.status));
  tokenCache = { value: j.access_token, exp: now + (j.expires_in || 3600) };
  return tokenCache.value;
}
async function gd(path, opts) {
  var t = await googleToken();
  var o = Object.assign({}, opts || {});
  o.headers = Object.assign({ Authorization: "Bearer " + t }, o.headers || {});
  var r = await fetch("https://www.googleapis.com" + path, o);
  var text = await r.text();
  var body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!r.ok) throw new Error("Google Drive: " + ((body && body.error && (body.error.message || body.error)) || r.status));
  return body;
}

async function uploadFile(folder, name, buf) {
  var t = await googleToken();
  var start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size", {
    method: "POST",
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/gzip" },
    body: JSON.stringify({ name: name, parents: [folder], mimeType: "application/gzip" })
  });
  if (!start.ok) {
    var tx = await start.text();
    var msg = tx; try { msg = JSON.parse(tx).error.message; } catch (e) {}
    throw new Error("Google Drive: " + msg + (/not found/i.test(msg) ? " (a pasta precisa estar no Drive compartilhado e a conta de serviço precisa ser membro dele)" : ""));
  }
  var loc = start.headers.get("location");
  var put = await fetch(loc, { method: "PUT", headers: { "Content-Type": "application/gzip", "Content-Length": String(buf.length) }, body: buf });
  var j = await put.json().catch(function () { return {}; });
  if (!put.ok || !j.id) throw new Error("Google Drive: o envio do arquivo falhou (" + put.status + ").");
  return j;
}

async function pruneOld(folder, keepDays) {
  var cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
  var q = "'" + folder + "' in parents and trashed=false and name contains '" + PREFIX + "' and createdTime < '" + cutoff + "'";
  var j = await gd("/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100&fields=files(id,name)&q=" + encodeURIComponent(q));
  var n = 0;
  for (var i = 0; i < (j.files || []).length; i++) {
    var f = j.files[i];
    if (f.name.indexOf(PREFIX) !== 0 || !/\.json\.gz$/.test(f.name)) continue;
    await gd("/drive/v3/files/" + encodeURIComponent(f.id) + "?supportsAllDrives=true&fields=id", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true })
    });
    n++;
  }
  return n;
}

function stamp(d) {
  // horário de Brasília (UTC-3) no nome do arquivo
  var b = new Date(d.getTime() - 3 * 3600000);
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return b.getUTCFullYear() + "-" + p(b.getUTCMonth() + 1) + "-" + p(b.getUTCDate()) + "-" + p(b.getUTCHours()) + p(b.getUTCMinutes());
}

module.exports = async function handler(req, res) {
  var secret = readEnv("CRON_SECRET");
  if (!secret) { res.status(500).json({ error: "Falta CRON_SECRET na Vercel." }); return; }
  var auth = String(req.headers.authorization || "");
  var a = Buffer.from(auth), b = Buffer.from("Bearer " + secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { res.status(401).json({ error: "Não autorizado." }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: "Falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY." }); return; }
  try {
    var now = new Date();
    var data = {}, counts = {};
    for (var i = 0; i < TABLES.length; i++) {
      var rows = await fetchAll(TABLES[i][0], TABLES[i][1]);
      if (rows) { data[TABLES[i][0]] = rows; counts[TABLES[i][0]] = rows.length; }
    }
    var file = { app: "agenda-pipo", formato: 1, criado_em: now.toISOString(), origem: "automatico", tabelas: data };
    var gz = zlib.gzipSync(Buffer.from(JSON.stringify(file), "utf8"), { level: 9 });
    var folder = readEnv("BACKUP_DRIVE_FOLDER") || DEFAULT_FOLDER;
    var up = await uploadFile(folder, PREFIX + stamp(now) + ".json.gz", gz);
    var keep = parseInt(readEnv("BACKUP_KEEP_DAYS"), 10); if (!(keep > 0)) keep = 30;
    var removed = 0, pruneErr = "";
    try { removed = await pruneOld(folder, keep); } catch (e) { pruneErr = String(e.message || e); }
    res.status(200).json({ ok: true, arquivo: up.name, bytes: gz.length, tabelas: counts, removidos: removed, aviso: pruneErr || undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
