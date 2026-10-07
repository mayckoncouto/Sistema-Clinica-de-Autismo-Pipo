// Paciente (e sala/grupo) por código nos agendamentos: o Planner grava patientId/roomRef,
// homônimos ficam separados (escolher na lista), aviso ao cadastrar nome repetido e
// renomear sala atualiza as células dos grupos. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_code.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const bk = (doc, key) => page.evaluate(([d, k]) => (window.__STORE__['schedule/' + d].bookings || {})[k] || null, [doc, key]);
  async function openCell(key){
    await page.locator(`td.slotcell[data-key="${key}"] .book-main`).first().click();
    await page.waitForSelector('#ovBook');
  }

  // 1) Agendar pelo Planner grava o código do paciente.
  await openCell('08:00|r1|r1-t1');
  await page.fill('#bkPatient', 'Ana Azul');
  await page.locator('#bkSuggest button', { hasText: 'Ana Azul' }).first().click();
  await page.click('#bkSave'); await page.waitForTimeout(250);
  const b1 = await bk('seg-1', '08:00|r1|r1-t1');
  console.log('Planner booking carries the patient code?', !!b1 && b1.patient === 'Ana Azul' && b1.patientId === 'ana-azul', JSON.stringify(b1));

  // 2) Homônimo: outra "Ana Azul" no cadastro. Digitar sem escolher na lista é recusado;
  //    a lista mostra nascimento/mãe e escolher grava o código certo.
  await ev(`(function(){ state.patientsRaw = state.patientsRaw.concat([{id: "ana-azul-2", nome: "Ana Azul", nascimento: "2019-03-04", mae: {nome: "Maria Teste"}}]); rebuildPatients(); })()`);
  await openCell('08:40|r1|r1-t1');
  await page.fill('#bkPatient', 'Ana Azul');
  await page.waitForSelector('#bkSuggest button');
  const subs = await page.locator('#bkSuggest .autolist-sub').allInnerTexts();
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await page.locator('#bkPatient').press('Escape').catch(() => {});
  await page.evaluate(() => { document.getElementById('bkSuggest').hidden = true; });
  await page.click('#bkSave'); await page.waitForTimeout(200);
  const refused = /Há 2 pacientes chamados Ana Azul/.test(await page.innerText('#toastHost')) && !!(await page.$('#ovBook'));
  await page.fill('#bkPatient', 'Ana Azul');
  await page.locator('#bkSuggest button[data-pid="ana-azul-2"]').click();
  await page.click('#bkSave'); await page.waitForTimeout(250);
  const b2 = await bk('seg-1', '08:40|r1|r1-t1');
  console.log('homonyms: suggestions show birth date / mother?', subs.some((t) => /04\/03\/2019/.test(t) && /Maria Teste/.test(t)), subs);
  console.log('homonyms: typing without picking is refused?', refused);
  console.log('homonyms: picking from the list stores that patient code?', !!b2 && b2.patientId === 'ana-azul-2', JSON.stringify(b2));

  // 3) Regras: os dois homônimos são pacientes diferentes; o mesmo código é o mesmo paciente.
  const rules = await ev(`(function(){
    var a = {patient: "Ana Azul", patientId: "ana-azul"}, b = {patient: "Ana Azul", patientId: "ana-azul-2"};
    return [samePatient(a, b), samePatient(a, {patient: "Ana Azul", patientId: "ana-azul"}), findPatientByName(b).id, recIsPatient(b, {id: "ana-azul", nome: "Ana Azul"})];
  })()`);
  console.log('samePatient / findPatientByName(record) / recIsPatient use the code?', JSON.stringify(rules) === '[false,true,"ana-azul-2",false]', JSON.stringify(rules));
  const conf = await ev(`(function(){
    // mesmo horário (08:40), outra coluna da sala: a outra "Ana Azul" pode; a mesma não (mesmo serviço).
    var other = plannerConflict("seg-1", "08:40|r1|r1-t2", {patient: "Ana Azul", patientId: "ana-azul", service: "sessao"});
    var same = plannerConflict("seg-1", "08:40|r1|r1-t2", {patient: "Ana Azul", patientId: "ana-azul-2", service: "sessao"});
    return [!!other, !!same];
  })()`);
  console.log('conflict rules tell homonyms apart?', JSON.stringify(conf) === '[false,true]', JSON.stringify(conf));

  // 4) Cadastrar paciente com nome de outro: aviso antes de salvar.
  await ev('openPatientModal(null)');
  await page.waitForSelector('#ovPat');
  await page.fill('#pNome', 'Bruno Verde');
  await page.fill('#pf-cpf', '16899535009');
  await page.click('#pSave'); await page.waitForTimeout(250);
  const warnTxt = await page.locator('#confirmHost').innerText().catch(() => '');
  console.log('same name as another patient asks before saving?', /Nome igual ao de outro paciente/.test(warnTxt), warnTxt.slice(0, 80));
  await page.locator('#confirmHost button', { hasText: 'Cancelar' }).first().click().catch(() => {});
  await page.waitForTimeout(150);
  const notSaved = await page.evaluate(() => window.__STORE__['patients/all'].list.filter((p) => p.nome === 'Bruno Verde').length === 1);
  console.log('cancel keeps the patient unsaved?', notSaved);
  await page.click('#pCancel').catch(() => {}); await page.waitForTimeout(100);
  await page.evaluate(() => { const h = document.getElementById('modalHost'); if (h) h.innerHTML = ''; });

  // 5) Célula de grupo guarda a sala pelo código; renomear a sala atualiza o nome nela.
  await ev(`applyBookingChanges({"ter-1": {"16:10|coord|coord-t1": {patient: "Sala Azul", note: ""}}}, {noHistory: true, patientHoursOk: true, therapistOk: true, areaOk: true})`);
  await page.waitForTimeout(200);
  const g1 = await bk('ter-1', '16:10|coord|coord-t1');
  await ev(`(function(){ var list = state.rooms.map(function(r){ return r.id === "r2" ? Object.assign({}, r, {name: "Sala Azul Clara"}) : r; });
    return writeRooms(list).then(function(){ return roomRenameEverywhere(findRoom("r2"), "Sala Azul", "Sala Azul Clara"); }); })()`);
  await page.waitForTimeout(300);
  const g2 = await bk('ter-1', '16:10|coord|coord-t1');
  console.log('group cell stores the room code (roomRef)?', !!g1 && g1.roomRef === 'r2' && !g1.patientId, JSON.stringify(g1));
  console.log('renaming the room renames the group cells?', !!g2 && g2.patient === 'Sala Azul Clara' && g2.roomRef === 'r2', JSON.stringify(g2));

  // 6) Desfazer continua funcionando com os códigos acrescentados na gravação.
  await ev(`(function(){ state.tab = "planner"; })()`);
  await ev(`applyBookingChanges({"seg-1": {"09:20|r1|r1-t1": {patient: "Carla Laranja", note: ""}}}, {patientHoursOk: true, therapistOk: true, areaOk: true})`);
  await page.waitForTimeout(200);
  const withCode = await bk('seg-1', '09:20|r1|r1-t1');
  await ev('runHistory("undo")'); await page.waitForTimeout(300);
  const undone = await bk('seg-1', '09:20|r1|r1-t1');
  await ev('runHistory("redo")'); await page.waitForTimeout(300);
  const redone = await bk('seg-1', '09:20|r1|r1-t1');
  console.log('undo/redo work with the added code?', !!withCode && withCode.patientId === 'carla-laranja' && (!undone || !undone.patient) && !!redone && redone.patient === 'Carla Laranja',
    JSON.stringify([withCode, undone, redone]));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
