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

  // ---- TEST: no more banner meeting row on Monday; 11:20 is now real bookable slots ----
  console.log('Monday: no more .meetingrow?', (await page.locator('tr.meetingrow').count()) === 0);
  const cell1 = page.locator('td.slotcell[data-key="11:20|r1|r1-t1"]');
  const cell2 = page.locator('td.slotcell[data-key="11:20|r1|r1-t2"]');
  console.log('Monday 11:20 r1-t1 cell exists?', (await cell1.count()) === 1);
  console.log('Monday 11:20 r1-t2 cell exists?', (await cell2.count()) === 1);

  // ---- TEST: every seat at 11:20 on Monday defaults to "Reunião Clínica", yellow fill ----
  const text1 = await cell1.innerText();
  console.log('11:20 r1-t1 pre-marked "Reunião Clínica"?', text1.includes('Reunião Clínica'));
  const bg1 = await cell1.locator('.book-main').evaluate(el => el.style.background);
  console.log('11:20 r1-t1 filled with the yellow meeting color (#F5E27A)?', bg1.replace(/\s/g,'') === 'rgb(245,226,122)');
  const text2 = await cell2.innerText();
  console.log('11:20 r1-t2 (a second seat) ALSO pre-marked?', text2.includes('Reunião Clínica'));

  // ---- TEST: the meeting default isn't a real record — nothing written to the store yet ----
  const storeBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('no real "11:20|r1|r1-t1" key stored yet (purely virtual default)?', !storeBefore.bookings['11:20|r1|r1-t1']);

  // ---- TEST: opening it shows it pre-filled and editable ----
  await cell1.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  console.log('modal title says "Editar" (looks already booked)?', (await page.locator('.modal-head h3').innerText()) === 'Editar atendimento');
  console.log('opens with the "Reunião Clínica" kind ticked?', await page.locator('#ovBook .kind-pick input[value="reuniao"]').isChecked());
  console.log('"Desmarcar" button is present?', (await page.locator('#bkClear').count()) === 1);

  // A Reunião Clínica GRAVADA do mock (Coordenador, Ana, 11:20) ocupa a Ana em qualquer lugar
  // (regra pl_reuniao_prof): tira-a antes de trocar a reunião automática da coluna dela por paciente.
  await page.evaluate(async () => { const db = await window.claude.use('db'); const r = db.doc('schedule/seg-1'); const d = JSON.parse(JSON.stringify((await r.get()).data())); delete d.bookings['11:20|coord|coord-t1']; await r.set(d); });
  await page.waitForTimeout(150);
  // Overriding it with a real patient at that seat should work like any other slot.
  // Desde 2026-10-01 a reunião é um tipo especial marcado: desmarcar libera o campo do paciente.
  await page.uncheck('#ovBook .kind-pick input[value="reuniao"]');
  await page.fill('#bkPatient', 'Paciente Um');
  await page.waitForSelector('#bkSuggest button', { timeout: 3000 });
  await page.locator('#bkSuggest button', { hasText: 'Paciente Um' }).first().click();
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  const afterOverride = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('overriding the default writes a real booking?', afterOverride.bookings['11:20|r1|r1-t1'].patient === 'Paciente Um');
  const cell1AfterOverride = await cell1.innerText();
  console.log('cell now shows the real patient instead of the meeting default?', cell1AfterOverride.includes('Paciente Um') && !cell1AfterOverride.includes('Reunião'));

  // ---- TEST: "Desmarcar" on a still-default (never overridden) seat truly empties it,
  // instead of bouncing back to the yellow default (the tombstone-vs-delete fix) ----
  await cell2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.click('#bkClear');
  await page.waitForTimeout(150);
  const cell2AfterClear = await cell2.innerText();
  console.log('cell2 no longer shows "Reunião Clínica" after Desmarcar?', !cell2AfterClear.includes('Reunião'));
  console.log('cell2 shows the empty "+" state after Desmarcar?', (await cell2.locator('.book-main .empty-plus').count()) === 1);
  const storeAfterClear = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('a tombstone record (not a deleted key) was written for cell2?', storeAfterClear.bookings['11:20|r1|r1-t2'] && storeAfterClear.bookings['11:20|r1|r1-t2'].patient === '');

  // ---- TEST: a seat on a different day at 11:20 is unaffected (no yellow default there) ----
  await page.click('#daySeg button[data-day="ter"]');
  await page.waitForTimeout(150);
  const terCell = page.locator('td.slotcell[data-key="11:20|r1|r1-t1"]');
  console.log('Tuesday 11:20 has NO meeting default (still an empty "+")?', (await terCell.locator('.book-main .empty-plus').count()) === 1);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
