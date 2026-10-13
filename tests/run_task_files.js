// Anexos de tarefas no Drive: pastas por paciente, nome final, permissões, 409 de nome repetido, renomear e excluir.
const crypto = require("crypto");
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "sb_publishable_teste";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_teste";
process.env.GOOGLE_DRIVE_ID = "DRIVE123";
// JSON colado na Vercel com quebras de linha de verdade dentro da chave também precisa funcionar
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"sa@p.iam.gserviceaccount.com","private_key":"' + privateKey.replace(/\n/g, "\n") + '"}';
const db = { folders: [], atts: [], gfiles: {}, nextId: 1, perm: { create: true, edit: true, delete: true }, patient: { patient_id: "p1", patient_name: "João da Silva", unit_id: "unidade-1" } };
const calls = [];
const J = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o), json: async () => o, arrayBuffer: async () => Buffer.from("conteudo-pdf") });
global.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  const m = opts.method || "GET", u = String(url);
  if (u.endsWith("/auth/v1/user")) return J({ id: "u1" });
  if (u.includes("/rpc/task_attachment_can")) { const b = JSON.parse(opts.body); return J(!!db.perm[b.p_action] && !(b.p_kind === "documentos" && db.noHealth)); }
  if (u.includes("/rpc/task_attachment_ctx")) return J([db.patient]);
  if (u.includes("/rest/v1/patient_drive_folders")) { if (m === "POST") { db.folders.push(JSON.parse(opts.body)); return J(null); } return J(db.folders); }
  if (u.includes("/rest/v1/task_attachments")) {
    if (m === "POST") { const r = Object.assign({ id: "a" + db.nextId++, unit_id: "unidade-1" }, JSON.parse(opts.body)); db.atts.push(r); return J([r]); }
    if (m === "PATCH") { const id = /id=eq\.([^&]+)/.exec(u)[1]; const r = db.atts.find((x) => x.id === id); Object.assign(r, JSON.parse(opts.body)); return J([r]); }
    if (m === "DELETE") { const id = /id=eq\.([^&]+)/.exec(u)[1]; db.atts = db.atts.filter((x) => x.id !== id); return J(null); }
    const id = /id=eq\.([^&]+)/.exec(u); return J(id ? db.atts.filter((x) => x.id === id[1]) : db.atts);
  }
  if (u.startsWith("https://oauth2.googleapis.com/token")) return J({ access_token: "gtoken", expires_in: 3600 });
  if (u.includes("/upload/drive/v3/files")) { const id = "F" + db.nextId++; const name = /"name":"([^"]+)"/.exec(opts.body.toString())[1]; db.gfiles[id] = { name, trashed: false }; return J({ id, name }); }
  if (u.includes("/drive/v3/drives?")) return J({ drives: [{ id: "OUTRO999", name: "Outro Drive" }] });
  if (u.includes("/drive/v3/files?") && m === "POST" && db.failRoot) return J({ error: { message: "File not found: DRIVE123." } }, 404);
  if (u.includes("/drive/v3/files?") && m === "POST") { const id = "D" + db.nextId++; const b = JSON.parse(opts.body); db.gfiles[id] = { name: b.name, folder: true, parent: b.parents[0] }; return J({ id }); }
  if (u.includes("/drive/v3/files?") && m === "GET") { const q = decodeURIComponent(/q=([^&]+)/.exec(u)[1]); const nm = /name = '([^']+)'/.exec(q)[1]; return J({ files: Object.entries(db.gfiles).filter(([, f]) => f.name === nm && !f.trashed && !f.folder).map(([id]) => ({ id })) }); }
  if (u.includes("/drive/v3/files/") && m === "PATCH") { const id = /files\/([^?]+)/.exec(u)[1]; Object.assign(db.gfiles[id], JSON.parse(opts.body)); return J({ id }); }
  if (u.includes("alt=media")) return J(null);
  return J(null, 404);
};
const handler = require("../api/task-files.js");
function run(req) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); }, send(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    handler(Object.assign({ headers: {}, query: {} }, req, { headers: Object.assign({ authorization: "Bearer tk" }, req.headers) }), res);
  });
}
const up = (typed, kind = "relatorios", filename = "scan.PDF", size = 100) => run({ method: "POST", query: { action: "upload" }, body: Buffer.alloc(size, 1),
  headers: { "x-task-id": "t1", "x-kind": kind, "x-name": encodeURIComponent(typed), "x-filename": encodeURIComponent(filename), "x-mime": "application/pdf" } });
