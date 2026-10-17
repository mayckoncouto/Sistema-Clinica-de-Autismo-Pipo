// Tipo de Tratamento × especialidade do agendamento: aviso (Multidisciplinar libera, serviço é livre,
// tipo de serviço avisa Sessão de especialidade) e inclusão automática dos quadros ao marcar o tipo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_tipo.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  const pat = await ev('state.patients[0].nome'), pid = await ev('state.patients[0].id');
  const prof = JSON.parse(await ev('JSON.stringify(state.professionals.filter(function(p){ return p.specialtyId; })[0])'));
  await ev('state.specialties = state.specialties.concat([{id: "nutri", name: "Nutrição"}]); 0');
  const otherSpec = await ev('state.specialties.filter(function(s){ return profAreas(findProfessional(' + JSON.stringify(prof.id) + ')).indexOf(s.id) === -1; })[0].id');
  await ev('state.services = state.services.concat([{id: "triagem", name: "Triagem"}]); 0');
  const svcId = 'triagem';
  const setTipos = (tipos) => ev('state.treatments = [{id: "tx", patientId: ' + JSON.stringify(pid) + ', status: "ativo", inicio: "2026-01-01", tipos: ' + JSON.stringify(tipos) + '}]; _patAt = {p: null, t: null, map: {}}; 0');
  const msg = (service) => ev('treatTypeMismatchMsg(' + JSON.stringify(pat) + ', ' + JSON.stringify(prof.id) + ', ' + JSON.stringify(service || null) + ')');

  await setTipos([]);
  check('sem tipo marcado não avisa?', (await msg()) === null);
  await setTipos(['multidisciplinar']);
  check('Multidisciplinar libera todas as especialidades?', (await msg()) === null);
  await setTipos(['spec:' + prof.specialtyId]);
  check('tipo = especialidade do profissional não avisa?', (await msg()) === null);
  await setTipos(['spec:' + otherSpec]);
  const m4 = await msg(); check('tipo = outra especialidade avisa?', /não atende nenhuma especialidade do tipo/.test(m4), m4);
  check('serviço diferente de Sessão nunca avisa?', (await msg(svcId)) === null);
  await setTipos(['svc:' + svcId]);
  check('tipo só de serviço + Sessão de especialidade avisa?', /Sessão é de uma especialidade/.test(await msg()));
  check('tipo só de serviço + serviço não avisa?', (await msg(svcId)) === null);
  await setTipos(['svc:' + svcId, 'multidisciplinar']);
  check('serviço + Multidisciplinar não avisa?', (await msg()) === null);
  await setTipos(['svc:' + svcId, 'spec:' + prof.specialtyId]);
  check('serviço + a especialidade dele não avisa?', (await msg()) === null);

  // Regra do Sistema: Desligado não avisa, e a chave existe nos dois lados
  check('regras do Sistema existem (padrão Avisar)?', (await ev('sysMode("pl_tipo_trat") + "|" + sysMode("ag_tipo_trat")')) === 'warn|warn');

  // Planner: aviso aparece ao gravar; "Agendar assim mesmo" grava
  await setTipos(['spec:' + otherSpec]);
  const room = await ev('state.rooms.filter(function(r){ return !isGroup(r) && r.therapists && r.therapists.some(function(t){ return t.professionalId === ' + JSON.stringify(prof.id) + '; }); })[0]');
  const th = room.therapists.filter((t) => t.professionalId === prof.id)[0];
  const key = '09:20|' + room.id + '|' + th.id;
  const done = page.evaluate((a) => window.__ev('applyBookingChanges({"seg-1": {' + JSON.stringify(a.key) + ': {patient: ' + JSON.stringify(a.pat) + ', patientId: ' + JSON.stringify(a.pid) + ', note: ""}}}, {noHistory: true, patientHoursOk: true, routineOk: true, therapistOk: true, areaOk: true})'), { key, pat, pid });
  await page.waitForSelector('#ovConfirm', { timeout: 4000 }).catch(() => {});
  check('Planner abre o aviso Especialidade Fora do Tipo de Tratamento?', /Fora do Tipo de Tratamento/.test(await page.textContent('#ovConfirm').catch(() => '')));
  await page.click('#ovConfirm button:has-text("Agendar Assim Mesmo")').catch(() => {});
  await done;
  check('confirmando, o agendamento é gravado?', await ev('!!(state.scheduleDocs["seg-1"] && state.scheduleDocs["seg-1"].bookings[' + JSON.stringify(key) + '])'));

  // Tratamento: marcar o tipo inclui os quadros
  await ev('state.treatments = []; _patAt = {p: null, t: null, map: {}}; 0');
  await ev('openTreatmentModal(null, {patientId: ' + JSON.stringify(pid) + '})'); await page.waitForSelector('#ovTreat');
  const quadros = () => page.$$eval('#specRowsHost .tl-row', (r) => r.length);
  const n0 = await quadros();
  await page.click('#trTiposMs .ms-btn');
  const opt = (v) => page.$('#trTipos input[value="' + v + '"]');
  const isOn = async (v) => (await opt(v)).isChecked();
  if (await isOn('multidisciplinar')) await page.uncheck('#trTipos input[value="multidisciplinar"]');
  check('desmarcar o tipo não mexe nos quadros?', (await quadros()) === n0);
  await page.check('#trTipos input[value="multidisciplinar"]');
  const nAll = await ev('activeOnly(state.specialties).filter(function(sp){ return !/aplicador/.test(normText(sp.name || "")); }).length');
  check('Multidisciplinar inclui todas as especialidades (menos Aplicador ABA)?', (await quadros()) === n0 + nAll - 0 || (await quadros()) === nAll, [n0, nAll, await quadros()]);
  const nAfter = await quadros();
  await page.uncheck('#trTipos input[value="multidisciplinar"]'); await page.check('#trTipos input[value="multidisciplinar"]');
  check('marcar de novo não duplica os quadros?', (await quadros()) === nAfter);
  // Quadro: salvar Sessão de especialidade fora do tipo avisa; serviço diferente de Sessão não
  check('tipoLineMsg: fora do tipo avisa, dentro não, Multidisciplinar não, serviço não?',
    (await ev('tipoLineMsg(["spec:fono"], "psico", "sessao")')) && (await ev('tipoLineMsg(["spec:fono"], "fono", "sessao")')) === null &&
    (await ev('tipoLineMsg(["multidisciplinar"], "psico", "sessao")')) === null && (await ev('tipoLineMsg(["spec:fono"], "psico", "triagem")')) === null);
  check('tipo só de serviço + quadro de Sessão da especialidade avisa?', /serviço/.test(await ev('tipoLineMsg(["svc:triagem"], "psico", "sessao")')));
  await page.uncheck('#trTipos input[value="multidisciplinar"]'); await page.check('#trTipos input[value="spec:fono"]');
  await page.click('#specRowAdd'); await page.waitForSelector('#tlSave');
  await ev('(function(){ var s = document.getElementById("tlSpec"); s.value = "psico"; s.dispatchEvent(new Event("change", {bubbles: true})); document.getElementById("tlHours").value = "2"; return 0; })()');
  await page.click('#tlSave'); await page.waitForSelector('#ovConfirm');
  check('salvar quadro de especialidade fora do tipo abre o aviso?', /não está no Tipo de Tratamento/.test(await page.textContent('#ovConfirm')));
  await page.click('#ovConfirm button:has-text("Salvar Assim Mesmo")'); await page.waitForTimeout(300);
  await page.click('#trCancel').catch(() => {});

  check('sem erros de JS?', errors.length === 0, errors.slice(0, 3));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
