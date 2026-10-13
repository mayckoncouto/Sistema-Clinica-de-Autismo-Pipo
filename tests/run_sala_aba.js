// Sala com campo ABA (Sim/Não): o nome mostra "… ABA"; máximo de 4 pacientes por sala no mesmo horário (aviso no Planner).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_sa.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (l, ok, x) => console.log(l, !!ok, x === undefined ? '' : x);

  await ev(`openRoomModal(state.rooms[0])`);
  await page.waitForSelector('#rmAba', { state: 'attached' });
  check('room window has the ABA field (default Não)?', (await page.$eval('#rmAba', (s) => s.checked)) === false);
  await page.$eval('#rmAba', (s) => { s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#rmSave');
  await page.waitForTimeout(500);
  const r = await ev(`JSON.stringify({n: state.rooms[0].name, a: state.rooms[0].aba, ok: roomAba(state.rooms[0])})`);
  check('saving ABA Sim stores aba:true and shows "… ABA" in the name?', /ABA"/.test(r) && /"a":true/.test(r), r);
  await ev(`openRoomModal(state.rooms[0])`);
  await page.waitForSelector('#rmAba', { state: 'attached' });
  check('editing shows the base name without ABA and ABA = Sim?', (await page.inputValue('#rmName')) === 'Sala Teste' && (await page.$eval('#rmAba', (s) => s.checked)) === true);
  await page.click('#rmCancel');
  check('rules read the field, not the name?', await ev(`roomAba({name: "Fono ABA"}) === false && roomAba({name: "Fono", aba: true}) === true`));

  // máximo 4 por sala no mesmo horário
  const cap = await ev(`(function(){
    var room = state.rooms[0];
    room.therapists = [1,2,3,4,5].map(function(n){ return {id: "x" + n, professionalId: n % 2 ? "ana-terapeuta" : "bia-terapeuta", name: "T" + n}; });
    state.patients = state.patients.concat([{id: "extra-um", nome: "Extra Um", idade: 5, aba: "Sim"}]);
    var pats = ["paciente-um", "ana-azul", "bruno-verde", "extra-um", "carla-laranja"].map(function(id){ return state.patients.filter(function(p){ return p.id === id; })[0]; });
    var bk = {};
    [0,1,2,3].forEach(function(i){ bk["09:20|" + room.id + "|x" + (i + 1)] = {patient: pats[i].nome, patientId: pats[i].id, note: "", service: "sessao"}; });
    state.scheduleDocs["seg-1"] = {bookings: bk};
    var five = {patient: pats[4].nome, patientId: pats[4].id, note: "", service: "sessao"};
    var c5 = plannerConflict("seg-1", "09:20|" + room.id + "|x5", five);
    var c4 = plannerConflict("seg-1", "09:20|" + room.id + "|x4", five);   // 4º lugar já ocupado pela troca: só 3 outros
    return JSON.stringify({c5: c5 && c5.warn ? c5.msg : c5, c4: c4 && c4.warn ? "warn" : c4});
  })()`);
  const c = JSON.parse(cap);
  check('5th patient in the same room/time asks for confirmation (warn)?', c.c5 && /máximo 4/.test(c.c5), cap);
  check('up to 4 is fine?', !c.c4 || !/máximo 4/.test(String(c.c4)), cap);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
