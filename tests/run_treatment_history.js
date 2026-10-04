// Etapa 2 dos tratamentos: cada atendimento usa o tratamento que valia NA DATA
// dele (cor/ABA da Agenda, regras, relatórios de convênio, pacote e sem
// atendimento). A Agenda e os relatórios precisam do sistema online, então o
// teste chama as funções internas por um "eval" injetado numa cópia da página.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ev.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  const r = await ev(`(function(){
    var pat = state.patientsRaw.filter(function(p){ return p.id === "duda-vermelho"; })[0];
    var prof = state.professionals.filter(function(p){ return p.specialtyId; })[0];
    var spec = prof.specialtyId;
    var other = state.patientsRaw.filter(function(p){ return p.id !== pat.id; })[0];
    state.treatments = [
      {id: "t1", patientId: pat.id, inicio: "2026-01-01", status: "renegociado", statusEm: "2026-03-01", tipo: "novo", aba: "Não", convenio: "Conv A", plano: "P1", specHours: [{specId: spec, hours: 4}]},
      {id: "t2", patientId: pat.id, inicio: "2026-03-01", status: "ativo", tipo: "renegociado", aba: "Sim", convenio: "Conv B", plano: "P2", specHours: [{specId: spec, hours: 8}]},
      {id: "t3", patientId: other.id, inicio: "2025-01-01", status: "cancelado", statusEm: "2025-06-01", tipo: "novo", aba: "Sim"}
    ];
    rebuildPatients();
    var name = pat.nome, out = {};
    out.at = [treatmentAt(pat.id, "2025-12-01").id, treatmentAt(pat.id, "2026-02-10").id, treatmentAt(pat.id, "2026-03-05").id, treatmentAt(pat.id, trTodayIso()).id].join(",");
    out.abaPast = findPatientAt(name, "2026-02-10").aba;
    out.abaNow = findPatientByName(name).aba;
    out.rawUntouched = pat.aba === undefined || pat.aba === state.patientsRaw.filter(function(p){ return p.id === pat.id; })[0].aba;
    out.naoPast = isNaoABABooking({patient: name, date: "2026-02-10"});
    out.naoPlanner = isNaoABABooking({patient: name});
    var colPast = patientColor(findPatientAt(name, "2026-02-10")), colNow = patientColor(findPatientByName(name));
    out.colorDiffers = colPast !== colNow;
    out.cellPast = agdEventHtml({id: "a", patient: name, date: "2026-02-10", time: "08:00", professional_id: prof.id}, "08:00", name, null, false, false).indexOf(colPast) !== -1;
    var appts = [
      {id: "x1", patient: name, date: "2026-02-10", time: "08:00", professional_id: prof.id, status: "finalizado", service: "sessao"},
      {id: "x2", patient: name, date: "2026-03-10", time: "08:00", professional_id: prof.id, status: "finalizado", service: "sessao"},
      {id: "x3", patient: name, date: "2026-03-12", time: "08:00", professional_id: prof.id, status: "finalizado", service: "sessao"}
    ];
    var pk = RP_BUILDERS.pacote(appts, {from: "2026-01-01", to: "2026-04-30", pac: normText(name)}).sections[0].rows;
    out.pacote = pk.map(function(x){ return [x[1], x[3], x[4], x[5]].join("/"); }).join(" | ");
    var cv = RP_BUILDERS.convenios(appts, {conv: ""}).sections[0].rows;
    out.conv = cv.map(function(x){ return x[0] + ":" + x[1] + ":" + x[3]; }).sort().join(" | ");
    var sa = RP_BUILDERS["sem-atendimento"]([], {from: "2026-01-01", to: "2026-04-30", conv: ""}).sections[0].rows;
    out.semHasCancelled = sa.some(function(x){ return x[0] === other.nome; });
    out.semConv = (sa.filter(function(x){ return x[0] === name; })[0] || [])[1];
    return out;
  })()`);

  console.log('treatment in force: before 1st, Feb, Mar, today?', r.at === 't1,t1,t2,t2', r.at);
  console.log('past date reads ABA of the old treatment, today the current one?', r.abaPast === 'Não' && r.abaNow === 'Sim');
  console.log('patient record itself untouched?', r.rawUntouched);
  console.log('Agenda "não ABA" rule uses the treatment of the date (Planner keeps current)?', r.naoPast === true && r.naoPlanner === false);
  console.log('Agenda cell in the past uses the color of that time?', r.colorDiffers && r.cellPast);
  console.log('package report split by treatment (4/mês then 8/mês)?', /^01\/01\/2026 \(Renegociado\)\/4\/8\/1 \| 01\/03\/2026 \(Ativo\)\/8\/16\/2$/.test(r.pacote), r.pacote);
  console.log('convênio report uses convênio of the date?', r.conv === 'Conv A:P1:1 | Conv B:P2:2', r.conv);
  console.log('no-appointment report skips treatment closed before the period?', r.semHasCancelled === false);
  console.log('no-appointment report shows convênio at the end of the period?', r.semConv === 'Conv B', r.semConv);

  // Tratamento com atendimentos Finalizados: não exclui e não muda a quantidade de sessões.
  const lk = await ev(`(function(){
    var pat = state.patientsRaw.filter(function(p){ return p.id === "duda-vermelho"; })[0];
    TR.done = {}; TR.done[normText(pat.nome)] = ["2026-02-10"];   // finalizado no tempo do t1
    var t1 = state.treatments.filter(function(t){ return t.id === "t1"; })[0];
    var t2 = state.treatments.filter(function(t){ return t.id === "t2"; })[0];
    return {c1: trDoneCount(t1), c2: trDoneCount(t2)};
  })()`);
  console.log('finalized appointment counts for the treatment of its date only?', lk.c1 === 1 && lk.c2 === 0, JSON.stringify(lk));
  await ev(`openTreatmentModal(state.treatments.filter(function(t){ return t.id === "t1"; })[0])`);
  await page.waitForSelector('#ovTreat');
  console.log('treatment with done sessions: no Excluir, lock note shown?', !(await page.isVisible('#trDel')) && await page.isVisible('#trLockNote'));
  console.log('package and specialty quantities locked?', await page.$eval('#pPac', (i) => i.disabled) && await page.$eval('#specRowsHost .spec-hours-val', (i) => i.disabled) && await page.$eval('#specRowAdd', (b) => b.disabled));
  console.log('therapist per specialty still editable?', !(await page.$eval('#specRowsHost .spec-prof', (s) => s.disabled)));
  await page.$eval('#pPac', (i) => { i.disabled = false; i.value = '99'; });
  await page.click('#trSave'); await page.waitForTimeout(200);
  console.log('saving with a changed quantity is refused?', !!(await page.$('#ovTreat')) && (await ev(`state.treatments.filter(function(t){ return t.id === "t1"; })[0].pacoteHoras`)) === undefined);
  await page.click('#trCancel');
  await ev(`openTreatmentModal(state.treatments.filter(function(t){ return t.id === "t2"; })[0])`);
  await page.waitForSelector('#ovTreat');
  console.log('treatment without done sessions can still be deleted and edited?', await page.isVisible('#trDel') && !(await page.$eval('#pPac', (i) => i.disabled)));
  await page.click('#trCancel');

  // Etapa 4: vencimento.
  const v = await ev(`(function(){
    function plus(n){ var d = agdParse(trTodayIso()); d.setDate(d.getDate() + n); return agdIso(d); }
    var pats = state.patientsRaw;
    state.treatments = [
      {id: "v1", patientId: pats[0].id, inicio: "2026-01-01", status: "ativo", tipo: "novo", validoAte: plus(10)},
      {id: "v2", patientId: pats[1].id, inicio: "2026-01-01", status: "ativo", tipo: "novo", validoAte: plus(-3)},
      {id: "v3", patientId: pats[2].id, inicio: "2026-01-01", status: "ativo", tipo: "novo", validoAte: plus(90)},
      {id: "v4", patientId: pats[3].id, inicio: "2026-01-01", status: "cancelado", tipo: "novo", validoAte: plus(-30), motivoCancel: "outro"},
      {id: "v5", patientId: pats[4].id, inicio: "2026-01-01", status: "ativo", tipo: "novo"}
    ];
    rebuildPatients();
    return {m6: trAddMonths("2026-01-01", 6), m1: trAddMonths("2026-01-31", 1), d: ["v1","v2","v3","v4","v5"].map(function(id){ var x = trDue(state.treatments.filter(function(t){ return t.id === id; })[0]); return x ? x.state : "-"; }).join(",")};
  })()`);
  console.log('6 months from 01/01 = valid until 30/06; 1 month from 31/01 = 27/02?', v.m6 === '2026-06-30' && v.m1 === '2026-02-27', v.m6, v.m1);
  console.log('due states: 10 days = vencendo, past = vencido, 90 days/cancelled/no date = nothing?', v.d === 'vencendo,vencido,,-,-', v.d);
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(300);
  console.log('banner shows 1 due and 1 overdue?', /1 vence nos próximos 30 dias/.test(await page.textContent('#trDue')) && /1 vencido/.test(await page.textContent('#trDue')));
  await page.click('#trDue [data-tr-due=vencidos]'); await page.waitForTimeout(200);
  console.log('"Vencidos" filter shows only the overdue one with the red tag?', (await page.$$('#trHost tbody tr')).length === 1 && /Vencido/.test(await page.textContent('#trHost tbody tr')));
  await page.$eval('#trFilter', (f) => { f.value = ''; f.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.click('#trAdd'); await page.waitForSelector('#ovTreat');
  await page.$eval('#trPat', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, await ev('state.patientsRaw[5].id'));
  await page.waitForTimeout(200);
  await page.$eval('#trIni', (i) => { i.value = '2026-03-15'; i.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.fill('#trDur', '6'); await page.dispatchEvent('#trDur', 'input');
  console.log('duration 6 months from 15/03 fills valid until 14/09?', (await page.$eval('#trVenc', (i) => i.value)) === '2026-09-14');
  await page.click('#trSave'); await page.waitForTimeout(300);
  const saved = await ev(`(function(){ var t = state.treatments.filter(function(x){ return x.patientId === state.patientsRaw[5].id; })[0]; return t ? [t.duracaoMeses, t.validoAte].join("|") : ""; })()`);
  console.log('duration and valid-until saved?', saved === '6|2026-09-14', saved);
  await page.click('#trHost tbody tr:has-text("' + (await ev('state.patientsRaw[5].nome')) + '")'); await page.waitForSelector('#ovTreat');
  await page.click('#trReneg'); await page.waitForTimeout(300);
  console.log('renegotiation starts with blank duration and valid-until?', (await page.$eval('#trDur', (i) => i.value)) === '' && (await page.$eval('#trVenc', (i) => i.value)) === '');
  await page.click('#trCancel');

  // Vencimento por quantidade de sessões (Finalizados + Não compareceu).
  const sv = await ev(`(function(){
    var p6 = state.patientsRaw[2], p7 = state.patientsRaw[4];
    state.treatments = state.treatments.map(function(t){
      if (t.id === "v3") return Object.assign({}, t, {id: "s1", vencPor: "sessoes", totalSessoes: 10, validoAte: ""});
      if (t.id === "v5") return Object.assign({}, t, {id: "s2", vencPor: "sessoes", totalSessoes: 3});
      return t;
    });
    rebuildPatients();
    TR.used = {}; TR.done = TR.done || {};
    TR.used[normText(p6.nome)] = ["2026-02-01","2026-02-02","2026-02-03","2026-02-04","2026-02-05","2026-02-06"];   // 6 de 10 → restam 4
    TR.used[normText(p7.nome)] = ["2026-02-01","2026-02-02","2026-02-03"];                                         // 3 de 3 → esgotado
    function st(id){ var t = state.treatments.filter(function(x){ return x.id === id; })[0]; var d = t && trDue(t); return d ? d.state + ":" + d.rest : "-"; }
    return {s1: st("s1"), s2: st("s2"), txt: trDueText(state.treatments.filter(function(x){ return x.id === "s1"; })[0] || {})};
  })()`);
  console.log('sessions: 6 of 10 used = vencendo (4 left), 3 of 3 = esgotado?', sv.s1 === 'vencendo:4' && sv.s2 === 'vencido:0', JSON.stringify(sv));
  await ev(`openTreatmentModal(state.treatments.filter(function(x){ return x.id === "s1"; })[0])`);
  await page.waitForSelector('#ovTreat');
  console.log('modal by sessions: total shown, date fields hidden, used count shown?', await page.isVisible('#trTotal') && !(await page.isVisible('#trDur')) && /usadas: 6/.test(await page.textContent('#trUsedInfo')));
  await page.$eval('#trVencPor', (s) => { s.value = 'data'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  console.log('switching to Data shows duration/valid-until?', await page.isVisible('#trDur') && !(await page.isVisible('#trTotal')));
  await page.click('#trCancel');
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
