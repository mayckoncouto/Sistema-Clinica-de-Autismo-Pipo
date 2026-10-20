// Histórico de Alterações (Planner e Agenda): janela no formato da Caixa de Entrada, grupos em lote, filtros, lidas e restaurar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ha.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await ev(`(function(){
    var now = Date.now(), L = [];
    function r(id, mins, user, acao, pac, extra){ L.push(Object.assign({id: id, at: new Date(now - mins * 60000).toISOString(), user_id: user, user_name: user === "u-me" ? "Eu" : "Fulana", acao: acao, tipo: "atendimento", paciente: pac, quando: "seg-1", hora: "08:00", sala_id: null, prof_id: null, ref: "seg-1#08:00|r|s" + id, antes: null, depois: {patient: pac}, lote: "t" + id, lida: user === "u-me"}, extra || {})); }
    r(1, 5, "u-other", "excluiu", "Paciente Um", {antes: {patient: "Paciente Um"}, depois: null});
    for (var k = 2; k <= 13; k++) r(k, 30, "u-other", "criou", "Lote " + k, {lote: "lote1"});
    r(20, 40, "u-me", "criou", "Minha Alteração");
    r(21, 50, "u-other", "status", "Paciente Um", {antes: {status: ""}, depois: {status: "finalizado"}});
    r(22, 60, "u-other", "alterou", "Bruno Verde", {antes: {patient: "Bruno Verde", note: "a"}, depois: {patient: "Bruno Verde", note: "b"}});
    HA.mem.planner = L;
    window.__crmMeOrig = crmMe; crmMe = function(){ return "u-me"; };
  })()`);
  await page.evaluate(() => { document.getElementById('plToolsBtn').click(); });
  check('botão no menu do Planner', await ev(`!document.getElementById("plHistBtn").hidden`));
  await page.evaluate(() => document.getElementById('plHistBtn').click());
  await page.waitForTimeout(300);
  check('janela abriu', await ev(`!!document.getElementById("ovHa")`));
  // Principal: exclusão (1) + lote de 12 criações (1 linha) + alteração; sem as minhas e sem status
  check('principal agrupa o lote', await ev(`document.querySelectorAll("#haHost tr[data-ha-i]").length`) === 3, await ev(`document.querySelectorAll("#haHost tr[data-ha-i]").length`));
  check('etiqueta em lote', await ev(`document.getElementById("haHost").textContent.indexOf("em lote") !== -1`));
  check('contador Principal', await ev(`document.getElementById("haN-principal").textContent`) === '3');
  check('resumo conta ações', await ev(`/12 criadas/.test(document.getElementById("haSum").textContent) || /13 criadas/.test(document.getElementById("haSum").textContent)`));
  // histórico mostra tudo, inclusive status e as minhas
  await ev(`document.querySelector('#haTabs [data-ha="historico"]').click()`);
  check('histórico tem status', await ev(`document.getElementById("haHost").textContent.indexOf("Status de") !== -1`));
  check('histórico tem as minhas', await ev(`document.getElementById("haHost").textContent.indexOf("Minha Alteração") !== -1`));
  // filtro por ação
  await ev(`(function(){ var s = document.getElementById("haAcao"); s.value = "excluiu"; s.dispatchEvent(new Event("change")); })()`);
  check('filtro excluiu', await ev(`document.querySelectorAll("#haHost tr[data-ha-i]").length`) === 1);
  await ev(`(function(){ var s = document.getElementById("haAcao"); s.value = ""; s.dispatchEvent(new Event("change")); })()`);
  // marcar como lida
  await ev(`document.querySelector('#haTabs [data-ha="principal"]').click()`);
  await ev(`document.querySelector('#haHost tr[data-ha-i="0"] [data-ha-act="read"]').click()`);
  await page.waitForTimeout(200);
  check('marcar lida reduz a principal', await ev(`document.getElementById("haN-principal").textContent`) === '2');
  await ev(`document.querySelector('#haTabs [data-ha="lidas"]').click()`);
  check('lidas tem 1 (e não as minhas)', await ev(`document.querySelectorAll("#haHost tr[data-ha-i]").length`) === 1);
  await ev(`document.querySelector('#haHost [data-ha-act="unread"]').click()`);
  await page.waitForTimeout(200);
  check('voltar à principal', await ev(`document.getElementById("haN-principal").textContent`) === '3');
  // detalhes
  await ev(`document.querySelector('#haTabs [data-ha="principal"]').click()`);
  await ev(`document.querySelector('#haHost [data-ha-act="det"]').click()`);
  check('detalhes abre', await ev(`!!document.getElementById("ovHaDet")`));
  await ev(`document.querySelector("#ovHaDet [data-hdclose]").click()`);
  // restaurar (Planner): chamada com o antes
  await ev(`(function(){ window.__applied = null; applyBookingChanges = function(ch){ window.__applied = ch; return Promise.resolve(true); }; })()`);
  await ev(`document.querySelector('#haTabs [data-ha="historico"]').click()`);
  console.log(await ev(`JSON.stringify([can("planner","create"), HA.tab, document.querySelectorAll("#haHost [data-ha-act=restore]").length])`));
  await ev(`(function(){ var tr = Array.prototype.filter.call(document.querySelectorAll("#haHost tr[data-ha-i]"), function(t){ return t.textContent.indexOf("Paciente Um") !== -1 && t.textContent.indexOf("Excluiu") !== -1; })[0]; tr.querySelector('[data-ha-act="restore"]').click(); })()`);
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.getElementById('cfOk'); if (b) b.click(); });
  await page.waitForTimeout(400);
  console.log(await ev(`(document.getElementById('toastHost')||{}).textContent`), await ev(`!!document.getElementById('cfOk')`));
  const applied = await ev(`JSON.stringify(window.__applied)`);
  check('restaurar grava o antes', applied && applied.indexOf('Paciente Um') !== -1, applied);
  // restaurar só um dia (grupo com dois dias e uma reunião)
  await ev(`(function(){ window.__applied = null; var it = function(id, q, tipo, pac){ return {id: id, at: new Date().toISOString(), area: "planner", user_name: "Fulana", acao: "excluiu", tipo: tipo, paciente: pac, quando: q, hora: "08:00", ref: "schedule/" + q + "#08:00|r|s" + id, antes: {patient: pac}, depois: null}; };
    haDetails({items: [it(201, "seg-3", "atendimento", "Ana"), it(202, "seg-3", "reuniao", "Reunião Clínica"), it(203, "ter-3", "atendimento", "Bia")], user_name: "Fulana", acao: "excluiu", at: new Date().toISOString()}); })()`);
  check('detalhes: opção restaurar só um dia', await ev(`!!document.getElementById("hdDayGo") && document.querySelectorAll("#hdDay option").length === 2`));
  await ev(`(function(){ var s = document.getElementById("hdDay"); s.value = "seg-3"; s.dispatchEvent(new Event("change")); document.getElementById("hdDayPat").checked = true; document.getElementById("hdDayGo").click(); })()`);
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.getElementById('cfOk'); if (b) b.click(); });
  await page.waitForTimeout(400);
  const day1 = await ev(`JSON.stringify(window.__applied)`);
  check('restaura só o dia escolhido, só pacientes', day1 && day1.indexOf('Ana') !== -1 && day1.indexOf('Bia') === -1 && day1.indexOf('Reuni') === -1 && day1.indexOf('ter-3') === -1, day1);
  // contador de não lidas
  await ev(`haBadgeRefresh(true)`);
  check('contador do Planner (14 não lidas)', await ev(`HA_BADGE.planner`) === 14, await ev(`HA_BADGE.planner`));
  check('botão Histórico mostra o contador', /\(14\)/.test(await ev(`document.getElementById("plHistBtn").textContent`)));
  check('botão Outras Opções ganha o número', await ev(`!!document.querySelector("#plToolsBtn [data-ha-badge]")`));
  // histórico por paciente (Planner + Agenda)
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = ""; HA.mem.agenda = [{id: 100, at: new Date().toISOString(), user_id: "u-other", user_name: "Fulana", acao: "alterou", tipo: "atendimento", paciente: "Paciente Um", quando: "2030-01-07", hora: "08:00", sala_id: null, prof_id: null, ref: "a1", antes: {patient: "Paciente Um", note: "a"}, depois: {patient: "Paciente Um", note: "b"}, lote: "x", lida: false}]; openHistoricoAlteracoes("ambas", {paciente: "Paciente Um"}); })()`);
  await page.waitForTimeout(300);
  const pt = await ev(`Array.prototype.map.call(document.querySelectorAll("#haHost tr[data-ha-i]"), function(t){ return t.textContent; }).join("|")`);
  check('paciente: traz Planner e Agenda só dele', /Planner/.test(pt) && /Agenda/.test(pt) && pt.indexOf('Bruno Verde') === -1, pt.slice(0, 200));
  // comparar semanas
  await ev(`document.getElementById("haMenuBtn").click()`);
  await ev(`document.querySelector('.cx-menu [data-pick="cmp"], [data-pick="cmp"]').click()`);
  await page.waitForTimeout(200);
  check('comparar semanas abre com tabela', await ev(`!!document.getElementById("ovHaCmp") && document.querySelectorAll("#hcOut table").length >= 1`));
  check('comparar: semana A tem lançamentos', await ev(`document.getElementById("hcOut").textContent.indexOf("Excluídos") !== -1`));
  check('sem erros de script', errors.length === 0, errors.join('|'));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  console.log(fails ? 'FALHOU: ' + fails : 'OK');
  process.exit(fails ? 1 : 0);
})();
