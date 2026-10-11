// Financeiro (Fase 1): Categorias de fornecedor, Contas bancárias (com saldo inicial), Plano de contas e as planilhas do Plano de contas e de Fornecedores.
// Dados fictícios (CNPJ de exemplo válido: 11.222.333/0001-81).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_fin.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setSel = (id, v) => page.$eval(id, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const open = async (key, tab) => { await page.click('#cadBtn'); await page.click('#cadMenu [data-nav="' + key + '"]'); await page.waitForTimeout(200); return page.$eval('#tab-' + tab, (e) => !e.hidden); };
  const rows = (k) => page.$$eval('#reg-' + k + '-host tbody tr', (r) => r.map((x) => x.textContent));

  // ---- Categorias de fornecedor ----
  check('menu lists the 3 new registries?', await (async () => { await page.click('#cadBtn'); const ok = !!(await page.$('#cadMenu [data-nav="catfornecedor"]')) && !!(await page.$('#cadMenu [data-nav="contas"]')) && !!(await page.$('#cadMenu [data-nav="planocontas"]')); await page.click('#cadBtn'); return ok; })());
  check('Categorias screen opens with title?', await open('catfornecedor', 'catfornecedor') && /Categorias de fornecedor/.test(await page.$eval('#tab-catfornecedor .cad-title', (e) => e.textContent)));
  await page.click('#reg-catfornecedor-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Material'); await page.click('#regSave'); await page.waitForTimeout(300);
  await page.click('#reg-catfornecedor-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'material'); await page.click('#regSave'); await page.waitForTimeout(200);
  check('same category name refused?', !!(await page.$('#ovReg')));
  await page.click('#regCancel');
  check('one category listed?', (await rows('catfornecedor')).length === 1);

  // ---- Fornecedor escolhe a categoria da lista ----
  await open('fornecedores', 'fornecedores');
  await page.click('#reg-fornecedores-add'); await page.waitForSelector('#ovReg');
  check('supplier Categoria is a list with the category?', (await page.$$eval('#regf-categoria option', (o) => o.map((x) => x.textContent))).join() === 'Sem categoria,Material');
  check('supplier Categoria list has the "+ Incluir" hook?', await page.$eval('#regf-categoria', (e) => e.getAttribute('data-reg-add') === 'catfornecedor'));
  await page.click('#regCancel');

  // ---- Contas bancárias ----
  check('Contas screen opens with title?', await open('contas', 'contas') && /Contas bancárias/.test(await page.$eval('#tab-contas .cad-title', (e) => e.textContent)));
  await page.click('#reg-contas-add'); await page.waitForSelector('#ovReg');
  check('conta window has the Saldo inicial group?', !!(await page.$('#regSaldo')) && !!(await page.$('#regSaldoData')));
  await page.fill('#regName', 'Viacredi');
  await setSel('#regf-tipo', 'Banco');
  await page.fill('#regf-banco', 'Viacredi');
  await page.fill('#regf-cnpj', '11222333000100');
  await page.click('#regSave'); await page.waitForTimeout(200);
  check('invalid CNPJ refused?', !!(await page.$('#ovReg')));
  await page.fill('#regf-cnpj', '11222333000181');
  await page.fill('#regSaldo', '208.724,77');
  await page.click('#regSave'); await page.waitForTimeout(200);
  check('saldo without date refused?', !!(await page.$('#ovReg')));
  await setSel('#regSaldoData', '2026-01-01');
  await page.click('#regSave'); await page.waitForTimeout(300);
  let r = await rows('contas');
  check('conta listed with type, bank and CNPJ?', r.length === 1 && /Viacredi/.test(r[0]) && /Banco/.test(r[0]) && /11\.222\.333\/0001-81/.test(r[0]), r);
  await page.click('#reg-contas-host tbody tr'); await page.waitForSelector('#ovReg');
  check('edit shows the saved saldo and date?', (await page.inputValue('#regSaldo')) === '208.724,77' && (await page.$eval('#regSaldoData', (e) => e.value)) === '2026-01-01', await page.inputValue('#regSaldo'));
  await page.click('#regCancel');
  await page.click('#reg-contas-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'viacredi'); await page.click('#regSave'); await page.waitForTimeout(200);
  check('same account name refused?', !!(await page.$('#ovReg')));
  await page.click('#regCancel');

  // ---- Plano de contas ----
  await page.evaluate(async () => { const db = await window.claude.use('db'); await db.doc('config/convenios').set({ list: [{ id: 'bradesco-saude', name: 'Bradesco Saúde' }] }); });
  await page.waitForTimeout(200);
  check('Plano screen opens with title?', await open('planocontas', 'planocontas') && /Plano de contas/.test(await page.$eval('#tab-planocontas .cad-title', (e) => e.textContent)));
  await page.click('#reg-planocontas-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Bradesco'); await page.click('#regSave'); await page.waitForTimeout(200);
  check('category and type are required?', !!(await page.$('#ovReg')));
  await page.fill('#regf-categoria', 'Receita Operacional');
  await setSel('#regf-tipo', 'Receita');
  await setSel('#regf-convenioId', 'bradesco-saude');
  await page.click('#regSave'); await page.waitForTimeout(300);
  r = await rows('planocontas');
  check('subcategory listed with category, type and convênio?', r.length === 1 && /Bradesco/.test(r[0]) && /Receita Operacional/.test(r[0]) && /Receita/.test(r[0]) && /Bradesco Saúde/.test(r[0]), r);
  await page.click('#reg-planocontas-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Salários'); await page.fill('#regf-categoria', 'Despesas com Funcionários'); await setSel('#regf-tipo', 'Despesa');
  await page.click('#regSave'); await page.waitForTimeout(300);
  r = await rows('planocontas');
  check('ordered Receita before Despesa?', r.length === 2 && /Bradesco/.test(r[0]) && /Salários/.test(r[1]), r);
  await page.fill('#reg-planocontas-search', 'funcionarios'); await page.waitForTimeout(150);
  check('search by category ignores accents?', (await rows('planocontas')).length === 1);
  await page.fill('#reg-planocontas-search', ''); await page.waitForTimeout(150);

  // ---- Planilha do Plano de contas ----
  const pl = await page.evaluate(() => {
    const recs = [
      { _line: 2, nome: 'Bradesco', categoria: 'Receita Operacional', tipo: 'Receitas', convenio: 'Bradesco Saúde' },        // igual
      { _line: 3, nome: 'Salários', categoria: 'Despesas com Pessoal', tipo: 'Despesas', convenio: '' },                       // atualiza categoria
      { _line: 4, nome: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa', convenio: '' },                               // novo
      { _line: 5, nome: 'Transferência Saída', categoria: 'Transferências entre contas', tipo: 'Saídas', convenio: '' },       // novo, tipo no plural
      { _line: 6, nome: 'Cassi', categoria: 'Receita Operacional', tipo: 'Receita', convenio: 'Convênio Que Não Existe' },     // novo, convênio sem ligação (aviso)
      { _line: 7, nome: 'Erro', categoria: 'X', tipo: 'Banana', convenio: '' },                                                  // problema
      { _line: 8, nome: 'aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa', convenio: '' }                                 // repetido
    ];
    const plan = window.__ev('IO_KINDS').planocontas.plan(recs);
    return { st: plan.items.map((i) => i.st), warn: plan.items.map((i) => (i.warn || []).length) };
  });
  check('plan: igual, atualizar, novo, novo, novo, problema, problema?', pl.st.join() === 'igual,atualizar,novo,novo,novo,problema,problema', pl.st);
  check('plan: unknown convênio gives a warning?', pl.warn[4] === 1, pl.warn);
  await page.evaluate(async () => {
    const recs = [{ _line: 3, nome: 'Salários', categoria: 'Despesas com Pessoal', tipo: 'Despesas', convenio: '' }, { _line: 4, nome: 'Transferência Saída', categoria: 'Transferências entre contas', tipo: 'Saídas', convenio: '' }];
    await window.__ev('IO_KINDS').planocontas.apply(window.__ev('IO_KINDS').planocontas.plan(recs));
  });
  await page.waitForTimeout(300);
  const saved = await page.evaluate(async () => { const db = await window.claude.use('db'); const s = await db.doc('config/chart_accounts').get(); return s.data().list.map((x) => [x.name, x.categoria, x.tipo].join('|')); });
  check('import updated Salários and created Transferência Saída (tipo Saída)?', saved.includes('Salários|Despesas com Pessoal|Despesa') && saved.includes('Transferência Saída|Transferências entre contas|Saída'), saved);
  const exp = await page.evaluate(() => window.__ev('IO_KINDS').planocontas.exportRows().map((x) => x.nome + '|' + x.tipo + '|' + x.convenio));
  check('export has the convênio name and the tipo?', exp.includes('Bradesco|Receita|Bradesco Saúde'), exp);

  // ---- Planilha de Fornecedores ----
  const fp = await page.evaluate(() => {
    const recs = [
      { _line: 2, nome: 'Papelaria Nova', documento: '11222333000181', categoria: 'Papelaria', telefone: '47999998888' },
      { _line: 3, nome: 'Invalido', documento: '11222333000100' },
      { _line: 4, nome: 'Sem Documento Ltda', categoria: 'Material' }
    ];
    return window.__ev('IO_KINDS').fornecedores.plan(recs).items.map((i) => i.st);
  });
  check('suppliers plan: novo, problema (CNPJ), novo?', fp.join() === 'novo,problema,novo', fp);
  await page.evaluate(async () => {
    const recs = [{ _line: 2, nome: 'Papelaria Nova', documento: '11222333000181', categoria: 'Papelaria', telefone: '47999998888' }];
    await window.__ev('IO_KINDS').fornecedores.apply(window.__ev('IO_KINDS').fornecedores.plan(recs));
  });
  await page.waitForTimeout(300);
  const sup = await page.evaluate(async () => { const db = await window.claude.use('db'); const a = (await db.doc('config/suppliers').get()).data().list, b = (await db.doc('config/supplier_categories').get()).data().list; return { s: a.map((x) => x.name + '|' + x.documento + '|' + x.telefone), c: b.map((x) => x.name) }; });
  check('supplier imported with mask and the new category created?', sup.s.includes('Papelaria Nova|11.222.333/0001-81|(47) 99999-8888') && sup.c.includes('Papelaria'), sup);
  // reimportar o mesmo = igual
  const again = await page.evaluate(() => window.__ev('IO_KINDS').fornecedores.plan([{ _line: 2, nome: 'Papelaria Nova', documento: '11.222.333/0001-81', categoria: 'Papelaria', telefone: '(47) 99999-8888' }]).items.map((i) => i.st));
  check('re-import of the same supplier is "igual"?', again.join() === 'igual', again);
  check('Outras opções menu on Plano de contas and Fornecedores?', !!(await page.$('#tab-planocontas [data-io-wrap]')) && !!(await page.$('#tab-fornecedores [data-io-wrap]')));

  // ---- Excluir conta ----
  await open('contas', 'contas');
  await page.click('#reg-contas-host tbody tr'); await page.waitForSelector('#ovReg');
  await page.click('#regDel'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('delete conta (with confirmation) works?', (await rows('contas')).length === 0 || /Nenhuma conta/.test(await page.textContent('#reg-contas-host')));
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
