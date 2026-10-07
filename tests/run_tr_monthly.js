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
  const rowsShown = await page.$$eval('#trMonthly tbody tr', (t) => t.length);
  console.log('section starts hidden and opens with the arrow?', closed && !(await page.$eval('#trMonthBody', (e) => e.hidden)));
  console.log('‹ goes to the previous month (first one, ‹ disabled)?', /\(atual\)/.test(label1) && !/\(atual\)/.test(label2) && prevOff && rowsShown === 3, label1, label2);
  const font = await page.$eval('#trMonthBody > .pat-count', (e) => getComputedStyle(e).fontSize);
  const ref = await ev(`(function(){ var d = document.createElement("div"); d.className = "pat-count"; document.body.appendChild(d); var f = getComputedStyle(d).fontSize; d.remove(); return f; })()`);
  console.log('explanation uses the same text style as the hours note?', font === ref, font);

  // Janela: Histórico recolhido, "Outras opções" no topo, valores em R$ depois de Convênio/Plano.
  const win = await ev(`(function(){
    var t = state.treatments[0]; t.valor = 1500; t.descontos = 100;
    try { localStorage.removeItem("agendaPipo:trHistOpen"); } catch(e){}
    openTreatmentModal(t);
    var all = Array.from(document.querySelectorAll("#ovTreat input[id]")).map(function(e){ return e.id; });
    var menu = Array.from(document.querySelectorAll("#trMoreMenu button")).map(function(b){ return b.textContent; });
    return {histHidden: document.getElementById("trHistBody").hidden, menu: menu, inBody: !!document.querySelector("#ovTreat .modal-body #trOpenPlan"),
      order: all.indexOf("pPlano") < all.indexOf("trVal") && all.indexOf("trVal") < all.indexOf("pPac"), val: document.getElementById("trVal").value, fin: document.getElementById("trFinal").value};
  })()`);
  console.log('Histórico starts hidden?', win.histHidden);
  console.log('"Outras opções" has patient and plan, plan link left the body?', win.menu.join('|') === 'Cadastro do paciente|Abrir plano terapêutico' && !win.inBody, win.menu);
  console.log('Valor/Descontos/Valor final after Convênio/Plano, in R$?', win.order && /^R\$ 1\.500,00$/.test(win.val) && /^R\$ 1\.400,00$/.test(win.fin), win.val, win.fin);
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
    document.getElementById("trShowCanc").checked = true; renderTreatmentsTab();
    var n1 = document.querySelectorAll("#trHost tbody tr").length;
    document.getElementById("trShowReneg").checked = true; renderTreatmentsTab();
    var n2 = document.querySelectorAll("#trHost tbody tr").length;
    document.getElementById("trShowCanc").checked = false; document.getElementById("trShowReneg").checked = false;
    var f = document.getElementById("trFilter"); f.value = "cancelado"; renderTreatmentsTab();
    var n3 = document.querySelectorAll("#trHost tbody tr").length; f.value = ""; renderTreatmentsTab();
    return [n0, n1, n2, n3, /Sem vencimento/.test(txt)];
  })()`);
  console.log('cancelled/renegotiated hidden until checked (status filter still finds them)?', JSON.stringify(list.slice(0, 4)) === '[1,2,3,1]', JSON.stringify(list));
  console.log('Vencimento shows "Sem vencimento"?', list[4]);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
