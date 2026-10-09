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

  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);

  async function nomeColumn(){
    return page.locator('#patListHost .pat-table tbody tr .pt-nome').allInnerTexts();
  }

  // ---- TEST: 4 columns (only patient data + treatment status), all sortable ----
  const heads = await page.locator('#patListHost .pat-table thead th .th-label').allTextContents();
  console.log('columns are Nome, Idade, Telefone, E-mail, Escola, Médico, Status, Tratamento?', JSON.stringify(heads) === '["Nome","Idade","Telefone","E-mail","Escola","Médico","Status","Tratamento"]', JSON.stringify(heads));
  console.log('8 sort buttons present?', (await page.locator('#patListHost .pat-table .sort-btn').count()) === 8);
  console.log('treatment column shows "Sem tratamento" when the patient has none?', (await page.locator('#patListHost .pat-table tbody tr', { hasText: 'Ana Azul' }).locator('.pt-trat').innerText()).trim() === 'Sem tratamento');
  await page.fill('#patientListSearch', 'unimed'); await page.waitForTimeout(80);
  console.log('search is by name only (convênio does not match)?', (await page.locator('#patListHost .pat-table tbody tr').count()) === 0);
  await page.fill('#patientListSearch', ''); await page.waitForTimeout(80);

  // ---- TEST: default order is alphabetical by name ----
  let names = await nomeColumn();
  console.log('default order alphabetical by name?', JSON.stringify(names.map(n => n.trim())) ===
    JSON.stringify(['Ana Azul','Bruno Verde','Carla Laranja','Duda Vermelho','Eva Sem Idade','Paciente Um']));

  // ---- TEST: tri-state sort on Idade — asc, desc, clear ----
  const idadeBtn = page.locator('#patListHost .pat-table .sort-btn[data-sort-col="idade"]');
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

  // ---- TEST: Sigla no cadastro de Especialidades (Cadastros → Especialidades, desde 2026-10-02) ----
  await page.$eval('#mainTabs button[data-tab="especialidades"]', (b) => b.click());
  await page.waitForSelector('#reg-especialidades-host tbody tr');
  const siglaCells = await page.locator('#reg-especialidades-host tbody tr').evaluateAll(trs => trs.map(tr => tr.children[0].innerText.trim() + '=' + tr.children[1].innerText.trim()));
  console.log('Fonoaudiologia shows explicit sigla "FN"?', siglaCells.indexOf('Fonoaudiologia=FN') !== -1);
  console.log('Psicologia shows fallback sigla "PS"?', siglaCells.indexOf('Psicologia=PS') !== -1);
  // Set Psicologia's sigla explicitly and save.
  await page.locator('#reg-especialidades-host tbody tr', { hasText: 'Psicologia' }).click();
  await page.waitForSelector('#regSigla');
  console.log('Psicologia has no explicit sigla yet (placeholder "PS")?', (await page.inputValue('#regSigla')) === '' && (await page.getAttribute('#regSigla', 'placeholder')) === 'PS');
  await page.fill('#regSigla', 'ps');
  await page.click('#regSave');
  await page.waitForTimeout(150);
  const specStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/specialties'])));
  console.log('saved sigla is upper-cased?', specStore.list.filter(s => s.id === 'psico')[0].sigla === 'PS');


  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
