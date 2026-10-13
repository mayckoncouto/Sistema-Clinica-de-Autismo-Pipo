// Anexos das tarefas do CRM, guardados no Google Drive (Drive compartilhado da clínica).
//
// O navegador nunca fala com o Google: manda o arquivo para cá, com o login da pessoa. Esta função
//   1. confere o login e as permissões pelo banco (RLS, com o token DA PESSOA — nunca a service role);
//   2. usa a conta de serviço do Google (variável GOOGLE_SERVICE_ACCOUNT_JSON, só no servidor) para
//      guardar o arquivo em  <Drive compartilhado> / <Paciente> / Documentos | Relatórios;
//   3. grava no banco só o nome e o código do arquivo (tabela task_attachments).
//
// POST /api/task-files?action=upload    corpo = o arquivo (bytes). Cabeçalhos: x-task-id, x-kind
//                                       (documentos | relatorios), x-name (nome digitado, com encodeURIComponent),
//                                       x-filename (nome original, com encodeURIComponent), x-mime.
// POST /api/task-files?action=rename    JSON { id, name }
// POST /api/task-files?action=delete    JSON { id }            (o arquivo vai para a lixeira do Drive)
// GET  /api/task-files?action=download&id=<anexo>
// Todos com   Authorization: Bearer <access_token do usuário>.
//
// Nome final do arquivo: "<nome digitado> <primeiro nome do paciente>.<extensão original>".
// Nunca sobrescreve: nome repetido na pasta devolve 409 (code "exists").
// Variáveis: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_ID.

var crypto = require("crypto");

var SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
var ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
var SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
var MAX_BYTES = 4 * 1024 * 1024;
var KINDS = { documentos: "Documentos", relatorios: "Relatórios" };

function readEnv(name) { return (process.env[name] || "").trim(); }

// ---------- nome do arquivo ----------
function cleanName(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}
function firstName(full) { return cleanName(full).split(" ")[0] || ""; }
function extOf(filename) {
  var m = /\.([A-Za-z0-9]{1,8})$/.exec(String(filename || "").trim());
  return m ? "." + m[1].toLowerCase() : "";
}
// "Carteirinha" + paciente "João da Silva" + "foto.PDF"  ->  "Carteirinha João.pdf"
function finalName(typed, patientName, filename) {
  var base = cleanName(typed).slice(0, 120);
  var first = firstName(patientName);
  if (first && base.toLowerCase().split(" ").indexOf(first.toLowerCase()) < 0) base = (base + " " + first).trim();
  return base + extOf(filename);
}

// ---------- Supabase ----------
async function sb(path, opts) {
  var r = await fetch(SUPABASE_URL + path, opts);
  var text = await r.text();
  var body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body: body };
}
function userHeaders(token, extra) {
  return Object.assign({ apikey: ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" }, extra || {});
}
function serviceHeaders(extra) {
  var h = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!/^sb_/.test(SERVICE_KEY)) h.Authorization = "Bearer " + SERVICE_KEY;
  return Object.assign(h, extra || {});
}
function errMsg(resp, fallback) {
  var b = resp.body || {};
  return b.message || b.msg || b.error_description || b.error || b.details || fallback;
}
async function currentUser(token) {
  if (!token) return null;
  var me = await sb("/auth/v1/user", { headers: { apikey: ANON_KEY, Authorization: "Bearer " + token } });
  return me.ok && me.body && me.body.id ? me.body : null;
}
async function can(token, task, kind, action) {
  var r = await sb("/rest/v1/rpc/task_attachment_can", {
    method: "POST", headers: userHeaders(token), body: JSON.stringify({ p_task: task, p_kind: kind, p_action: action })
  });
  return r.ok && r.body === true;
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
  if (!sa) throw new Error("O Google Drive ainda não está configurado (falta GOOGLE_SERVICE_ACCOUNT_JSON na Vercel).");
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
async function gd(path, opts, raw) {
  var t = await googleToken();
  var o = Object.assign({}, opts || {});
  o.headers = Object.assign({ Authorization: "Bearer " + t }, o.headers || {});
  var r = await fetch("https://www.googleapis.com" + path, o);
  if (raw) return r;
  var text = await r.text();
  var body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!r.ok) {
    var msg = body && body.error && (body.error.message || body.error) || r.status;
    throw new Error("Google Drive: " + msg);
  }
  return body;
}
function qEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
async function createFolder(name, parent) {
  return gd("/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, mimeType: "application/vnd.google-apps.folder", parents: [parent] })
  });
}
async function trash(id) {
  return gd("/drive/v3/files/" + encodeURIComponent(id) + "?supportsAllDrives=true&fields=id", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true })
  });
}
async function nameExists(folder, name, exceptId) {
  var q = "'" + qEsc(folder) + "' in parents and name = '" + qEsc(name) + "' and trashed = false";
  var j = await gd("/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id)&q=" + encodeURIComponent(q));
  return ((j && j.files) || []).some(function (f) { return f.id !== exceptId; });
}

