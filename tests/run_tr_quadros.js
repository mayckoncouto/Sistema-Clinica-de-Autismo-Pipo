// Tratamento: especialidades em quadros (2026-10-10). Um quadro por linha (especialidade, sessões/mês,
// profissional, ABA, serviço, dia, horário, semanas, sala, seguidas, observação). A mesma especialidade
// pode repetir com outro profissional ou serviço; cada atendimento conta para o quadro certo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const TL = require('./tl-helper');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_trq.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // 1. Ligar o atendimento ao quadro certo (Psicologia com Ana no Acolhimento + Psicologia Sessão com "Todos").
  const m = await ev(`(function(){
    state.services = [{id: "sessao", name: "Sessão"}, {id: "acolh", name: "Acolhimento familiar"}];
    var lines = treatLines([{id: "a", specId: "psico", hours: 1, profId: "ana-terapeuta", service: "acolh"},
      {id: "b", specId: "psico", hours: 1, service: "sessao"}, {id: "c", specId: "fono", hours: 2, profId: "bia-terapeuta"}]);
    function k(prof, svc){ var r = treatLineFor(lines, prof, svc); return r ? r.id : "-"; }
    return [k("ana-terapeuta", "acolh"), k("andrelisa-terapeuta", "sessao"), k("ana-terapeuta", "sessao"), k("bia-terapeuta", "sessao"), k("andrelisa-terapeuta", "acolh"), k("ana-terapeuta", "triagem")].join(",");
  })()`);
  check('each appointment goes to the right card (service, specialty, therapist)?', m === 'a,b,b,c,a,-', m);
  const tm = await ev(`(function(){
    var pat = state.patientsRaw[0];
    state.treatments = [{id: "tq", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", aba: "Sim",
      specHours: [{id: "a", specId: "psico", hours: 1, profId: "ana-terapeuta", service: "acolh", aba: "Não"}, {id: "b", specId: "psico", hours: 1, service: "sessao", aba: "Sim"}]}];
    rebuildPatients();
    var n = pat.nome, p = findPatientByName(n);
    return {acolOther: !!therapistMismatchMsg(n, "andrelisa-terapeuta", "acolh"), acolAna: !!therapistMismatchMsg(n, "ana-terapeuta", "acolh"),
      sess: !!therapistMismatchMsg(n, "andrelisa-terapeuta", "sessao"), abaAcol: bookingAbaOf(p, "ana-terapeuta", "acolh"), abaSess: bookingAbaOf(p, "ana-terapeuta", "sessao")};
  })()`);
  check('therapist warning only for the card with a set therapist?', tm.acolOther && !tm.acolAna && !tm.sess, JSON.stringify(tm));
  check('ABA comes from the matching card?', tm.abaAcol === 'Não' && tm.abaSess === 'Sim', JSON.stringify(tm));
  const lockR = await ev(`(function(){
    var old = [{id: "a", specId: "psico", hours: 4, service: "acolh"}, {id: "b", specId: "fono", hours: 4}];
    return {add: trLinesLockOk(old, old.concat([{id: "n", specId: "to", hours: 2}])),
      redist: trLinesLockOk(old, [{id: "a", specId: "psico", hours: 2, service: "acolh"}, {id: "b", specId: "fono", hours: 6}]),
      redistNew: trLinesLockOk(old, [{id: "a", specId: "psico", hours: 4, service: "acolh"}, {id: "b", specId: "fono", hours: 2}, {id: "n", specId: "to", hours: 2}]),
      moreTotal: trLinesLockOk(old, [{id: "a", specId: "psico", hours: 5, service: "acolh"}, {id: "b", specId: "fono", hours: 4}]),
      changedSpec: trLinesLockOk(old, [{id: "a", specId: "to", hours: 4, service: "acolh"}, {id: "b", specId: "fono", hours: 4}]),
      changedSvc: trLinesLockOk(old, [{id: "a", specId: "psico", hours: 4}, {id: "b", specId: "fono", hours: 4}]),
      removed: trLinesLockOk(old, [old[1]]), changedFlag: trLinesHoursChanged(old, [{id: "a", specId: "psico", hours: 2}, {id: "b", specId: "fono", hours: 6}])};
  })()`);
  check('lock: new card ok; sessions redistributed with the same sum ok (also into a new card); other changes refused?',
    lockR.add && lockR.redist && lockR.redistNew && !lockR.moreTotal && !lockR.changedSpec && !lockR.changedSvc && !lockR.removed && lockR.changedFlag, JSON.stringify(lockR));

  // 2. Janela: quadros com o visual das salas, observação só fora de Sessão, avisos, gravação.
  await ev(`(function(){ state.treatments = []; rebuildPatients(); openTreatmentModal(null, {patientId: state.patientsRaw[0].id}); })()`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(200);
  await page.$eval('#pPac', (x) => { x.value = '2'; x.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.click('#specRowAdd'); await page.waitForSelector('#ovTLine');
  const labels = await page.$$eval('#ovTLine .field label', (a) => a.filter((l) => l.offsetParent).map((l) => l.textContent.trim()));
  check('card window: all fields, Observação hidden with Sessão?', labels.join('|') === 'Especialidade|Sessões/mês|Serviço|Profissional|ABA|Sala|Dia|Horário de início|Semanas|Sessões seguidas', labels.join('|'));
  await page.$eval('#tlSvc', (x) => { x.value = 'acolh'; x.dispatchEvent(new Event('change', {bubbles: true})); });
  check('Observação appears for another service?', await page.$eval('#tlObsBox', (b) => !b.hidden));
  await page.click('#tlCancel');
  // Quadro com dia fixo e 1ª e 3ª semanas, mas 4 sessões/mês → aviso
  await page.click('#specRowAdd'); await page.waitForSelector('#ovTLine');
  await page.evaluate(() => { function set(id, v){ const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }
    const sp = document.getElementById('tlSpec'); set('tlSpec', [...sp.options].find((o) => o.textContent === 'Psicologia').value);
    document.getElementById('tlHours').value = '4'; set('tlSvc', 'acolh'); set('tlProf', 'ana-terapeuta'); set('tlDia', 'qui'); set('tlHora', '08:00'); set('tlSem', '1,3');
    document.getElementById('tlObs').value = 'Acolhimento pais'; });
  await page.click('#tlSave'); await page.waitForTimeout(150);
  const warn = await page.$eval('#ovConfirm .confirm-msg', (e) => e.textContent).catch(() => '');
  check('warns: weeks × sessions/month do not match?', /dá 2 sessões\/mês, mas o quadro tem 4/.test(warn), warn);
  await page.click('#cfCancel'); await page.waitForTimeout(100);
  await page.fill('#tlHours', '2'); await page.click('#tlSave'); await page.waitForTimeout(150);
  if (await page.$('#cfOk')) { console.log('other warning:', await page.$eval('.confirm-msg', (e) => e.textContent)); await page.click('#cfOk'); await page.waitForTimeout(150); }
  await TL.addLine(page, {spec: 'Psicologia', hours: 2});
  const cards = await TL.lines(page);
  check('two Psicologia cards (Acolhimento with Ana on Thursday 08:00, and Sessão)?', cards.length === 2 && cards[0].name === 'Psicologia · Acolhimento familiar' && /Ana/.test(cards[0].sum) && /Quinta 08:00/.test(cards[0].sum) && /1ª e 3ª semanas/.test(cards[0].sum) && cards[1].name === 'Psicologia', JSON.stringify(cards));
  check('observação shown on the card?', /Acolhimento pais/.test(await page.textContent('#specRowsHost .tl-row')));
  check('sum Sessão/Mês × cards?', /Passou 2/.test(await page.textContent('#specSum')), await page.textContent('#specSum'));
  await page.$eval('#pPac', (x) => { x.value = '4'; x.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.click('#trSave'); await page.waitForTimeout(400);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(300); }
  const saved = await ev(`JSON.stringify((state.treatments.filter(function(t){ return t.patientId === state.patientsRaw[0].id; })[0] || {}).specHours)`);
  const sh = JSON.parse(saved || '[]');
  check('saved cards keep all fields (and no observação on Sessão)?', sh.length === 2 && sh[0].service === 'acolh' && sh[0].dia === 'qui' && sh[0].hora === '08:00' && sh[0].semanas === '1,3' && sh[0].profId === 'ana-terapeuta' && sh[0].obs === 'Acolhimento pais' && sh[1].service === 'sessao' && !sh[1].obs && sh.every((x) => x.id), saved);

  // 2b. Tratamento com atendimento realizado: redistribuir as sessões mantendo a soma.
  await ev(`(function(){ document.querySelectorAll(".overlay").forEach(function(o){ o.remove(); });
    var pat = state.patientsRaw[1];
    state.treatments = [{id: "tr2", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", aba: "Sim", vencPor: "sem", sessoesMes: "8",
      specHours: [{id: "a", specId: "psico", hours: "4", service: "sessao"}, {id: "b", specId: "fono", hours: "4", service: "sessao"}]}];
    rebuildPatients(); TR.done = {}; TR.done[pat.id] = ["2026-02-10"];
    openTreatmentModal(state.treatments[0]); })()`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(300);
  await TL.addLine(page, {hours: 2}, 0); await TL.addLine(page, {hours: 6}, 1);
  await page.click('#trSave'); await page.waitForTimeout(200);
  const rd = await page.$eval('#ovConfirm', (e) => e.textContent).catch(() => '');
  check('redistributing with the same sum asks to confirm (past months recalculated)?', /Redistribuir sessões/.test(rd) && /meses anteriores/.test(rd), rd.slice(0, 120));
  await page.click('#cfOk'); await page.waitForTimeout(400);
  const rdSaved = await ev(`JSON.stringify(state.treatments.filter(function(t){ return t.id === "tr2"; })[0].specHours.map(function(r){ return r.hours; }))`);
  check('redistribution saved?', rdSaved === '["2","6"]' && !(await page.$('#ovTreat')), rdSaved);
  await ev(`openTreatmentModal(state.treatments.filter(function(t){ return t.id === "tr2"; })[0])`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(300);
  await TL.addLine(page, {hours: 5}, 0);
  await page.click('#trSave'); await page.waitForTimeout(300);
  const still = await ev(`JSON.stringify(state.treatments.filter(function(t){ return t.id === "tr2"; })[0].specHours.map(function(r){ return r.hours; }))`);
  check('changing the sum is refused (window stays open)?', !!(await page.$('#ovTreat')) && still === '["2","6"]', still);
  await ev(`document.querySelectorAll(".overlay").forEach(function(o){ o.remove(); })`);

  // 3. Celular: quadros e janela cabem na tela.
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mPage = path.join(__dirname, 'page_trq_m.html');
  fs.writeFileSync(mPage, fs.readFileSync(evPage, 'utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">'));
  await mob.goto('file://' + mPage); await mob.waitForTimeout(800);
  await mob.evaluate(() => window.__ev(`state.treatments = [{id: "tm", patientId: state.patientsRaw[0].id, inicio: "2026-01-01", status: "ativo", tipo: "novo", aba: "Sim", specHours: [{id: "a", specId: "psico", hours: 2, service: "sessao", dia: "seg", hora: "08:00"}]}]; rebuildPatients(); openTreatmentModal(state.treatments[0])`));
  await mob.waitForSelector('#ovTreat'); await mob.waitForTimeout(200);
  await mob.click('[data-tl-edit="0"]'); await mob.waitForSelector('#ovTLine');
  check('mobile: card window fits the screen?', await mob.evaluate(() => document.documentElement.scrollWidth <= 390 && document.querySelector('#ovTLine .modal').getBoundingClientRect().width <= 390));

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage); fs.unlinkSync(mPage);
  process.exit(fails ? 1 : 0);
})();
