// Unidades (Fase 1): cadastro Unidades em Cadastros, CNPJ único, nome na tela de login, Ajuda.
// Dados fictícios (CNPJs de exemplo válidos: 11.222.333/0001-81 e 45.723.174/0001-10).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const rows = () => page.$$eval('#reg-unidades-host tbody tr', (r) => r.map((x) => x.textContent));
  await page.$eval('#mainTabs button[data-tab="unidades"]', (b) => b.click());
  await page.waitForTimeout(200);
  check('Unidades screen opens with title?', await page.$eval('#tab-unidades', (e) => !e.hidden) && /Unidades/.test(await page.$eval('#tab-unidades .cad-title', (e) => e.textContent)));
  check('Cadastros menu no longer lists Unidades (it lives in Acesso)?', await (async () => { await page.click('#cadBtn'); const ok = !(await page.$('#cadMenu [data-nav="unidades"]')); await page.keyboard.press('Escape'); return ok; })());
  // incluir
  await page.click('#reg-unidades-add'); await page.waitForSelector('#ovReg');
  check('window labels: Nome na Tela de Login + fields?', (await page.$eval('#ovReg label[for="regName"]', (e) => e.textContent)) === 'Nome na Tela de Login'
    && !!(await page.$('#regf-fantasia')) && !!(await page.$('#regf-cnpj')) && !!(await page.$('#regf-cidade')));
  await page.fill('#regName', 'Unidade 1 – Blumenau'); await page.fill('#regf-fantasia', 'Clínica Pipo'); await page.fill('#regf-cnpj', '11222333000181'); await page.fill('#regf-cidade', 'Blumenau');
  await page.click('#regSave'); await page.waitForTimeout(300);
  check('first unit listed?', (await rows()).length === 1 && /Unidade 1 – Blumenau/.test((await rows())[0]) && /11\.222\.333\/0001-81/.test((await rows())[0]), (await rows())[0]);
  // mesmo nome fantasia, CNPJ diferente: permitido
  await page.click('#reg-unidades-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Unidade 2 – Joinville'); await page.fill('#regf-fantasia', 'Clínica Pipo'); await page.fill('#regf-cnpj', '45723174000110');
  await page.click('#regSave'); await page.waitForTimeout(300);
  check('same fantasy name with other CNPJ accepted?', (await rows()).length === 2);
  // mesmo CNPJ: recusado
  await page.click('#reg-unidades-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Unidade 3'); await page.fill('#regf-cnpj', '45723174000110');
  await page.click('#regSave'); await page.waitForTimeout(200);
  check('same CNPJ refused?', !!(await page.$('#ovReg')) && (await rows()).length === 2);
  await page.click('#regCancel');
  // editar o nome da lista de login
  await page.click('#reg-unidades-host tbody tr:nth-child(2)'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Joinville'); await page.click('#regSave'); await page.waitForTimeout(300);
  check('login name editable?', /Joinville/.test((await rows()).join()) && !/Unidade 2 – Joinville/.test((await rows()).join()));
  // ajuda: o "?" da tela abre o tópico Unidades
  await page.click('#tab-unidades .help-q'); await page.waitForTimeout(300);
  check('help topic for the screen opens?', await page.$eval('#tab-ajuda', (e) => !e.hidden) && /Gestão/.test(await page.$eval('#helpBody', (e) => e.textContent)) && /Unidades/.test(await page.$eval('#helpBody h3, #helpBody h2', (e) => e.textContent)));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails ? 'FALHOU: ' + fails : 'Tudo certo');
  process.exit(fails ? 1 : 0);
})();
