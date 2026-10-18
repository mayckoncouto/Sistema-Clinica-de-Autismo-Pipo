// Backup diário para o Drive (api/backup-diario.js): autorização, leitura em páginas, gzip, envio, retenção.
const crypto = require("crypto"), zlib = require("zlib");
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_teste";
process.env.CRON_SECRET = "segredo";
process.env.BACKUP_DRIVE_FOLDER = "PASTA1";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey });
const J = (o, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => JSON.stringify(o), json: async () => o });
let uploaded = null, trashed = [], appts = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1 }));
global.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  if (u.startsWith("https://oauth2.googleapis.com/token")) return J({ access_token: "g", expires_in: 3600 });
  if (u.includes("/rest/v1/appointments")) { const [a, b] = opts.headers.Range.split("-").map(Number); return J(appts.slice(a, b + 1)); }
  if (u.includes("/rest/v1/profiles")) return J({}, 404);
  if (u.includes("/rest/v1/")) return J([]);
  if (u.includes("uploadType=resumable")) { uploaded = { meta: JSON.parse(opts.body) }; return J({}, 200, { location: "https://up.google/session1" }); }
  if (u === "https://up.google/session1") { uploaded.buf = opts.body; return J({ id: "F1", name: uploaded.meta.name, size: "1" }); }
  if (u.includes("/drive/v3/files?") && m === "GET") return J({ files: [{ id: "OLD1", name: "backup-agenda-pipo-2026-01-01-1900.json.gz" }, { id: "X", name: "outro.txt" }] });
  if (u.includes("/drive/v3/files/") && m === "PATCH") { trashed.push(/files\/([^?]+)/.exec(u)[1]); return J({ id: "x" }); }
  return J(null, 404);
};
const handler = require("../api/backup-diario.js");
const run = (auth) => new Promise((resolve) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } }; handler({ headers: auth ? { authorization: auth } : {} }, res); });
(async () => {
  let fails = 0; const ck = (n, ok) => { console.log(n, ok); if (!ok) fails++; };
  ck("sem segredo: 401", (await run("")).code === 401);
  ck("segredo errado: 401", (await run("Bearer errado")).code === 401);
  const r = await run("Bearer segredo");
  ck("ok 200", r.code === 200 && r.body.ok);
  ck("leu as 2300 consultas em páginas", r.body.tabelas.appointments === 2300);
  ck("tabela inexistente é pulada", r.body.tabelas.profiles === undefined);
  ck("arquivo na pasta certa com nome .json.gz", uploaded && uploaded.meta.parents[0] === "PASTA1" && /^backup-agenda-pipo-\d{4}-\d\d-\d\d-\d{4}\.json\.gz$/.test(uploaded.meta.name));
  const f = JSON.parse(zlib.gunzipSync(uploaded.buf).toString());
  ck("conteúdo no formato do backup", f.app === "agenda-pipo" && f.formato === 1 && f.tabelas.appointments.length === 2300);
  ck("apaga só backup automático antigo", trashed.length === 1 && trashed[0] === "OLD1" && r.body.removidos === 1);
  console.log(fails ? "FALHOU" : "ALL PASS"); process.exit(fails ? 1 : 0);
})();
