const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ap6.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);

  // Cenário: sala ABA com 4 colunas (Fono), sala dupla com 2 colunas, grupo de suporte com um Aplicador ABA
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('config/specialties').set({list: [{id: 'fono', name: 'Fonoaudiologia', sigla: 'FN'}, {id: 'aplic', name: 'Aplicador ABA'}]});
    var profs = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map(function(id){ return {id: id, name: id.toUpperCase(), specialtyId: 'fono'}; });
    profs.push({id: 'ap1', name: 'Aplic', specialtyId: 'aplic'});
    await db.doc('config/professionals').set({list: profs});
    await db.doc('config/rooms').set({list: [
      {id: 'rB', name: 'Fonoaudiologia', aba: false, color: '#2255aa', therapists: ['f5'].map(function(f){ return {id: 'rB-' + f, name: f, professionalId: f}; })},
      {id: 'sup', name: 'Aplicador ABA', color: 'slate', group: true, therapists: [{id: 'sup-t1', name: 'Aplic', professionalId: 'ap1'}]}
    ]});
    var pats = [];
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function(x){ pats.push({id: 'p' + x, nome: 'Paciente ' + x.toUpperCase(), idade: 12, nascimento: '', aba: 'Sim'}); });
    await db.doc('patients/all').set({list: pats});
  })()`);
  await page.waitForTimeout(500);
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForTimeout(400);
  const setTr = (list) => ev(`(function(){ state.treatments = ${JSON.stringify(list)}.map(function(t){ return Object.assign({inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem'}, t); }); rebuildPatients(); })()`);
  const tr = (id, extra, lineExtra) => Object.assign({ id: 't' + id, patientId: id, specHours: [Object.assign({ id: 'l' + id, specId: 'fono', hours: 4, service: 'sessao', aba: 'Sim' }, lineExtra || {})] }, extra || {});
  const build = (ids, opts) => ev(`(function(){ var plan = apBuild(state.patients.filter(function(p){ return ${JSON.stringify(ids)}.indexOf(p.id) !== -1; }), ${JSON.stringify(opts || {})});
    return JSON.stringify({items: plan.items.map(function(it){ return {p: it.p.id, w: it.w, day: it.day, time: it.time, room: it.room.id, prof: it.prof.id, svc: it.rec.service, group: it.group}; }),
      goal: plan.goal.map(function(g){ return {p: g.p.id, total: g.total, group: g.group, ok: g.ok}; }), support: plan.support.map(function(s){ return {room: s.room.id, size: s.size, time: s.time, w: s.w}; }),
      cap: plan.capacity.map(function(c){ return [c.specId, c.need, c.free, c.placed]; }), gaps: plan.gaps.length}); })()`).then(JSON.parse);

  const hor = (day, ini, fim) => { const o = {}; o[day] = { ativo: true, manha: { inicio: ini, fim: fim } }; return o; };
  // X (outro serviço, janela larga) monta primeiro e pega 07:20; Y (Sessão, só 07:20) não caberia -> X é trocado para outro horário
  await setTr([
    tr('pa', { horarios: hor('seg', '07:20', '09:00') }, { hours: 1, aba: 'Não', semanas: '1', service: 'triagem' }),
    tr('pb', { horarios: hor('seg', '07:20', '08:00') }, { hours: 1, aba: 'Não', semanas: '1' })
  ]);
  await ev(`(function(){ state.scheduleDocs = {}; })()`);
  const r = await ev(`(function(){ var plan = apBuild(state.patients.filter(function(p){ return ['pa','pb'].indexOf(p.id) !== -1; }), {});
    return JSON.stringify({ej: plan.ejected, gaps: plan.gaps.length, diag: plan.diag.length, items: plan.items.map(function(it){ return [it.p.id, it.day, it.time]; })}); })()`).then(JSON.parse);
  check('diagnosis lists both quadros?', r.diag === 2, JSON.stringify(r));
  check('hard session placed by swapping the easier one (no gaps)?', r.gaps === 0 && r.items.length === 2 && r.items.every((x) => x[0] !== 'pb' || x[2] === '07:20' || x[2] === '08:00'), JSON.stringify(r));
  console.log('ejected', r.ej);
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
})();
