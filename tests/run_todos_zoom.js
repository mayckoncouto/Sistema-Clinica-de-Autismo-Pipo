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

  // ---- TEST: default single day/week view renders exactly one table ----
  console.log('default view: exactly one table.sched?', (await page.locator('table.sched').count()) === 1);
  console.log('default view: no .day-section wrapper present?', (await page.locator('.day-section').count()) === 0);
  console.log('default view: no .weeks-row wrapper present?', (await page.locator('.weeks-row').count()) === 0);

  // ---- TEST: "Todos" day view stacks 5 day tables ----
  await page.click('#daySeg button[data-day="todos"]');
  await page.waitForTimeout(150);
  console.log('day=todos: 5 day-section blocks?', (await page.locator('.day-section').count()) === 5);
  console.log('day=todos: 5 table.sched (one per weekday, single week)?', (await page.locator('table.sched').count()) === 5);
  // .day-section-label uses CSS text-transform:uppercase, so compare case-insensitively
  // against the raw text (same caveat as run_registries.js's table-header check).
  const segLabelHtml = await page.locator('.day-section').nth(0).locator('.day-section-label').innerText();
  console.log('day=todos: first section labeled Segunda-feira?', segLabelHtml.toLowerCase().includes('segunda-feira'));
  console.log('day=todos: Monday table shows Paciente Um?', (await page.locator('table.sched[data-doc="seg-1"]').innerText()).includes('Paciente Um'));
  console.log('day=todos: Tuesday table shows Bruno Verde?', (await page.locator('table.sched[data-doc="ter-1"]').innerText()).includes('Bruno Verde'));

  // Booking a brand-new slot in the Tuesday table (visible while day=todos) should
  // write to the Tuesday doc specifically, not Monday's.
  const terCell = page.locator('table.sched[data-doc="ter-1"] td.slotcell[data-key="08:00|r1|r1-t1"]');
  await terCell.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  const modalSub = await page.locator('.modal-sub').first().innerText();
  console.log('modal shows Terça-feira as the day for that cell?', modalSub.includes('Terça'));
  await page.fill('#bkPatient', 'Novo Na Terca');
  // Typing an unmatched name opens the "none found" suggestion box, which reflows
  // the modal; blur onto another field first so its layout is settled before we
  // click Save (otherwise the Save button can shift out from under the click).
  await page.click('#bkNote');
  await page.waitForTimeout(50);
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  const storeAfterTer = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/ter-1'])));
  console.log('booking written to ter-1 doc (not seg-1)?', storeAfterTer.bookings['08:00|r1|r1-t1'].patient === 'Novo Na Terca');
  const storeSegUnaffected = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('seg-1 doc unaffected by the ter-1 booking?', !storeSegUnaffected.bookings['08:00|r1|r1-t1']);

  // back to normal day view
  await page.click('#daySeg button[data-day="seg"]');
  await page.waitForTimeout(100);

  // ---- TEST: "Todos" week view shows 4 side-by-side week panels ----
  await page.click('#weekSeg button[data-week="todos"]');
  await page.waitForTimeout(150);
  console.log('week=todos: 1 weeks-row wrapper?', (await page.locator('.weeks-row').count()) === 1);
  console.log('week=todos: 4 week-panel blocks?', (await page.locator('.week-panel').count()) === 4);
  console.log('week=todos: 4 table.sched (one per week, single day)?', (await page.locator('table.sched').count()) === 4);
  console.log('week=todos: week-1 table shows Paciente Um?', (await page.locator('table.sched[data-doc="seg-1"]').innerText()).includes('Paciente Um'));
  console.log('week=todos: week-2 table shows Carla Laranja?', (await page.locator('table.sched[data-doc="seg-2"]').innerText()).includes('Carla Laranja'));
  const panelLabel = await page.locator('.week-panel').nth(1).locator('.week-panel-label').innerText();
  console.log('week=todos: second panel labeled "2ª semana"?', panelLabel.toLowerCase().includes('2ª semana'));

  // ---- TEST: combined day=todos + week=todos renders 5 day-sections x 4 week-panels = 20 tables ----
  await page.click('#daySeg button[data-day="todos"]');
  await page.waitForTimeout(150);
  console.log('combined: 5 day-sections?', (await page.locator('.day-section').count()) === 5);
  console.log('combined: 5 weeks-row (one per day)?', (await page.locator('.weeks-row').count()) === 5);
  console.log('combined: 20 total tables (5 days x 4 weeks)?', (await page.locator('table.sched').count()) === 20);

  // reset back to defaults
  await page.click('#daySeg button[data-day="seg"]');
  await page.click('#weekSeg button[data-week="1"]');
  await page.waitForTimeout(150);
  console.log('reset: back to exactly one table?', (await page.locator('table.sched').count()) === 1);

  // ---- TEST: zoom control ----
  console.log('zoom control visible on Agenda tab?', !(await page.locator('#zoomCtrl').isHidden()));
  const zoomBefore = await page.locator('#gridHost').evaluate(el => el.style.zoom);
  console.log('zoom starts at 100%?', zoomBefore === '100%');
  await page.selectOption('#zoomSelect', '70');
  await page.waitForTimeout(100);
  console.log('zoom applies 70% to gridHost?', (await page.locator('#gridHost').evaluate(el => el.style.zoom)) === '70%');
  console.log('zoom label shows 70%?', (await page.locator('#zoomLabel').innerText()) === '70%');

  await page.selectOption('#zoomSelect', 'dia');
  await page.waitForTimeout(250);
  const zoomDia = await page.locator('#gridHost').evaluate(el => el.style.zoom);
  console.log('zoom dia computes some percentage (not empty)?', !!zoomDia && zoomDia.endsWith('%'));

  await page.selectOption('#zoomSelect', '100');
  await page.waitForTimeout(100);
  console.log('zoom back to normal 100%?', (await page.locator('#gridHost').evaluate(el => el.style.zoom)) === '100%');

  // zoom control hides on other tabs
  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(100);
  console.log('zoom control hidden on Pacientes tab?', await page.locator('#zoomCtrl').isHidden());
  await page.click('button[data-tab="agenda"]');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
