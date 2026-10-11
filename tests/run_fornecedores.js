// Cadastros → Fornecedores: lista, busca, "+ Incluir", CNPJ/CPF com máscara e conferência, repetido, editar, excluir, celular.
// Dados fictícios (CNPJ de exemplo válido: 11.222.333/0001-81).
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
  const setSel = (id, v) => page.$eval(id, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await page.evaluate(async () => { const db = await window.claude.use('db'); await db.doc('config/supplier_categories').set({ list: [{ id: 'material', name: 'Material' }, { id: 'escritorio', name: 'Escritório' }] }); });
  await page.waitForTimeout(200);
  await page.click('#cadBtn');
  check('menu Cadastros lists Fornecedores?', !!(await page.$('#cadMenu [data-nav="fornecedores"]')));
  await page.click('#cadMenu [data-nav="fornecedores"]');
  await page.waitForTimeout(200);
  check('Fornecedores screen opens?', await page.$eval('#tab-fornecedores', (e) => !e.hidden));
  check('screen has the title?', /Fornecedores/.test(await page.$eval('#tab-fornecedores .cad-title', (e) => e.textContent)));
  check('empty state says "Nenhum fornecedor cadastrado"?', /Nenhum fornecedor cadastrado/.test(await page.textContent('#reg-fornecedores-host')));
  // incluir
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  check('window is "Novo fornecedor" with the name label?', /Novo fornecedor/.test(await page.textContent('#ovReg h3')) && /Razão social/.test(await page.textContent('#ovReg')));
  await page.fill('#regName', 'Papelaria Teste Ltda');
  await page.fill('#regf-documento', '11222333000100');
  await page.click('#regSave'); await page.waitForTimeout(200);
  check('invalid CNPJ refused (window stays open)?', !!(await page.$('#ovReg')));
  await page.fill('#regf-documento', '11222333000181');
  check('document gets the mask?', (await page.inputValue('#regf-documento')) === '11.222.333/0001-81', await page.inputValue('#regf-documento'));
  await setSel('#regf-categoria', 'Material');
  await page.fill('#regf-telefone', '47999998888');
  check('phone gets the mask?', (await page.inputValue('#regf-telefone')) === '(47) 99999-8888');
  await page.fill('#regf-email', 'vendas@papelaria.test');
  await page.click('#regSave'); await page.waitForTimeout(300);
  let rows = await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.map((x) => x.textContent));
  check('new supplier listed with category, document and phone?', rows.length === 1 && /Papelaria Teste/.test(rows[0]) && /Material/.test(rows[0]) && /11\.222\.333\/0001-81/.test(rows[0]) && /\(47\) 99999-8888/.test(rows[0]), rows);
  // CPF válido de pessoa física (CPF de exemplo 529.982.247-25)
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Maria Eletricista'); await page.fill('#regf-documento', '52998224725');
  check('CPF gets the mask?', (await page.inputValue('#regf-documento')) === '529.982.247-25');
  await page.click('#regSave'); await page.waitForTimeout(300);
  check('supplier with CPF saved?', (await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.length)) === 2);
  // repetido: mesmo documento com outro nome
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Outro Nome'); await page.fill('#regf-documento', '11222333000181');
  await page.click('#regSave'); await page.waitForTimeout(200);
  check('same document refused (window stays open)?', !!(await page.$('#ovReg')));
  await page.click('#regCancel');
  // repetido: mesmo nome, os dois sem documento
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Chaveiro Sem Documento'); await page.click('#regSave'); await page.waitForTimeout(300);
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'chaveiro sem documento'); await page.click('#regSave'); await page.waitForTimeout(200);
  check('same name without document refused (window stays open)?', !!(await page.$('#ovReg')));
  await page.click('#regCancel');
  await page.click('#reg-fornecedores-host tbody tr:has-text("Chaveiro")'); await page.waitForSelector('#ovReg');
  await page.click('#regDel'); await page.click('#cfOk'); await page.waitForTimeout(300);
  // editar
  await page.click('#reg-fornecedores-host tbody tr:has-text("Papelaria")'); await page.waitForSelector('#ovReg');
  check('edit window keeps the saved fields?', (await page.inputValue('#regf-documento')) === '11.222.333/0001-81' && (await page.$eval('#regf-categoria', (e) => e.value)) === 'Material');
  await setSel('#regf-categoria', 'Escritório'); await page.click('#regSave'); await page.waitForTimeout(300);
  check('edit changes the category?', (await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.map((x) => x.textContent))).some((t) => /Escritório/.test(t)));
  // busca (por categoria, sem acento)
  await page.fill('#reg-fornecedores-search', 'escritorio'); await page.waitForTimeout(150);
  check('search by category ignores accents?', (await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.length)) === 1);
  await page.fill('#reg-fornecedores-search', '529982'); await page.waitForTimeout(150);
  check('search by document digits (no punctuation)?', (await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.length)) === 1);
  await page.fill('#reg-fornecedores-search', ''); await page.waitForTimeout(150);
  // gravou no documento certo
  const saved = await page.evaluate(async () => { const db = await window.claude.use('db'); const s = await db.doc('config/suppliers').get(); return s.data().list.map((x) => x.name); });
  check('saved in config/suppliers?', saved.length === 2, saved);
  // excluir
  await page.click('#reg-fornecedores-host tbody tr:has-text("Maria")'); await page.waitForSelector('#ovReg');
  await page.click('#regDel'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('delete (with confirmation) removes it?', (await page.$$eval('#reg-fornecedores-host tbody tr', (r) => r.length)) === 1);
  // celular
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(200);
  const vis = await page.$$eval('#reg-fornecedores-host table thead th', (h) => h.filter((x) => getComputedStyle(x).display !== 'none').length);
  check('mobile: only Nome and Categoria columns?', vis === 2, vis);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