// Pastas do paciente (Paciente / Documentos / Relatórios): criadas na primeira vez e guardadas no banco.
async function patientFolders(patientId, unitId, patientName) {
  var key = "patient_id=eq." + encodeURIComponent(patientId) + "&unit_id=eq." + encodeURIComponent(unitId);
  var got = await sb("/rest/v1/patient_drive_folders?select=*&" + key, { headers: serviceHeaders() });
  if (got.ok && Array.isArray(got.body) && got.body[0]) return got.body[0];
  var root = readEnv("GOOGLE_DRIVE_ID");
  if (!root) throw new Error("O Google Drive ainda não está configurado (falta GOOGLE_DRIVE_ID na Vercel).");
  var main;
  try { main = await createFolder(cleanName(patientName) || "Paciente", root); }
  catch (e) {
    if (/not found|insufficient|forbidden|permission/i.test(String(e.message))) {
      var sa = serviceAccount(), seen = "";
      try {
        var dl = await gd("/drive/v3/drives?pageSize=50&fields=drives(id,name)");
        var arr = (dl && dl.drives) || [];
        seen = arr.length ? " Drives compartilhados que a conta enxerga agora: " + arr.map(function (d) { return d.name + " (" + d.id + ")"; }).join("; ") + "." : " A conta não enxerga nenhum Drive compartilhado.";
      } catch (e2) { seen = ""; }
      throw new Error("O Google não achou o Drive " + root + " para a conta de serviço" + (sa ? " (" + sa.client_email + ")" : "") + "." + seen + " Confira se esse código é o do Drive compartilhado (variável GOOGLE_DRIVE_ID na Vercel) e se a conta é membro dele em Gerenciar membros.");
    }
    throw e;
  }
  var docs = await createFolder(KINDS.documentos, main.id);
  var rel = await createFolder(KINDS.relatorios, main.id);
  var row = { patient_id: patientId, unit_id: unitId, folder_id: main.id, documentos_id: docs.id, relatorios_id: rel.id };
  var ins = await sb("/rest/v1/patient_drive_folders?on_conflict=patient_id,unit_id", {
    method: "POST", headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=minimal" }), body: JSON.stringify(row)
  });
  if (!ins.ok) throw new Error(errMsg(ins, "Não foi possível guardar as pastas do paciente."));
  // Se outro envio criou as pastas ao mesmo tempo, vale a que ficou gravada e as nossas vão para a lixeira.
  var again = await sb("/rest/v1/patient_drive_folders?select=*&" + key, { headers: serviceHeaders() });
  var kept = again.ok && Array.isArray(again.body) && again.body[0];
  if (kept && kept.folder_id !== main.id) { await trash(main.id).catch(function () {}); return kept; }
  return row;
}

async function uploadFile(parent, name, mime, buf) {
  var boundary = "pipo" + crypto.randomBytes(12).toString("hex");
  var meta = JSON.stringify({ name: name, parents: [parent] });
  var head = Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
    "\r\n--" + boundary + "\r\nContent-Type: " + (mime || "application/octet-stream") + "\r\n\r\n");
  var tail = Buffer.from("\r\n--" + boundary + "--");
  return gd("/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size", {
    method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary },
    body: Buffer.concat([head, buf, tail])
  });
}

