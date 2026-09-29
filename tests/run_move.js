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

  console.log('=== initial store ===');
  console.log(await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));

  // ---- TEST: click-based move ----
  const filledTd = page.locator('td.slotcell[data-key="07:20|r1|r1-t1"]');
  await filledTd.hover();
  await filledTd.locator('.book-move').click({ force: true });

  await page.waitForSelector('.clipboard-bar.on');
  console.log('=== clipboard bar text (should say Movendo) ===', await page.locator('.clipboard-bar').innerText());

  // source cell should show move-source highlight
  console.log('source has move-source class?', await filledTd.evaluate(el => el.querySelector('.book').classList.contains('move-source')));

  // click destination empty cell
  const destTd = page.locator('td.slotcell[data-key="08:00|r1|r1-t2"]');
  await destTd.locator('.book-main').click();

  await page.waitForTimeout(300);
  console.log('=== store after move ===');
  console.log(await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('=== dest cell DOM ===', await destTd.innerHTML());
  console.log('=== src cell DOM (should be empty now) ===', await filledTd.innerHTML());
  console.log('=== clipboard bar after move (should be empty/off) ===', await page.locator('.clipboard-bar').getAttribute('class'));
  console.log('=== log ===', await page.evaluate(() => JSON.stringify(window.__LOG__)));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
