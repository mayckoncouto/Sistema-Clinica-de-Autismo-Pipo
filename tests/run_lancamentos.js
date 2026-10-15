// Financeiro (Fase 2): Lançamentos — menu, tela, janela, filtros, resumo, saldo por conta e planilha.
// Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_fl.html');
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
  const rows = () => page.$$eval('#reg-lancamentos-host tbody tr', (r) => r.map((x) => x.textContent));
  const ev = (x) => page.evaluate((s) => window.__ev(s), x);

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [
      { id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 1000, dataSaldo: '2026-01-01' },
      { id: 'caixa', name: 'Caixa', tipo: 'Caixa', saldoInicial: 200, dataSaldo: '2026-01-01' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'agua', name: 'Água', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'bradesco', name: 'Bradesco', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'retirada', name: 'Retirada', categoria: 'Sócios', tipo: 'Saída' },
      { id: 'aporte', name: 'Aporte de sócios', categoria: 'Sócios', tipo: 'Entrada' }] });
  });
  await page.waitForTimeout(300);

  // ---- menu e tela ----
  await page.click('#finBtn');
  check('Financeiro menu lists Lançamentos, Demonstrativos and the financial registries?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,receber,emptomados,empconcedidos,conciliacao,demonstrativos,comissoes,fornecedores,catfornecedor,contas,planocontas');
  check('Cadastros menu no longer lists them?', !(await page.$('#cadMenu [data-nav="contas"]')) && !(await page.$('#cadMenu [data-nav="fornecedores"]')));
  await page.keyboard.press('Escape');
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="lancamentos"]'); await page.waitForTimeout(300);
  check('Lançamentos screen opens with title?', await page.$eval('#tab-lancamentos', (e) => !e.hidden) && /Lançamentos/.test(await page.$eval('#tab-lancamentos .cad-title', (e) => e.textContent)));
  check('empty state before any entry?', /Nenhum lançamento/.test(await page.textContent('#reg-lancamentos-host')));
  check('hash is #lancamentos?', (await page.evaluate(() => location.hash)) === '#lancamentos');

  // ---- incluir ----
  async function add(o) {
    await page.click('#flAdd'); await page.waitForSelector('#ovFl');
    await setSel('#flConta', o.conta); await setSel('#flData', o.data); await page.fill('#flDesc', o.desc);
    await setSel('#flSub', o.sub); await page.fill('#flValor', o.valor);
    if (o.extVal) { await page.fill('#flExtVal', o.extVal); await setSel('#flExtData', o.data); }
    await page.click('#flSave'); await page.waitForTimeout(250);
  }
  await page.click('#flAdd'); await page.waitForSelector('#ovFl');
  await page.click('#flSave'); await page.waitForTimeout(150);
  check('empty form refused?', !!(await page.$('#ovFl')));
  await page.click('#flCancel');
  await add({ conta: 'viacredi', data: '2026-01-10', desc: 'SAMAE agua', sub: 'agua', valor: '67,59' });
  await add({ conta: 'viacredi', data: '2026-01-12', desc: 'Convenio Bradesco', sub: 'bradesco', valor: '1.000,00', extVal: '1.050,00' });
  await add({ conta: 'caixa', data: '2026-02-03', desc: 'Retirada socio', sub: 'retirada', valor: '50' });
  check('last month is the default filter?', (await page.$eval('#flMonth', (e) => e.value)) === '2026-02');
  check('only the February entry listed?', (await rows()).length === 1 && /Retirada socio/.test((await rows())[0]));
  await setSel('#flMonth', '2026-01');
  let r = await rows();
  check('January has 2 entries?', r.length === 2, r);
  check('despesa shown negative, receita positive?', r.some((x) => /Convenio Bradesco/.test(x) && /R\$\s?1\.000,00/.test(x) && !/−R\$\s?1\.000/.test(x)) && r.some((x) => /SAMAE/.test(x) && /−R\$\s?67,59/.test(x)), r);
  check('extrato differing is highlighted?', (await page.$$('#reg-lancamentos-host .fl-warn')).length === 1);
  const sum = await page.textContent('#flSum');
  check('summary: receitas, despesas, resultado?', /Receitas\s*R\$\s?1\.000,00/.test(sum) && /Despesas\s*R\$\s?67,59/.test(sum) && /Resultado\s*R\$\s?932,41/.test(sum), sum);
  check('summary: saldo Viacredi = 1000 + 1000 - 67,59?', /Saldo Viacredi\s*R\$\s?1\.932,41/.test(sum), sum);
  check('summary: saldo Caixa at end of January = 200?', /Saldo Caixa\s*R\$\s?200,00/.test(sum), sum);
  await setSel('#flMonth', '');
  check('all months: caixa saldo = 200 - 50?', /Saldo Caixa\s*R\$\s?150,00/.test(await page.textContent('#flSum')), await page.textContent('#flSum'));
  await setSel('#flMonth', '2026-01');

  // ---- filtros ----
  await setSel('#flAcc', 'caixa');
  check('conta filter hides Viacredi entries?', (await rows()).length === 0 || /Nada encontrado/.test(await page.textContent('#reg-lancamentos-host')));
  await setSel('#flAcc', '');
  await setSel('#flTipo', 'Despesa');
  check('tipo filter keeps only the despesa?', (await rows()).length === 1 && /SAMAE/.test((await rows())[0]));
  await setSel('#flTipo', '');
  await page.fill('#flSearch', 'AGUA'); await page.waitForTimeout(150);
  check('search ignores case and finds by description?', (await rows()).length === 1);
  await page.fill('#flSearch', 'despesas fixas'); await page.waitForTimeout(150);
  check('search finds by category?', (await rows()).length === 1);
  await page.fill('#flSearch', ''); await page.waitForTimeout(150);

  // ---- repetido ----
  await page.click('#flAdd'); await page.waitForSelector('#ovFl');
  await setSel('#flConta', 'viacredi'); await setSel('#flData', '2026-01-10'); await page.fill('#flDesc', 'samae AGUA'); await setSel('#flSub', 'agua'); await page.fill('#flValor', '67,59');
  await page.click('#flSave'); await page.waitForTimeout(250);
  check('duplicate asks for confirmation?', !!(await page.$('#cfOk')));
  await page.click('#cfCancel'); await page.waitForTimeout(100);
  check('still in the window after cancelling?', !!(await page.$('#ovFl')));
  await page.click('#flCancel');

  // ---- editar e excluir ----
  await page.click('#reg-lancamentos-host tbody tr'); await page.waitForSelector('#ovFl');
  check('edit shows the saved value formatted?', ['67,59', '1.000,00'].includes(await page.inputValue('#flValor')), await page.inputValue('#flValor'));
  await page.fill('#flValor', '70,00'); await page.click('#flSave'); await page.waitForTimeout(250);
  check('edited value saved?', (await rows()).some((x) => /70,00/.test(x)), await rows());
  await page.click('#reg-lancamentos-host tbody tr'); await page.waitForSelector('#ovFl');
  await page.click('#flDel'); await page.click('#cfOk'); await page.waitForTimeout(250);
  check('delete (with confirmation) removes the entry?', (await ev('FL.rows.length')) === 2, await ev('FL.rows.length'));

  // ---- conta e subcategoria em uso ----
  const useC = await ev('USAGE.contas({id: "viacredi"})');
  check('conta with entries counts as in use?', useC.length === 1 && /lançamento/.test(useC[0]), useC);
  const useP = await ev('USAGE.planocontas({id: "aporte"})');
  check('unused subcategory is free?', useP.length === 0, useP);

  // ---- planilha ----
  const base = { _line: 2, conta: 'Viacredi', descricao: 'Convenio Bradesco', data: '12/01/2026', valor: 1000, tipo: 'Receitas', categoria: 'Receita Operacional', sub: 'Bradesco', dataExtrato: '12/01/2026', valorExtrato: 1050 };
  const plan = await page.evaluate((b) => {
    const recs = [
      b,                                                                                                                       // igual (já existe com o mesmo extrato)
      { _line: 3, conta: 'Viacredi', descricao: 'Convenio Bradesco', data: '12/01/2026', valor: 1000, sub: 'Bradesco', valorExtrato: 1000 }, // 2ª repetição idêntica = novo
      { _line: 4, conta: 'Viacredi', descricao: 'Luz', data: '15/01/2026', valor: 30, sub: 'agua', tipo: 'Receitas' },         // novo, aviso de tipo
      { _line: 5, conta: 'Banco X', descricao: 'Luz', data: '15/01/2026', valor: 30, sub: 'agua' },                              // conta desconhecida
      { _line: 6, conta: 'Caixa', descricao: 'Luz', data: '15/01/2026', valor: 30, sub: 'Energia' },                             // subcategoria desconhecida
      { _line: 7, conta: 'Caixa', descricao: 'Luz', data: '31/02/2026', valor: 30, sub: 'agua' },                                // data inválida
      { _line: 8, conta: 'Caixa', descricao: 'Aporte', data: '20/01/2026', valor: 0, sub: 'Aporte de sócios' },                  // valor zero
      { _line: 9, conta: 'caixa', descricao: 'Aporte inicial', data: '20/01/2026', valor: 500, sub: 'aporte de socios', dataExtrato: '20/01/2026', valorExtrato: 500 } // novo (sem acento)
    ];
    const p = window.__ev('IO_KINDS').lancamentos.plan(recs);
    return { st: p.items.map((x) => x.st), warn: p.items.map((x) => (x.warn || []).length), notes: p.notes };
  }, base);
  check('plan statuses?', plan.st.join() === 'igual,novo,novo,problema,problema,problema,problema,novo', plan.st);
  check('tipo mismatch gives a warning?', plan.warn[2] === 1, plan.warn);
  check('plan has the totals note?', plan.notes.length === 1 && /receitas/.test(plan.notes[0]), plan.notes);
  const msg = await page.evaluate(async () => {
    const K = window.__ev('IO_KINDS').lancamentos;
    const recs = [
      { _line: 2, conta: 'Viacredi', descricao: 'Convenio Bradesco', data: '12/01/2026', valor: 1000, sub: 'Bradesco', dataExtrato: '12/01/2026', valorExtrato: 1050 },
      { _line: 3, conta: 'Viacredi', descricao: 'Convenio Bradesco', data: '12/01/2026', valor: 1000, sub: 'Bradesco', valorExtrato: 1000 },
      { _line: 4, conta: 'caixa', descricao: 'Aporte inicial', data: '20/01/2026', valor: 500, sub: 'aporte de socios', dataExtrato: '20/01/2026', valorExtrato: 500 }];
    const p = K.plan(recs); const m = await K.apply(p);
    const again = K.plan(recs).items.map((x) => x.st);
    return { m, again, n: window.__ev('FL.rows.length') };
  });
  check('import wrote the 2 new entries?', msg.n === 4, msg);
  check('importing the same sheet again is all "igual"?', msg.again.join() === 'igual,igual,igual', msg.again);
  const up = await page.evaluate(() => window.__ev('IO_KINDS').lancamentos.plan([{ _line: 2, conta: 'Caixa', descricao: 'Aporte inicial', data: '20/01/2026', valor: 500, sub: 'Aporte de sócios', valorExtrato: 499 }]).items.map((x) => x.st));
  check('different extrato value on an existing entry = atualizar?', up.join() === 'atualizar', up);
  const exp = await ev('IO_KINDS.lancamentos.exportRows().map(function(x){ return [x.conta, x.data, x.valor, x.tipo, x.sub].join("|"); })');
  check('export has conta, date, tipo and subcategory?', exp.includes('Caixa|20/01/2026|500|Entrada|Aporte de sócios'), exp);
  check('Outras Opções menu on Lançamentos?', !!(await page.$('#flMenuWrap')));

  // ---- somente leitura: sem permissão de incluir, o botão some ----
  await page.evaluate(() => { window.pipoAuth = { can: (m, a) => m === 'financeiro' && a === 'view', canDefault: () => true, isAdmin: () => false, onProfile: () => {} }; });
  await ev('renderLancamentos()');
  check('Incluir hidden without create permission?', await page.$eval('#flAdd', (b) => b.hidden));
  await page.evaluate(() => { delete window.pipoAuth; });

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
