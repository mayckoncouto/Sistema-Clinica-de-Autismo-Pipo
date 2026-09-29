const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);

  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  console.log('=== initial store ===');
  console.log(await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));

  // ---- TEST 1: copy + paste ----
  // find the filled cell's copy button
  const filledTd = await page.locator('td.slotcell[data-key="07:20|r1|r1-t1"]');
  await filledTd.hover();
  await filledTd.locator('.book-copy').click({ force: true });

  await page.waitForSelector('.clipboard-bar.on');
  console.log('=== clipboard bar text ===', await page.locator('.clipboard-bar').innerText());

  // click destination empty cell 07:20|r1|r1-t2
  const destTd = await page.locator('td.slotcell[data-key="07:20|r1|r1-t2"]');
  await destTd.locator('.book-main').click();

  await page.waitForTimeout(300);
  console.log('=== store after paste ===');
  console.log(await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('=== dest cell DOM after paste ===');
  console.log(await destTd.innerHTML());
  console.log('=== log ===', await page.evaluate(() => JSON.stringify(window.__LOG__)));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
