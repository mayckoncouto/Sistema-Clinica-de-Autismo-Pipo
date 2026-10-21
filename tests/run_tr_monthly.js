// Tratamento: contratado × Planner × Agenda × realizado, um mês por vez (dados fictícios).
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

  // "Ana Azul": Psicologia 8/mês e Fono 0 (selecionada), desde o 1º dia do mês passado.
  const r = await ev(`(function(){
    var today = trTodayIso(), d = agdParse(today);
    var prevFirst = agdIso(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    var prev = prevFirst.slice(0, 8);
    var t = {id: "trm", patientId: "ana-azul", inicio: prevFirst, status: "ativo", specHours: [{specId: "psico", hours: 8}, {specId: "fono", hours: ""}]};
    state.treatments = [t]; rebuildPatients();
    var bk = {}; for (var k = 0; k < 6; k++) bk["0" + (7 + k) + ":00|r1|r1-t1"] = {patient: "Ana Azul", patientId: "ana-azul"};
    bk["13:30|r1|r1-t1"] = {patient: "Bloqueado", blocked: true};
    TR.plan = {"seg-1": bk}; TR.planAt = Date.now();
    TR.appts = {"ana-azul": [
      {d: prev + "05", prof: "ana-terapeuta", svc: "sessao", st: "finalizado"},
      {d: prev + "06", prof: "ana-terapeuta", svc: "sessao", st: "nao-compareceu"},
      {d: prev + "07", prof: "ana-terapeuta", svc: "sessao", st: "falta-justificada"},
      {d: prev + "08", prof: "ana-terapeuta", svc: "sessao", st: ""},
      {d: prev + "09", prof: "x", svc: "triagem", st: ""}
    ]};
    var v = trMonthView(t, prevFirst.slice(0, 7));
    return {v: v, html: trMonthViewHtml(t, prevFirst.slice(0, 7)), rg: trMonthRange(t), cur: today.slice(0, 7), prevYm: prevFirst.slice(0, 7)};
  })()`);
  const ps = r.v.rows[0], fo = r.v.rows[1];
  console.log('only the treatment specialties, monthly (no proportion)?', r.v.rows.length === 2 && ps.contr === 8 && fo.contr === 0, JSON.stringify(r.v.rows));
  console.log('Planner and Dif. Planner = contracted − Planner?', ps.plan === 6 && ps.difPl === 2);
  console.log('Agenda, done, justified, no status?', ps.ag === 4 && ps.real === 2 && ps.just === 1 && ps.semSt === 1);
  console.log('Dif. Agenda = contracted − Agenda + justified?', ps.difAg === 8 - 4 + 1);
  console.log('total row and other-service note?', /tr-month-tot/.test(r.html) && r.v.tot.contr === 8 && r.v.other === 1 && /não estão no tratamento/.test(r.html));
  console.log('Agenda service without a quadro becomes a "Fora do Tratamento" row?', r.v.extra.length === 1 && r.v.extra[0].ag === 1 && /Fora do Tratamento/.test(r.html));
  console.log('divergence panel lists the error with a link to the Agenda?', r.v.divs.some((d) => d.lvl === 'erro' && /Agenda: 1 atendimento/.test(d.text) && d.go && d.go.t === 'agenda') && /tr-div-go/.test(r.html), JSON.stringify(r.v.divs.map((d) => d.text)));
  console.log('Agenda without Planner / Planner without Agenda / same-day duplicates are reported?', Array.isArray(r.v.divs) && r.v.divs.every((d) => d.text && d.lvl));
  const dv = await ev(`(function(){
    var t = state.treatments[0], ym = t.inicio.slice(0, 7);
    state.services = (state.services || []).concat([{id: "devolutivas-x", name: "Devolutiva"}]);
    TR.appts["ana-azul"].push({d: ym + "-10", prof: "x", svc: "devolutivas-x", st: ""});
    var v = trMonthView(t, ym);
    return v.divs.filter(function(d){ return /Devolutiva/.test(d.text); }).map(function(d){ return d.lvl; }).concat(v.divs.filter(function(d){ return /triagem/i.test(d.text); }).map(function(d){ return "t:" + d.lvl; }));
  })()`);
  console.log('Devolutiva without a quadro is "info", Triagem stays "erro"?', dv.indexOf('info') !== -1 && dv.indexOf('erro') === -1 && dv.indexOf('t:erro') !== -1, JSON.stringify(dv));
  console.log('months from the start to next month, opens on the current month?', r.rg.first === r.prevYm && r.rg.dflt === r.cur && r.rg.last > r.cur, JSON.stringify(r.rg));

  // Janela: começa fechada, abre pela seta, ‹ › trocam o mês.
  await ev(`(function(){ try { localStorage.removeItem("agendaPipo:trMonthOpen"); } catch(e){} openTreatmentModal(state.treatments[0]); })()`);
  await page.waitForSelector('#trMonthToggle');
  const closed = await page.$eval('#trMonthBody', (e) => e.hidden);
  await page.click('#trMonthToggle');
  const label1 = await page.textContent('#trMonthLabel');
  await page.click('#trMonthPrev');
  const label2 = await page.textContent('#trMonthLabel');
  const prevOff = await page.$eval('#trMonthPrev', (b) => b.disabled);
  await page.waitForFunction(() => { const b = document.getElementById('trPlBox'); return b && !/…/.test(b.textContent); }, null, {timeout: 4000}).catch(() => {});
  const plBox = await page.$eval('#trPlBox', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  console.log('Planner box (Por Semana, Atendimentos, Profissionais, Fora do Horário) above the table?', /Por Semana 1ª: \d+\/[\d,]+ · 2ª: \d+\/[\d,]+ · 3ª: \d+\/[\d,]+ · 4ª: \d+\/[\d,]+ Atendimentos \d+\/\d+ Especialidades \d+\/\d+ Fora do Horário do Paciente \d+/i.test(plBox), plBox);
  if (process.env.SHOT) await page.$eval('#trPlBox', (e) => e.scrollIntoView()).then(() => page.locator('#trPlBox').screenshot({path: process.env.SHOT}));
  const rowsShown = await page.$$eval('#trMonthly tbody tr:not(.tr-month-x):not(.tr-month-xh)', (t) => t.length);
  console.log('section starts hidden and opens with the arrow?', closed && !(await page.$eval('#trMonthBody', (e) => e.hidden)));
  console.log('‹ goes to the previous month (first one, ‹ disabled)?', /\(atual\)/.test(label1) && !/\(atual\)/.test(label2) && prevOff && rowsShown === 3, label1, label2);
  const font = await page.$eval('#trMonthBody > .pat-count', (e) => getComputedStyle(e).fontSize);
  const ref = await ev(`(function(){ var d = document.createElement("div"); d.className = "pat-count"; document.body.appendChild(d); var f = getComputedStyle(d).fontSize; d.remove(); return f; })()`);
  console.log('explanation uses the same text style as the hours note?', font === ref, font);

  // Quadro alterado na janela (ainda sem salvar): o Contratado × Realizado já mostra o valor novo.
  await page.click('#trMonthToday');
  const contrBefore = await page.$eval('#trMonthly tbody tr:not(.tr-month-x):not(.tr-month-xh) td:nth-child(2)', (e) => e.textContent.trim());
  await require('./tl-helper').addLine(page, {hours: '9'}, 0);
  await page.waitForTimeout(700);
  const contrAfter = await page.$eval('#trMonthly tbody tr:not(.tr-month-x):not(.tr-month-xh) td:nth-child(2)', (e) => e.textContent.trim());
  console.log('quadro edited in the window (unsaved) updates Contratado x Realizado?', contrAfter === '9' && contrBefore !== '9', contrBefore, contrAfter);
  console.log('saved treatment untouched?', (await ev(`String(state.treatments[0].specHours[0].hours)`)) === contrBefore);

  // Mudança no Planner com a janela aberta: a coluna Planner atualiza sozinha.
  const before = await ev(`trMonthView(state.treatments[0], trTodayIso().slice(0, 7)).rows[0].plan`);
  const htmlBefore = await page.innerHTML('#trMonthly');
  await ev(`(function(){
    var bk = JSON.parse(JSON.stringify(TR.plan["seg-1"]));
    bk["13:30|r1|r1-t1"] = {patient: "Ana Azul", patientId: "ana-azul"};
    return window.claude.use("db").then(function(db){ return db.doc("schedule/seg-1").set({bookings: bk}); });
  })()`);
  await page.waitForTimeout(900);
  const after = await ev(`trMonthView(state.treatments[0], trTodayIso().slice(0, 7)).rows[0].plan`);
  const htmlAfter = await page.innerHTML('#trMonthly');
  console.log('Planner change with the window open updates the table?', before === 6 && after === 7 && htmlAfter !== htmlBefore, before, after);

  // Janela: Histórico recolhido, "Outras Opções" no topo, valores em R$ depois de Convênio/Plano.
  const win = await ev(`(function(){
    var t = state.treatments[0]; t.valor = 1500; t.descontos = 100;
    try { localStorage.removeItem("agendaPipo:trHistOpen"); } catch(e){}
    openTreatmentModal(t);
    var all = Array.from(document.querySelectorAll("#ovTreat input[id]")).map(function(e){ return e.id; });
    var menu = Array.from(document.querySelectorAll("#trMoreMenu button")).map(function(b){ return b.textContent; });
    return {histHidden: document.getElementById("trHistBody").hidden, menu: menu, inBody: !!document.querySelector("#ovTreat .modal-body #trOpenPlan"),
      order: all.indexOf("pConv") < all.indexOf("pPac") && all.indexOf("pPac") < all.indexOf("trVal") && all.indexOf("trVal") < all.indexOf("pAba"), val: document.getElementById("trVal").value, fin: document.getElementById("trFinal").value};
  })()`);
  console.log('Histórico starts hidden?', win.histHidden);
  console.log('"Outras Opções" has patient and plan, plan link left the body?', win.menu.join('|') === 'Cadastro do Paciente|Abrir Plano Terapêutico|Criar Tarefa' && !win.inBody, win.menu);
  console.log('Valor/Descontos/Valor Final after Convênio/Plano, in R$?', win.order && /^R\$ 1\.500,00$/.test(win.val) && /^R\$ 1\.400,00$/.test(win.fin), win.val, win.fin);
  await page.click('#trHistToggle');
  console.log('arrow opens the Histórico?', !(await page.$eval('#trHistBody', (e) => e.hidden)));
  await page.fill('#trDesp', '50'); await page.click('#trVal');
  console.log('leaving a value field formats it in R$?', /^R\$ 50,00$/.test(await page.inputValue('#trDesp')));
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // Lista: Cancelados/Renegociados ocultos até marcar; "Sem vencimento".
  const list = await ev(`(function(){
    state.treatments = [
      {id: "a1", patientId: "ana-azul", inicio: "2026-01-01", status: "ativo", vencPor: "sem"},
      {id: "c1", patientId: "bruno-verde", inicio: "2025-01-01", status: "cancelado", motivoCancel: "financeiro", statusEm: "2025-06-01"},
      {id: "r1", patientId: "ana-azul", inicio: "2025-01-01", status: "renegociado", statusEm: "2025-12-31"}];
    rebuildPatients();
    document.querySelectorAll("#mainTabs button[data-tab=tratamentos]")[0].click();
    renderTreatmentsTab();
    var n0 = document.querySelectorAll("#trHost tbody tr").length, txt = document.getElementById("trHost").textContent;
    document.getElementById("trShowInact").checked = true; renderTreatmentsTab();
    var n1 = document.querySelectorAll("#trHost tbody tr").length;
    renderTreatmentsTab();
    var n2 = document.querySelectorAll("#trHost tbody tr").length;
    document.getElementById("trShowInact").checked = false;
    var f = document.getElementById("trFilter"); f.value = "cancelado"; renderTreatmentsTab();
    var n3 = document.querySelectorAll("#trHost tbody tr").length; f.value = ""; var se = document.getElementById("trSearch"); se.value = "a"; renderTreatmentsTab(); var n4 = document.querySelectorAll("#trHost tbody tr").length; se.value = ""; renderTreatmentsTab();
    return [n0, n1, n2, n3, /Sem vencimento/.test(txt), n4];
  })()`);
  console.log('cancelled/renegotiated hidden until checked (status filter still finds them)?', JSON.stringify(list.slice(0, 4)) === '[1,3,3,1]' && list[5] >= 2, JSON.stringify(list));
  console.log('Vencimento shows "Sem vencimento"?', list[4]);

    const abaSt = await ev(`(function(){ var d = function(n){ var x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return [trAbaRevState({status: "ativo", abaRevisao: d(-1)}), trAbaRevState({status: "ativo", abaRevisao: d(10)}), trAbaRevState({status: "ativo", abaRevisao: d(90)}), trAbaRevState({status: "cancelado", abaRevisao: d(-1)}), trAbaRevState({status: "ativo"})].join("|"); })()`);
  console.log('ABA revision state: vencida, vencendo, none, cancelled none, empty none?', abaSt === 'vencida|vencendo|||', abaSt);

  const outH = await ev(`(function(){
    var t = {horarios: {seg: {ativo: true, manha: {inicio: "08:00", fim: "09:00"}}}, vencPor: "sem"};
    var p = {id: "p1", nome: "Paciente Teste"};
    var ctx = {p: p, lines: [], lineOf: function(){ return null; },
      pitems: [{day: "seg", week: 1, time: "08:00", prof: "", svc: "sessao"}, {day: "ter", week: 1, time: "08:00", prof: "", svc: "sessao"}],
      aitems: [{d: "2026-10-06", t: "10:00:00", prof: "", svc: "sessao", st: "finalizado"}]};
    var d = trDivergences(t, "2026-10", ctx).filter(function(x){ return /Horário de Atendimento/.test(x.text); });
    return d.map(function(x){ return x.lvl + ":" + x.text.slice(0, 7); }).join("|");
  })()`);
  console.log('outside the patient hours (from the treatment) = Erro in Planner and Agenda?', outH === 'erro:Planner|erro:Agenda:', outH);

  const outQ = await ev(`(function(){
    var t = {horarios: {seg: {ativo: true, manha: {inicio: "08:00", fim: "09:00"}}}, vencPor: "sem"};
    var p = {id: "p1", nome: "Paciente Teste"};
    var lq = {id: "q1", service: "triagem", hora: "15:30", dia: "qua"};
    var ctx = {p: p, lines: [lq], lineOf: function(prof, svc){ return svc === "triagem" ? lq : null; },
      pitems: [{day: "qua", week: 1, time: "15:30", prof: "", svc: "triagem"}, {day: "qua", week: 2, time: "16:10", prof: "", svc: "triagem"}, {day: "qua", week: 3, time: "15:30", prof: "", svc: "sessao"}],
      aitems: [{d: "2026-10-07", t: "15:30:00", prof: "", svc: "triagem", st: "finalizado"}]};
    var d = trDivergences(t, "2026-10", ctx).filter(function(x){ return /Horário de Atendimento/.test(x.text); });
    return d.map(function(x){ return x.text.slice(0, 7) + (/16:10/.test(x.text) ? "16:10" : /3ª/.test(x.text) ? "sessao" : "?"); }).join("|");
  })()`);
  console.log('service other than Sessão: quadro time matches = ignores patient hours; other time or Sessão still Erro?', outQ === 'Planner16:10|Plannersessao', outQ);

console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
