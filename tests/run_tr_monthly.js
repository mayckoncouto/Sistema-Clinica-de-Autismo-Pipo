// Tratamento: contratado × Planner × Agenda × realizado, mês a mês (dados fictícios).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_trmes.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  // Tratamento de "Ana Azul": Psicologia 8/mês, começando no 1º dia do mês passado.
  const r = await ev(`(function(){
    var today = trTodayIso(), d = agdParse(today);
    var prevFirst = agdIso(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    var prev = prevFirst.slice(0, 8), cur = today.slice(0, 8);
    var t = {id: "trm", patientId: "ana-azul", inicio: prevFirst, status: "ativo", specHours: [{specId: "psico", hours: 8}]};
    state.treatments = [t]; rebuildPatients();
    // Planner: 6 sessões de Psicologia (coluna da Ana) + 1 bloqueio (não conta).
    var bk = {}; for (var k = 0; k < 6; k++) bk["0" + (7 + k) + ":00|r1|r1-t1"] = {patient: "Ana Azul", patientId: "ana-azul"};
    bk["13:30|r1|r1-t1"] = {patient: "Bloqueado", blocked: true};
    TR.plan = {"seg-1": bk}; TR.planAt = Date.now();
    var tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    var tm = agdIso(tomorrow), inMonth = tm.slice(0, 7) === today.slice(0, 7);
    TR.appts = {"ana-azul": [
      {d: prev + "05", prof: "ana-terapeuta", svc: "sessao", st: "finalizado"},
      {d: prev + "06", prof: "ana-terapeuta", svc: "sessao", st: "nao-compareceu"},
      {d: prev + "07", prof: "ana-terapeuta", svc: "sessao", st: "falta-justificada"},
      {d: prev + "08", prof: "ana-terapeuta", svc: "sessao", st: ""}
    ].concat(inMonth ? [{d: tm, prof: "ana-terapeuta", svc: "sessao", st: ""}] : [])};
    var m = trMonthly(t), mp = m.months[0], mc = m.months[1];
    var html = trMonthlyHtml(t);
    return {inMonth: inMonth, prev: mp.rows[0], cur: mc.rows[0], html: html};
  })()`);
  const p = r.prev;
  console.log('past month: contracted, Planner, Agenda, done, justified, no status?', p.contr === 8 && p.plan === 6 && p.ag === 4 && p.real === 2 && p.just === 1 && p.semSt === 1 && p.diff === -6, JSON.stringify(p));
  const c = r.cur;
  console.log('current month counts what is still booked?', c.plan !== null && c.ag === (r.inMonth ? 1 : 0) && c.diff === c.real + c.sched - c.contr && c.sched === (r.inMonth ? 1 : 0), JSON.stringify(c));
  console.log('table has the new columns?', ['Contratado', 'Planner', 'Agenda', 'Realizado', 'Falta just.', 'Diferença'].every((h) => r.html.includes('<th' + (h === 'Falta just.' ? ' title="Falta justificada">' : '>') + h + '</th>')));
  console.log('warnings: missing in Planner and without status?', /Falta no Planner/.test(r.html) && /1 sem status/.test(r.html));
  console.log('current month warns when the Agenda has less than the Planner?', /Falta enviar para a Agenda/.test(r.html));

  // Duas especialidades: aparece a linha Total.
  const tot = await ev(`(function(){
    var t = state.treatments[0]; t.specHours = [{specId: "psico", hours: 8}, {specId: "fono", hours: 4}];
    var h = trMonthlyHtml(t), m = trMonthly(t).months[0];
    return {total: /tr-month-tot/.test(h), contr: m.tot.contr, plan: m.tot.plan};
  })()`);
  console.log('total row with more than one specialty?', tot.total && tot.contr === 12 && tot.plan === 6, JSON.stringify(tot));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
