// "Não Agrupar com" do tratamento: o Planner e a Agenda avisam ao pôr os dois pacientes na mesma sala e horário
// (regras pl_nao_agrupar / ag_nao_agrupar, padrão Avisar). Dados fictícios.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_naoag.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage); await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0; const check = (n, ok, x) => { console.log(n, !!ok, ok ? '' : JSON.stringify(x === undefined ? '' : x)); if (!ok) fails++; };
  const info = await ev(`(function(){
    var room = physicalRooms().filter(function(r){ return (r.therapists || []).filter(function(t){ return t.professionalId; }).length >= 2; })[0];
    var ps = state.patients.filter(function(p){ return isActive(p); });
    var a = ps[0], b = ps[1]; a.naoAgrupar = [b.id]; b.naoAgrupar = [];
    var seats = room.therapists.filter(function(t){ return t.professionalId; });
    return {room: room.id, s1: seats[0].id, s2: seats[1].id, a: a.nome, b: b.nome, c: ps[2] ? ps[2].nome : "", t: DAYS.filter(function(d){ return d.key === "seg"; })[0].afternoon[2]};
  })()`);
  const k1 = info.t + '|' + info.room + '|' + info.s1, k2 = info.t + '|' + info.room + '|' + info.s2;
  const both = await ev(`naoAgruparConflicts({"seg-3": {"${k1}": {patient: ${JSON.stringify(info.a)}, service: "sessao"}, "${k2}": {patient: ${JSON.stringify(info.b)}, service: "sessao"}}}).length`);
  check('Planner: the two in the same room and time are reported (once, either side marked)?', both === 1, both);
  const other = await ev(`naoAgruparConflicts({"seg-3": {"${k1}": {patient: ${JSON.stringify(info.a)}, service: "sessao"}, "${k2}": {patient: ${JSON.stringify(info.c)}, service: "sessao"}}}).length`);
  check('Planner: another patient does not warn?', other === 0, other);
  await ev(`(function(){ window.__r = null; applyBookingChanges({"seg-3": {"${k1}": {patient: ${JSON.stringify(info.a)}, service: "sessao"}, "${k2}": {patient: ${JSON.stringify(info.b)}, service: "sessao"}}}).then(function(v){ window.__r = v; }); return 1; })()`);
  await page.waitForSelector('#cfTitle', { timeout: 3000 }).catch(() => {});
  const ttl = await page.$eval('#cfTitle', (e) => e.textContent).catch(() => '');
  check('Planner: asks for confirmation before saving?', /Não Agrupar com/.test(ttl), ttl);
  if (ttl) { await page.click('#cfCancel'); await page.waitForTimeout(200); }
  check('Planner: cancel keeps the cells empty?', !(await page.evaluate((k) => ((window.__STORE__['schedule/seg-3'] || {}).bookings || {})[k], k2)));
  // Agenda
  await ev(`(function(){ window.__a = null; AD.rows = AD.rows || {}; AD.rows["zz1"] = {id: "zz1", date: "2032-01-05", time: "${info.t}", room_id: "${info.room}", professional_id: "x", patient: ${JSON.stringify(info.b)}, service: "sessao"};
    agdNaoAgruparCheck([{rec: {date: "2032-01-05", time: "${info.t}", room_id: "${info.room}", professional_id: "y", patient: ${JSON.stringify(info.a)}, service: "sessao"}, old: null}]).then(function(v){ window.__a = v; }); return 1; })()`);
  await page.waitForSelector('#cfTitle', { timeout: 3000 }).catch(() => {});
  const t2 = await page.$eval('#cfTitle', (e) => e.textContent).catch(() => '');
  if (t2) { await page.click('#cfCancel'); await page.waitForTimeout(200); }
  check('Agenda: same room and time with the other patient asks, cancel refuses?', /Não Agrupar com/.test(t2) && (await page.evaluate(() => window.__a)) === false, t2);
  const off = await ev(`(function(){ state.sysRules = Object.assign({}, state.sysRules, {ag_nao_agrupar: "off"}); window.__a = null;
    agdNaoAgruparCheck([{rec: {date: "2032-01-05", time: "${info.t}", room_id: "${info.room}", professional_id: "y", patient: ${JSON.stringify(info.a)}, service: "sessao"}, old: null}]).then(function(v){ window.__a = v; }); return 1; })()`);
  await page.waitForTimeout(200);
  check('Agenda: with the rule off in Sistema it does not ask?', !(await page.$('#cfTitle')) && (await page.evaluate(() => window.__a)) !== false);
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close(); fs.unlinkSync(evPage); process.exit(fails || errors.length ? 1 : 0);
})();
