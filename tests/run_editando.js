// Aviso "Fulana está com este cadastro aberto agora" (presença). Dados fictícios.
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
  const keys = () => page.evaluate(() => window.__epKeys());

  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForTimeout(300);
  const k = await keys();
  check('patient window announces its key?', k.length === 1 && /^paciente:/.test(k[0]), k.join(','));

  await page.evaluate((key) => window.__epSim({ outra: [{ keys: [key], name: 'Beatriz Teste', uid: 'x', at: { [key]: new Date().toISOString() } }] }), k[0]);
  const txt = await page.$eval('#ovPat .ep-note', (n) => n.textContent).catch(() => '');
  check('warning shows the other person?', /Beatriz Teste/.test(txt) && /com este cadastro aberto/.test(txt), txt);

  await page.evaluate(() => window.__epSim({ outra: [{ keys: ['paciente:outro'], name: 'Beatriz Teste' }] }));
  check('other record = no warning?', !(await page.$('#ovPat .ep-note')));

  await page.evaluate(() => window.__epSim({}));
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  check('closing removes the key?', (await keys()).length === 0);

  // Cadastro novo não anuncia
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#addPatientBtn');
  await page.waitForSelector('#ovPat'); await page.waitForTimeout(250);
  check('new record does not announce?', (await keys()).length === 0);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // Outra janela (Status) também anuncia
  await page.click('#cadBtn'); await page.click('#cadMenu [data-nav="status"]'); await page.waitForTimeout(200);
  await page.click('#reg-status-add'); await page.waitForSelector('#ovStItem'); await page.fill('#stiName', 'Status Editando'); await page.click('#stiSave'); await page.waitForTimeout(300);
  await page.click('#reg-status-host tbody tr:has-text("Status Editando")'); await page.waitForSelector('#ovStItem'); await page.waitForTimeout(250);
  const k2 = await keys();
  check('status window announces its key?', k2.length === 1 && /^status:/.test(k2[0]), k2.join(','));

  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  if (fails) { console.log('FAILED', fails); process.exit(1); }
  console.log('ALL PASS');
})();
