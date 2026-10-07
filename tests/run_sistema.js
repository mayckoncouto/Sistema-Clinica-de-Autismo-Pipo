// Acesso → Sistema: regras com chave (Bloquear / Avisar / Desligado), histórico e
// restaurar padrão; plannerConflict / agdConflictIn e a grade seguem a chave.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_sys.html');
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

  // Janela: grupos, chaves, regras travadas.
  await page.evaluate(() => window.pipoOpenSystem());
  await page.waitForSelector('#ovSys');
  const ui = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('#ovSys .sys-group h4')].map((h) => h.textContent),
    seg: [...document.querySelectorAll('[data-rule="pl_nao_aba"] [data-mode]')].map((b) => b.textContent),
    locked: !!document.querySelector('[data-rule="tr_um_ativo"] .sys-lock') && !document.querySelector('[data-rule="tr_um_ativo"] [data-mode]')
  }));
  check('window lists groups, 3-way switch and locked rules?', ui.groups.join('|') === 'Planner|Agenda|Pacientes|Tratamentos|Plano Terapêutico' && ui.seg.join('|') === 'Bloquear|Avisar|Desligado' && ui.locked, JSON.stringify(ui));
  await page.fill('#sysSearch', 'feriado');
  const found = await page.$$eval('#sysBody .sys-rule', (r) => r.map((x) => x.getAttribute('data-rule')));
  check('search filters rules?', found.join() === 'ag_feriado', found.join());
  await page.fill('#sysSearch', '');

  // Desligar "não ABA" do Planner e salvar → histórico.
  await page.click('[data-sys="pl_nao_aba"][data-mode="off"]');
  await page.click('[data-sys="pl_prof_dois"][data-mode="warn"]');
  await page.click('#sysSave');
  await page.waitForTimeout(200);
  const saved = await ev(`JSON.stringify([sysMode("pl_nao_aba"), sysMode("pl_prof_dois"), window.__STORE__["config/system"]])`);
  const sv = JSON.parse(saved);
  check('saved modes and history?', sv[0] === 'off' && sv[1] === 'warn' && sv[2].rules.pl_nao_aba === 'off' && sv[2].historico.length === 2, saved);

  // Regras no Planner.
  const pl = await ev(`(function(){
    var out = {}, d = state.scheduleDocs["seg-1"] = state.scheduleDocs["seg-1"] || {bookings: {}};
    d.bookings["09:20|r1|r1-t1"] = {patient: "Duda Vermelho", note: "", service: "sessao"};
    out.abaOff = plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "sessao"});
    renderGrid();
    var td = document.querySelector('table.sched[data-doc="seg-1"] td.slotcell[data-key="09:20|r1|r1-t2"]');
    out.cellFree = !!td && !td.classList.contains("slot-off");
    state.sysRules = {pl_nao_aba: "block"};
    out.abaBlock = typeof plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "sessao"});
    state.sysRules = {pl_nao_aba: "warn"};
    var w = plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "sessao"});
    out.abaWarn = !!(w && w.warn && /ABA/.test(w.msg));
    out.batch = sysHard(w);
    delete d.bookings["09:20|r1|r1-t1"];
    state.sysRules = {pl_fora_prof: "off"}; out.seatOff = seatAvailable({professionalId: "ana-terapeuta"}, "seg", "03:00");
    state.sysRules = {}; out.seatOn = seatAvailable({professionalId: "ana-terapeuta"}, "seg", "03:00");
    return out;
  })()`);
  check('Planner: rule off = no conflict and free cell?', pl.abaOff === null && pl.cellFree, JSON.stringify(pl));
  check('Planner: block = text, warn = {warn} (batch ignores warn)?', pl.abaBlock === 'string' && pl.abaWarn && pl.batch === null);

  // Agenda.
  const ag = await ev(`(function(){
    var out = {}, rows = [{id: "o1", date: "2030-01-07", time: "08:00", professional_id: "ana-terapeuta", room_id: "r1", patient: "Duda Vermelho", service: "sessao"}];
    var rec = {date: "2030-01-07", time: "08:00", professional_id: "bia-terapeuta", room_id: "r1", patient: "Bruno Verde", service: "sessao"};
    state.sysRules = {}; out.block = typeof agdConflictIn(rows, rec);
    state.sysRules = {ag_nao_aba: "warn"}; var w = agdConflictIn(rows, rec); out.warn = !!(w && w.warn);
    state.sysRules = {ag_nao_aba: "off"}; out.off = agdConflictIn(rows, rec);
    state.sysRules = {ag_final_terapeuta: "off"}; window.__planProfId = "ana-terapeuta"; out.finalOff = agdFinalLocked(FINAL_STATUS);
    state.sysRules = {}; out.finalOn = agdFinalLocked(FINAL_STATUS); delete window.__planProfId;
    return out;
  })()`);
  check('Agenda: block / warn / off on não ABA?', ag.block === 'string' && ag.warn && ag.off === null, JSON.stringify(ag));
  check('Agenda: Finalizado travado follows the switch?', ag.finalOff === false && ag.finalOn === true);

  // sysGate: bloquear recusa, desligado segue.
  const gate = await ev(`(function(){
    state.sysRules = {ag_feriado: "block"};
    return sysGate("ag_feriado", "Feriado", ["x"]).then(function(a){
      state.sysRules = {ag_feriado: "off"};
      return sysGate("ag_feriado", "Feriado", ["x"]).then(function(b){ state.sysRules = {}; return [a, b]; });
    });
  })()`);
  check('sysGate: block refuses, off passes?', gate[0] === false && gate[1] === true, JSON.stringify(gate));

  // Avisar na janela do agendamento: pergunta e, confirmando, grava.
  await ev(`(function(){ state.sysRules = {pl_nao_aba: "warn"}; var d = state.scheduleDocs["seg-1"]; d.bookings["09:20|r1|r1-t1"] = {patient: "Duda Vermelho", note: "", service: "sessao"}; renderGrid();
    openBookingModal({docId: "seg-1", key: "09:20|r1|r1-t2", dayKey: "seg", week: 1, time: "09:20", roomId: "r1", therapistId: "r1-t2"}); })()`);
  await page.waitForSelector('#bkPatient');
  await page.fill('#bkPatient', 'Bruno Verde');
  await page.click('#bkSave');
  await page.waitForSelector('#ovConfirm', {timeout: 3000}).catch(() => {});
  const asked = await page.$eval('#ovConfirm .confirm-msg', (e) => e.textContent).catch(() => '');
  await page.click('#cfOk').catch(() => {});
  await page.waitForTimeout(300);
  const wrote = await ev(`(state.scheduleDocs["seg-1"].bookings["09:20|r1|r1-t2"] || {}).patient || ""`);
  check('Planner window in Avisar mode asks and then saves?', /ABA/.test(asked) && wrote === 'Bruno Verde', JSON.stringify([asked.slice(0, 60), wrote]));
  await ev(`(function(){ var d = state.scheduleDocs["seg-1"]; delete d.bookings["09:20|r1|r1-t1"]; delete d.bookings["09:20|r1|r1-t2"]; state.sysRules = {}; document.querySelectorAll(".overlay").forEach(function(o){ o.remove(); }); })()`);

  // Restaurar tudo.
  await ev(`state.sysRules = {pl_nao_aba: "off"}`);
  await page.evaluate(() => window.pipoOpenSystem());
  await page.waitForSelector('#ovSys');
  const chg = await page.$$eval('#sysBody .sys-changed', (x) => x.length);
  await page.click('#sysResetAll'); await page.click('#cfOk'); await page.waitForTimeout(100);
  const chg2 = await page.$$eval('#sysBody .sys-changed', (x) => x.length);
  await page.click('[data-view="hist"]');
  const histRows = await page.$$eval('#sysHist tbody tr', (x) => x.length);
  check('"alterada" tag, Restaurar tudo and history tab?', chg === 1 && chg2 === 0 && histRows === 2, JSON.stringify([chg, chg2, histRows]));
  await page.click('#sysCancel');

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
