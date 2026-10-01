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

  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(150);

  async function nomeColumn(){
    return page.locator('.pat-table tbody tr .pt-nome').allInnerTexts();
  }

  // ---- TEST: 7 columns, sort buttons on the first 6 ----
  console.log('header has 7 columns?', (await page.locator('.pat-table thead th').count()) === 7);
  console.log('6 sort buttons present (not on Especialidades)?', (await page.locator('.pat-table .sort-btn').count()) === 6);
  console.log('ABA column header present?', (await page.locator('.pat-table thead th .th-label').nth(5).innerText()) === 'ABA');

  // ---- TEST: default order is alphabetical by name ----
  let names = await nomeColumn();
  console.log('default order alphabetical by name?', JSON.stringify(names.map(n => n.trim())) ===
    JSON.stringify(['Ana Azul','Bruno Verde','Carla Laranja','Duda Vermelho','Eva Sem Idade','Paciente Um']));

  // ---- TEST: tri-state sort on Idade — asc, desc, clear ----
  const idadeBtn = page.locator('.pat-table .sort-btn[data-sort-col="idade"]');
  await idadeBtn.click();
  await page.waitForTimeout(80);
  names = await nomeColumn();
  console.log('idade asc order correct (blanks last)?', JSON.stringify(names.map(n => n.trim())) ===
    JSON.stringify(['Ana Azul','Paciente Um','Bruno Verde','Duda Vermelho','Carla Laranja','Eva Sem Idade']));
  console.log('idade sort button marked active after first click?', (await idadeBtn.evaluate(el => el.classList.contains('active'))));

  await idadeBtn.click();
  await page.waitForTimeout(80);
  names = await nomeColumn();
  console.log('idade desc order correct (blanks still last)?', JSON.stringify(names.map(n => n.trim())) ===
    JSON.stringify(['Carla Laranja','Duda Vermelho','Bruno Verde','Paciente Um','Ana Azul','Eva Sem Idade']));

  await idadeBtn.click();
  await page.waitForTimeout(80);
  names = await nomeColumn();
  console.log('third click clears sort back to alphabetical?', JSON.stringify(names.map(n => n.trim())) ===
    JSON.stringify(['Ana Azul','Bruno Verde','Carla Laranja','Duda Vermelho','Eva Sem Idade','Paciente Um']));
  console.log('idade sort button inactive after clearing?', !(await idadeBtn.evaluate(el => el.classList.contains('active'))));

  // ---- TEST: specialties summary format + registration-order (not storage order) ----
  const rowPacienteUm = page.locator('.pat-table tbody tr', { hasText: 'Paciente Um' });
  console.log('Paciente Um shows "FN 4" (explicit sigla registered)?', (await rowPacienteUm.locator('.pt-especialidades').innerText()).trim() === 'FN 4');

  const rowBruno = page.locator('.pat-table tbody tr', { hasText: 'Bruno Verde' });
  console.log('Bruno Verde shows "FN 3 - PS 2" (registration order, not storage order)?',
    (await rowBruno.locator('.pt-especialidades').innerText()).trim() === 'FN 3 - PS 2');

  // ---- TEST: patients with no specialty hours show an em dash ----
  const rowCarla = page.locator('.pat-table tbody tr', { hasText: 'Carla Laranja' });
  console.log('Carla Laranja (no specialty hours) shows placeholder?', (await rowCarla.locator('.pt-especialidades').innerText()).trim() === '—');

  // ---- TEST: Sigla field in the Especialidades registry modal ----
  // (o botão Especialidades fica na tela de Profissionais desde 2026-10-01)
  await page.click('button[data-tab="profissionais"]');
  await page.click('#manageSpecialtiesBtn');
  await page.waitForSelector('#ovSpec');
  console.log('specialties modal has a sigla input per row?', (await page.locator('#specRows .sigla-input').count()) === 2);
  const siglaValues = await page.locator('#specRows .sigla-input').evaluateAll(els => els.map(e => e.value));
  console.log('Fonoaudiologia row pre-filled with explicit sigla "FN"?', siglaValues[0] === 'FN');
  console.log('Psicologia row has no explicit sigla yet (fallback placeholder "PS")?', siglaValues[1] === '' &&
    (await page.locator('#specRows .sigla-input').nth(1).getAttribute('placeholder')) === 'PS');

  // Set Psicologia's sigla explicitly and save.
  await page.locator('#specRows .sigla-input').nth(1).fill('ps');
  await page.click('#specSave');
  await page.waitForTimeout(150);
  const specStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  console.log('saved sigla is upper-cased?', specStore.list.filter(s => s.id === 'psico')[0].sigla === 'PS');

  await page.click('button[data-tab="pacientes"]');
  await page.waitForTimeout(100);
  console.log('after save, Bruno Verde summary still "FN 3 - PS 2" (now from an explicit sigla)?',
    (await rowBruno.locator('.pt-especialidades').innerText()).trim() === 'FN 3 - PS 2');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
