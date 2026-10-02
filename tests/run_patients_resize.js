const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  // Narrow viewport: the table now has width:100% (it stretches to fill any extra
  // space in the wrapper, proportionally across columns, so the app makes full use
  // of wide screens). This test asserts exact per-column pixel widths, which only
  // holds when the wrapper is narrower than the table's natural (summed) width —
  // i.e. the table is pinned at its min-width, not stretched. A default-size (or
  // wider) viewport would inflate every column beyond its configured default.
  const context = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);
  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);

  // ---- TEST: colgroup + resizer handles are present, one per column (7 columns) ----
  console.log('colgroup has 7 <col> elements?', (await page.locator('#patListHost .pat-table colgroup col').count()) === 7);
  console.log('7 resizer handles present (one per column)?', (await page.locator('#patListHost .pat-col-resizer').count()) === 7);

  const nomeCol = page.locator('#patListHost col[data-col="nome"]');
  const startWidth = await nomeCol.evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('Nome column starts at its default width (230px)?', startWidth === 230);

  const tableBefore = await page.locator('#patListHost table.pat-table').evaluate(el => el.getBoundingClientRect().width);

  // ---- TEST: dragging the Nome column's resizer widens just that column ----
  const handle = page.locator('#patListHost .pat-col-resizer[data-col="nome"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const widthAfterDrag = await nomeCol.evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('dragging +80px widened the Nome column to ~310px?', Math.abs(widthAfterDrag - 310) <= 2);

  const tableAfter = await page.locator('#patListHost table.pat-table').evaluate(el => el.getBoundingClientRect().width);
  console.log('the table itself grew by the same amount (other columns untouched)?', Math.abs((tableAfter - tableBefore) - 80) <= 2);

  const convenioColWidth = await page.locator('#patListHost col[data-col="convenio"]').evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('a different column (Convênio) is unaffected by resizing Nome?', convenioColWidth === 150);

  // ---- TEST: the resized width is persisted to localStorage ----
  const stored = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('agendaPipo:patColWidths') || '{}'); } catch(e) { return null; }
  });
  console.log('localStorage holds the new Nome width after the drag?', stored && stored.nome === 310);

  // ---- TEST: the width survives a full reload (simulating the user coming back later) ----
  await page.reload();
  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  const widthAfterReload = await page.locator('#patListHost col[data-col="nome"]').evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('after reload, Nome column keeps the saved 310px width?', widthAfterReload === 310);

  // ---- TEST: double-clicking a handle resets that column back to its default ----
  const handle2 = page.locator('#patListHost .pat-col-resizer[data-col="nome"]');
  await handle2.dblclick();
  await page.waitForTimeout(80);
  const widthAfterReset = await page.locator('#patListHost col[data-col="nome"]').evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('double-click resets Nome column back to its default (230px)?', widthAfterReset === 230);
  const storedAfterReset = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('agendaPipo:patColWidths') || '{}'); } catch(e) { return null; }
  });
  console.log('the reset is also persisted (nome key removed from storage)?', storedAfterReset && !('nome' in storedAfterReset));

  // ---- TEST: a column cannot be dragged below its configured minimum width ----
  const abaHandle = page.locator('#patListHost .pat-col-resizer[data-col="aba"]');
  const abaBox = await abaHandle.boundingBox();
  await page.mouse.move(abaBox.x + abaBox.width / 2, abaBox.y + abaBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(abaBox.x - 500, abaBox.y + abaBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const abaWidth = await page.locator('#patListHost col[data-col="aba"]').evaluate(el => parseInt(getComputedStyle(el).width, 10));
  console.log('ABA column clamped at its minimum (60px), not collapsed?', abaWidth === 60);

  // ---- TEST: sorting still works (resize wiring didn't break the sort buttons) ----
  await page.locator('#patListHost .pat-table .sort-btn[data-sort-col="idade"]').click();
  await page.waitForTimeout(80);
  const names = await page.locator('#patListHost .pat-table tbody tr .pt-nome').allInnerTexts();
  console.log('sort still works after adding resize handles?', names[0].trim() === 'Ana Azul');

  // ---- TEST: clicking a row still opens the patient modal (resizer clicks don't leak into row clicks) ----
  await page.locator('#patListHost .pat-table tbody tr').first().click();
  await page.waitForSelector('.modal-head h3', { timeout: 3000 });
  console.log('row click still opens the patient modal?', (await page.locator('.modal-head h3').count()) === 1);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
