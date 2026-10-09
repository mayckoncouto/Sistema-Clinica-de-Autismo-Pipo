// Cadastros → Status: tela de cadastro (lista + busca + "+ Incluir" + janela de cada status), como os outros cadastros.
// Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, 'page.html'));
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  await page.click('#cadBtn');
  await page.click('#cadMenu [data-nav="status"]');
  await page.waitForTimeout(200);
  check('Cadastros → Status opens the Status screen?', await page.$eval('#tab-status', (e) => !e.hidden));
  // incluir
  await page.click('#reg-status-add');
  await page.waitForSelector('#ovStItem');
  check('"+ Incluir" opens "Novo status"?', /Novo status/.test(await page.$eval('#ovStItem h3', (e) => e.textContent)));
  await page.fill('#stiName', 'Remarcado Teste');
  await page.click('#stiSave'); await page.waitForTimeout(300);
  const rows = await page.$$eval('#reg-status-host tbody tr', (r) => r.map((x) => x.textContent));
  check('new status listed?', rows.some((t) => /Remarcado Teste/.test(t)), rows);
  // repetido
  await page.click('#reg-status-add'); await page.waitForSelector('#ovStItem');
  await page.fill('#stiName', 'remarcado teste'); await page.click('#stiSave'); await page.waitForTimeout(200);
  check('duplicate name refused (window stays open)?', !!(await page.$('#ovStItem')));
  await page.click('#stiCancel');
  // editar
  await page.click('#reg-status-host tbody tr:has-text("Remarcado Teste")'); await page.waitForSelector('#ovStItem');
  await page.fill('#stiName', 'Remarcado'); await page.click('#stiSave'); await page.waitForTimeout(300);
  check('edit renames it?', (await page.$$eval('#reg-status-host tbody tr', (r) => r.map((x) => x.textContent))).some((t) => /^Remarcado/.test(t.trim()) && !/Teste/.test(t)));
  // busca
  await page.fill('#reg-status-search', 'remar'); await page.waitForTimeout(150);
  check('search filters the list?', (await page.$$eval('#reg-status-host tbody tr', (r) => r.length)) === 1);
  await page.fill('#reg-status-search', ''); await page.waitForTimeout(150);
  // excluir
  await page.click('#reg-status-host tbody tr:has-text("Remarcado")'); await page.waitForSelector('#ovStItem');
  await page.click('#stiDel'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('delete (with confirmation) removes it?', !(await page.$$eval('#reg-status-host tbody tr', (r) => r.map((x) => x.textContent))).some((t) => /Remarcado/.test(t)));
  // celular: barra parada, só a lista rola
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(200);
  check('mobile: Status screen is a fixed-height column like Pacientes?', await page.$eval('#tab-status', (e) => getComputedStyle(e).display === 'flex' && e.getBoundingClientRect().height <= 800));
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
