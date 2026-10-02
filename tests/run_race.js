const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page_race.html');
  await page.goto(url);

  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  // Click-based move: source 07:20|r1|r1-t1 -> dest 08:00|r1|r1-t2
  const filledTd = page.locator('td.slotcell[data-key="07:20|r1|r1-t1"]');
  await filledTd.hover();
  await filledTd.locator('.book-move').click({ force: true });
  await page.waitForSelector('.clipboard-bar.on');

  const destTd = page.locator('td.slotcell[data-key="08:00|r1|r1-t2"]');
  await destTd.locator('.book-main').click();

  // Immediately after the click (t=0), before the racy stale snapshot (t=40ms)
  // and the real write (t=150ms) resolve, check the DOM.
  await page.waitForTimeout(10);
  console.log('t=10ms dest shows patient?', (await destTd.innerText()).includes('Paciente Um'));

  // At t=60ms the stale snapshot has fired (t=40ms) — this is exactly the moment
  // that used to revert the UI before the pending-changes guard was added.
  await page.waitForTimeout(60);
  console.log('t=70ms (after stale snapshot) dest still shows patient?', (await destTd.innerText()).includes('Paciente Um'));
  console.log('t=70ms src still empty?', !(await filledTd.innerText()).includes('Paciente Um'));

  // At t=250ms the real write has landed and the fresh snapshot has fired.
  await page.waitForTimeout(200);
  console.log('t=270ms (after real write) dest still shows patient?', (await destTd.innerText()).includes('Paciente Um'));
  console.log('=== final store ===', await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
