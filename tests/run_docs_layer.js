// Camada de dados (js/pipo-supabase.js) com um Supabase falso: leituras da abertura
// juntas numa consulta só, documento já acompanhado ao vivo não é lido de novo,
// aviso do tempo real sem conteúdo (documento grande) relê do banco e mudança que
// chega durante a leitura vence a leitura.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipo-supabase.js'), 'utf8');
  const fake = `
    window.__q = []; window.__store = {"config/rooms": {list: [1]}, "patients/all": {list: [2]}, "config/a": {v: 1}, "config/b": {v: 2}, "config/c": {v: 3}};
    window.__hold = false; window.__held = [];
    window.fetch = function(u){ return Promise.resolve({ok: true, json: function(){ return Promise.resolve({supabaseUrl: "x", supabaseAnonKey: "y"}); }}); };
    function chain(table){
      var c = {_t: table, _in: null};
      ["select","eq","order","limit","range","contains","not","gte","lte"].forEach(function(m){ c[m] = function(){ return c; }; });
      c.in = function(col, arr){ c._in = arr.slice(); return c; };
      c.maybeSingle = function(){ return Promise.resolve({data: {id: "u1", active: true, full_name: "Teste", role: {is_admin: true, permissions: {}}}}); };
      c.then = function(ok, bad){
        if (table !== "documents") return Promise.resolve({data: []}).then(ok, bad);
        var paths = c._in || [], snapshot = paths.map(function(p){ return window.__store[p] === undefined ? null : {path: p, data: JSON.parse(JSON.stringify(window.__store[p]))}; }).filter(Boolean);
        window.__q.push(paths);
        var res = {data: snapshot};
        if (window.__hold) return new Promise(function(r){ window.__held.push(function(){ r(res); }); }).then(ok, bad);
        return Promise.resolve(res).then(ok, bad);
      };
      return c;
    }
    window.__ch = {handlers: [], sub: null};
    window.supabase = {createClient: function(){
      return {
        from: chain,
        rpc: function(){ return Promise.resolve({}); },
        channel: function(){ var ch = {on: function(a, b, fn){ window.__ch.handlers.push({b: b, fn: fn}); return ch; }, subscribe: function(fn){ window.__ch.sub = fn; return ch; }}; return ch; },
        realtime: {setAuth: function(){}},
        auth: {
          onAuthStateChange: function(cb){ setTimeout(function(){ cb("SIGNED_IN", {user: {id: "u1"}, access_token: "t"}); }, 0); },
          getSession: function(){ return Promise.resolve({data: {session: {user: {id: "u1"}}}}); },
          signOut: function(){ return Promise.resolve(); }
        }
      };
    }};
    window.__docEvent = function(payload){ window.__ch.handlers.filter(function(h){ return h.b.table === "documents"; }).forEach(function(h){ h.fn(payload); }); };
  `;
  const html = '<!doctype html><html><body><div id="userPill"></div><script>' + fake + '</script><script>' + lib + '</script></body></html>';
  const file = path.join(__dirname, 'page_docs_layer.html');
  fs.writeFileSync(file, html);
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const tick = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms || 30);

  // 1) Cinco documentos pedidos juntos = uma consulta só
  await page.evaluate(async () => {
    window.__db = await window.claude.use("db");
    window.__got = {};
    ["config/rooms", "patients/all", "config/a", "config/b", "config/c"].forEach(function(p){
      window.__db.doc(p).onSnapshot(function(s){ (window.__got[p] = window.__got[p] || []).push(s.exists ? s.data() : null); });
    });
  });
  await tick();
  let r = await page.evaluate(() => ({q: window.__q.slice(), got: window.__got}));
  check('5 documents read in one query?', r.q.length === 1 && r.q[0].length === 5 && r.got['config/a'][0].v === 1, JSON.stringify(r.q));

  // 2) Tempo real conecta: relê tudo numa consulta, sem avisar o que não mudou
  await page.evaluate(() => { window.__q = []; window.__ch.sub("SUBSCRIBED"); });
  await tick();
  r = await page.evaluate(() => ({q: window.__q.slice(), n: window.__got['config/a'].length}));
  check('Realtime connected: one re-read, no repeated callback?', r.q.length === 1 && r.n === 1, JSON.stringify(r));

  // 3) Outro ouvinte do mesmo documento (troca de dia no Planner): sem ler de novo
  await page.evaluate(() => { window.__q = []; window.__db.doc("config/a").onSnapshot(function(s){ window.__second = s.data(); }); });
  await tick();
  r = await page.evaluate(() => ({q: window.__q.length, v: window.__second && window.__second.v}));
  check('Second listener uses the live value (no query)?', r.q === 0 && r.v === 1, JSON.stringify(r));

  // 4) Aviso do tempo real sem o conteúdo (documento grande): relê, nunca "vazio"
  await page.evaluate(() => { window.__q = []; window.__store["config/b"] = {v: 22}; window.__docEvent({eventType: "UPDATE", new: {path: "config/b"}, errors: ["Error 413: Payload Too Large"]}); });
  await tick();
  r = await page.evaluate(() => ({q: window.__q.slice(), last: window.__got['config/b'].slice(-1)[0]}));
  check('Payload without data: re-read, listener gets the new value?', r.q.length === 1 && r.last && r.last.v === 22, JSON.stringify(r));

  // 5) Mudança que chega durante a leitura vence a leitura (mais antiga)
  await page.evaluate(() => {
    window.__ch.sub("CLOSED");                 // sem tempo real: a próxima leitura vai ao banco
    window.__hold = true; window.__held = [];
    window.__db.doc("config/c").onSnapshot(function(s){ window.__third = s.data(); });
  });
  await tick();
  await page.evaluate(() => {
    window.__docEvent({eventType: "UPDATE", new: {path: "config/c", data: {v: 99}}});
    window.__hold = false; window.__held.forEach(function(f){ f(); });
  });
  await tick();
  r = await page.evaluate(() => window.__third);
  check('Change during the read wins over the older read?', r && r.v === 99, JSON.stringify(r));

  // 6) Sem tempo real, ouvinte novo lê do banco
  await page.evaluate(() => { window.__q = []; window.__db.doc("config/a").onSnapshot(function(){}); });
  await tick();
  r = await page.evaluate(() => window.__q.length);
  check('Realtime down: new listener reads from the database?', r === 1, r);

  check('No page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(file);
  console.log(fails ? 'FAIL (' + fails + ')' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