(async () => {
  let ok = true; const check = (l, v) => { console.log(l, v); if (!v) ok = false; };
  check("nome final = digitado + nome completo + extensão?", handler.finalName("Carteirinha", "João da Silva", "foto.JPG") === "Carteirinha João da Silva.jpg");
  check("não repete o nome se já está no texto?", handler.finalName("Carteirinha João da Silva", "João da Silva", "a.pdf") === "Carteirinha João da Silva.pdf");
  check("caracteres proibidos saem?", handler.cleanName('Laudo: a/b*c?') === "Laudo a b c");
  const r1 = await up("Carteirinha", "documentos");
  check("upload em Documentos ok e com o nome certo?", r1.code === 200 && r1.body.attachment.name === "Carteirinha João da Silva.pdf" && r1.body.attachment.kind === "documentos");
  check("criou a pasta do paciente com 2 subpastas?", db.folders.length === 1 && Object.values(db.gfiles).filter((f) => f.folder).map((f) => f.name).sort().join("|") === "Documentos|João da Silva|Relatórios");
  const docsId = db.folders[0].documentos_id, relId = db.folders[0].relatorios_id;
  const gUp = calls.filter((c) => String(c.url).includes("/upload/drive/v3/files")).pop();
  check("arquivo foi para a subpasta Documentos?", gUp.opts.body.toString().includes('"parents":["' + docsId + '"]'));
  const r2 = await up("Relatório mensal", "relatorios", "x.docx");
  check("segundo upload reaproveita as pastas e vai para Relatórios?", r2.code === 200 && db.folders.length === 1 && calls.filter((c) => String(c.url).includes("/upload/drive/v3/files")).pop().opts.body.toString().includes('"parents":["' + relId + '"]'));
  const r3 = await up("Carteirinha", "documentos");
  check("nome repetido na pasta = 409 sem sobrescrever?", r3.code === 409 && r3.body.code === "exists" && db.atts.length === 2);
  const r4 = await up("Outro", "relatorios", "x.pdf", 5 * 1024 * 1024);
  check("arquivo acima de 4 MB recusado?", r4.code === 413);
  db.patient = { patient_id: null, patient_name: null, unit_id: "unidade-1" };
  const r5 = await up("Teste");
  check("tarefa sem paciente cadastrado recusada?", r5.code === 400 && /Cadastre o paciente/.test(r5.body.error));
  db.patient = { patient_id: "p1", patient_name: "João da Silva", unit_id: "unidade-1" };
  db.noHealth = true;
  const r6 = await up("Laudo", "documentos");
  check("Documentos sem permissão de saúde recusado?", r6.code === 403);
  db.noHealth = false;
  const r7 = await run({ method: "POST", query: { action: "upload" }, body: Buffer.alloc(10), headers: { "x-task-id": "t1", "x-kind": "outra", "x-name": "a", "x-filename": "a.pdf" } });
  check("pasta inválida recusada?", r7.code === 400);
  const id1 = r2.body.attachment.id;
  const rn = await run({ method: "POST", query: { action: "rename" }, body: { id: id1, name: "Relatório de outubro" } });
  check("renomear mantém a regra do nome e a extensão?", rn.code === 200 && rn.body.attachment.name === "Relatório de outubro João da Silva.docx");
  const rn2 = await run({ method: "POST", query: { action: "rename" }, body: { id: id1, name: "Carteirinha" } });
  check("mesmo nome mas outra extensão não conflita?", rn2.code === 200 && rn2.body.attachment.name === "Carteirinha João da Silva.docx");
  const dlr = await run({ method: "GET", query: { action: "download", id: id1 } });
  check("baixar entrega o arquivo com o nome?", dlr.code === 200 && /filename\*=UTF-8''/.test(dlr.headers["Content-Disposition"]));
  const driveId = db.atts.find((a) => a.id === id1).drive_file_id;
  const dl = await run({ method: "POST", query: { action: "delete" }, body: { id: id1 } });
  const gid = db.gfiles[driveId];
  check("excluir tira do banco e manda o arquivo para a lixeira do Drive?", dl.code === 200 && !db.atts.find((a) => a.id === id1) && gid.trashed === true);
  const rk = await up("Manter", "relatorios");
  const kd = db.atts.find((a) => a.id === rk.body.attachment.id).drive_file_id;
  const dk = await run({ method: "POST", query: { action: "delete" }, body: { id: rk.body.attachment.id, keep: true } });
  check("excluir com 'manter no Drive' tira da tarefa mas não manda para a lixeira?", dk.code === 200 && !db.atts.find((a) => a.id === rk.body.attachment.id) && !db.gfiles[kd].trashed);
  db.perm.edit = false;
  const rn3 = await run({ method: "POST", query: { action: "rename" }, body: { id: db.atts[0].id, name: "X" } });
  check("sem permissão de editar não renomeia?", rn3.code === 403);
  const nl = await run({ method: "POST", query: { action: "upload" }, headers: { authorization: "" }, body: Buffer.alloc(3) });
  check("sem login recusado?", nl.code === 401);
  db.folders = []; db.failRoot = true;
  const r8 = await up("Teste", "relatorios");
  check("sem acesso ao Drive: mensagem explica o que fazer (e não o 'File not found')?", r8.code === 500 && /Gerenciar membros/.test(r8.body.error) && /sa@p\.iam/.test(r8.body.error) && /Outro Drive \(OUTRO999\)/.test(r8.body.error), r8.body.error);
  console.log("no JS errors?", true);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("ERRO", e); process.exit(1); });