// ---------- requisição ----------
function readBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body, "binary"));
  return new Promise(function (resolve, reject) {
    var parts = [];
    req.on("data", function (c) { parts.push(c); });
    req.on("end", function () { resolve(Buffer.concat(parts)); });
    req.on("error", reject);
  });
}
function jsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}
function header(req, k) { var v = req.headers[k]; try { return decodeURIComponent(Array.isArray(v) ? v[0] : v || ""); } catch (e) { return String(v || ""); } }
function fail(res, code, msg, extra) { res.status(code).json(Object.assign({ error: msg }, extra || {})); }

async function loadAttachment(token, id) {
  var r = await sb("/rest/v1/task_attachments?select=*&id=eq." + encodeURIComponent(id), { headers: userHeaders(token) });
  return r.ok && Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}

module.exports = async function handler(req, res) {
  try {
    var token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    var query = req.query || {};
    var action = query.action || "";
    if (!SUPABASE_URL || !ANON_KEY) { fail(res, 500, "O sistema não está configurado (Supabase)."); return; }
    var user = await currentUser(token);
    if (!user) { fail(res, 401, "Entre no sistema."); return; }

    if (action === "download" && req.method === "GET") {
      var att = await loadAttachment(token, query.id);
      if (!att) { fail(res, 404, "Anexo não encontrado ou sem permissão."); return; }
      var dl = await gd("/drive/v3/files/" + encodeURIComponent(att.drive_file_id) + "?alt=media&supportsAllDrives=true", {}, true);
      if (!dl.ok) { fail(res, 502, "O Google Drive não entregou o arquivo (" + dl.status + ")."); return; }
      var data = Buffer.from(await dl.arrayBuffer());
      res.setHeader("Content-Type", att.mime || "application/octet-stream");
      res.setHeader("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(att.name));
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).send(data);
      return;
    }
    if (req.method !== "POST") { fail(res, 405, "Método não permitido."); return; }

    if (action === "upload") {
      var taskId = header(req, "x-task-id"), kind = header(req, "x-kind");
      if (!KINDS[kind]) { fail(res, 400, "Escolha Documentos ou Relatórios."); return; }
      if (!(await can(token, taskId, kind, "create"))) { fail(res, 403, "Sem permissão para anexar nesta tarefa" + (kind === "documentos" ? " (Documentos exige ver a saúde do paciente)." : ".")); return; }
      var ctx = await sb("/rest/v1/rpc/task_attachment_ctx", { method: "POST", headers: userHeaders(token), body: JSON.stringify({ p_task: taskId }) });
      var c = ctx.ok && Array.isArray(ctx.body) ? ctx.body[0] : (ctx.ok ? ctx.body : null);
      if (!c) { fail(res, 403, errMsg(ctx, "Sem acesso a esta tarefa.")); return; }
      if (!c.patient_id || !c.patient_name) { fail(res, 400, "Esta tarefa não tem paciente cadastrado. Cadastre o paciente antes de anexar."); return; }
      var buf = await readBody(req);
      if (!buf.length) { fail(res, 400, "Arquivo vazio."); return; }
      if (buf.length > MAX_BYTES) { fail(res, 413, "O arquivo passa de 4 MB."); return; }
      var typed = header(req, "x-name"), filename = header(req, "x-filename");
      if (!cleanName(typed)) { fail(res, 400, "Informe o nome do arquivo."); return; }
      var name = finalName(typed, c.patient_name, filename);
      var folders = await patientFolders(c.patient_id, c.unit_id, c.patient_name);
      var parent = kind === "documentos" ? folders.documentos_id : folders.relatorios_id;
      if (await nameExists(parent, name)) { fail(res, 409, "Já existe um arquivo chamado “" + name + "” nesta pasta. Escolha outro nome.", { code: "exists", name: name }); return; }
      var mime = header(req, "x-mime") || "application/octet-stream";
      var file = await uploadFile(parent, name, mime, buf);
      var ins = await sb("/rest/v1/task_attachments", {
        method: "POST", headers: userHeaders(token, { Prefer: "return=representation" }),
        body: JSON.stringify({ task_id: taskId, patient_id: c.patient_id, kind: kind, drive_file_id: file.id, name: name, mime: mime, size: buf.length })
      });
      if (!ins.ok) { await trash(file.id).catch(function () {}); fail(res, 400, errMsg(ins, "Não foi possível registrar o anexo.")); return; }
      res.status(200).json({ ok: true, attachment: Array.isArray(ins.body) ? ins.body[0] : ins.body });
      return;
    }

    var body = jsonBody(req);
    if (action === "rename") {
      var a = await loadAttachment(token, body.id);
      if (!a) { fail(res, 404, "Anexo não encontrado ou sem permissão."); return; }
      if (!(await can(token, a.task_id, a.kind, "edit"))) { fail(res, 403, "Sem permissão para renomear."); return; }
      if (!cleanName(body.name)) { fail(res, 400, "Informe o nome do arquivo."); return; }
      var rc = await sb("/rest/v1/rpc/task_attachment_ctx", { method: "POST", headers: userHeaders(token), body: JSON.stringify({ p_task: a.task_id }) });
      var cc = rc.ok && Array.isArray(rc.body) ? rc.body[0] : null;
      var newName = finalName(body.name, (cc && cc.patient_name) || "", a.name);
      if (newName === a.name) { res.status(200).json({ ok: true, attachment: a }); return; }
      var folders2 = await sb("/rest/v1/patient_drive_folders?select=*&patient_id=eq." + encodeURIComponent(a.patient_id) + "&unit_id=eq." + encodeURIComponent(a.unit_id), { headers: serviceHeaders() });
      var f2 = folders2.ok && Array.isArray(folders2.body) ? folders2.body[0] : null;
      var par = f2 ? (a.kind === "documentos" ? f2.documentos_id : f2.relatorios_id) : null;
      if (par && (await nameExists(par, newName, a.drive_file_id))) { fail(res, 409, "Já existe um arquivo chamado “" + newName + "” nesta pasta. Escolha outro nome.", { code: "exists", name: newName }); return; }
      await gd("/drive/v3/files/" + encodeURIComponent(a.drive_file_id) + "?supportsAllDrives=true&fields=id", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName })
      });
      var up = await sb("/rest/v1/task_attachments?id=eq." + encodeURIComponent(a.id), {
        method: "PATCH", headers: userHeaders(token, { Prefer: "return=representation" }), body: JSON.stringify({ name: newName })
      });
      if (!up.ok) { fail(res, 400, errMsg(up, "Não foi possível renomear.")); return; }
      res.status(200).json({ ok: true, attachment: Array.isArray(up.body) ? up.body[0] : up.body });
      return;
    }
    if (action === "delete") {
      var d = await loadAttachment(token, body.id);
      if (!d) { fail(res, 404, "Anexo não encontrado ou sem permissão."); return; }
      if (!(await can(token, d.task_id, d.kind, "delete"))) { fail(res, 403, "Sem permissão para excluir."); return; }
      var del = await sb("/rest/v1/task_attachments?id=eq." + encodeURIComponent(d.id), { method: "DELETE", headers: userHeaders(token) });
      if (!del.ok) { fail(res, 400, errMsg(del, "Não foi possível excluir.")); return; }
      var warn = "";
      try { await trash(d.drive_file_id); } catch (e) { warn = "O anexo saiu da tarefa, mas o arquivo continua no Drive: " + e.message; }
      res.status(200).json({ ok: true, warning: warn || undefined });
      return;
    }
    fail(res, 400, "Ação desconhecida.");
  } catch (e) {
    fail(res, 500, String((e && e.message) || e));
  }
};
module.exports.finalName = finalName;
module.exports.cleanName = cleanName;
