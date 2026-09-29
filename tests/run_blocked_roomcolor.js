const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
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
  const td = page.locator('td.slotcell[data-key="13:30|r1|r1-t1"]');
  await td.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Sala Azul');
  await page.waitForSelector('#bkSuggest button', { timeout: 3000 });
  await page.locator('#bkSuggest button', { hasText: 'Sala Azul' }).first().click();
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  console.log('room-booked slot gets "pcolor" fill class?', (await cls('13:30|r1|r1-t1')).includes('pcolor'));
  console.log('room-booked slot background uses color-mix of room hex?', (await bg('13:30|r1|r1-t1')).includes('color-mix'));

  // ---- TEST: "Bloqueado" checkbox marks the slot dark gray, no patient/room required ----
  const td2 = page.locator('td.slotcell[data-key="14:10|r1|r1-t2"]');
  await td2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  // Leave the patient field empty, just check "Bloqueado" and save.
  await page.check('#bkBlocked');
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  const blockedText = await td2.innerText();
  console.log('blocked slot defaults to "Bloqueado" label?', blockedText.includes('Bloqueado'));
  console.log('blocked slot gets "blocked" class?', (await cls('14:10|r1|r1-t2')).includes('blocked'));
  console.log('blocked slot background is the dark gray constant?', (await bg('14:10|r1|r1-t2')).replace(/\s/g,'') === 'rgb(74,82,87)');

  const store1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('booking record has blocked:true?', store1.bookings['14:10|r1|r1-t2'].blocked === true);

  // ---- TEST: reopening a blocked slot shows the checkbox pre-checked ----
  await td2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  console.log('reopened blocked slot has checkbox checked?', await page.locator('#bkBlocked').isChecked());
  await page.click('#bkCancel');
  await page.waitForTimeout(100);

  // ---- TEST: copying a blocked slot to another cell preserves blocked status ----
  await td2.hover();
  await td2.locator('.book-copy').click({ force: true });
  await page.waitForSelector('.clipboard-bar.on');
  const td3 = page.locator('td.slotcell[data-key="16:10|r1|r1-t2"]');
  await td3.locator('.book-main').click();
  await page.waitForTimeout(150);
  console.log('pasted copy of blocked slot also shows blocked styling?', (await cls('16:10|r1|r1-t2')).includes('blocked'));
  const store2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('pasted copy has blocked:true in store?', store2.bookings['16:10|r1|r1-t2'].blocked === true);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
