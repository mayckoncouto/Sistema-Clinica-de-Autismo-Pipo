const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);
  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  // Inject an accented booking into a plain (non-special) room/seat so it shows up
  // both on the grid and in the Relatório aggregation.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const ref = db.doc('schedule/seg-1');
    const cur = (await ref.get()) || {};
    cur.bookings = cur.bookings || {};
    cur.bookings['08:40|r1|r1-t1'] = { patient: 'José Ávila', note: '' };
    await ref.set(cur);
  });
  await page.waitForTimeout(150);

  // Also add a patient record and a convênio, both with accents, for the Pacientes-tab test.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const ref = db.doc('patients/all');
    const cur = (await ref.get()) || {};
    cur.list = cur.list || [];
    cur.list.push({ id: 'jose-avila', nome: 'José Ávila', idade: 9, aba: 'Sim', nascimento: '', convenio: 'Convênio Antigo' });
    await ref.set(cur);
  });
  await page.waitForTimeout(150);

  // ---- TEST: grid search (#patientSearch) ignores accents and case ----
  await page.fill('#patientSearch', 'jose avila');
  await page.waitForTimeout(120);
  let matchCount = await page.locator('#gridHost .book-main.match').count();
  console.log('grid search "jose avila" (no accent) matches "José Ávila"?', matchCount >= 1);

  await page.fill('#patientSearch', 'JOSÉ');
  await page.waitForTimeout(120);
  matchCount = await page.locator('#gridHost .book-main.match').count();
  console.log('grid search "JOSÉ" (uppercase, accented) still matches?', matchCount >= 1);
  await page.fill('#patientSearch', '');
  await page.waitForTimeout(80);

  // ---- TEST: Pacientes tab list search ----
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  await page.fill('#patientListSearch', 'jose');
  await page.waitForTimeout(120);
  let names = await page.locator('.pat-table tbody tr .pt-nome').allInnerTexts();
  console.log('Pacientes search "jose" (no accent) finds "José Ávila"?', names.some(n => n.indexOf('José Ávila') !== -1));

  await page.fill('#patientListSearch', 'convenio antigo');
  await page.waitForTimeout(120);
  names = await page.locator('.pat-table tbody tr .pt-nome').allInnerTexts();
  console.log('Pacientes search "convenio antigo" (no accent) matches by convênio name?', names.length >= 1);
  await page.fill('#patientListSearch', '');
  await page.waitForTimeout(80);

  // ---- TEST: Relatório search ----
  await page.$eval('#mainTabs button[data-tab="relatorio"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  await page.fill('#reportSearch', 'avila');
  await page.waitForTimeout(120);
  let rowTexts = await page.locator('.report-table tbody tr .rpt-nome-col, .report-table tbody tr td:first-child').allInnerTexts();
  console.log('Relatório search "avila" (no accent) shows José Ávila\'s row?', rowTexts.some(t => t.indexOf('Ávila') !== -1 || t.indexOf('Avila') !== -1));
  await page.fill('#reportSearch', '');
  await page.waitForTimeout(80);

  // ---- TEST: booking-modal typeahead (#bkPatient) ----
  await page.$eval('#mainTabs button[data-tab="agenda"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  const cell = page.locator('.slotcell[data-key="09:20|r1|r1-t2"]');
  await cell.locator('.book-main').click();
  await page.waitForSelector('#bkPatient', { timeout: 3000 });
  await page.fill('#bkPatient', 'avila');
  await page.waitForTimeout(120);
  const suggestText = await page.locator('#bkSuggest').innerText();
  console.log('booking modal typeahead "avila" (no accent) suggests "José Ávila"?', suggestText.indexOf('Ávila') !== -1);
  await page.click('#closeBook');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
