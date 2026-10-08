const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);

  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  const bg = async (key) => page.locator(`td.slotcell[data-key="${key}"] .book-main`).evaluate(el => el.style.background);
  const cls = async (key) => page.locator(`td.slotcell[data-key="${key}"] .book-main`).evaluate(el => el.className);

  // ---- TEST: booking a ROOM name into a slot gets that room's own color, filled style ----
  // "Sala Azul" (r2) is registered with hex color #2255aa.
  const td = page.locator('td.slotcell[data-key="13:30|coord|coord-t1"]');
  await td.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Sala Azul');
  await page.waitForSelector('#bkSuggest button', { timeout: 3000 });
  await page.locator('#bkSuggest button', { hasText: 'Sala Azul' }).first().click();
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  console.log('room-booked slot gets "pcolor" fill class?', (await cls('13:30|coord|coord-t1')).includes('pcolor'));
  console.log('room-booked slot background uses color-mix of room hex?', (await bg('13:30|coord|coord-t1')).includes('color-mix'));

  // ---- TEST: "Bloqueado" checkbox marks the slot dark gray, no patient/room required ----
  const td2 = page.locator('td.slotcell[data-key="14:10|r1|r1-t2"]');
  await td2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  // Leave the patient field empty, just check "Bloqueado" and save.
  // (Desde 2026-10-01: opções Bloqueado / Reunião Clínica / Treinamento.)
  await page.check('#bkKindField input[value="bloqueado"]');
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  // Desde 2026-10-08: no Planner, "Bloqueado" vira horário bloqueado (cinza como fora do horário, sem agendamento).
  console.log('"Bloqueado" makes the slot a gray time block (slot-off pl-lock, no text)?', /slot-off.*pl-lock/.test(await td2.getAttribute('class')) && !(await td2.innerText()).includes('Bloqueado'));
  const store1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('record is {patient:"", lock:true} (not a booking)?', store1.bookings['14:10|r1|r1-t2'].lock === true && store1.bookings['14:10|r1|r1-t2'].patient === '' && !store1.bookings['14:10|r1|r1-t2'].blocked);

  // ---- TEST: Reunião Clínica (amarelo) e Treinamento (ciano #24E2FC) ----
  for (const [key, kind, rgb, label] of [['14:50|r1|r1-t2','reuniao','rgb(245,226,122)','Reunião Clínica'], ['15:30|r1|r1-t2','treinamento','rgb(36,226,252)','Treinamento']]) {
    const td = page.locator('td.slotcell[data-key="'+key+'"]');
    await td.locator('.book-main').click();
    await page.waitForSelector('#ovBook');
    await page.check('#bkKindField input[value="'+kind+'"]');
    console.log('only one kind checked at a time ('+kind+')?', (await page.locator('#bkKindField input:checked').count()) === 1);
    await page.click('#bkSave');
    await page.waitForTimeout(150);
    console.log(label+' slot shows its label and color?', (await td.innerText()).includes(label) && (await bg(key)).replace(/\s/g,'') === rgb);
  }
  const storeKinds = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('treinamento saved with training:true?', storeKinds.bookings['15:30|r1|r1-t2'].training === true);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
