// Feriados e recessos (cálculo, cadastro, Agenda) e "Gerar mês" (semanas, feriado pulado).
// Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_hol.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  const calc = await ev(`({
    sexta2026: holMovelIso("sexta-santa", 2026), corpus2026: holMovelIso("corpus-christi", 2026), sexta2027: holMovelIso("sexta-santa", 2027),
    natal: !!holidayAt("2031-12-25", "08:00"), blu: (holidayAt("2027-09-02", "") || {}).name, normal: holidayAt("2026-10-14", "08:00")
  })`);
  console.log('Easter-based holidays (Sexta Santa 03/04/2026, Corpus 04/06/2026, Sexta 26/03/2027)?', calc.sexta2026 === '2026-04-03' && calc.corpus2026 === '2026-06-04' && calc.sexta2027 === '2027-03-26', JSON.stringify(calc));
  console.log('fixed holidays repeat every year (Natal 2031, Blumenau 2027) and normal day is free?', calc.natal && calc.blu === 'Aniversário de Blumenau' && calc.normal === null);
  const rec = await ev(`(function(){
    state.holidays = holidaysList().concat([{id: "rec", name: "Recesso", tipo: "recesso", inicio: "2026-12-24", fim: "2027-01-05", periodo: "dia", anual: true},
      {id: "meio", name: "Véspera", tipo: "outro", inicio: "2026-10-15", fim: "2026-10-15", periodo: "tarde", anual: false}]);
    return {wrap: !!holidayAt("2030-01-03", "08:00") && !!holidayAt("2030-12-28", ""), morning: holidayAt("2026-10-15", "08:00"), afternoon: (holidayAt("2026-10-15", "14:10") || {}).name};
  })()`);
  console.log('recess across new year works; half-day only covers the afternoon?', rec.wrap && rec.morning === null && rec.afternoon === 'Véspera', JSON.stringify(rec));

  // Cadastro
  await page.$eval('#mainTabs button[data-tab=feriados]', (b) => b.click()); await page.waitForTimeout(300);
  const rows = await page.$$eval('#reg-feriados-host tbody tr', (r) => r.length);
  console.log('Feriados registry lists defaults + added?', rows === 14, rows);
  await page.click('#reg-feriados-add'); await page.waitForSelector('#ovHol');
  await page.fill('#holName', 'Recesso de julho');
  await page.$eval('#holIni', (e) => { e.value = '2030-07-15'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#holSave'); await page.waitForTimeout(200);
  const saved = await page.evaluate(() => ((window.__STORE__['config/holidays'] || {}).list || []).filter((h) => h.name === 'Recesso de julho')[0]);
  console.log('new recess saved (end = start when blank)?', !!saved && saved.inicio === '2030-07-15' && saved.fim === '2030-07-15' && !(await page.$('#ovHol')), JSON.stringify(saved));

  // Gerar mês: semanas
  const wk = await ev(`(function(){ var w = genMonthWeeks("2026-10"); return w.map(function(x){ return x.days[0].iso + "|" + x.week; }).concat([w[3].days.filter(function(d){ return d.inMonth; }).length]); })()`);
  console.log('Oct/2026: week 1 starts on the first Monday (05/10) and 4 weeks follow?', JSON.stringify(wk.slice(0, 4)) === '["2026-10-05|1","2026-10-12|2","2026-10-19|3","2026-10-26|4"]', JSON.stringify(wk));
  const wk2 = await ev(`(function(){ var w = genMonthWeeks("2026-09"); return w[3].days.map(function(d){ return d.iso + (d.inMonth ? "" : "*"); }); })()`);
  console.log('Sept/2026: 4th week days in October are marked out of the month?', wk2.some((d) => d.endsWith('*')) && wk2[0] === "2026-09-28", JSON.stringify(wk2));

  // plannerSendPlan pula horário de feriado
  const plan = await ev(`(function(){
    var fake = {from: function(){ var q = {select: function(){ return q; }, eq: function(){ return Promise.resolve({data: []}); }}; return q; }};
    agdClient = function(){ return fake; };
    return db.doc("schedule/seg-1").set({bookings: {"08:00|r1|r1-t1": {patient: "Paciente Um", service: "sessao"}}}).then(function(){
      return plannerSendPlan("seg", "1", "2030-01-07", function(t){ return t === "08:00" ? "Feriado X" : ""; });
    }).then(function(p){ return {sent: p.send.filter(function(r){ return r.time === "08:00"; }).length, hol: p.skipped.filter(function(s){ return s.why === "holiday"; }).length}; });
  })()`);
  console.log('Gerar mês skips holiday times?', plan.sent === 0 && plan.hol >= 1, JSON.stringify(plan));
  console.log('no separate Gerar mês button (Mês is a period inside Enviar para a Agenda)?', await page.evaluate(() => !document.getElementById('genMonthBtn') && !!document.querySelector('#plToolsMenu #sendToAgendaBtn')));

  const ag = await ev(`(function(){
    agdClient = function(){ return null; };
    AD.error = ""; AD.loaded = true; AD.rows = {}; AD.view = "semana"; AD.mode = "prof"; AD.date = new Date(2026, 11, 22);
    document.getElementById("tab-agenda").hidden = false;
    agdRender();
    return {gray: document.querySelectorAll('#agdGrid td.agd-hol[data-d="2026-12-25"]').length, other: document.querySelectorAll('#agdGrid td.agd-hol[data-d="2026-12-23"]').length,
      head: (document.querySelector('#agdGrid .agd-hol-name') || {}).textContent};
  })()`);
  console.log('Agenda: holiday cells are gray with the name in the header (other days normal)?', ag.gray > 0 && ag.other === 0 && !!ag.head, JSON.stringify(ag));
  const conf = await ev(`(function(){ var r = agdPatientConfirm([{rec: {patient: "Paciente Um", date: "2026-12-25", time: "08:00", professional_id: "x"}, old: null}]); return true; })()`);
  await page.waitForTimeout(150);
  console.log('marking on a holiday asks for confirmation (not blocked)?', conf && /Feriado ou recesso/.test(await page.textContent('#confirmHost')));
  await page.click('#confirmHost .btn.ghost').catch(() => {});

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
