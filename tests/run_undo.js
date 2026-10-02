// Desfazer / refazer das células da agenda: botões no canto da grade e
// atalhos Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('[data-hist="undo"]');

  const S = (k) => page.evaluate((k) => window.__STORE__['schedule/seg-1'].bookings[k] || null, k);
  const cell = (k) => page.locator('td.slotcell[data-key="' + k + '"][data-doc="seg-1"]');
  const undoBtn = page.locator('[data-hist="undo"]').first();
  const redoBtn = page.locator('[data-hist="redo"]').first();

  console.log('undo/redo buttons live in the lock-buttons row (before 07:20)?',
    (await page.locator('.timecell-hist [data-hist="undo"]').count()) > 0 && (await page.locator('.timecell-hist [data-hist="redo"]').count()) > 0);
  console.log('both start disabled (nothing to undo yet)?', await undoBtn.isDisabled() && await redoBtn.isDisabled());

  // agenda um paciente
  await cell('08:00|r1|r1-t1').locator('.book-main').click();
  await page.fill('#bkPatient', 'Ana Azul');
  await page.click('#bkSave');
  await page.waitForTimeout(200);
  console.log('after booking, undo is enabled?', !(await undoBtn.isDisabled()));

  // desmarca outro
  await cell('07:20|r1|r1-t1').locator('.book-main').click();
  await page.click('#bkClear');
  await page.waitForTimeout(200);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  console.log('Ctrl+Z restores the cleared booking?', (await S('07:20|r1|r1-t1'))?.patient === 'Paciente Um');

  await undoBtn.click();
  await page.waitForTimeout(300);
  console.log('undo button removes the new booking?', (await S('08:00|r1|r1-t1')) === null);
  console.log('with nothing left, undo is disabled and redo enabled?', await undoBtn.isDisabled() && !(await redoBtn.isDisabled()));

  await page.keyboard.press('Control+y');
  await page.waitForTimeout(300);
  console.log('Ctrl+Y redoes the booking?', (await S('08:00|r1|r1-t1'))?.patient === 'Ana Azul');

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  console.log('Ctrl+Shift+Z redoes the clear?', (await S('07:20|r1|r1-t1')) === null);

  // uma alteração nova apaga o "refazer"
  await undoBtn.click();
  await page.waitForTimeout(300);
  await cell('09:20|r1|r1-t1').locator('.book-main').click();
  await page.fill('#bkPatient', 'Carla Laranja');
  await page.click('#bkSave');
  await page.waitForTimeout(200);
  console.log('a new change clears the redo history?', await redoBtn.isDisabled());

  // outra pessoa altera a mesma célula: desfazer não sobrescreve
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const cur = JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'].bookings));
    cur['09:20|r1|r1-t1'] = { patient: 'Duda Vermelho', note: '' };
    await db.doc('schedule/seg-1').set({ bookings: cur });
  });
  await page.waitForTimeout(200);
  await undoBtn.click();
  await page.waitForTimeout(300);
  console.log('undo refuses to overwrite a cell someone else changed since?', (await S('09:20|r1|r1-t1'))?.patient === 'Duda Vermelho');

  // Ctrl+Z dentro de um campo de texto é do campo, não da agenda
  const before = await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1']));
  await page.click('#patientSearch');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('Ctrl+Z inside a text field leaves the agenda alone?',
    before === await page.evaluate(() => JSON.stringify(window.__STORE__['schedule/seg-1'])));

  // Setinha ▾: lista das ações e desfazer várias de uma vez
  await page.reload();
  await page.waitForSelector('[data-hist="undo"]');
  const book = async (k, name) => {
    await cell(k).locator('.book-main').click();
    await page.fill('#bkPatient', name);
    await page.click('#bkSave');
    await page.waitForTimeout(200);
  };
  await book('08:00|r1|r1-t1', 'Ana Azul');
  await book('08:40|r1|r1-t1', 'Bruno Verde');
  await cell('07:20|r1|r1-t1').locator('.book-main').click();
  await page.click('#bkClear');
  await page.waitForTimeout(200);
  await page.locator('[data-hist-menu="undo"]').first().click();
  const labels = await page.locator('.hist-menu .hist-menu-item').allInnerTexts();
  console.log('undo list shows the 3 actions, newest first, with readable labels?',
    labels.length === 3 && labels[0].startsWith('Desmarcar Paciente Um') &&
    labels[1].startsWith('Agendar Bruno Verde') && labels[2].startsWith('Agendar Ana Azul'));
  await page.locator('.hist-menu .hist-menu-item').nth(1).hover();
  console.log('hovering the 2nd item marks 2 and the footer says "Desfazer 2 ações"?',
    (await page.locator('.hist-menu .hist-menu-item.on').count()) === 2 &&
    (await page.locator('.hist-menu-foot').innerText()).trim() === 'Desfazer 2 ações');
  await page.locator('.hist-menu .hist-menu-item').nth(1).click();
  await page.waitForTimeout(600);
  console.log('choosing the 2nd item undoes the last 2 actions and keeps the 1st?',
    (await S('07:20|r1|r1-t1'))?.patient === 'Paciente Um' && (await S('08:40|r1|r1-t1')) === null &&
    (await S('08:00|r1|r1-t1'))?.patient === 'Ana Azul');
  await page.locator('[data-hist-menu="redo"]').first().click();
  console.log('redo list now holds those 2 actions?', (await page.locator('.hist-menu .hist-menu-item').count()) === 2);
  await page.keyboard.press('Escape');
  console.log('Esc closes the list?', (await page.locator('.hist-menu').count()) === 0);

  const errors = await page.evaluate(() => window.__LOG__.filter(x => x.op === 'error'));
  console.log('no JS errors?', errors.length === 0, errors.length ? JSON.stringify(errors) : '');
  await browser.close();
})();
