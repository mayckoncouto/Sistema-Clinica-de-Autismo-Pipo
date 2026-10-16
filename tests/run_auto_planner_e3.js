// Auto Planner, etapa 3: Por que aqui?, Fixar, Remontar e Relatório de Qualidade.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ap3.html');
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
      {id: 'rA', name: 'Fonoaudiologia ABA', aba: true, color: 'teal', therapists: ['f1', 'f2', 'f3', 'f4'].map(function(f){ return {id: 'rA-' + f, name: f, professionalId: f}; })},
      {id: 'rB', name: 'Fonoaudiologia', aba: false, color: '#2255aa', therapists: ['f5', 'f6'].map(function(f){ return {id: 'rB-' + f, name: f, professionalId: f}; })},
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

  const storeAuto = () => ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).sort().map(function(k){ return [k, window.__STORE__[k].bookings]; }))`).then(JSON.parse);
  const mineOf = async (pid) => { const out = []; (await storeAuto()).forEach(([k, b]) => Object.keys(b).forEach((key) => { if (b[key] && b[key].patientId === pid) out.push({ doc: k, key, rec: b[key] }); })); return out; };
  const openModal = async () => { await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn'); await page.waitForSelector('#apRun'); };

  // 1) a proposta grava os motivos (porque) em cada atendimento
  await setTr([tr('pa', null, { hours: 2, aba: 'Não' })]);
  let r = await ev(`(function(){ var plan = apBuild(state.patients.filter(function(p){ return p.id === "pa"; }), {}); return JSON.stringify(plan.items.map(function(i){ return i.rec.porque; })); })()`).then(JSON.parse);
  check('every proposed session carries its reasons (porque)?', r.length === 2 && r.every((x) => Array.isArray(x) && x.indexOf('individual') !== -1), JSON.stringify(r));
  check('alternate weeks reason shows up for 2 sessions?', r.every((x) => x.indexOf('alterna') !== -1), JSON.stringify(r));

  // 2) Montar Proposta (Completar) para o paciente e conferir o texto "Por que" no title
  await openModal();
  await page.$eval('#apPat', (s) => { s.value = 'pa'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun'); await page.waitForSelector('#apOut details');
  check('preview line has the reasons in the title?', /individual/i.test(await page.$eval('#apOut .fr-day > div', (e) => e.getAttribute('title') || '')));
  await page.click('#apApply'); await page.waitForFunction(() => !document.getElementById('ovAp')); await page.waitForTimeout(400);
  let mine = await mineOf('pa');
  check('2 sessions placed (auto, with porque)?', mine.length === 2 && mine.every((m) => m.rec.auto && m.rec.porque.length), mine.length);

  // 3) janela do atendimento mostra "Por que aqui?" e deixa fixar
  const m0 = mine[0], dayKey = m0.doc.replace('autoplan/', '').split('-')[0], week = +m0.doc.split('-')[1], kp = m0.key.split('|');
  await ev(`openBookingModal({key: ${JSON.stringify(m0.key)}, docId: ${JSON.stringify(m0.doc.replace('autoplan/', ''))}, dayKey: ${JSON.stringify(dayKey)}, week: ${week}, roomId: ${JSON.stringify(kp[1])}, therapistId: ${JSON.stringify(kp[2])}, time: ${JSON.stringify(kp[0])}})`);
  await page.waitForSelector('#ovBook');
  check('booking window shows "Por que aqui?" and the Fixar box?', /Por que aqui\?/.test(await page.innerText('#ovBook')) && !!(await page.$('#bkFixo')));
  await page.check('#bkFixo'); await page.click('#bkSave'); await page.waitForFunction(() => !document.getElementById('ovBook')); await page.waitForTimeout(400);
  mine = await mineOf('pa');
  const fixed = mine.filter((m) => m.rec.fixo);
  check('fixed session keeps auto + porque and gets fixo?', fixed.length === 1 && fixed[0].rec.auto && fixed[0].rec.porque.length, JSON.stringify(fixed.map((f) => f.rec)));

  // 4) Remontar: só a não fixa sai e volta; a fixa fica igual
  const keepKey = fixed[0].doc + fixed[0].key;
  await openModal();
  await page.$eval('#apMode', (s) => { s.value = 'remontar'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  check('therapist field appears in Remontar mode?', !(await page.$eval('#apTherBox', (b) => b.hidden)));
  await page.$eval('#apPat', (s) => { s.value = 'pa'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun'); await page.waitForSelector('#apOut details');
  check('preview says 1 session of the previous proposal will be removed?', /1<\/b> atendimento da proposta anterior/.test(await page.$eval('#apOut', (e) => e.innerHTML)));
  await page.click('#apApply'); await page.waitForFunction(() => !document.getElementById('ovAp')); await page.waitForTimeout(500);
  mine = await mineOf('pa');
  check('still 2 sessions; the fixed one did not move?', mine.length === 2 && mine.some((m) => m.doc + m.key === keepKey && m.rec.fixo), JSON.stringify(mine.map((m) => m.doc + m.key)));
  // nada para remontar quando tudo está fixo
  await ev(`(function(){ Object.keys(state.scheduleDocs).forEach(function(id){ var b = state.scheduleDocs[id].bookings; Object.keys(b).forEach(function(k){ if (b[k] && b[k].auto) b[k].fixo = true; }); }); })()`);
  await openModal();
  await page.$eval('#apMode', (s) => { s.value = 'remontar'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun'); await page.waitForFunction(() => /Nada para remontar/.test(document.getElementById('apOut').innerText));
  check('all fixed → nothing to remount?', true);
  await page.click('#apCancel');

  // 5) Relatório de Qualidade
  await page.click('#plToolsBtn'); await page.click('#apQualityBtn');
  await page.waitForFunction(() => /Sessões Colocadas/i.test((document.getElementById('apqOut') || {}).innerText || ''));
  await page.waitForFunction(() => /Não Couberam/i.test(document.getElementById('apqOut').innerText));
  const txt = await page.innerText('#apqOut');
  check('quality report: totals, placed × contracted, occupancy, empty slot, alerts, gaps?', /2 atendimentos/.test(txt) && /Ocupação por Terapeuta/i.test(txt) && /Horário Vago por Sala e Turno/i.test(txt) && /Alertas/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 260));
  check('placed = contracted (patient complete)?', /pacientes com tratamento completos/.test(txt) && !/Diferença/.test(txt), '');
  await page.click('#apqCancel');
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
