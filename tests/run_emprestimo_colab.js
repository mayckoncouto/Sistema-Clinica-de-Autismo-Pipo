// Empréstimo a colaborador: Tomador = colaborador (lista) ou texto livre; Abater parcela em conta a pagar do mesmo colaborador;
// baixa da conta com lançamentos do bruto + parcela (principal Entrada, juros Receita); desfazer abatimento. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_lc.html');
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
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 1000, dataSaldo: '2026-01-01' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'juros', name: 'Juros', categoria: 'Despesas Financeiras', tipo: 'Despesa' },
      { id: 'salarios', name: 'Salários', categoria: 'Despesas com Funcionários', tipo: 'Despesa' },
      { id: 'emprestimos-concedidos', name: 'Empréstimos Concedidos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'pagamento-de-emprestimos', name: 'Pagamento de Empréstimos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'recebimento-de-emprestimos', name: 'Recebimento de Empréstimos', categoria: 'Empréstimos', tipo: 'Entrada' },
      { id: 'juros-de-emprestimos-concedidos', name: 'Juros de Empréstimos Concedidos', categoria: 'Receita Financeira', tipo: 'Receita' }] });
  });
  await page.waitForTimeout(300);
  const staff = await ev('fpStaffList()');
  check('lista de colaboradores para o tomador não está vazia?', staff.length >= 1, JSON.stringify(staff.slice(0, 2)));
  const ana = staff.filter((s) => /^Ana/.test(s.nome))[0] || staff[0];

  await page.click('#finBtn'); await page.click('#finMenu [data-nav="empconcedidos"]'); await page.waitForTimeout(300);
  await page.click('#lcAdd'); await page.waitForSelector('#ovLn');
  check('campo Tomador aceita colaborador ou outra pessoa?', /Colaborador ou Outra Pessoa/.test(await page.textContent('#ovLn label[for="lnParte"]')) && !!(await page.$('#lnParteSug')));
  await page.fill('#lnParte', ana.nome.slice(0, 2)); await page.dispatchEvent('#lnParte', 'input');
  check('digitar mostra o colaborador na lista?', (await page.$$('#lnParteSug button')).length >= 1 && /Colaborador/.test(await page.textContent('#lnParteSug')));
  await page.dispatchEvent('#lnParteSug [data-sid]', 'mousedown');
  check('escolher preenche o nome e avisa que pode abater?', (await page.inputValue('#lnParte')) === ana.nome && /abatidas/.test(await page.textContent('#lnParteHint')));
  await page.fill('#lnDesc', 'Adiantamento');
  await page.$eval('#lnConta', (e) => { e.value = 'viacredi'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnTipo', (e) => { e.value = 'simples'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#lnValor', '1200,00'); await page.fill('#lnTaxa', '1'); await page.fill('#lnN', '4');
  await page.$eval('#lnLib', (e) => { e.value = '2026-11-01'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnV1', (e) => { e.value = '2026-12-10'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#lnSave'); await page.waitForTimeout(400);
  const loan = (await ev('LN.rows'))[0];
  check('empréstimo guarda o colaborador?', loan && loan.staff === ana.id && loan.parte === ana.nome, JSON.stringify(loan && [loan.staff, loan.parte]));
  const parcs = await ev('FP.rows.filter(function(r){ return r.loan && r.parcela > 0; })');
  check('parcelas e liberação nascem com o colaborador?', parcs.length === 4 && parcs.every((p) => p.staff === ana.id) && (await ev('FP.rows.filter(function(r){ return r.loan && !r.parcela; })[0].staff')) === ana.id);

  // texto livre: sem colaborador
  await page.click('#lcAdd'); await page.waitForSelector('#ovLn');
  await page.fill('#lnParte', 'Fulano de Tal'); await page.dispatchEvent('#lnParte', 'input');
  await page.fill('#lnDesc', 'Empréstimo avulso');
  await page.$eval('#lnConta', (e) => { e.value = 'viacredi'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#lnValor', '500,00'); await page.fill('#lnTaxa', '0'); await page.fill('#lnN', '2');
  await page.$eval('#lnLib', (e) => { e.value = '2026-11-01'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#lnV1', (e) => { e.value = '2026-12-10'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.click('#lnSave'); await page.waitForTimeout(400);
  const avulso = (await ev('LN.rows')).filter((l) => l.desc === 'Empréstimo avulso')[0];
  check('nome digitado fica como texto, sem colaborador?', avulso && avulso.staff === '' && avulso.parte === 'Fulano de Tal');

  // conta a pagar do colaborador (folha)
  await ev(`(function(){ FP.rows.push({id: "folha1", venc: "2026-12-05", desc: "Folha dezembro", plan: "salarios", acc: "viacredi", sup: "", staff: "${ana.id}", valor: 3000, entry: "", grupo: "", parcela: 0, parcelas: 0, obs: "", linhas: [], loan: "", abate: ""}); FP.rows.push({id: "folha2", venc: "2026-12-05", desc: "Folha de outra pessoa", plan: "salarios", acc: "viacredi", sup: "", staff: "outra-pessoa", valor: 3000, entry: "", grupo: "", parcela: 0, parcelas: 0, obs: "", linhas: [], loan: "", abate: ""}); return true; })()`);
  await page.click('#reg-empconcedidos-host tbody tr[data-ln-id="' + loan.id + '"]'); await page.waitForSelector('#ovLn');
  check('contrato salvo mostra Receber… e Abater… nas parcelas em aberto?', (await page.$$('#lnParc [data-ln-abate]')).length === 4 && (await page.$$('#lnParc [data-ln-pay]')).length === 4);
  await page.click('#lnParc [data-ln-abate]:first'.replace(':first', '')); await page.waitForSelector('#ovAbate');
  const opts = await page.$$eval('#abConta option', (o) => o.map((x) => x.textContent));
  check('só aparecem contas a pagar do MESMO colaborador?', opts.length === 1 && /Folha dezembro/.test(opts[0]) && !/outra pessoa/i.test(opts[0]), opts.join(' | '));
  await page.click('#abOk'); await page.waitForTimeout(400);
  const p1 = (await ev('FP.rows.filter(function(r){ return r.loan && r.parcela === 1; })'))[0];
  check('parcela 1 ficou abatida na folha?', p1.abate === 'folha1' && !p1.entry);
  check('status da parcela = paga/abatida e fora do saldo devedor?', (await ev('fpStatus(FP.rows.filter(function(r){ return r.parcela === 1 && r.loan === "' + loan.id + '"; })[0])')) === 'paga' && near(await ev('lnStats(LN.rows.filter(function(l){ return l.id === "' + loan.id + '"; })[0]).saldo'), 900), await ev('lnStats(LN.rows[0]).saldo'));
  check('contrato reaberto mostra "Abatida" e Desfazer Abatimento?', /Abatida/.test(await page.textContent('#lnParc')) && !!(await page.$('#lnParc [data-ln-unabate]')));
  check('valor líquido da folha = 3000 − parcela?', near(await ev('fpNet(FP.rows.filter(function(r){ return r.id === "folha1"; })[0])'), 3000 - p1.valor), await ev('fpNet(FP.rows.filter(function(r){ return r.id === "folha1"; })[0])'));
  await page.click('#lnCancel');

  // desfazer abatimento pela janela do contrato e abater de novo
  await ev('renderEmprestimos("concedido")');
  await page.click('#reg-empconcedidos-host tbody tr[data-ln-id="' + loan.id + '"]'); await page.waitForSelector('#ovLn');
  await page.click('#lnParc [data-ln-unabate]'); await page.waitForTimeout(500);
  check('desfazer abatimento devolve a parcela para em aberto?', (await ev('FP.rows.filter(function(r){ return r.loan && r.parcela === 1; })[0].abate')) === '');
  await page.click('#lnCancel');
  await ev(`FP.rows = FP.rows.map(function(r){ return r.loan === "${loan.id}" && r.parcela === 1 ? Object.assign({}, r, {abate: "folha1"}) : r; })`);

  // baixa da folha: bruto + parcela (principal Entrada, juros Receita); líquido no campo
  await ev('openBaixa(FP.rows.filter(function(r){ return r.id === "folha1"; })[0])'); await page.waitForSelector('#ovFpb');
  const liq = p1.valor;
  check('baixa mostra o valor líquido e as linhas fixas do desconto?', (await page.inputValue('#fpbValor')) === (await ev('fmtMoney(' + (3000 - liq) + ').replace("R$ ", "")')) && (await page.$$('#ovFpb .fpb-ln-fixed')).length >= 1 && /desconto do empréstimo/.test(await page.textContent('#ovFpb')));
  await page.$eval('#fpbConta', (e) => { e.value = 'viacredi'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#fpbOk'); await page.waitForTimeout(500);
  const ents = await ev('FL.rows.filter(function(e){ return e.pay === "folha1"; })');
  const signed = await ev(`FL.rows.filter(function(e){ return e.pay === "folha1"; }).reduce(function(t, e){ return t + flSign(e) * e.valor; }, 0)`);
  check('baixa criou o lançamento do bruto + o(s) da parcela?', ents.length === (liq > p1.linhas[0].valor + 0.001 ? 3 : 2), ents.length + ' lançamentos');
  check('efeito no caixa = −(bruto − parcela)?', near(signed, -(3000 - liq)), signed);
  check('parcela segue abatida e conta como paga no saldo do empréstimo?', (await ev('FP.rows.filter(function(r){ return r.loan && r.parcela === 1; })[0].abate')) === 'folha1' && near(await ev('lnStats(LN.rows.filter(function(l){ return l.id === "' + loan.id + '"; })[0]).pagas'), 1));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close(); fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
