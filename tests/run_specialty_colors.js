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

  // Helper: resolve a swatch key or hex to the rgb() string a browser reports for it.
  async function resolvedColor(cssValue) {
    return page.evaluate((v) => {
      const el = document.createElement('div');
      el.style.background = v;
      document.body.appendChild(el);
      const rgb = getComputedStyle(el).backgroundColor;
      el.remove();
      return rgb;
    }, cssValue);
  }

  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(150);

  // ---- TEST: opening Especialidades shows a color swatch button per row, default teal ----
  await page.click('#manageSpecialtiesBtn');
  await page.waitForSelector('#ovSpec');
  console.log('one color button per existing specialty (2)?', (await page.locator('.spec-color-btn').count()) === 2);
  // Mock data order: index 0 = Fonoaudiologia ("fono"), index 1 = Psicologia ("psico").
  const fonoRow = page.locator('.therapist-row').nth(0);
  console.log('row 0 is Fonoaudiologia?', (await fonoRow.locator('.spec-name-inp').inputValue()) === 'Fonoaudiologia');
  const fonoColorBtn = fonoRow.locator('.spec-color-btn');
  const fonoBtnBg = await fonoColorBtn.evaluate(el => getComputedStyle(el).backgroundColor);
  const tealRgb = await resolvedColor('var(--sw-teal)');
  console.log('specialty with no saved color defaults to teal?', fonoBtnBg === tealRgb);

  // ---- TEST: clicking the color button opens an inline swatch panel ----
  await fonoColorBtn.click();
  await page.waitForTimeout(80);
  console.log('color panel opens with 10 swatches?', (await page.locator('.spec-color-panel .swatch-btn').count()) === 10);

  // ---- TEST: picking a swatch updates the row's color button + hex preview ----
  await page.locator('.spec-color-panel .swatch-btn[data-color="rose"]').click();
  await page.waitForTimeout(60);
  const roseRgb = await resolvedColor('var(--sw-rose)');
  const fonoBtnBgAfter = await fonoColorBtn.evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('picking "rose" updates the color button live?', fonoBtnBgAfter === roseRgb);
  console.log('the rose swatch shows as selected?', (await page.locator('.spec-color-panel .swatch-btn[data-color="rose"]').getAttribute('class') || '').includes('selected'));

  // ---- TEST: typing a hex code also updates the color ----
  await page.locator('.spec-color-panel .spec-hex-inp').fill('#123456');
  await page.waitForTimeout(60);
  const hexRgb = await resolvedColor('#123456');
  const fonoBtnBgHex = await fonoColorBtn.evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('typing a hex code updates the color button?', fonoBtnBgHex === hexRgb);

  // ---- TEST: saving persists the color to config/specialties ----
  await page.click('#specSave');
  await page.waitForTimeout(120);
  const specStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  const fonoSaved = specStore.list.find(s => s.name === 'Fonoaudiologia');
  console.log('Fonoaudiologia persisted with color "#123456"?', fonoSaved && fonoSaved.color === '#123456');
  const psicoSaved = specStore.list.find(s => s.name === 'Psicologia');
  console.log('Psicologia (untouched) persisted with default color "teal"?', psicoSaved && psicoSaved.color === 'teal');

  // ---- TEST: reopening the modal shows the persisted color ----
  await page.click('#manageSpecialtiesBtn');
  await page.waitForSelector('#ovSpec');
  const fonoBtnReopened = await page.locator('.therapist-row').nth(0).locator('.spec-color-btn').evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('reopening the modal shows the saved color?', fonoBtnReopened === hexRgb);
  await page.click('#specCancel');
  await page.waitForTimeout(80);

  // ---- TEST: the Relatório specialty header cells use each specialty's own color ----
  await page.click('button[data-tab="relatorio"]');
  await page.waitForTimeout(200);
  const fonoHeaderBg = await page.locator('.rpt-spec-name', { hasText: 'Fonoaudiologia' }).evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('Relatório "Fonoaudiologia" header uses its saved hex color?', fonoHeaderBg === hexRgb);
  const psicoHeaderBg = await page.locator('.rpt-spec-name', { hasText: 'Psicologia' }).evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('Relatório "Psicologia" header uses default teal?', psicoHeaderBg === tealRgb);
  const fonoTotalBg = await page.locator('.rpt-spec-total').nth(0).evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('Relatório specialty-total row also picks up the specialty color (first group)?', fonoTotalBg === hexRgb || fonoTotalBg === tealRgb);

  // ---- TEST: a professional with no matching specialty falls back to a neutral slate ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const ref = db.doc('config/professionals');
    const cur = (await ref.get()).data();
    cur.list.push({ id: 'no-spec-prof', name: 'Sem Especialidade Pro', specialtyId: 'nao-existe' });
    await ref.set(cur);
  });
  await page.waitForTimeout(200);
  const slateRgb = await resolvedColor('var(--sw-slate)');
  const semEspecialidadeBg = await page.locator('.rpt-spec-name', { hasText: 'Sem especialidade' }).evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('"Sem especialidade" group header falls back to neutral slate?', semEspecialidadeBg === slateRgb);

  // ---- TEST: header text stays readable (white) regardless of the swatch/hex chosen ----
  const fonoHeaderColor = await page.locator('.rpt-spec-name', { hasText: 'Fonoaudiologia' }).evaluate(el => getComputedStyle(el).color);
  console.log('specialty header text stays white?', fonoHeaderColor === 'rgb(255, 255, 255)');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
