// Trocar o nome do paciente no cadastro: o Planner (nome gravado em cada agendamento) passa
// para o nome novo e a Agenda/Prontuário/Plano vão pelo banco (rename_patient). Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_rename.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  // Banco simulado: guarda a chamada do rename_patient.
  const before = await page.evaluate(() => (window.__STORE__['schedule/seg-1'].bookings['07:20|r1|r1-t1'] || {}).patient);
  await ev('openPatientModal(state.patients.filter(function(p){ return p.nome === "Paciente Um"; })[0])');
  await page.waitForSelector('#ovPat');
  await ev(`(function(){ window.__rpc = []; var fake = {rpc: function(n, a){ window.__rpc.push([n, a]); return Promise.resolve({data: {agenda: 3}}); }};
    agdClient = function(){ return fake; }; })()`);
  await page.fill('#pNome', 'Paciente Um Renomeado');
  await page.fill('#pf-cpf', '52998224725');
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await page.click('#pSave'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => (window.__STORE__['schedule/seg-1'].bookings['07:20|r1|r1-t1'] || {}).patient);
  const leftOld = await page.evaluate(() => Object.keys(window.__STORE__).filter((k) => k.indexOf('schedule/') === 0).some((k) => Object.values(window.__STORE__[k].bookings || {}).some((b) => b && (b.patient === 'Paciente Um' || b === 'Paciente Um'))));
  const rpc = await page.evaluate(() => window.__rpc);
  const toast = await page.innerText('#toastHost');
  const saved = await page.evaluate(() => window.__STORE__['patients/all'].list.some((p) => p.nome === 'Paciente Um Renomeado'));
  console.log('renaming the patient renames the Planner bookings (no old name left)?', before === 'Paciente Um' && after === 'Paciente Um Renomeado' && !leftOld && saved, before, after);
  console.log('Agenda/Prontuário/Plano go through rename_patient with id, old and new names; message tells what changed?',
    rpc.length === 1 && rpc[0][0] === 'rename_patient' && rpc[0][1].p_old === 'Paciente Um' && rpc[0][1].p_new === 'Paciente Um Renomeado' && !!rpc[0][1].p_id &&
    /3 atendimentos na Agenda/.test(toast) && /no Planner/.test(toast), JSON.stringify(rpc), toast);

  // Homônimo: outro paciente com o mesmo nome antigo → não renomeia.
  await ev(`(function(){ window.__rpc = []; state.patientsRaw = state.patientsRaw.concat([{id: "homonimo", nome: "Bruno Verde"}]); })()`);
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await ev('patientRenameEverywhere("bruno-verde", "Bruno Verde", "Bruno Verde Silva")');
  await page.waitForTimeout(300);
  const t2 = await page.innerText('#toastHost');
  const brunoKept = await page.evaluate(() => Object.keys(window.__STORE__).filter((k) => k.indexOf('schedule/') === 0).some((k) => Object.values(window.__STORE__[k].bookings || {}).some((b) => b && b.patient === 'Bruno Verde')));
  console.log('another patient with the old name: nothing is renamed and a warning shows?', /também se chama Bruno Verde/.test(t2) && brunoKept && (await page.evaluate(() => window.__rpc.length)) === 0, t2);

  // Mesmo nome (só salvou outro campo): nada acontece.
  await ev('window.__rpc = []');
  await ev('patientRenameEverywhere("carla-laranja", "Carla Laranja", "Carla Laranja")');
  console.log('same name does nothing?', (await page.evaluate(() => window.__rpc.length)) === 0);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
