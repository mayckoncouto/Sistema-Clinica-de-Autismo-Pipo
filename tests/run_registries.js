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
  console.log('patients table no longer shows treatment columns (Especialidades/Convênio)?', !tableHeaderHtml.includes('Especialidades') && !tableHeaderHtml.includes('Convênio'));
  console.log('table header no longer says "(h/mês)"?', !tableHeaderHtml.includes('(h/mês)'));

  // Open an existing patient (Paciente Um, legacy convenio:"Unimed" string, matches catalog "unimed")
  const rowPU = page.locator('#patListHost .pat-table tbody tr', { hasText: 'Paciente Um' });
  await rowPU.click();
  await page.waitForSelector('#ovPat');
  // Convênio, plano, pacote, ABA e especialidades ficam no Tratamento (desde 2026-10-03):
  // paciente sem tratamento → "+ Novo tratamento", que já vem com os dados antigos dele.
  console.log('patient modal no longer has the treatment fields?', (await page.$('#pAba')) === null);
  await page.click('#pNewTreat');
  await page.waitForSelector('#ovTreat');
  console.log('label "Sessão/Mês"?', (await page.locator('label[for="pPac"]').innerText()) === 'Sessão/Mês');
  console.log('label "ABA" (not "Faz ABA?")?', (await page.locator('label[for="pAba"]').innerText()) === 'ABA');
  console.log('label "Especialidades e serviços"?', (await page.locator('#ovTreat .field', { has: page.locator('#specRowsHost') }).locator('label').first().innerText()).includes('Especialidades e serviços'));

  // ---- TEST: legacy convenio text resolved against catalog (Unimed matches) ----
  const convVal = await page.locator('#pConv').inputValue();
  console.log('legacy convenio "Unimed" resolved and shown?', convVal === 'Unimed');
  await page.click('#trCancel');
  await page.waitForTimeout(100);

  // Open a patient whose legacy convenio text has NO catalog match ("Convênio Antigo")
  const rowAna = page.locator('#patListHost .pat-table tbody tr', { hasText: 'Ana Azul' });
  await rowAna.click();
  await page.waitForSelector('#ovPat');
  await page.click('#pNewTreat');
  await page.waitForSelector('#ovTreat');
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

  // ---- TEST: quadros do tratamento — inclui Fonoaudiologia e cria "Terapia Ocupacional" pelo "+ Incluir" da lista ----
  const TL = require('./tl-helper');
  console.log('added a Fonoaudiologia card?', await TL.addLine(page, {spec: 'Fonoaudiologia', hours: 4}));
  await page.click('#specRowAdd'); await page.waitForSelector('#ovTLine');
  await page.evaluate(() => { const b = document.querySelector('[data-dp-for="tlSpec"]'); (b.querySelector('.dp-in') || b).click(); });
  await page.waitForSelector('#dpPop');
  await page.type('[data-dp-for="tlSpec"] .dp-in', 'Terapia Ocupacional'); await page.waitForTimeout(150);
  await page.click('#dpPop .dp-add'); await page.waitForSelector('#qkName');
  console.log('"+ Incluir" opens the quick window with the typed name?', (await page.inputValue('#qkName')) === 'Terapia Ocupacional');
  await page.click('#qkSave'); await page.waitForTimeout(250);
  console.log('inline-created specialty auto-selected in the card window?', await page.evaluate(() => { const s = document.getElementById('tlSpec'); return s.options[s.selectedIndex].textContent; }) === 'Terapia Ocupacional');
  await page.fill('#tlHours', '2'); await page.click('#tlSave'); await page.waitForTimeout(150);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(150); }
  const cards = await TL.lines(page);
  console.log('two cards, the same visual of the room cards?', cards.length === 2 && cards[1].name === 'Terapia Ocupacional' && await page.$$eval('#specRowsHost .room-row [data-tl-edit]', (a) => a.length) === 2, JSON.stringify(cards));

  await page.click('#trSave');
  await page.waitForTimeout(200);

  const treatStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['treatments/all'])));
  const savedAna = treatStore.list.find(t => t.patientId === 'ana-azul');
  console.log('=== Ana Azul treatment saved ===', JSON.stringify(savedAna));
  console.log('treatment is Ativo and Novo?', savedAna.status === 'ativo' && savedAna.tipo === 'novo');
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
  console.log('patients list does not show convênio (it lives in the treatment)?', !listHtml.includes('Amil Saúde'));
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
