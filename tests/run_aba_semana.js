// Dois quadros da mesma especialidade e do mesmo terapeuta, com ABA e semanas diferentes:
// o atendimento usa o quadro da semana do mês (Planner pelo documento, Agenda pela data).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_wk.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const r = await ev(`(function(){
    var lines = [
      {id:"q1", specId:"psico", hours:2, profId:"ana-terapeuta", aba:"Sim", semanas:"1,3"},
      {id:"q2", specId:"psico", hours:2, profId:"ana-terapeuta", aba:"Não", semanas:"2,4"}];
    var p = {nome:"X", specHours: lines};
    return {
      w1: bookingAbaOf(p, "ana-terapeuta", "sessao", 1), w2: bookingAbaOf(p, "ana-terapeuta", "sessao", 2),
      w3: bookingAbaOf(p, "ana-terapeuta", "sessao", 3), w4: bookingAbaOf(p, "ana-terapeuta", "sessao", 4),
      dt: bookingAbaOf(p, "ana-terapeuta", "sessao", tlWeekOfDate("2026-10-12")),
      wk: [tlWeekOfDate("2026-10-02"), tlWeekOfDate("2026-10-05"), tlWeekOfDate("2026-10-12"), tlWeekOfDate("2026-10-26"), tlWeekOfDate("2026-11-02"), tlWeekOfDate("2026-11-30")],
      k1: trLineKey(lines, {prof:"ana-terapeuta", svc:"sessao", wk:3}), k2: trLineKey(lines, {prof:"ana-terapeuta", svc:"sessao", d:"2026-10-12"}),
      agenda: bookingPatient(p, {date:"2026-10-19", service:"sessao", professional_id:"ana-terapeuta"})._aba
    };
  })()`);
  console.log('week 1/3 = Sim, 2/4 = Não?', r.w1 === 'Sim' && r.w3 === 'Sim' && r.w2 === 'Não' && r.w4 === 'Não', JSON.stringify(r));
  console.log('week of date follows the first Monday (0 outside weeks 1-4)?', JSON.stringify(r.wk) === '[0,1,2,4,0,0]' || JSON.stringify(r.wk) === '[0,1,2,4,1,0]', JSON.stringify(r.wk));
  console.log('Agenda date and trLineKey pick the same quadro as the week?', r.dt === 'Não' && r.k1 === 'q1' && r.k2 === 'q2' && r.agenda === 'Sim');
  console.log('no JS errors?', errors.length === 0, errors);
  fs.unlinkSync(evPage);
  await browser.close();
})();
