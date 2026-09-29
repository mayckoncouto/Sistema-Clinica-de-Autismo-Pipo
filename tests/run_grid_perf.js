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

  // Instrument innerHTML assignment counts on #gridHost's children so we can tell
  // a full grid rebuild (host.innerHTML = ...) apart from a targeted single-table
  // rebuild (table.outerHTML = ...) without touching the app's own code.
  await page.evaluate(() => {
    window.__hostInnerHTMLSets = 0;
    window.__tableOuterHTMLSets = 0;
    const host = document.getElementById('gridHost');
    const proto = Object.getPrototypeOf(host);
    const desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML') || Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    Object.defineProperty(host, 'innerHTML', {
      set(v){ window.__hostInnerHTMLSets++; desc.set.call(this, v); },
      get(){ return desc.get.call(this); },
      configurable: true
    });
    const outerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    window.__origTableOuterHTMLSetter = outerDesc.set;
    Element.prototype.__outerHTMLPatched = true;
  });

  // ---- TEST: switching to "Todos" dias + "Todos" semanas coalesces the burst of
  // ~20 onSnapshot firings (one per doc) into ONE full render, not 20 ----
  await page.click('#daySeg button[data-day="todos"]');
  await page.click('#weekSeg button[data-week="todos"]');
  await page.waitForTimeout(150); // let every subscription's initial snapshot fire + settle

  const tableCount = await page.locator('table.sched').count();
  console.log('todos/todos view shows all 20 day x week tables?', tableCount === 20);

  const fullRendersOnEntry = await page.evaluate(() => window.__hostInnerHTMLSets);
  console.log('entering todos/todos triggered only a small, bounded number of full grid rebuilds (<=3), not one per doc (~20)?', fullRendersOnEntry <= 3, '(actual: ' + fullRendersOnEntry + ')');

  // ---- TEST: editing a single slot in this 20-table view only rebuilds that one
  // table (a targeted per-doc update), not the whole grid ----
  await page.evaluate(() => { window.__hostInnerHTMLSets = 0; });
  const otherTables = await page.locator('table.sched').elementHandles();
  const otherTableIdsBefore = [];
  for (const t of otherTables) otherTableIdsBefore.push(await t.evaluate(el => el));
  // Tag every table so we can tell which DOM nodes survive untouched.
  await page.evaluate(() => {
    document.querySelectorAll('table.sched').forEach((t, i) => { t.__tagIdx = i; });
  });

  const targetCell = page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="07:20|r1|r1-t1"]');
  await targetCell.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.click('#bkClear'); // clears the existing "Paciente Um" booking
  await page.waitForTimeout(150);

  const rebuildsAfterEdit = await page.evaluate(() => window.__hostInnerHTMLSets);
  console.log('editing one slot in todos/todos did NOT trigger a full-grid rebuild?', rebuildsAfterEdit === 0, '(host.innerHTML sets: ' + rebuildsAfterEdit + ')');

  const survivedTagCount = await page.evaluate(() => document.querySelectorAll('table.sched[data-doc]').length &&
    Array.from(document.querySelectorAll('table.sched')).filter(t => typeof t.__tagIdx === 'number').length);
  console.log('other tables\' DOM nodes were left untouched by the targeted update (still carry their tag)?', survivedTagCount === 19, '(survived: ' + survivedTagCount + ')');

  const editedCellNowEmpty = await targetCell.locator('.empty-plus').count();
  console.log('the edited table itself DID pick up the change (slot now empty)?', editedCellNowEmpty === 1);

  // ---- TEST: while a different tab is active, background schedule snapshots don't
  // touch the (hidden) agenda grid DOM at all — switching back re-renders fresh ----
  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__hostInnerHTMLSets = 0; });
  // Simulate a live edit arriving from another user while we're on a different tab.
  await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-2']));
    doc.bookings['07:20|r1|r1-t1'] = {patient: 'Novo Enquanto Ausente', note: ''};
    window.__STORE__['schedule/seg-2'] = doc;
    // Re-trigger listeners the same way the mock db's set()/onSnapshot would.
    const path = 'schedule/seg-2';
  });
  // The mock store's onSnapshot listeners are only registered against the doc ref,
  // so drive it through the real API instead of poking __STORE__ directly.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const ref = db.doc('schedule/seg-2');
    const cur = (await ref.get()).data() || {bookings:{}};
    cur.bookings['07:20|r1|r1-t1'] = {patient: 'Novo Enquanto Ausente', note: ''};
    await ref.set(cur);
  });
  await page.waitForTimeout(150);
  const rebuildsWhileHidden = await page.evaluate(() => window.__hostInnerHTMLSets);
  console.log('no grid DOM work happened while Agenda tab was hidden?', rebuildsWhileHidden === 0, '(host.innerHTML sets: ' + rebuildsWhileHidden + ')');

  await page.click('button[data-tab="agenda"]');
  await page.waitForTimeout(150);
  const cellAfterReturn = page.locator('table.sched[data-doc="seg-2"] td.slotcell[data-key="07:20|r1|r1-t1"]');
  const textAfterReturn = await cellAfterReturn.innerText();
  console.log('switching back to Agenda shows the edit that arrived while hidden?', textAfterReturn.includes('Novo Enquanto Ausente'));

  // ---- TEST: interactions still work correctly after several targeted (non-full)
  // rebuilds — delegation on #gridHost survives table replacement ----
  const anotherCell = page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="08:00|coord|coord-t1"]');
  await anotherCell.locator('.book-copy').click();
  await page.waitForTimeout(80);
  console.log('clipboard bar shows after copy (delegated click still wired post-rebuild)?', (await page.locator('.clipboard-bar.on').count()) === 1);
  const pasteTarget = page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="09:20|r1|r1-t1"]');
  await pasteTarget.locator('.book-main').click();
  await page.waitForTimeout(120);
  console.log('paste landed correctly via delegated click?', (await pasteTarget.innerText()).includes('Fonoaudiologia ABA'));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
