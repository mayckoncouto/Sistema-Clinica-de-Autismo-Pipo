// Agenda ▾ → Agenda Planner: agenda real (por data) no visual do Planner (salas e colunas).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_agp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + ' ' + (e.stack||'').split('\n').slice(1,4).join(' ')));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await ev(`(function(){
    var db = {appointments: []};
    function q(table){
      var f = [], rng = null;
      var o = {select: function(){ return o; }, gte: function(k, v){ f.push(function(r){ return r[k] >= v; }); return o; }, lte: function(k, v){ f.push(function(r){ return r[k] <= v; }); return o; },
        eq: function(k, v){ f.push(function(r){ return r[k] === v; }); return o; }, order: function(){ return o; }, range: function(a, b){ rng = [a, b]; return o; },
        then: function(res, rej){ var hit = (db[table] || []).filter(function(r){ return f.every(function(fn){ return fn(r); }); }); if (rng) hit = hit.slice(rng[0], rng[1] + 1); return Promise.resolve({data: JSON.parse(JSON.stringify(hit)), error: null}).then(res, rej); }};
      return o;
    }
    var fake = {from: q, channel: function(){ var ch = {on: function(){ return ch; }, subscribe: function(){ return ch; }}; return ch; }, rpc: function(){ return Promise.resolve({data: null, error: null}); }};
    agdClient = function(){ return fake; };
    AD.channel = {};
    window.__db = db;
    function a(id, date, time, prof, room, patient, extra){ db.appointments.push(Object.assign({id: id, date: date, time: time, professional_id: prof, room_id: room, patient: patient, note: "", blocked: false, service: "sessao", status: null}, extra || {})); }
    a("a1", "2030-01-07", "08:00", "ana-terapeuta", "r1", "Paciente Um");
    a("a2", "2030-01-07", "08:00", "bia-terapeuta", "r1", "Bruno Verde");
    a("a3", "2030-01-07", "08:40", "andrelisa-terapeuta", "r1", "Ana Azul");
    a("a4", "2030-01-07", "09:20", "ana-terapeuta", null, "Paciente Um");
    a("a5", "2030-01-08", "08:00", "ana-terapeuta", "r1", "Bruno Verde");
    AD.date = agdParse("2030-01-07");
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(function(b){ if (b.getAttribute("data-tab") === "agendaplanner") b.click(); });
  })()`);
  await page.waitForTimeout(800);
  check('menu Agenda tem Agenda Planner logo depois de Agenda', await ev(`AG_ITEMS[0].key === "agenda" && AG_ITEMS[1].key === "agendaplanner"`));
  check('abriu a aba', (await ev(`state.tab`)) === 'agendaplanner');
  check('mês é o primeiro controle da barra', await ev(`document.querySelector("#tab-agendaplanner .agd-toolbar").firstElementChild.id === "agpMonth" || !!document.querySelector("#tab-agendaplanner .agd-toolbar > .dp-btn #agpMonth, #tab-agendaplanner .agd-toolbar > #agpMonth")`));
  check('mês selecionado = janeiro de 2030', await ev(`document.getElementById("agpMonth").value === "2030-01"`), await ev(`document.getElementById("agpMonth").value`));
  check('cabeçalho de salas (grouphead)', (await ev(`document.querySelectorAll("#agpGrid th.grouphead").length`)) >= 2);
  check('colunas de profissional (seathead) no visual do Planner', (await ev(`document.querySelectorAll("#agpGrid th.seathead").length`)) >= 3);
  check('a1 aparece na célula 08:00', await ev(`!!document.querySelector('#agpGrid td[data-t="08:00"][data-p="ana-terapeuta"] .book[data-id="a1"]')`));
  check('a2 aparece na coluna da Bia', await ev(`!!document.querySelector('#agpGrid td[data-t="08:00"][data-p="bia-terapeuta"] .book[data-id="a2"]')`));
  check('profissional sem coluna na sala vai para Outros', await ev(`!!document.querySelector('#agpGrid td[data-t="08:40"][data-p=""] .book[data-id="a3"]')`));
  check('atendimento sem sala vai para Sem Sala', await ev(`Array.prototype.some.call(document.querySelectorAll("#agpGrid th.grouphead"), function(t){ return /Sem Sala/i.test(t.textContent); })`));
  check('dia seguinte não aparece', await ev(`!document.querySelector('#agpGrid .book[data-id="a5"]')`));
  // clique abre os Detalhes
  await ev(`document.querySelector('#agpGrid .book[data-id="a1"] .book-main').click()`);
  await page.waitForTimeout(300);
  check('clicar no atendimento abre os Detalhes', await ev(`!!document.getElementById("ovAgdDet")`));
  await ev(`(document.querySelector("#ovAgdDet .modal-close") || document.querySelector("#ovAgdDet [id$=Close]")).click()`);
  await page.waitForTimeout(200);
  // busca destaca
  await ev(`(function(){ var q = document.getElementById("agpSearch"); q.value = "bruno"; q.dispatchEvent(new Event("input")); })()`);
  check('busca destaca o paciente', await ev(`!!document.querySelector('#agpGrid .book[data-id="a2"] .book-main.match')`));
  check('busca apaga os outros', await ev(`!!document.querySelector('#agpGrid .book[data-id="a1"].search-dim-item')`));
  await ev(`(function(){ var q = document.getElementById("agpSearch"); q.value = ""; q.dispatchEvent(new Event("input")); })()`);
  // filtros
  await ev(`(function(){ var s = document.getElementById("agpRoom"); s.value = "r2"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro de sala deixa só a sala escolhida', (await ev(`document.querySelectorAll("#agpGrid th.grouphead").length`)) === 1);
  await ev(`(function(){ var s = document.getElementById("agpRoom"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  await ev(`(function(){ var s = document.getElementById("agpProf"); s.value = "bia-terapeuta"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro de profissional mostra só a coluna dele', await ev(`!document.querySelector('#agpGrid td[data-p="ana-terapeuta"]') && !!document.querySelector('#agpGrid td[data-p="bia-terapeuta"]')`));
  await ev(`(function(){ var s = document.getElementById("agpProf"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  // navegação por mês e dia
  await ev(`document.getElementById("agpNext").click()`);
  await page.waitForTimeout(400);
  check('› vai para o dia seguinte (terça 08/01)', await ev(`agdIso(AD.date) === "2030-01-08"`));
  check('terça mostra a5', await ev(`!!document.querySelector('#agpGrid .book[data-id="a5"]')`));
  await ev(`(function(){ var s = document.getElementById("agpMonth"); window.__m = s.options[s.options.length - 1].value; s.value = window.__m; s.dispatchEvent(new Event("change")); })()`);
  await page.waitForTimeout(400);
  check('trocar o mês leva a data para o mês', await ev(`agdIso(AD.date).slice(0, 7) === window.__m`), await ev(`agdIso(AD.date) + " / " + window.__m`));
  await ev(`(function(){ var s = document.getElementById("agpMonth"); s.value = "2030-01"; s.dispatchEvent(new Event("change")); })()`);
  await page.waitForTimeout(400);
  // célula vazia abre a janela de novo atendimento
  await ev(`(function(){ AD.date = agdParse("2030-01-07"); agpRender(); })()`);
  await ev(`document.querySelector('#agpGrid td[data-t="10:00"][data-p="bia-terapeuta"] .book-main').click()`);
  await page.waitForTimeout(300);
  check('célula vazia abre a janela de agendar', await ev(`!!document.querySelector("#modalHost .overlay")`));
  check('janela vem com profissional da coluna', await ev(`(document.getElementById("agdProf") || {}).value === "bia-terapeuta"`), await ev(`(document.getElementById("agdProf") || {}).value`));
  // atalhos de destino: mover para outra coluna
  check('apTarget usa profissional da coluna', await ev(`(function(){ var td = document.querySelector('#agpGrid td[data-t="10:00"][data-p="bia-terapeuta"]'); var t = agpTarget(AD.rows["a1"], td); return t.professional_id === "bia-terapeuta" && t.room_id === "r1" && t.time === "10:00"; })()`));
  check('grupo só aceita atendimento de grupo', await ev(`(function(){ var td = document.createElement("td"); td.setAttribute("data-grp", "1"); return !!agpRefuse(AD.rows["a1"], td); })()`));
  // regras visuais do Planner e sem "+" de mais um atendimento
  await ev(`(function(){ AD.date = agdParse("2030-01-07"); agdRender(); })()`);
  check('não existe o botão de marcar mais um atendimento', !(await page.$('#agpGrid .agd-add')));
  await ev(`(function(){ AD.rows["z1"] = {id: "z1", date: "2030-01-07", time: "09:20", professional_id: "ana-terapeuta", room_id: "r2", patient: "Paciente Um", note: "", blocked: false, service: "sessao", status: null}; agpRender(); })()`);
  check('profissional atendendo em outra sala: coluna dele fica listrada (prof-busy)', await ev(`!!document.querySelector('#agpGrid td[data-t="09:20"][data-p="ana-terapeuta"][data-rm="r1"].prof-busy')`));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
