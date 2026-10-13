// Paciente Bloqueado: campos no cadastro, motivo, travas do Planner/Agenda, tarja e lista.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_bq.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  const names = await ev('blockReasonsList().map(function(r){ return r.name; })');
  check('default reasons exist (incl. Financeiro and Outro)?', names.indexOf('Financeiro') !== -1 && names.indexOf('Outro') !== -1);
  const pid = await ev('state.patients[0].id');
  await ev('openPatientModal(state.patients[0])');
  await page.waitForTimeout(250);
  check('window has the Bloqueio de Agendamento group with the switch and the reason?', !!(await page.$('#ovPat [data-pmsec="bloqueio"] #pf-bloqueado')) && !!(await page.$('#ovPat [data-pmsec="bloqueio"] #pf-bloqueioMotivo')));
  await page.$eval('#pf-cpf', (e) => { if (!e.value) { e.value = '11144477735'; e.dispatchEvent(new Event('input', {bubbles: true})); } });
  await page.click('#pf-bloqueado');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  check('saving blocked without reason is refused (window stays open)?', !!(await page.$('#ovPat')));
  await page.$eval('#pf-bloqueioMotivo', (e) => { e.value = 'financeiro'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.click('#pSave');
  await page.waitForTimeout(500);
  const blocked = await ev('patBlocked(state.patients[0])');
  check('patient is saved as Bloqueado with motivo and date?', blocked && !!(await ev('state.patients[0].bloqueioDesde')));

  // Planner: não agenda em célula nova
  const room = await ev('(function(){ var r = state.rooms.filter(function(x){ return !isGroup(x) && (x.therapists||[]).length; })[0]; return {id: r.id, seat: r.therapists[0].id}; })()');
  const msg = await ev(`(function(){ var p = state.patients[0]; return plannerConflict("seg-1", "09:00|${room.id}|${room.seat}", {patient: p.nome, service: DEFAULT_SERVICE_ID}, [], {}); })()`);
  check('Planner refuses a blocked patient in a new cell?', typeof msg === 'string' && /Bloqueado/.test(msg), msg);
  const msg2 = await ev(`(function(){ var p = state.patients[1]; return plannerConflict("seg-1", "09:00|${room.id}|${room.seat}", {patient: p.nome, service: DEFAULT_SERVICE_ID}, [], {}); })()`);
  check('Planner does not refuse a patient that is not blocked (for this rule)?', !(typeof msg2 === 'string' && /Bloqueado/.test(msg2)), msg2);
  // Agenda
  const am = await ev(`(function(){ var p = state.patients[0]; return agdConflictIn([], {date: "2099-01-05", time: "09:00", professional_id: "x", patient: p.nome, room_id: "${room.id}"}); })()`);
  check('Agenda refuses a blocked patient?', typeof am === 'string' && /Bloqueado/.test(am), am);
  const am2 = await ev(`(function(){ var p = state.patients[0]; return agdConflictIn([], {date: "2099-01-05", time: "09:00", professional_id: "x", patient: p.nome, room_id: "${room.id}"}, true); })()`);
  check('Agenda lets a booking the patient already holds be edited (held)?', !(typeof am2 === 'string' && /Bloqueado/.test(am2)), am2);
  const tag = await ev('blockTagHtml(state.patients[0])');
  check('Bloqueado tag html exists?', /Bloqueado/.test(tag));

  // Desbloquear limpa motivo
  await ev('openPatientModal(state.patients[0])');
  await page.waitForTimeout(250);
  await page.$eval('#pf-cpf', (e) => { if (!e.value) { e.value = '11144477735'; e.dispatchEvent(new Event('input', {bubbles: true})); } });
  await page.click('#pf-bloqueado');
  await page.click('#pSave');
  await page.waitForTimeout(500);
  check('unblocking clears the reason and releases the patient?', !(await ev('patBlocked(state.patients[0])')) && !(await ev('state.patients[0].bloqueioMotivo')));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
