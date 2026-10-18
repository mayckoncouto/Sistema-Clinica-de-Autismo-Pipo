// Agenda ▾ → Agendamentos: lista, resumo, filtros, alertas, exportar e Ver na Agenda.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_lg.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
    state.statuses = [{id: "finalizado", name: "Finalizado", color: "#2e7d32"}, {id: "nao-compareceu", name: "Não compareceu", color: "#c62828"}, {id: "falta-justificada", name: "Falta justificada", color: "#f9a825"}];
    window.__db = db;
    function a(id, date, time, prof, patient, extra){ db.appointments.push(Object.assign({id: id, date: date, time: time, professional_id: prof, room_id: "r1", patient: patient, note: "", blocked: false, service: "sessao", status: null}, extra || {})); }
    a("a1", "2030-01-07", "08:00", "ana-terapeuta", "Paciente Um");
    a("a2", "2030-01-07", "08:40", "ana-terapeuta", "Bruno Verde", {status: "finalizado"});
    a("a3", "2030-01-08", "08:00", "ana-terapeuta", "Bruno Verde", {status: "nao-compareceu"});
    a("a4", "2030-01-08", "09:20", "ana-terapeuta", "Bloqueado", {blocked: true, service: null});
    a("a5", "2030-01-09", "08:00", "bia-terapeuta", "Ana Azul", {status: "nao-compareceu"});
    a("a6", "2030-01-10", "08:00", "ana-terapeuta", "Bruno Verde", {status: "falta-justificada"});
    LG.per = "custom"; LG.from = "2030-01-01"; LG.to = "2030-01-31";
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(function(b){ if (b.getAttribute("data-tab") === "agendamentos") b.click(); });
  })()`);
  await page.waitForTimeout(600);
  const rows = () => ev(`document.querySelectorAll("#reg-agendamentos-host tr[data-lg-id]").length`);
  check('menu Agenda tem Agendamentos', await ev(`AG_ITEMS.some(function(i){ return i.key === "agendamentos"; })`));
  check('título', await ev(`!!document.querySelector("#tab-agendamentos .cad-title")`));
  check('5 linhas de paciente (bloqueio fora)', (await rows()) === 5, await rows());
  check('resumo mostra 3 pacientes', await ev(`/Pacientes[\\s\\S]*3/.test(document.getElementById("lgSum").textContent)`));
  check('alerta de 2+ faltas', await ev(`!!document.querySelector('[data-lg-alert="faltas"]')`));
  await ev(`document.querySelector('[data-lg-alert="faltas"]').click()`);
  check('alerta filtra Bruno (3 linhas)', (await rows()) === 3, await rows());
  await ev(`document.querySelector('[data-lg-alert=""]').click()`);
  await ev(`(function(){ var q = document.getElementById("lgQ"); q.value = "bruno"; q.dispatchEvent(new Event("input")); })()`);
  await new Promise(function(r){ setTimeout(r, 300); });
  check('busca por paciente', (await rows()) === 3, await rows());
  check('resumo de um paciente (Próximo/Último)', await ev(`/Próximo Atendimento/.test(document.getElementById("lgSum").textContent)`));
  await ev(`(function(){ var q = document.getElementById("lgQ"); q.value = ""; q.dispatchEvent(new Event("input")); })()`);
  await new Promise(function(r){ setTimeout(r, 300); });
  await ev(`(function(){ var s = document.getElementById("lgStatus"); s.value = "__sem"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro Sem Status', (await rows()) === 1, await rows());
  await ev(`(function(){ var s = document.getElementById("lgStatus"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  await ev(`(function(){ var s = document.getElementById("lgSvc"); s.value = "sessao"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro Serviço Sessão não tem reunião', (await ev(`LG.last.every(function(r){ return !bookingKind(r); })`)) === true);
  await ev(`(function(){ var s = document.getElementById("lgSvc"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  check('CSV tem 5 linhas', (await ev(`LG.last.length`)) === 5);
  await ev(`document.getElementById("lgMenuBtn").click()`);
  check('Outras Opções tem Gerenciar Status', await ev(`!!document.querySelector('#lgMenu [data-lg-act="manage"]')`));
  await ev(`document.querySelector('#lgMenu [data-lg-act="manage"]').click()`);
  await page.waitForTimeout(300);
  check('janela Gerenciar Status abre', await ev(`!!document.getElementById("ovLgManage")`));
  check('janela lista os 5 atendimentos', (await ev(`document.querySelectorAll("#ovLgManage [data-lgm]").length`)) === 5);
  check('lista de status sem Finalizado', await ev(`!Array.prototype.some.call(document.querySelectorAll("#lgmSt option"), function(o){ return o.value === "finalizado"; })`));
  await ev(`document.querySelector('#ovLgManage [data-lgm="a1"]').click(); document.querySelector('#ovLgManage [data-lgm="a1"]').dispatchEvent(new Event("change", {bubbles: true}))`);
  check('botão Aplicar habilita', await ev(`!document.getElementById("lgmGo").disabled`));
  await ev(`document.querySelector('#ovLgManage [data-tclose]').click()`);
  await page.waitForTimeout(200);
  await ev(`document.querySelector('#reg-agendamentos-host tr[data-lg-id="a1"]').click()`);
  await page.waitForTimeout(300);
  check('abre os Detalhes', await ev(`!!document.getElementById("ovAgdDet")`));
  check('botão Ver na Agenda nos Detalhes', await ev(`!!document.getElementById("agdDetGo")`));
  await ev(`document.getElementById("agdDetGo").click()`);
  await page.waitForTimeout(800);
  check('foi para a Agenda', (await ev(`state.tab`)) === 'agenda');
  check('data da Agenda = dia do atendimento', await ev(`agdIso(AD.date) === "2030-01-07"`));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
