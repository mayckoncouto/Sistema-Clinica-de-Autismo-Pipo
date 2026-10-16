// Auto Planner, etapa 4: rascunhos, comparar, imprimir e Excel.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ap4.html');
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
  const mineOf = async (pid) => { const out = []; (await storeAuto()).forEach(([k, b]) => Object.keys(b || {}).forEach((key) => { if (b[key] && b[key].patientId === pid) out.push({ doc: k, key, rec: b[key] }); })); return out; };
  const openModal = async () => { await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn'); await page.waitForSelector('#apRun'); };

  // grade com 2 sessões (Montar Proposta) e a janela de rascunhos
  await setTr([tr('pa', null, { hours: 2, aba: 'Não' }), tr('pb', null, { hours: 2, aba: 'Não' })]);
  await openModal();
  await page.click('#apRun'); await page.waitForSelector('#apOut details');
  await page.click('#apApply'); await page.waitForFunction(() => !document.getElementById('ovAp')); await page.waitForTimeout(400);
  const n0 = (await mineOf('pa')).length + (await mineOf('pb')).length;
  check('4 sessions placed (2 patients × 2)?', n0 === 4, n0);

  await page.click('#plToolsBtn'); await page.click('#apDraftsBtn'); await page.waitForSelector('#ovApD');
  await page.waitForFunction(() => document.querySelectorAll('#apdList tbody tr').length === 5);
  check('five empty slots listed?', (await page.locator('#apdList tbody tr .pt-muted').count()) === 5);
  await page.fill('#apdName', 'Base'); await page.click('#apdSave');
  await page.waitForFunction(() => /Base/.test(document.getElementById('apdList').innerText));
  let d1 = await ev(`JSON.stringify(window.__STORE__["autoplan/rascunho-1"] || null)`).then(JSON.parse);
  check('draft 1 saved with name and the 4 weeks of bookings?', d1 && d1.name === 'Base' && Object.keys(d1.docs).length >= 1 && apCount(d1.docs) === 4, d1 && JSON.stringify(Object.keys(d1.docs)));
  function apCount(docs){ let n = 0; Object.values(docs).forEach((b) => Object.values(b).forEach((r) => { if (r && r.patient) n++; })); return n; }

  // muda a grade (apaga uma sessão) e salva como rascunho 2
  await page.click('#apdCancel');
  const one = (await mineOf('pa'))[0];
  await ev(`writeBooking(${JSON.stringify(one.doc.replace('autoplan/', ''))}, ${JSON.stringify(one.key)}, null)`);
  await page.waitForTimeout(400);
  await page.click('#plToolsBtn'); await page.click('#apDraftsBtn'); await page.waitForSelector('#ovApD');
  await page.waitForFunction(() => /Base/.test(document.getElementById('apdList').innerText));
  await page.fill('#apdName', 'Menos uma');
  check('next free slot is preselected (2)?', (await page.$eval('#apdSlot', (s) => s.value)) === '2');
  await page.click('#apdSave'); await page.waitForFunction(() => /Menos uma/.test(document.getElementById('apdList').innerText));
  const d2 = await ev(`JSON.stringify(window.__STORE__["autoplan/rascunho-2"])`).then(JSON.parse);
  check('draft 2 has 3 sessions?', apCount(d2.docs) === 3);

  // renomear
  await page.$eval('#apdSlot', (s) => { s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#apdName', 'Três sessões'); await page.click('#apdRename');
  await page.waitForFunction(() => /Três sessões/.test(document.getElementById('apdList').innerText));
  check('draft renamed, content kept?', (await ev(`window.__STORE__["autoplan/rascunho-2"].name`)) === 'Três sessões' && apCount(JSON.parse(await ev(`JSON.stringify(window.__STORE__["autoplan/rascunho-2"].docs)`))) === 3);

  // comparar rascunho 1 × rascunho 2
  await page.$eval('#apdA', (s) => { s.value = 'r1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#apdB', (s) => { s.value = 'r2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apdCmp'); await page.waitForFunction(() => /B − A/.test(document.getElementById('apdOut').innerText));
  const cmp = await page.innerText('#apdOut');
  const flat = cmp.replace(/\s+/g, ' ');
  check('compare: 4 × 3 attendances and 1 removed?', /Atendimentos 4 3 -1/.test(flat) && /−1<?|−1 /.test(flat), flat.slice(0, 300));
  check('compare against the Planner also works?', await (async () => { await page.$eval('#apdB', (s) => { s.value = 'plan'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.click('#apdCmp'); await page.waitForFunction(() => /Planner \(Atual\)/i.test(document.getElementById('apdOut').innerText)); return true; })());

  // carregar o rascunho 1: a grade volta a ter 4 sessões e o Ctrl+Z existe
  await page.click('[data-apd-load="1"]'); await page.waitForSelector('.confirm-overlay');
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForFunction(() => !document.getElementById('ovApD')); await page.waitForTimeout(500);
  const back = (await mineOf('pa')).length + (await mineOf('pb')).length;
  check('draft 1 loaded: 4 sessions again, undo available?', back === 4 && (await ev(`bookingHistory.undo.length`)) > 0, back);

  // excluir o rascunho 2
  await page.click('#plToolsBtn'); await page.click('#apDraftsBtn'); await page.waitForSelector('#ovApD');
  await page.waitForFunction(() => /Três sessões/.test(document.getElementById('apdList').innerText));
  await page.click('[data-apd-del="2"]'); await page.waitForSelector('.confirm-overlay');
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForFunction(() => !/Três sessões/.test(document.getElementById('apdList').innerText));
  check('draft 2 deleted (slot empty again)?', !(await ev(`window.__STORE__["autoplan/rascunho-2"] && window.__STORE__["autoplan/rascunho-2"].name`)));
  await page.click('#apdCancel');

  // imprimir e exportar
  await ev(`window.__printed = null; demPrintFrame = function(t, css, body){ window.__printed = {t: t, body: body}; };`);
  await page.click('#plToolsBtn'); await page.click('#apPrintBtn'); await page.waitForSelector('#ovApP');
  await page.click('#appPrintTher'); await page.waitForFunction(() => window.__ev('window.__printed') !== null);
  let pr = await ev(`JSON.stringify(window.__printed)`).then(JSON.parse);
  check('therapist grid printed: title, therapist and patients?', pr.t === 'Grade por Terapeuta' && /F5/.test(pr.body) && /Paciente A/.test(pr.body) && /Paciente B/.test(pr.body), pr.body.length);
  await ev(`window.__printed = null`);
  await page.$eval('#appPat', (s) => { s.value = 'pa'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#appPrintFam'); await page.waitForFunction(() => window.__ev('window.__printed') !== null);
  pr = await ev(`JSON.stringify(window.__printed)`).then(JSON.parse);
  check('family schedule printed for one patient (no other patient)?', pr.t === 'Horário da Família' && /Paciente A/.test(pr.body) && !/Paciente B/.test(pr.body) && /semana/.test(pr.body), pr.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  await page.evaluate(() => { window.__copied = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
  await page.click('#appCopyFam'); await page.waitForFunction(() => !!document.getElementById('appTa'));
  const copied = await page.evaluate(() => window.__copied);
  check('WhatsApp text copied (patient name, day, time, weeks)?', /Horários de Paciente A/.test(copied) && /•/.test(copied) && /semanas?/.test(copied), copied.replace(/\n/g, ' | ').slice(0, 200));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#appExcel')]);
  check('Excel export is named autoplanner.csv?', dl.suggestedFilename() === 'autoplanner.csv', dl.suggestedFilename());
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
