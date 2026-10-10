// Cadastros → Escolas: campo Município no formulário, coluna na lista e busca pelo município.
// Dados 100% fictícios.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForTimeout(900);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await page.evaluate(() => { const b = document.querySelector('#mainTabs button[data-tab=escolas], [data-tab=escolas]'); b.hidden = false; b.click(); });
  await page.waitForTimeout(300);
  await page.click('#reg-escolas-add'); await page.waitForTimeout(300);
  check('form has Município field?', await page.$('#regf-municipio'));
  const labels = await page.$$eval('.modal label', (l) => l.map((x) => x.textContent.trim()));
  check('Município comes before Telefone?', labels.indexOf('Município') !== -1 && labels.indexOf('Município') < labels.indexOf('Telefone'), JSON.stringify(labels));
  const nameInput = await page.$('.modal input[type=text]:not([data-regf])');
  await nameInput.fill('Escola Teste Arco-Íris');
  await page.fill('#regf-municipio', 'Gaspar');
  await page.click('.modal .btn.primary'); await page.waitForTimeout(500);
  const head = await page.$$eval('#reg-escolas-host th', (t) => t.map((x) => x.textContent.trim()));
  check('columns Nome, Município, Telefone, Pacientes?', head.slice(0, 4).join('|') === 'Nome|Município|Telefone|Pacientes', JSON.stringify(head));
  const row = await page.$$eval('#reg-escolas-host tbody tr', (r) => r.map((x) => x.textContent));
  check('row shows the município?', row.some((t) => /Arco-Íris/.test(t) && /Gaspar/.test(t)), JSON.stringify(row));
  await page.fill('#reg-escolas-search', 'gaspar'); await page.waitForTimeout(300);
  const found = await page.$$eval('#reg-escolas-host tbody tr', (r) => r.map((x) => x.textContent));
  check('search by município finds the school?', found.length === 1 && /Arco-Íris/.test(found[0]), JSON.stringify(found));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
