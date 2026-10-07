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

  // Especialidades: tela própria (Cadastros → Especialidades) e o seletor de cor
  // único do sistema (#cpPop), desde 2026-10-02.
  await page.$eval('#mainTabs button[data-tab="especialidades"]', (b) => b.click());
  await page.waitForSelector('#reg-especialidades-host tbody tr');
  console.log('one row per existing specialty (2)?', (await page.locator('#reg-especialidades-host tbody tr').count()) === 2);
  const tealRgb = await resolvedColor('var(--sw-teal)');
  const dotBg = await page.locator('#reg-especialidades-host tbody tr', { hasText: 'Fonoaudiologia' }).locator('.pcolor-dot').evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('specialty with no saved color shows teal?', dotBg === tealRgb);

  // ---- TEST: open Fonoaudiologia, pick a color in the color picker, save ----
  await page.locator('#reg-especialidades-host tbody tr', { hasText: 'Fonoaudiologia' }).click();
  await page.waitForSelector('#regColor');
  await page.click('#regColor');
  await page.waitForSelector('#cpPop .cp-dot');
  const PICK = '#4a63d8';
  await page.click('#cpPop .cp-dot[data-hex="' + PICK + '"]');
  await page.waitForTimeout(80);
  const hexRgb = await resolvedColor(PICK);
  console.log('picking a color updates the button live?', (await page.locator('#regColor').evaluate(el => getComputedStyle(el).backgroundColor)) === hexRgb);
  console.log('hex code shown next to the button?', (await page.innerText('#regColorCode')).trim().toLowerCase() === PICK);
  await page.click('#regSave');
  await page.waitForTimeout(150);
  const specStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  const fonoSaved = specStore.list.find(s => s.name === 'Fonoaudiologia');
  console.log('Fonoaudiologia persisted with the picked color?', fonoSaved && fonoSaved.color === PICK);
  const psicoSaved = specStore.list.find(s => s.name === 'Psicologia');
  console.log('Psicologia (untouched) keeps no/teal color?', psicoSaved && (!psicoSaved.color || psicoSaved.color === 'teal'));

  // ---- TEST: reopening shows the persisted color ----
  await page.locator('#reg-especialidades-host tbody tr', { hasText: 'Fonoaudiologia' }).click();
  await page.waitForSelector('#regColor');
  console.log('reopening shows the saved color?', (await page.locator('#regColor').evaluate(el => getComputedStyle(el).backgroundColor)) === hexRgb);
  await page.click('#regCancel');
  await page.waitForTimeout(80);

  // ---- TEST: the Relatório specialty header cells use each specialty's own color ----
  await page.$eval('#mainTabs button[data-tab="resumo"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
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
