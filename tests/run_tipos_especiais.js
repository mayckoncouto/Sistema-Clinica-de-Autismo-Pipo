// Reunião Clínica, Treinamento e Bloqueado: descrição na célula (tipo / sala / observação),
// contagem nos relatórios (Lista e Produtividade) e presença na tela Agendamentos (Bloqueado fora).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_tp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
    state.statuses = [{id: "finalizado", name: "Finalizado", color: "#2e7d32"}, {id: "nao-compareceu", name: "Não compareceu", color: "#c62828"}];
    window.__db = db;
    function a(id, date, time, prof, patient, extra){ db.appointments.push(Object.assign({id: id, date: date, time: time, professional_id: prof, room_id: "r1", patient: patient, note: "", blocked: false, service: "sessao", status: null}, extra || {})); }
    a("p1", "2030-01-07", "08:00", "ana-terapeuta", "Paciente Um", {status: "finalizado"});
    a("m1", "2030-01-07", "08:40", "ana-terapeuta", "Reunião Clínica", {note: "Alinhamento de casos", service: null});
    a("t1", "2030-01-07", "09:20", "ana-terapeuta", "Treinamento", {note: "Curso ABA", service: null});
    a("b1", "2030-01-07", "10:00", "ana-terapeuta", "Bloqueado", {blocked: true, service: null, room_id: null});
    LG.per = "custom"; LG.from = "2030-01-01"; LG.to = "2030-01-31";
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(function(b){ if (b.getAttribute("data-tab") === "agendamentos") b.click(); });
  })()`);
  await page.waitForTimeout(600);
  const rows = () => ev(`document.querySelectorAll("#reg-agendamentos-host tr[data-lg-id]").length`);

  // Célula: tipo / sala / observação
  const cell = await ev(`(function(){ var h = document.createElement("div"); h.innerHTML = agdEventHtml(window.__db.appointments[1], "08:40", "Ana", "#ccc", false, false);
    return {n: (h.querySelector(".pname")||{}).textContent, s: (h.querySelector(".pserv")||{}).textContent, o: (h.querySelector(".pnote")||{}).textContent, room: (findRoom("r1")||{}).name}; })()`);
  check('Reunião: 1ª linha = tipo', cell.n === 'Reunião Clínica', cell.n);
  check('Reunião: 2ª linha = sala', !!cell.room && cell.s === cell.room, cell.s + ' / ' + cell.room);
  check('Reunião: 3ª linha = observação', cell.o === 'Alinhamento de casos', cell.o);
  const tr = await ev(`(function(){ var h = document.createElement("div"); h.innerHTML = agdEventHtml(window.__db.appointments[2], "09:20", "Ana", "#ccc", false, false);
    return {n: (h.querySelector(".pname")||{}).textContent, s: (h.querySelector(".pserv")||{}).textContent, o: (h.querySelector(".pnote")||{}).textContent}; })()`);
  check('Treinamento: tipo, sala e observação', tr.n === 'Treinamento' && tr.s === cell.room && tr.o === 'Curso ABA', JSON.stringify(tr));
  const bl = await ev(`(function(){ var h = document.createElement("div"); h.innerHTML = agdEventHtml(window.__db.appointments[3], "10:00", "Ana", "#ccc", false, false);
    return {n: (h.querySelector(".pname")||{}).textContent, s: !!h.querySelector(".pserv")}; })()`);
  check('Bloqueado sem sala: só o tipo', bl.n === 'Bloqueado' && !bl.s, JSON.stringify(bl));

  // Agendamentos: paciente + reunião + treinamento; bloqueado fora
  check('lista: 3 linhas (bloqueado fora)', (await rows()) === 3, await rows());
  check('lista: Reunião Clínica aparece', await ev(`/Reunião Clínica/.test(document.getElementById("reg-agendamentos-host").textContent)`));
  check('lista: Treinamento aparece', await ev(`/Treinamento/.test(document.getElementById("reg-agendamentos-host").textContent)`));
  check('resumo: só 1 paciente (reunião/treinamento não são paciente)', await ev(`/Paciente Um/.test(document.getElementById("lgSum").textContent) && !/Pacientes/.test(document.getElementById("lgSum").textContent)`));
  check('resumo: 3 agendamentos', await ev(`/Agendamentos[\\s\\S]*?3/.test(document.getElementById("lgSum").textContent)`));
  check('reunião sem botão Status', await ev(`!document.querySelector('#reg-agendamentos-host tr[data-lg-id="m1"] [data-lg-st]')`));
  check('paciente com botão Status', await ev(`!!document.querySelector('#reg-agendamentos-host tr[data-lg-id="p1"] [data-lg-st]')`));
  await ev(`(function(){ var s = document.getElementById("lgStatus"); s.value = "__sem"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro Sem Status não traz reunião/treinamento', (await rows()) === 0, await rows());
  await ev(`(function(){ var s = document.getElementById("lgStatus"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  await ev(`document.getElementById("lgMenuBtn").click(); document.querySelector('#lgMenu [data-lg-act="manage"]').click()`);
  await page.waitForTimeout(300);
  check('Gerenciar Status lista só o paciente', (await ev(`document.querySelectorAll("#ovLgManage [data-lgm]").length`)) === 1);

  // Relatórios
  const lista = await ev(`(function(){ var r = RP_BUILDERS.lista(Object.keys(window.__db.appointments).map(function(k){ return window.__db.appointments[k]; }), {}); return r.sections[0].rows.map(function(x){ return [x[2], x[6]]; }); })()`);
  check('Lista: 3 linhas (sem Bloqueado)', lista.length === 3, JSON.stringify(lista));
  check('Lista: reunião com status —', lista.some(x => x[0] === 'Reunião Clínica' && x[1] === '—'));
  const prod = await ev(`(function(){ var r = RP_BUILDERS.produtividade(window.__db.appointments, {}); return r.sections[0].rows[0]; })()`);
  check('Produtividade: Agendados = 3', prod[1] === 3, JSON.stringify(prod));
  check('Produtividade: Em Aberto = 0 (reunião não é pendência)', prod[prod.length - 3] === 0, JSON.stringify(prod));
  check('Produtividade: Comparecimento 100%', /100/.test(String(prod[prod.length - 2])), prod[prod.length - 2]);
  const filt = await ev(`(function(){ var r = RP_BUILDERS.lista(window.__db.appointments, {status: "finalizado"}); return r.sections[0].rows.length; })()`);
  check('Lista com filtro de status: só o paciente', filt === 1, filt);

  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
