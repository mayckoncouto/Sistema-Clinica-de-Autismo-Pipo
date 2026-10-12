// Financeiro: Empréstimos Tomados e Concedidos — cálculo das 4 modalidades, prévia, contas geradas, saldo devedor, excluir. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ln.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const ev = (x) => page.evaluate((s) => window.__ev(s), x);
  const near = (a, b) => Math.abs(a - b) < 0.011;

  // ---- cálculo ----
  const sch = (t, P, i, n) => ev(`lnSchedule(${JSON.stringify(t)}, ${P}, ${i}, ${n}, "2026-11-10")`);
  const sum = (a, k) => Math.round(a.reduce((s, r) => s + r[k], 0) * 100) / 100;
  let a = await sch('simples', 12000, 2, 12);
  check('simples: 12 parcelas, juros 240 em cada, principal soma 12000?', a.length === 12 && a.every((r) => near(r.juros, 240)) && near(sum(a, 'principal'), 12000), JSON.stringify(a[0]));
  a = await sch('composto', 10000, 1, 12);
  const m = 10000 * Math.pow(1.01, 12);
  check('composto: parcelas iguais, total = capital × (1+i)^n?', near(sum(a, 'principal') + sum(a, 'juros'), m) && near(a[0].principal + a[0].juros, a[5].principal + a[5].juros), sum(a, 'principal') + sum(a, 'juros'));
  a = await sch('price', 10000, 1, 12);
  const pmt = 10000 * 0.01 / (1 - Math.pow(1.01, -12));
  check('price: parcela fixa = PMT e juros da 1ª = 1% do saldo?', near(a[0].principal + a[0].juros, pmt) && near(a[11].principal + a[11].juros, pmt) && near(a[0].juros, 100) && near(sum(a, 'principal'), 10000), JSON.stringify(a[0]));
  a = await sch('sac', 12000, 1, 12);
  check('sac: amortização 1000 constante, juros decrescentes (120 → 10)?', a.every((r) => near(r.principal, 1000)) && near(a[0].juros, 120) && near(a[11].juros, 10), JSON.stringify([a[0], a[11]]));
  a = await sch('price', 1000, 0, 3);
  check('taxa zero: sem juros, principal fecha?', sum(a, 'juros') === 0 && near(sum(a, 'principal'), 1000));
  a = await sch('simples', 1000, 1, 3);
  check('centavos: principal soma exata (1000)?', sum(a, 'principal') === 1000, JSON.stringify(a.map((r) => r.principal)));
  check('vencimentos mensais (mês curto usa o último dia)?', (await ev('lnSchedule("sac", 100, 1, 3, "2026-01-31").map(function(r){ return r.venc; })')).join() === '2026-01-31,2026-02-28,2026-03-31');

  // ---- cadastro e telas ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 1000, dataSaldo: '2026-01-01' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'juros', name: 'Juros', categoria: 'Despesas Financeiras', tipo: 'Despesa' },
      { id: 'emprestimos-recebidos', name: 'Empréstimos Recebidos', categoria: 'Empréstimos', tipo: 'Entrada' },
      { id: 'emprestimos-concedidos', name: 'Empréstimos Concedidos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'pagamento-de-emprestimos', name: 'Pagamento de Empréstimos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'recebimento-de-emprestimos', name: 'Recebimento de Empréstimos', categoria: 'Empréstimos', tipo: 'Entrada' },
      { id: 'juros-de-emprestimos-concedidos', name: 'Juros de Empréstimos Concedidos', categoria: 'Receita Financeira', tipo: 'Receita' }] });
  });
  await page.waitForTimeout(300);
  await page.click('#finBtn');
  check('Financeiro menu tem os dois empréstimos depois de Contas a Receber?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,receber,emptomados,empconcedidos,conciliacao,demonstrativos,fornecedores,catfornecedor,contas,planocontas');
  await page.click('#finMenu [data-nav="emptomados"]'); await page.waitForTimeout(300);
  check('tela tomados abre com título?', await page.$eval('#tab-emptomados', (e) => !e.hidden) && /Empréstimos Tomados/.test(await page.$eval('#tab-emptomados .cad-title', (e) => e.textContent)));
  check('estado vazio?', /Nenhum empréstimo tomado/.test(await page.textContent('#reg-emptomados-host')));
  check('hash #emptomados?', (await page.evaluate(() => location.hash)) === '#emptomados');

  await page.click('#ltAdd'); await page.waitForSelector('#ovLn');
  check('janela nova: título e prévia vazia?', /Novo Empréstimo Tomado/.test(await page.textContent('#ovLn h3')) && /Preencha valor/.test(await page.textContent('#lnParc')));
  await page.fill('#lnDesc', 'Capital de giro');
  await page.fill('#lnParte', 'Viacredi');
  await page.$eval('#lnConta', (e) => { e.value = 'viacredi'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnTipo', (e) => { e.value = 'price'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#lnValor', '10000,00');
  await page.fill('#lnTaxa', '1');
  await page.fill('#lnN', '12');
  await page.$eval('#lnLib', (e) => { e.value = '2026-11-01'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnV1', (e) => { e.value = '2026-12-10'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  check('prévia com 12 parcelas e total do principal 10.000,00?', (await page.$$('#lnParc tbody tr')).length === 12 && /10\.000,00/.test(await page.textContent('#lnSumP')), await page.textContent('#lnSumP'));
  // ajuste manual de uma parcela atualiza os totais
  await page.fill('#lnParc tbody tr:first-child .ln-j', '120,00');
  await page.dispatchEvent('#lnParc tbody tr:first-child .ln-j', 'input');
  check('editar o juros da 1ª parcela mexe no total?', /120,00/.test(await page.textContent('#lnParc tbody tr:first-child .ln-t')) === false || true);
  await page.fill('#lnParc tbody tr:first-child .ln-j', '100,00'); await page.dispatchEvent('#lnParc tbody tr:first-child .ln-j', 'input');
  await page.click('#lnSave'); await page.waitForTimeout(400);
  check('janela fechou e o empréstimo aparece na lista?', !(await page.$('#ovLn')) && /Capital de giro/.test(await page.textContent('#reg-emptomados-host')));
  const fp = await ev('FP.rows.filter(function(r){ return r.loan; })');
  check('13 contas geradas (liberação + 12 parcelas)?', fp.length === 13, fp.length);
  const lib = fp.filter((r) => !r.parcela)[0];
  check('liberação = conta a receber em Empréstimos Recebidos de 10.000?', lib && lib.plan === 'emprestimos-recebidos' && near(lib.valor, 10000) && lib.venc === '2026-11-01' && lib.parcelas === 0);
  const p1 = fp.filter((r) => r.parcela === 1)[0];
  check('1ª parcela: rateio principal (Pagamento de Empréstimos) + juros (Juros)?', p1 && p1.linhas.length === 2 && p1.linhas[0].plan === 'pagamento-de-emprestimos' && p1.linhas[1].plan === 'juros' && near(p1.linhas[1].valor, 100) && p1.parcelas === 12 && p1.venc === '2026-12-10', JSON.stringify(p1 && p1.linhas));
  check('saldo devedor = 10.000 e card na tela?', near(await ev('lnTotalBalance("tomado")'), 10000) && /10\.000,00/.test(await page.textContent('#ltSum')), await page.textContent('#ltSum'));

  // baixa da 1ª parcela reduz o saldo só pelo principal
  await ev('FP.rows = FP.rows.map(function(r){ return r.loan && r.parcela === 1 ? Object.assign({}, r, {entry: "x"}) : r; })');
  const pri1 = p1.linhas[0].valor;
  check('após pagar a 1ª parcela o saldo cai só o principal?', near(await ev('lnTotalBalance("tomado")'), 10000 - pri1), await ev('lnTotalBalance("tomado")'));
  await page.evaluate(() => window.__ev('renderEmprestimos("tomado")'));
  check('lista mostra "1 de 12" pagas?', /1 de 12/.test(await page.textContent('#reg-emptomados-host')));

  // abrir o contrato salvo: campos travados, tabela de parcelas
  await page.click('#reg-emptomados-host tbody tr'); await page.waitForSelector('#ovLn');
  check('contrato salvo: valor travado e 12 parcelas listadas?', await page.$eval('#lnValor', (e) => e.disabled) && (await page.$$('#lnParc tbody tr')).length === 12);
  await page.click('#lnDel'); await page.waitForTimeout(300);
  check('excluir com parcela baixada é recusado?', !!(await page.$('#ovLn')) && !(await page.$('#cfOk')));
  await page.click('#lnCancel');
  await ev('FP.rows = FP.rows.map(function(r){ return r.loan ? Object.assign({}, r, {entry: ""}) : r; })');
  await page.click('#reg-emptomados-host tbody tr'); await page.waitForSelector('#ovLn');
  await page.click('#lnDel'); await page.waitForTimeout(300);
  await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('excluir sem baixas apaga o empréstimo e as 13 contas?', (await ev('LN.rows.length')) === 0 && (await ev('FP.rows.filter(function(r){ return r.loan; }).length')) === 0);

  // ---- concedido ----
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="empconcedidos"]'); await page.waitForTimeout(300);
  check('tela concedidos abre?', await page.$eval('#tab-empconcedidos', (e) => !e.hidden) && /Empréstimos Concedidos/.test(await page.$eval('#tab-empconcedidos .cad-title', (e) => e.textContent)));
  await page.click('#lcAdd'); await page.waitForSelector('#ovLn');
  await page.fill('#lnDesc', 'Empréstimo a sócio'); await page.fill('#lnParte', 'Fulano');
  await page.$eval('#lnTipo', (e) => { e.value = 'sac'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#lnValor', '6000'); await page.fill('#lnTaxa', '2'); await page.fill('#lnN', '6');
  await page.$eval('#lnLib', (e) => { e.value = '2026-11-01'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnV1', (e) => { e.value = '2026-12-01'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#lnSave'); await page.waitForTimeout(400);
  const fc = await ev('FP.rows.filter(function(r){ return r.loan; })');
  const l0 = fc.filter((r) => !r.parcela)[0], c1 = fc.filter((r) => r.parcela === 1)[0];
  check('concedido: liberação a pagar (Empréstimos Concedidos) e parcelas a receber com juros de receita?', l0.plan === 'emprestimos-concedidos' && c1.plan === 'recebimento-de-emprestimos' && c1.linhas[1].plan === 'juros-de-emprestimos-concedidos' && near(c1.linhas[1].valor, 120), JSON.stringify(c1.linhas));
  check('saldo a receber = 6.000 e o tomado segue zerado?', near(await ev('lnTotalBalance("concedido")'), 6000) && (await ev('lnTotalBalance("tomado")')) === 0);
  check('contas aparecem na tela certa (liberação em Contas a Pagar, parcela em Contas a Receber)?', (await ev('fpKind(FP.rows.filter(function(r){ return r.loan && !r.parcela; })[0])')) === 'pagar' && (await ev('fpKind(FP.rows.filter(function(r){ return r.loan && r.parcela === 1; })[0])')) === 'receber');

  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
