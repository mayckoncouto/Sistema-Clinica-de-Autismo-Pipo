// Cadastro do paciente: grupo "Rotina atual" (segunda a sexta × manhã/tarde, tipo + detalhe),
// "Copiar segunda" por coluna com Desfazer, gravação, ficha impressa, Campos obrigatórios e
// o aviso ao agendar no Planner e na Agenda (regras pl_rotina / ag_rotina). Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_rotina.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const setv = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  await ev('openPatientModal(state.patients.filter(function(p){ return p.nome === "Paciente Um"; })[0])');
  await page.waitForSelector('#ovPat');
  const order = await page.$$eval('#ovPat .pm-sec', (r) => r.map((s) => s.getAttribute('data-pmsec')));
  const days = await page.$$eval('#ovPat [data-pmsec="rotinaatual"] tbody th', (r) => r.map((x) => x.textContent));
  console.log('"Rotina atual" comes right after Escola, Monday to Friday?', order.indexOf('rotinaatual') === order.indexOf('escola') + 1 && days.join() === 'Segunda,Terça,Quarta,Quinta,Sexta', JSON.stringify(order), JSON.stringify(days));

  await setv('#rt-seg-m-tipo', 'escola');
  await page.fill('#rt-seg-m-txt', 'Escola Azul');
  await setv('#rt-seg-t-tipo', 'casa');
  await page.click('[data-rt-copy="m"]');
  const copied = await page.evaluate(() => ['ter', 'qua', 'qui', 'sex'].every((d) => document.getElementById('rt-' + d + '-m-tipo').value === 'escola' && document.getElementById('rt-' + d + '-m-txt').value === 'Escola Azul') &&
    document.getElementById('rt-ter-t-tipo').value === '');
  const undoShown = await page.isVisible('#rtUndo');
  await page.click('#rtUndoBtn');
  const undone = await page.evaluate(() => document.getElementById('rt-ter-m-tipo').value === '' && document.getElementById('rt-seg-m-tipo').value === 'escola');
  console.log('"Copiar segunda" copies only that column to Tue–Fri; Desfazer brings back?', copied && undoShown && undone);
  await page.click('[data-rt-copy="m"]');

  await page.fill('#pf-cpf', '52998224725');
  await page.click('#pSave'); await page.waitForTimeout(400);
  const saved = await page.evaluate(() => (window.__STORE__['patients/all'].list.filter((p) => p.nome === 'Paciente Um')[0] || {}).rotinaAtual);
  console.log('saved: Monday–Friday morning School, Monday afternoon at home?', !(await page.$('#ovPat')) && saved && saved.seg.m.tipo === 'escola' && saved.seg.m.txt === 'Escola Azul' && saved.sex.m.tipo === 'escola' && saved.seg.t.tipo === 'casa' && !saved.ter.t, JSON.stringify(saved));

  // Ficha impressa e Campos obrigatórios.
  const ficha = await ev('patientFichaHtml(state.patients.filter(function(p){ return p.nome === "Paciente Um"; })[0])');
  console.log('printed form has the routine?', /Rotina atual/.test(ficha) && /Manhã: Escola \(Escola Azul\)/.test(ficha) && /Tarde: Em casa/.test(ficha));
  const inFields = await ev('PAT_FIELDS.some(function(f){ return f.key === "rotinaAtual" && f.sec === "rotinaatual"; }) && PAT_SECTIONS.some(function(s){ return s.id === "rotinaatual"; })');
  console.log('"Rotina atual" is in Campos obrigatórios (same list as the form)?', inFields === true);

  // Planner: marcar segunda de manhã avisa; segunda à tarde (em casa) não.
  const morning = await ev('DAYS.filter(function(d){ return d.key === "seg"; })[0].morning[1]');
  const afternoon = await ev('DAYS.filter(function(d){ return d.key === "seg"; })[0].afternoon[1]');
  await ev(`(function(){ window.__r = applyBookingChanges({"seg-2": {"${morning}|r1|r1-t1": {patient: "Paciente Um", service: "sessao"}}}); return true; })()`);
  await page.waitForSelector('#cfTitle');
  const t1 = await page.$eval('#cfTitle', (e) => e.textContent);
  const m1 = await page.$eval('#confirmHost', (e) => e.textContent);
  await page.click('#cfCancel'); await page.waitForTimeout(200);
  const notSaved = await page.evaluate((k) => !((window.__STORE__['schedule/seg-2'] || {}).bookings || {})[k], morning + '|r1|r1-t1');
  console.log('Planner: booking on a school morning asks first ("Rotina atual do paciente"); cancel keeps it empty?', t1 === 'Rotina atual do paciente' && /manhã de Escola \(Escola Azul\)/.test(m1) && notSaved, t1, m1);
  await ev(`(function(){ var l = state.patients.filter(function(p){ return p.nome === "Paciente Um"; })[0]; l.rotinaAtual.ter.t = {tipo: "pipo", txt: ""}; return true; })()`);
  const pipoAsk = await ev(`routineConflicts({"ter-2": {"${afternoon}|r1|r1-t1": {patient: "Paciente Um", service: "sessao"}}}).length`);
  console.log("Planner: \"Terapia (Pipo)\" does not warn?", pipoAsk === 0, pipoAsk);
  const asked = await ev(`(function(){ var r = routineConflicts({"seg-2": {"${afternoon}|r1|r1-t1": {patient: "Paciente Um", service: "sessao"}}}); return r.length; })()`);
  console.log('Planner: afternoon "Em casa" does not warn?', asked === 0, asked);
  // Sistema: regra desligada não pergunta.
  const offOk = await ev(`(function(){ state.sysRules = Object.assign({}, state.sysRules, {pl_rotina: "off"}); return sysOn("pl_rotina"); })()`);
  console.log('rule can be switched off in Sistema?', offOk === false);
  await ev('state.sysRules = Object.assign({}, state.sysRules, {pl_rotina: "warn"})');

  // Agenda: segunda 05/01/2032 de manhã avisa.
  await ev(`(function(){ window.__a = null; agdRoutineCheck([{rec: {date: "2032-01-05", time: "${morning}", professional_id: "ana-terapeuta", patient: "Paciente Um", service: "sessao"}, old: null}]).then(function(v){ window.__a = v; }); return true; })()`);
  await page.waitForSelector('#cfTitle');
  const t2 = await page.$eval('#cfTitle', (e) => e.textContent);
  await page.click('#cfCancel'); await page.waitForTimeout(200);
  console.log('Agenda: booking on a school morning asks first?', t2 === 'Rotina atual do paciente' && (await page.evaluate(() => window.__a)) === false, t2);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
