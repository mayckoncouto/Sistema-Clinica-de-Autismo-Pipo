const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);

  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  // ---- TEST: label renames ----
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(100);
  // thead cells are CSS text-transform:uppercase, so read raw HTML rather than the
  // rendered innerText (which comes back uppercased) to check the literal label text.
  const tableHeaderHtml = await page.locator('#patListHost .pat-table thead').innerHTML();
  console.log('table header uses "Especialidades/Serviços (sessão/mês)"?', tableHeaderHtml.includes('Especialidades/Serviços (sessão/mês)'));
  console.log('table header no longer says "(h/mês)"?', !tableHeaderHtml.includes('(h/mês)'));

  // Open an existing patient (Paciente Um, legacy convenio:"Unimed" string, matches catalog "unimed")
  const rowPU = page.locator('#patListHost .pat-table tbody tr', { hasText: 'Paciente Um' });
  await rowPU.click();
  await page.waitForSelector('#ovPat');
  console.log('label "Pacote (sessão/mês)"?', (await page.locator('label[for="pPac"]').innerText()) === 'Pacote (sessão/mês)');
  console.log('label "ABA" (not "Faz ABA?")?', (await page.locator('label[for="pAba"]').innerText()) === 'ABA');
  console.log('label "Especialidades/serviços e sessão (mês)"?', (await page.locator('#ovPat .field', { has: page.locator('#specRowsHost') }).locator('label').first().innerText()).includes('Especialidades/serviços e sessão (mês)'));

  // ---- TEST: legacy convenio text resolved against catalog (Unimed matches) ----
  const convVal = await page.locator('#pConv').inputValue();
  console.log('legacy convenio "Unimed" resolved and shown?', convVal === 'Unimed');
  await page.click('#pCancel');
  await page.waitForTimeout(100);

  // Open a patient whose legacy convenio text has NO catalog match ("Convênio Antigo")
  const rowAna = page.locator('#patListHost .pat-table tbody tr', { hasText: 'Ana Azul' });
  await rowAna.click();
  await page.waitForSelector('#ovPat');
  const convValAna = await page.locator('#pConv').inputValue();
  console.log('unresolved legacy convenio text preserved verbatim?', convValAna === 'Convênio Antigo');

  // ---- TEST: convênio picker shows catalog suggestions + "cadastrar novo" ----
  await page.fill('#pConv', '');
  await page.click('#pConv');
  await page.waitForSelector('#pConvSuggest button', { timeout: 3000 });
  const convSuggestHtml = await page.locator('#pConvSuggest').innerHTML();
  console.log('convênio suggestions include "Unimed"?', convSuggestHtml.includes('Unimed'));
  console.log('convênio suggestions include "Bradesco Saúde"?', convSuggestHtml.includes('Bradesco Saúde'));

  // Type a brand-new convênio name and use "+ Cadastrar novo convênio"
  await page.fill('#pConv', 'Amil Saúde');
  await page.waitForSelector('#pConvSuggest button.autolist-new', { timeout: 3000 });
  await page.click('#pConvSuggest button.autolist-new');
  const convValAfterCreate = await page.locator('#pConv').inputValue();
  console.log('newly created convênio auto-selected in field?', convValAfterCreate === 'Amil Saúde');

  // ---- TEST: specialty row exclusion — already-added specialty shouldn't reappear ----
  // Ana Azul has no specHours yet; add "Fonoaudiologia" in row 1, then check row 2's
  // suggestions no longer offer Fonoaudiologia.
  await page.click('#specRowAdd');
  await page.waitForTimeout(50);
  let rows = page.locator('#specRowsHost .hours-row');
  await rows.nth(0).locator('.spec-name').click();
  await page.waitForSelector('#specRowsHost .hours-row:nth-child(1) .autolist button', { timeout: 3000 });
  await rows.nth(0).locator('.autolist button', { hasText: 'Fonoaudiologia' }).click();
  await rows.nth(0).locator('.spec-hours-val').fill('4');

  await page.click('#specRowAdd');
  await page.waitForTimeout(50);
  rows = page.locator('#specRowsHost .hours-row');
  const n2 = await rows.count();
  await rows.nth(n2-1).locator('.spec-name').click();
  await page.waitForTimeout(100);
  const row2SuggestHtml = await rows.nth(n2-1).locator('.autolist').innerHTML();
  console.log('row 2 suggestions EXCLUDE already-picked Fonoaudiologia?', !row2SuggestHtml.includes('Fonoaudiologia'));
  console.log('row 2 suggestions still include unused Psicologia?', row2SuggestHtml.includes('Psicologia'));

  // Create a brand-new specialty inline from row 2, verify it's usable and won't
  // reappear as an option for a subsequent row.
  await rows.nth(n2-1).locator('.spec-name').fill('Terapia Ocupacional');
  await rows.nth(n2-1).locator('.autolist button.autolist-new').waitFor({ timeout: 3000 });
  await rows.nth(n2-1).locator('.autolist button.autolist-new').click();
  await rows.nth(n2-1).locator('.spec-hours-val').fill('2');
  const row2Val = await rows.nth(n2-1).locator('.spec-name').inputValue();
  console.log('inline-created specialty auto-selected in row 2?', row2Val === 'Terapia Ocupacional');

  await page.click('#pSave');
  await page.waitForTimeout(200);

  const patientsStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['patients/all'])));
  const savedAna = patientsStore.list.find(p => p.nome === 'Ana Azul');
  console.log('=== Ana Azul saved record ===', JSON.stringify(savedAna));
  console.log('convenioId points at newly-created "Amil Saúde"?', !!savedAna.convenioId);

  const conveniosStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/convenios'])));
  console.log('=== catálogo de convênios após criar "Amil Saúde" ===', JSON.stringify(conveniosStore));
  const amil = conveniosStore.list.find(c => c.name === 'Amil Saúde');
  console.log('Amil Saúde persisted to shared catalog?', !!amil && amil.id === savedAna.convenioId);

  const specialtiesStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  console.log('=== catálogo de especialidades após criar "Terapia Ocupacional" ===', JSON.stringify(specialtiesStore));
  console.log('Terapia Ocupacional persisted to shared catalog?', !!specialtiesStore.list.find(s => s.name === 'Terapia Ocupacional'));

  // ---- TEST: patients list shows resolved convênio name + "x/mês" units ----
  const listHtml = await page.locator('#patListHost').innerText();
  console.log('patients list shows resolved "Amil Saúde" for Ana Azul?', listHtml.includes('Amil Saúde'));
  console.log('patients list never uses the old "h/mês" unit?', !listHtml.includes('h/mês'));

  // ---- TEST: Convênios (Cadastros → Convênios, desde 2026-10-02) ----
  await page.$eval('#mainTabs button[data-tab="convenios"]', (b) => b.click());
  await page.waitForSelector('#reg-convenios-host tbody tr');
  const convNames = await page.locator('#reg-convenios-host tbody tr').evaluateAll(trs => trs.map(tr => tr.children[0].innerText.trim()));
  console.log('Convênios screen lists Unimed and Bradesco Saúde?', convNames.includes('Unimed') && convNames.includes('Bradesco Saúde'));
  await page.click('#reg-convenios-add');
  await page.waitForSelector('#regName');
  await page.fill('#regName', 'SulAmérica');
  await page.click('#regSave');
  await page.waitForTimeout(150);
  const conveniosAfterRegistry = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/convenios'])));
  console.log('SulAmérica added via Convênios screen?', !!conveniosAfterRegistry.list.find(c => c.name === 'SulAmérica'));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
