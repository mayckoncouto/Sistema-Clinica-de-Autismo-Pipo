// Cadastros em lista gravam só o item alterado (patch_list2) e avisam quando outra pessoa
// mexeu no mesmo item depois que ele foi aberto ("Salvar assim mesmo" / "Recarregar").
// Cria tests/page_lp.html: a página dos testes com um "eval" e um banco simulado que tem
// patchList2/reload com as mesmas regras da função do banco (2026-10-10b).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  let src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const mock = `
    patchList2: function(ups, dels, opts){
      opts = opts || {};
      window.__LOG__.push({op: "patch", path: path, ups: JSON.parse(JSON.stringify(ups || [])), dels: (dels || []).slice(), expect: opts.expect || {}, order: opts.order || null, force: !!opts.force});
      var cur = ((window.__STORE__[path] || {}).list || []).slice();
      if (!opts.force){
        var conf = [];
        Object.keys(opts.expect || {}).forEach(function(k){
          var c = cur.filter(function(x){ return x.id === k; })[0];
          if (!c){ var u = (ups || []).filter(function(x){ return x.id === k; })[0] || {}; conf.push({id: k, excluido: true, nome: u.nome || u.name || ""}); }
          else if (((c._upd || {}).em || "") !== (opts.expect[k] || "")) conf.push({id: k, nome: c.nome || c.name || "", por: (c._upd || {}).por, em: (c._upd || {}).em});
        });
        if (conf.length){ var e = new Error("conflito"); e.code = "conflict"; e.conflicts = conf; return Promise.reject(e); }
      }
      var seen = {}, out = [];
      cur.forEach(function(x){
        if ((dels || []).indexOf(x.id) !== -1) return;
        var u = (ups || []).filter(function(y){ return y.id === x.id; })[0];
        if (u){ out.push(u); seen[x.id] = 1; } else out.push(x);
      });
      (ups || []).forEach(function(u){ if (!seen[u.id]) out.push(u); });
      if (opts.order){
        var used = {}, o2 = [];
        opts.order.forEach(function(id){ var x = out.filter(function(y){ return y.id === id; })[0]; if (x && !used[id]){ o2.push(x); used[id] = 1; } });
        out.forEach(function(x){ if (!used[x.id]) o2.push(x); });
        out = o2;
      }
      window.__STORE__[path] = Object.assign({}, window.__STORE__[path] || {}, {list: out});
      listeners.forEach(function(cb){ cb(currentSnap()); });
      return Promise.resolve();
    },
    reload: function(){ window.__LOG__.push({op: "reload", path: path}); listeners.forEach(function(cb){ cb(currentSnap()); }); return Promise.resolve(); },
    update: function(obj){`;
  if (src.indexOf('    update: function(obj){') === -1) throw new Error('mock não encontrado');
  src = src.replace('    update: function(obj){', mock);
  const i = src.indexOf('"use strict";');
  src = src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13);
  const lpPage = path.join(__dirname, 'page_lp.html');
  fs.writeFileSync(lpPage, src);

  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + lpPage);
  await page.waitForTimeout(900);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };
  const lastOps = () => page.evaluate(() => window.__LOG__.filter((x) => x.path === 'patients/all'));
  const store = () => page.evaluate(() => window.__STORE__['patients/all'].list.map((x) => ({id: x.id, nome: x.nome, upd: x._upd})));
  const other = (id, nome, por) => page.evaluate(([id, nome, por]) => {
    // Outra pessoa grava o paciente (direto no banco simulado, como se fosse outro computador).
    var list = window.__STORE__['patients/all'].list.map(function(x){ return x.id === id ? Object.assign({}, x, {nome: nome, _upd: {por: por, em: new Date().toISOString()}}) : x; });
    var r = window.claude; return r.use('db').then(function(db){ return db.doc('patients/all').set({list: list}); });
  }, [id, nome, por]);

  // 1. Sem mudança: nada é gravado.
  await page.evaluate(() => { window.__LOG__ = []; });
  await ev('writePatients(state.patients)');
  check('sem mudança: nada gravado?', (await lastOps()).length === 0, await lastOps());

  // 2. Muda um paciente: grava só ele, com carimbo.
  await page.evaluate(() => { window.__LOG__ = []; });
  const ids = await ev('state.patients.map(function(p){ return p.id; })');
  const A = ids[0], B = ids[1];
  await ev(`writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, p, {obs: "nota 1"}) : p; }))`);
  let ops = await lastOps();
  check('um alterado: só ele vai para o banco, com carimbo?', ops.length === 1 && ops[0].op === 'patch' && ops[0].ups.length === 1 && ops[0].ups[0].id === A && !!ops[0].ups[0]._upd && !ops[0].dels.length, ops.map((o) => ({op: o.op, n: (o.ups || []).length})));

  // 3. Duas pessoas, pacientes diferentes: as duas alterações ficam.
  await ev(`window.__baseA = JSON.parse(JSON.stringify(state.patients.filter(function(p){ return p.id === "${A}"; })[0]))`);
  await other(B, 'Nome mudado por Lucas', 'Lucas');
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__LOG__ = []; });
  await ev(`writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, window.__baseA, {obs: "nota 2"}) : p; }))`);
  await page.waitForTimeout(100);
  let st = await store();
  check('itens diferentes: as duas alterações ficaram e não houve aviso?',
    st.find((x) => x.id === B).nome === 'Nome mudado por Lucas' && !(await page.$('#ovConfirm')), st.map((x) => x.nome));

  // 4. Mesmo paciente: aviso; "Recarregar" descarta a minha e mostra a dela.
  await ev(`window.__baseA = JSON.parse(JSON.stringify(state.patients.filter(function(p){ return p.id === "${A}"; })[0]))`);
  await other(A, 'Ana por Lucas', 'Lucas');
  await page.waitForTimeout(100);
  await ev(`window.__w = writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, window.__baseA, {nome: "Ana minha"}) : p; })); 1`);
  await page.waitForSelector('#ovConfirm', { timeout: 3000 }).catch(() => {});
  const msg = await page.$eval('#ovConfirm', (e) => e.textContent).catch(() => '');
  const btns = await page.$$eval('#ovConfirm .btn', (bs) => bs.map((b) => b.textContent)).catch(() => []);
  check('mesmo item: aviso com quem alterou e os dois botões?', /Lucas/.test(msg) && btns.includes('Salvar assim mesmo') && btns.includes('Recarregar'), {msg: msg.slice(0, 120), btns});
  await page.click('#cfCancel');
  await page.waitForTimeout(150);
  st = await store();
  const stateName = await ev(`state.patientsRaw.filter(function(p){ return p.id === "${A}"; })[0].nome`);
  check('Recarregar: banco e tela ficam com a versão da outra pessoa?', st.find((x) => x.id === A).nome === 'Ana por Lucas' && stateName === 'Ana por Lucas', {db: st.find((x) => x.id === A).nome, tela: stateName});

  // 5. Mesmo paciente: "Salvar assim mesmo" grava a minha.
  await ev(`window.__baseA = JSON.parse(JSON.stringify(state.patients.filter(function(p){ return p.id === "${A}"; })[0]))`);
  await other(A, 'Ana de novo por Lucas', 'Lucas');
  await page.waitForTimeout(100);
  await ev(`window.__w = writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, window.__baseA, {nome: "Ana minha"}) : p; })); 1`);
  await page.waitForSelector('#ovConfirm', { timeout: 3000 }).catch(() => {});
  await page.click('#cfOk').catch(() => {});
  await page.waitForTimeout(150);
  st = await store();
  check('Salvar assim mesmo: a minha versão fica?', st.find((x) => x.id === A).nome === 'Ana minha', st.find((x) => x.id === A));

  // 6. Mesmo paciente salvo duas vezes seguidas por mim: sem aviso (o carimbo novo fica na tela).
  await page.evaluate(() => { window.__LOG__ = []; });
  await ev(`writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, p, {obs: "x1"}) : p; }))`);
  await ev(`writePatients(state.patients.map(function(p){ return p.id === "${A}" ? Object.assign({}, p, {obs: "x2"}) : p; }))`);
  await page.waitForTimeout(100);
  check('duas gravações seguidas minhas: sem aviso?', !(await page.$('#ovConfirm')) && (await store()).find((x) => x.id === A).nome === 'Ana minha');

  // 7. Item excluído por outra pessoa enquanto eu editava: a tela já não tem o item, a minha
  //    gravação não o traz de volta. Se a tela ainda não soube da exclusão (banco à frente),
  //    o banco recusa e o app avisa "excluído por outra pessoa".
  await page.evaluate((B) => window.claude.use('db').then((db) => db.doc('patients/all').set({list: window.__STORE__['patients/all'].list.filter((x) => x.id !== B)})), B);
  await page.waitForTimeout(100);
  await ev(`writePatients(state.patients.map(function(p){ return p.id === "${B}" ? Object.assign({}, p, {obs: "editado"}) : p; }))`);
  await page.waitForTimeout(100);
  check('excluído por outra pessoa: não volta sozinho?', !(await store()).some((x) => x.id === B));
  await ev(`window.__w = listCommit("patients/all", {list: [], ups: [{id: "${B}", nome: "B"}], dels: [], expect: {"${B}": ""}, order: null, empty: false}); 1`);
  await page.waitForSelector('#ovConfirm', { timeout: 3000 }).catch(() => {});
  const msg7 = await page.$eval('#ovConfirm', (e) => e.textContent).catch(() => '');
  check('tela atrasada: aviso de excluído?', /excluído por outra pessoa/.test(msg7), msg7.slice(0, 100));
  await page.click('#cfCancel').catch(() => {});
  await page.waitForTimeout(100);

  // 8. Reordenar (salas): manda a ordem; sem reordenar, não manda.
  await page.evaluate(() => { window.__LOG__ = []; });
  await ev('writeRooms(state.rooms.slice().reverse())');
  let rOps = await page.evaluate(() => window.__LOG__.filter((x) => x.path === 'config/rooms'));
  const orderSent = rOps.length === 1 && Array.isArray(rOps[0].order) && rOps[0].ups.length === 0;
  const roomOrder = await page.evaluate(() => window.__STORE__['config/rooms'].list.map((r) => r.id).join(','));
  const stateOrder = await ev('state.rooms.map(function(r){ return r.id; }).join(",")');
  check('reordenar salas: manda só a ordem e o banco fica igual à tela?', orderSent && roomOrder === stateOrder, {ops: rOps.map((o) => ({ups: o.ups.length, order: !!o.order})), roomOrder, stateOrder});

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(lpPage); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
