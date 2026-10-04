// Planner lembra o dia e a semana abertos neste computador (recarregar a página).
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('#gridHost .book');
  console.log('first time opens on Monday · 1st week?', (await page.innerText('#daySeg button.active')).trim() === 'Segunda' && (await page.innerText('#weekSeg button.active')).trim() === '1ª');
  await page.click('#daySeg button[data-day="qua"]');
  await page.click('#weekSeg button[data-week="3"]');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForSelector('#gridHost table.sched');
  console.log('after reloading, comes back on Wednesday?', (await page.innerText('#daySeg button.active')).trim() === 'Quarta');
  console.log('…and on the 3rd week?', (await page.innerText('#weekSeg button.active')).trim() === '3ª');
  console.log('…showing the Wednesday 3rd-week grid?', (await page.locator('table.sched[data-doc="qua-3"]').count()) === 1);
  await page.click('#daySeg button[data-day="todos"]');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForSelector('#gridHost table.sched');
  console.log('"Todos" (all days) is remembered too?', (await page.innerText('#daySeg button.active')).trim() === 'Todos');
  await page.evaluate(() => localStorage.removeItem('agendaPipo:plannerView'));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
