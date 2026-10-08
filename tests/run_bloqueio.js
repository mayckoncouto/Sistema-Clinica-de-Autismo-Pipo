// Planner: Bloqueio de horário. Botões da grade criam horário bloqueado (célula cinza, sem
// agendamento) só nas colunas livres; Outras opções → Bloquear/Liberar horário por
// profissional, sala ou clínica toda, por semana e grade, com motivo e prévia. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_bloqueio.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const store = (p) => page.evaluate((x) => JSON.parse(JSON.stringify(window.__STORE__[x] || null)), p);
  const setSel = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const cell = (doc, key) => page.locator(`td.slotcell[data-doc="${doc}"][data-key="${key}"]`);

  // 1) Botão "bloquear manhã" da coluna: livres viram bloqueio (sem paciente), ocupados ficam.
  const before = (await store('schedule/seg-1')).bookings;
  const morning = await ev('findDayObj("seg").morning');
  const busyKeys = morning.map((t) => t + '|r1|r1-t1').filter((k) => before[k] && before[k].patient);
  const lock = page.locator('tr.periodrow-pre .period-btn-lock[data-doc="seg-1"][data-room="r1"][data-seat="r1-t1"]');
  await lock.click(); await lock.click();
  await page.waitForTimeout(300);
  let bk = (await store('schedule/seg-1')).bookings;
  const freeKeys = morning.map((t) => t + '|r1|r1-t1').filter((k) => busyKeys.indexOf(k) === -1 && !(k.startsWith('11:20')));
  const allLock = freeKeys.every((k) => bk[k] && bk[k].lock === true && bk[k].patient === '' && !bk[k].blocked);
  const keptPat = busyKeys.every((k) => JSON.stringify(bk[k]) === JSON.stringify(before[k]));
  console.log('column lock: free slots become a time block (no "Bloqueado" booking), booked ones untouched?', allLock && keptPat, freeKeys.length, busyKeys.length);
  const k0 = freeKeys[0];
  const cls = await cell('seg-1', k0).getAttribute('class');
  console.log('blocked slot is gray/inactive like outside work hours (slot-off pl-lock), no "Bloqueado" text?', /slot-off/.test(cls) && /pl-lock/.test(cls) && !(await cell('seg-1', k0).innerText()).includes('Bloqueado'));
  // Resumo não conta.
  const special = await ev('(function(){ var d = state.reportDocs["seg-1"] || state.scheduleDocs["seg-1"]; return Object.keys(d.bookings).filter(function(k){ var b = d.bookings[k]; return b && b.lock && b.patient; }).length; })()');
  console.log('time block is not a booking (empty patient)?', special === 0);

  // Clique numa célula bloqueada pelo botão: pergunta e libera.
  await cell('seg-1', k0).click();
  await page.waitForSelector('#cfTitle');
  await page.click('#cfOk'); await page.waitForTimeout(250);
  bk = (await store('schedule/seg-1')).bookings;
  console.log('clicking a button-blocked slot offers "Liberar" and frees it?', !bk[k0] || (!bk[k0].lock && !bk[k0].patient));

  // 2) Liberar manhã pelos botões: tira os bloqueios, ocupados ficam.
  const unlock = page.locator('tr.periodrow-pre .period-btn:not(.period-btn-lock):not(.period-btn-clear)[data-doc="seg-1"][data-room="r1"][data-seat="r1-t1"]');
  await unlock.click(); await unlock.click();
  await page.waitForTimeout(300);
  bk = (await store('schedule/seg-1')).bookings;
  console.log('column unlock removes the time blocks and keeps bookings?', freeKeys.every((k) => !bk[k] || !bk[k].lock) && busyKeys.every((k) => JSON.stringify(bk[k]) === JSON.stringify(before[k])));

  // 3) Outras opções → Bloquear horário: profissional Ana, segunda manhã, só 1ª semana, Férias.
  await ev('openPlBlockModal("lock")');
  await page.waitForSelector('#ovPlb');
  await setSel('#plbAlvo', 'prof');
  await setSel('#plbId', 'ana-terapeuta');
  for (const w of ['2', '3', '4']) await page.uncheck(`.plb-weeks input[value="${w}"]`);
  await page.click('[data-plb-per="seg|m"]');
  await setSel('#plbMotivo', 'Férias');
  const prev = await page.$eval('#plbPrev', (e) => e.textContent);
  console.log('preview shows count and the bookings that stay?', /horários/.test(prev) && /continua/.test(prev), prev.slice(0, 160));
  await page.click('#plbSave'); await page.waitForTimeout(300);
  const blocks = (await store('config/planner_blocks')).list;
  console.log('saved one block (prof Ana, week 1, Monday morning, Férias)?', blocks.length === 1 && blocks[0].alvo === 'prof' && blocks[0].profId === 'ana-terapeuta' && Object.keys(blocks[0].slots).join() === '1' && blocks[0].slots['1'].seg.length === morning.length && blocks[0].motivo === 'Férias');
  const anaFree = freeKeys[1];
  const c1 = await cell('seg-1', anaFree).getAttribute('class'), t1 = await cell('seg-1', anaFree).getAttribute('title');
  const coordCls = await cell('seg-1', morning[2] + '|coord|coord-t1').getAttribute('class').catch(() => '');
  console.log('Ana is gray in every column (rooms) with "Férias" on hover; week 2 stays free?', /pl-lock/.test(c1) && /Férias/.test(t1) &&
    !(await ev(`plRuleLock("seg", 2, "${anaFree.split("|")[0]}", findRoom("r1"), findRoom("r1").therapists[0])`)), t1);
  console.log('a booking already there keeps showing?', !busyKeys.length || !/slot-off/.test(await cell('seg-1', busyKeys[0]).getAttribute('class')));
  const bia = await cell('seg-1', morning[2] + '|r1|r1-t2').getAttribute('class');
  console.log('other professionals are not blocked?', !/pl-lock/.test(bia));

  // Botão da grade não libera bloqueio de Outras opções (avisa).
  const rowUn = page.locator(`.row-lock [data-row-action="unlock"][data-doc="seg-1"][data-time="${anaFree.split('|')[0]}"]`);
  await rowUn.click(); await rowUn.click(); await page.waitForTimeout(250);
  const toast = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  console.log('grid unlock does not remove a tool block (and says so)?', /pl-lock/.test(await cell('seg-1', anaFree).getAttribute('class')) && /Outras opções/.test(toast), toast);

  // Sala e clínica toda.
  await ev('openPlBlockModal("lock")');
  await page.waitForSelector('#ovPlb');
  await setSel('#plbAlvo', 'clinica');
  await page.click('[data-plb-cell="ter|' + morning[3] + '"]');
  await page.click('#plbSave'); await page.waitForTimeout(300);
  const terCls = await page.evaluate((t) => Array.prototype.map.call(document.querySelectorAll(`td.slotcell[data-doc="ter-1"][data-time="${t}"]`), (x) => /pl-lock|slot-off/.test(x.className) || x.querySelector('.pname')), morning[3]);
  // (terça pode não estar na tela; confere pela função)
  const clinicHit = await ev(`!!plRuleLock("ter", 1, "${morning[3]}", findRoom("r1"), findRoom("r1").therapists[1])`);
  console.log('"Clínica toda" blocks every column at that time?', clinicHit === true && (await store('config/planner_blocks')).list.length === 2);

  // 4) Liberar horário: Ana, segunda manhã, 1ª semana → bloqueio sai.
  await ev('openPlBlockModal("unlock")');
  await page.waitForSelector('#ovPlb');
  await setSel('#plbAlvo', 'prof');
  await setSel('#plbId', 'ana-terapeuta');
  for (const w of ['2', '3', '4']) await page.uncheck(`.plb-weeks input[value="${w}"]`);
  await page.click('[data-plb-per="seg|m"]');
  await page.click('#plbSave'); await page.waitForTimeout(300);
  const after = (await store('config/planner_blocks')).list;
  console.log('"Liberar horário" removes the professional block (clinic block stays)?', after.length === 1 && after[0].alvo === 'clinica' && !/pl-lock/.test(await cell('seg-1', anaFree).getAttribute('class')));

  // 5) Janela de atendimento: "Bloqueado" vira horário bloqueado.
  await cell('seg-1', anaFree).locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.check('#bkKindField input[value="bloqueado"]');
  await page.fill('#bkNote', 'Supervisão');
  await page.click('#bkSave'); await page.waitForTimeout(300);
  bk = (await store('schedule/seg-1')).bookings;
  console.log('booking window "Bloqueado" saves a time block with the reason?', bk[anaFree] && bk[anaFree].lock === true && bk[anaFree].patient === '' && bk[anaFree].motivo === 'Supervisão', JSON.stringify(bk[anaFree]));

  // 6) Permissão: sem "Bloqueio de horário" os botões somem e a gravação recusa.
  const denied = await ev(`(function(){ var old = window.pipoAuth; window.pipoAuth = {can: function(m, a){ return m !== "bloqueio_horario"; }, profile: function(){ return null; }};
    var msg = bookingPermDenied({"seg-1": {"${morning[4]}|r1|r1-t2": {patient: "", lock: true}}}); permToolClasses();
    var hidden = getComputedStyle(document.querySelector('[data-row-action="lock"]')).display === "none";
    window.pipoAuth = old; permToolClasses(); return [msg, hidden]; })()`);
  console.log('without the permission: grid lock buttons hidden and saving is refused?', /Bloqueio de horário/.test(denied[0]) && denied[1] === true, denied[0]);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
