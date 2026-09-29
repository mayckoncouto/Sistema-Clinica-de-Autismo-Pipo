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

  // ---- TEST: color-by-age on empty cells opened for different patients ----
  // Booking modal for an empty cell, search "Ana Azul" (idade 3 -> blue) and save.
  async function bookPatientAt(cellKey, patientName) {
    const td = page.locator(`td.slotcell[data-key="${cellKey}"]`);
    await td.locator('.book-main').click();
    await page.waitForSelector('#ovBook');
    await page.fill('#bkPatient', patientName);
    await page.waitForSelector('.autolist button', { timeout: 3000 });
    // click the suggestion matching the exact name
    await page.locator('#bkSuggest button', { hasText: patientName }).first().click();
    await page.click('#bkSave');
    await page.waitForTimeout(150);
  }

  await bookPatientAt('08:00|r1|r1-t1', 'Ana Azul');
  await bookPatientAt('08:40|r1|r1-t1', 'Bruno Verde');
  await bookPatientAt('09:20|r1|r1-t1', 'Carla Laranja');
  await bookPatientAt('10:00|r1|r1-t1', 'Duda Vermelho');
  await bookPatientAt('10:40|r1|r1-t1', 'Eva Sem Idade');

  const bg = async (key) => page.locator(`td.slotcell[data-key="${key}"] .book-main`).evaluate(el => el.style.background);
  console.log('Ana Azul (0-4) bg:', await bg('08:00|r1|r1-t1'), '(expect #AECCE5-ish)');
  console.log('Bruno Verde (5-9) bg:', await bg('08:40|r1|r1-t1'), '(expect #C4DCA9-ish)');
  console.log('Carla Laranja (10+) bg:', await bg('09:20|r1|r1-t1'), '(expect #F4CC99-ish)');
  console.log('Duda Vermelho (ABA=Não) bg:', await bg('10:00|r1|r1-t1'), '(expect #F4B7B7-ish, overrides age 8)');
  console.log('Eva Sem Idade bg:', await bg('10:40|r1|r1-t1'), '(expect empty/none)');

  // ---- TEST: unified search finds a ROOM too, and booking with a room name works ----
  const td2 = page.locator('td.slotcell[data-key="13:30|r1|r1-t2"]');
  await td2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Sala Azul');
  await page.waitForSelector('.autolist button', { timeout: 3000 });
  const suggestHtml = await page.locator('#bkSuggest').innerHTML();
  console.log('room suggestion shows "Sala" tag?', suggestHtml.includes('>Sala<'));
  await page.locator('#bkSuggest button', { hasText: 'Sala Azul' }).first().click();
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  const roomBookingText = await td2.innerText();
  console.log('booked with room name "Sala Azul"?', roomBookingText.includes('Sala Azul'));

  // ---- TEST: room editor hex color input ----
  await page.click('button[data-tab="salas"]');
  await page.waitForTimeout(100);
  await page.locator('[data-edit="r1"]').click();
  await page.waitForSelector('#ovRoom');
  await page.fill('#rmHexInput', '#ff00aa');
  const previewBg = await page.locator('#rmHexPreview').evaluate(el => el.style.background);
  console.log('hex preview updates live?', previewBg.replace(/\s/g,'').toLowerCase().includes('255,0,170') || previewBg.toLowerCase().includes('#ff00aa'));
  const anySwatchSelected = await page.locator('.swatch-btn.selected').count();
  console.log('typing hex deselects swatch buttons?', anySwatchSelected === 0);
  await page.click('#rmSave');
  await page.waitForTimeout(150);
  console.log('=== room store after hex save ===', await page.evaluate(() => JSON.stringify(window.__STORE__['config/rooms'])));

  // ---- TEST: patient modal — birth date auto-computes idade, ABA select, per-patient specialties ----
  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(100);
  await page.click('#addPatientBtn');
  await page.waitForSelector('#ovPat');
  await page.fill('#pNome', 'Novo Paciente Teste');
  await page.fill('#pNasc', '2020-01-15'); // should compute an age
  await page.waitForTimeout(50);
  const idadeCalcVal = await page.locator('#pIdadeCalc').inputValue().catch(() => null);
  console.log('idade auto-calculada a partir do nascimento:', idadeCalcVal);
  await page.selectOption('#pAba', 'Não');
  // add a specialty row referencing an EXISTING one, and a brand-new one
  await page.click('#specRowAdd');
  await page.waitForTimeout(50);
  let rows = page.locator('#specRowsHost .hours-row');
  let n = await rows.count();
  await rows.nth(n-1).locator('.spec-name').fill('Fonoaudiologia');
  await rows.nth(n-1).locator('.spec-hours-val').fill('3');
  await page.click('#specRowAdd');
  await page.waitForTimeout(50);
  rows = page.locator('#specRowsHost .hours-row');
  n = await rows.count();
  await rows.nth(n-1).locator('.spec-name').fill('Equoterapia'); // brand-new specialty not in catalog
  await rows.nth(n-1).locator('.spec-hours-val').fill('2');
  await page.click('#pSave');
  await page.waitForTimeout(200);

  const patientsStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['patients/all'])));
  const newPatient = patientsStore.list.find(p => p.nome === 'Novo Paciente Teste');
  console.log('=== novo paciente salvo ===', JSON.stringify(newPatient));
  const specialtiesStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  console.log('=== catálogo de especialidades após criar "Equoterapia" ===', JSON.stringify(specialtiesStore));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
