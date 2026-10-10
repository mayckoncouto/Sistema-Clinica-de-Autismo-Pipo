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
  const td2 = page.locator('td.slotcell[data-key="13:30|coord|coord-t1"]');
  await td2.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Sala Azul');
  await page.waitForSelector('.autolist button', { timeout: 3000 });
  const suggestHtml = await page.locator('#bkSuggest').innerHTML();
  console.log('room suggestion offered in the group column?', suggestHtml.includes('Sala Azul'));
  await page.locator('#bkSuggest button', { hasText: 'Sala Azul' }).first().click();
  await page.click('#bkSave');
  await page.waitForTimeout(150);
  const roomBookingText = await td2.innerText();
  console.log('booked with room name "Sala Azul"?', roomBookingText.includes('Sala Azul'));

  // ---- TEST: room editor hex color input ----
  await page.$eval('#mainTabs button[data-tab="salas"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(100);
  await page.locator('[data-edit="r1"]').click();
  await page.waitForSelector('#ovRoom');
  // Cor da sala pelo seletor de cor único (#cpPop), desde 2026-10-02.
  await page.click('#rmColorBtn');
  await page.waitForSelector('#cpPop .cp-dot');
  await page.click('#cpPop .cp-dot[data-hex="#0a8ef0"]');
  await page.waitForTimeout(60);
  console.log('color code updates live?', (await page.innerText('#rmColorCode')).trim().toLowerCase() === '#0a8ef0');
  await page.click('#rmSave');
  await page.waitForTimeout(150);
  console.log('=== room store after hex save ===', await page.evaluate(() => JSON.stringify(window.__STORE__['config/rooms'])));

  // ---- TEST: patient modal — birth date auto-computes idade, ABA select, per-patient specialties ----
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(100);
  await page.click('#addPatientBtn');
  await page.waitForSelector('#ovPat');
  await page.fill('#pNome', 'Novo Paciente Teste'); await page.fill('#pf-cpf', '11144477735'); // CPF é obrigatório
  await page.$eval('#pNasc', (el) => { el.value = '2020-01-15'; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }); // campo de data vira calendário próprio
  await page.waitForTimeout(50);
  const idadeCalcVal = await page.locator('#pIdadeCalc').inputValue().catch(() => null);
  console.log('idade auto-calculada a partir do nascimento:', idadeCalcVal);
  // Salvar o paciente novo já abre o Tratamento dele (ABA, especialidades... ficam lá).
  await page.click('#pSave');
  await page.waitForSelector('#ovTreat');
  console.log('new patient opens its treatment right away?', (await page.$eval('#trPat', s => s.options[s.selectedIndex].text)) === 'Novo Paciente Teste');
  await page.$eval('#pAba', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, 'Não'); // select vira lista própria (dpEnhance)
  // dois quadros (o ABA do tratamento vem marcado em cada quadro novo)
  const TL = require('./tl-helper');
  await TL.addLine(page, {spec: 'Fonoaudiologia', hours: 3});
  await TL.addLine(page, {spec: 'Psicologia', hours: 2});
  await page.click('#trSave');
  await page.waitForTimeout(200);

  const patientsStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['patients/all'])));
  const newPatient = patientsStore.list.find(p => p.nome === 'Novo Paciente Teste');
  console.log('=== novo paciente salvo ===', JSON.stringify(newPatient));
  const treat = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['treatments/all'])))).list.find(t => t.patientId === newPatient.id);
  console.log('=== tratamento do novo paciente ===', JSON.stringify(treat));
  console.log('treatment saved with ABA "Não" and 2 specialties (cards keep ABA Não)?', !!treat && treat.aba === 'Não' && treat.specHours.length === 2 && treat.specHours.every(h => h.aba === 'Não' && h.service === 'sessao' && h.id));
  const specialtiesStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  console.log('=== catálogo de especialidades após criar "Equoterapia" ===', JSON.stringify(specialtiesStore));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
