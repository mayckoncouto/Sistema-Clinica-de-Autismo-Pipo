// Verificação estática (sem navegador): sintaxe, nomes repetidos, ids repetidos, sobras.
// Uso: node tests/verificar_estatico.js   (código de saída 1 se achar problema)
const fs = require("fs"), path = require("path"), cp = require("child_process"), os = require("os");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let bad = 0;
const fail = (m) => { bad++; console.log("PROBLEMA: " + m); };
const ok = (m) => console.log("ok: " + m);

// 1. Sintaxe de cada <script> dos HTML e dos .js
function checkSyntax(label, code) {
  const tmp = path.join(os.tmpdir(), "verif-" + Math.random().toString(36).slice(2) + ".js");
  fs.writeFileSync(tmp, code);
  const r = cp.spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  fs.unlinkSync(tmp);
  if (r.status) fail("erro de sintaxe em " + label + "\n" + (r.stderr || "").split("\n").slice(0, 4).join("\n")); else ok("sintaxe " + label);
}
["index.html", "cadastro.html", "oauth-consent.html"].forEach((f) => {
  if (!fs.existsSync(path.join(root, f))) return;
  const html = read(f); let n = 0;
  html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, (_, code) => { if (code.trim()) checkSyntax(f + " #" + (++n), code); return ""; });
});
["js/pipo-supabase.js", "js/usuarios.js", "js/redes.js", "sw.js"].concat(fs.readdirSync(path.join(root, "api")).map((f) => "api/" + f)).forEach((f) => checkSyntax(f, read(f)));

// 2. Funções e variáveis de nível raiz repetidas no index.html (a segunda sobrescreve a primeira)
const idx = read("index.html");
const count = (re) => { const m = {}; let x; while ((x = re.exec(idx))) m[x[1]] = (m[x[1]] || 0) + 1; return Object.keys(m).filter((k) => m[k] > 1); };
const f = count(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm); f.length ? fail("funções repetidas na raiz: " + f.join(", ")) : ok("sem função repetida na raiz");
const v = count(/^var\s+([A-Za-z0-9_$]+)\s*=/gm); v.length ? fail("var repetida na raiz: " + v.join(", ")) : ok("sem var repetida na raiz");

// 3. ids repetidos no HTML estático
const body = idx.slice(0, idx.indexOf("<script"));
const ids = {}; let m; const re = /\sid="([^"]+)"/g; while ((m = re.exec(body))) ids[m[1]] = (ids[m[1]] || 0) + 1;
const dup = Object.keys(ids).filter((k) => ids[k] > 1); dup.length ? fail("ids repetidos: " + dup.join(", ")) : ok("sem id repetido no HTML");

// 4. Nomes proibidos (bloqueadores de anúncio) em classes/ids
const ad = idx.match(/(?:id|class)="[^"]*\b(?:ad|ads|ad-[a-z-]+|advert[a-z-]*|banner[a-z-]*|sponsor[a-z-]*|promo[a-z-]*)\b[^"]*"/g);
ad ? fail("nome que o AdBlock esconde: " + [...new Set(ad)].slice(0, 5).join(" | ")) : ok("sem nome de classe/id que o AdBlock esconde");

// 5. Cores e restos que não devem voltar
if (/#4a5257/i.test(idx)) fail("cinza escuro do Bloqueado (#4a5257) voltou");
const aspas = idx.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => /^\s*"[^"]*"[^"]*"[^"]*",?\s*$/.test(l) && /<b>|Ajuda/.test(l) && /[a-zà-ú]"[a-zà-ú ]/i.test(l));
if (aspas.length) console.log("aviso: conferir aspas retas dentro de textos da Ajuda nas linhas " + aspas.slice(0, 5).map((x) => x[1]).join(", "));
if (/console\.log\(/.test(idx.replace(/\/\/.*$/gm, ""))) console.log("aviso: há console.log no index.html");
if (/\bdebugger\b/.test(idx)) fail("há 'debugger' no index.html");

// 6. Dados reais de paciente nunca no repositório
const tracked = cp.spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout.split("\n");
const risk = tracked.filter((x) => /^(export\/|import.*\.sql$|.*backup-agenda-pipo.*\.json$|.*\.xlsx$|.*\.xlsm$)/i.test(x));
risk.length ? fail("arquivo que pode ter dados reais versionado: " + risk.join(", ")) : ok("nenhum arquivo de dados reais versionado");

// 7. Migrações: toda migração tem linha na conferência
const migs = tracked.filter((x) => /^supabase\/20\d\d-.*\.sql$/.test(x)).map((x) => path.basename(x, ".sql"));
const conf = read("supabase/conferencia-migracoes.sql");
const sem = migs.filter((x) => !conf.includes("'" + x + "'"));
sem.length ? console.log("aviso: migrações sem linha em conferencia-migracoes.sql: " + sem.join(", ")) : ok("todas as migrações estão na conferência");

console.log(bad ? "\nRESULTADO: " + bad + " problema(s)" : "\nRESULTADO: tudo certo");
process.exit(bad ? 1 : 0);
