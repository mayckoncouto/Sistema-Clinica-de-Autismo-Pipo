// Salas/grupos × agendamentos do Planner: tirar coluna com agendamentos pede para
// apagar ou mover; excluir sala/grupo apaga os agendamentos junto (com confirmação);
// agendamentos de colunas que não existem mais são limpos ao salvar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_seats.html');
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
  const bk = (doc) => ev(`(async function(){ var db = await window.claude.use("db"); var s = await db.doc("schedule/${doc}").get(); return JSON.stringify((s.exists && s.data().bookings) || {}); })()`).then(JSON.parse);

  // agendamento "perdido" (coluna que não existe)
  await ev(`(async function(){ var db = await window.claude.use("db"); var s = await db.doc("schedule/qua-3").get();
    var d = (s.exists && s.data()) || {bookings:{}}; d.bookings = Object.assign({}, d.bookings, {"09:20|r1|gone-seat": {patient: "Paciente Um", note: ""}}); await db.doc("schedule/qua-3").set(d); })()`);

  // 1) Tirar a coluna da Ana (3 agendamentos) e mover para a Bia
  await ev(`openRoomModal(findRoom("r1"))`);
  await page.waitForTimeout(300);
  await page.click('#ovRoom button.rm[data-rm="0"]');
  await page.click('#rmSave');
  await page.waitForTimeout(500);
  const dlg = await ev(`(function(){ var o = document.getElementById("ovSeatRm"); if (!o) return null;
    var sel = o.querySelector("select[data-sr-seat]"); return {txt: o.textContent, opts: Array.prototype.map.call(sel.options, function(x){ return x.value; }), prev: o.querySelector(".sr-prev").textContent}; })()`);
  check('removing a column with bookings asks what to do?', !!dlg && /3 agendamentos/.test(dlg.txt), dlg && dlg.txt.slice(0, 160));
  check('options: delete or move to another room column (not groups)?', !!dlg && dlg.opts[0] === '' && dlg.opts.indexOf('r1|r1-t2') !== -1 && !dlg.opts.some((v) => /^coord/.test(v)), dlg && dlg.opts.join(','));
  check('default preview = delete?', !!dlg && /serão apagados/.test(dlg.prev), dlg && dlg.prev);
  await ev(`(function(){ var s = document.querySelector("#ovSeatRm select[data-sr-seat]"); s.value = "r1|r1-t2"; s.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  const prev2 = await ev(`document.querySelector("#ovSeatRm .sr-prev").textContent`);
  check('move preview counts?', /3 serão movidos/.test(prev2), prev2);
  await page.click('#srOk');
  await page.waitForTimeout(700);
  const s1 = await bk('seg-1'), t1 = await bk('ter-1'), s2 = await bk('seg-2'), q3 = await bk('qua-3');
  const rooms1 = await ev(`JSON.stringify(findRoom("r1").therapists.map(function(t){ return t.id; }))`);
  check('bookings moved to the Bia column?', s1['07:20|r1|r1-t2'] && s1['07:20|r1|r1-t2'].patient === 'Paciente Um' && t1['07:20|r1|r1-t2'] && s2['07:20|r1|r1-t2'], JSON.stringify(s1));
  check('nothing left in the removed column?', !s1['07:20|r1|r1-t1'] && !t1['07:20|r1|r1-t1'] && !s2['07:20|r1|r1-t1']);
  check('lost booking of a missing column cleaned?', !q3['09:20|r1|gone-seat'], JSON.stringify(q3));
  check('room saved without the column?', rooms1 === '["r1-t2"]', rooms1);

  // 2) Cancelar não salva nada
  await ev(`(function(){ var r = findRoom("r1"); state.rooms = state.rooms.map(function(x){ return x.id === "r1" ? Object.assign({}, x, {therapists: x.therapists.concat([{id: "r1-t9", name: "Ana", professionalId: "ana-terapeuta"}])}) : x; }); })()`);
  await ev(`openRoomModal(findRoom("r1"))`);
  await page.waitForTimeout(300);
  await page.click('#ovRoom button.rm[data-rm="0"]');
  await page.click('#rmSave');
  await page.waitForTimeout(500);
  await page.click('#srCancel');
  await page.waitForTimeout(300);
  const after = await bk('seg-1');
  const stillOpen = !!(await page.$('#ovRoom'));
  check('cancel keeps bookings and the window open?', !!after['07:20|r1|r1-t2'] && stillOpen);
  await ev(`document.getElementById("closeRoom").click()`);

  // 3) Excluir o grupo Coordenador (com agendamentos) apaga os agendamentos junto
  await ev(`openRoomModal(findRoom("coord"))`);
  await page.waitForTimeout(500);
  await page.click('#rmDelete');
  await page.waitForTimeout(500);
  const del = await ev(`(function(){ var o = document.getElementById("ovConfirm"); return o ? o.textContent : null; })()`);
  check('delete group with bookings warns they will be erased?', !!del && /agendamentos? no Planner/.test(del) && /Apagar e excluir/.test(del), del && del.slice(0, 200));
  await page.click('#cfOk');
  await page.waitForTimeout(700);
  const s1b = await bk('seg-1');
  const coordGone = await ev(`!findRoom("coord")`);
  check('group bookings erased and group deleted?', coordGone && !Object.keys(s1b).some((k) => k.indexOf('|coord|') !== -1), JSON.stringify(s1b));

  // 4) Excluir sala sem agendamentos: confirmação simples
  await ev(`openRoomModal(findRoom("r2"))`);
  await page.waitForTimeout(500);
  await page.click('#rmDelete');
  await page.waitForTimeout(400);
  const simple = await ev(`(function(){ var o = document.getElementById("ovConfirm"); return o ? o.textContent : null; })()`);
  check('room without bookings: plain delete confirmation?', !!simple && !/no Planner/.test(simple) && /Confirmar exclusão/.test(simple), simple);
  await page.click('#cfCancel');

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
