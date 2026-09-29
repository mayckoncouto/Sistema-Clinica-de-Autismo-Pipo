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

  const srcBtn = page.locator('td.slotcell[data-key="07:20|r1|r1-t1"] .book-main');
  const destTd = page.locator('td.slotcell[data-key="08:00|r1|r1-t2"]');
  const destBtn = destTd.locator('.book-main');

  const srcBox = await srcBtn.boundingBox();
  const destBox = await destBtn.boundingBox();
  console.log('srcBox', srcBox, 'destBox', destBox);

  // Manual native-drag sequence via CDP mouse events
  await page.mouse.move(srcBox.x + srcBox.width/2, srcBox.y + srcBox.height/2);
  await page.mouse.down();
  await page.mouse.move(srcBox.x + srcBox.width/2 + 10, srcBox.y + srcBox.height/2 + 5, { steps: 5 });
  await page.mouse.move(destBox.x + destBox.width/2, destBox.y + destBox.height/2, { steps: 15 });
  await page.waitForTimeout(100);
  console.log('drag-over class present on dest?', await destTd.evaluate(el => el.classList.contains('drag-over')));
  await page.mouse.up();
  await page.waitForTimeout(300);

  console.log('=== store after drag (mouse-based) ===');
  console.log(await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('=== log ===', await page.evaluate(() => JSON.stringify(window.__LOG__)));
  console.log('=== dest cell DOM ===', await destTd.innerHTML());
  console.log('=== src cell DOM ===', await page.locator('td.slotcell[data-key="07:20|r1|r1-t1"]').innerHTML());

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
