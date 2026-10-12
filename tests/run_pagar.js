// Financeiro: Contas a pagar e a receber — tela, janela, repetição, baixa, desfazer baixa, previsto do Fluxo de caixa. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_fp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setSel = (id, v) => page.$eval(id, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const rows = () => page.$$eval('#reg-pagar-host tbody tr', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
  const ev = (x) => page.evaluate((s) => window.__ev(s), x);

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 1000, dataSaldo: '2026-01-01' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'agua', name: 'Água', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'conv', name: 'Convênio X', categoria: 'Receita Operacional', tipo: 'Receita' }] });
    await db.doc('config/suppliers').set({ list: [{ id: 'imob', name: 'Imobiliária Central' }] });
  });
  await page.waitForTimeout(300);

  // ---- menu e tela ----
  await page.click('#finBtn');
  check('Financeiro menu lists Contas a pagar e receber after Lançamentos?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,demonstrativos,fornecedores,catfornecedor,contas,planocontas');
  await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(300);
  check('screen opens with title?', await page.$eval('#tab-pagar', (e) => !e.hidden) && /Contas a pagar e receber/.test(await page.$eval('#tab-pagar .cad-title', (e) => e.textContent)));
  check('empty state?', /Nenhuma conta cadastrada/.test(await page.textContent('#reg-pagar-host')));
  check('hash is #pagar?', (await page.evaluate(() => location.hash)) === '#pagar');

  // ---- incluir ----
  await page.click('#fpAdd'); await page.waitForSelector('#ovFp');
  await page.click('#fpSave'); await page.waitForTimeout(150);
  check('empty form refused?', !!(await page.$('#ovFp')));
  await page.fill('#fpDesc', 'Aluguel sede'); await setSel('#fpSub', 'alu'); await setSel('#fpVenc', '2099-01-10'); await page.fill('#fpValor', '3.000,00');
  await setSel('#fpForn', 'imob'); await setSel('#fpConta', 'viacredi');
  check('subcategory hint says a pagar?', /conta a pagar/.test(await page.textContent('#fpSubHint')));
  check('repeat count disabled until repeating?', await page.$eval('#fpRepN', (e) => e.disabled));
  await setSel('#fpRep', '1'); await page.fill('#fpRepN', '3');
  await page.click('#fpSave'); await page.waitForTimeout(250);
  let r = await rows();
  check('3 monthly accounts created, labelled (1/3)…(3/3)?', r.length === 3 && /Aluguel sede \(1\/3\)/.test(r[0]) && /\(3\/3\)/.test(r[2]), r);
  check('due dates one month apart?', (await ev('FP.rows.map(function(x){return x.venc}).join()')) === '2099-01-10,2099-02-10,2099-03-10');
  check('same group, supplier shown?', (await ev('new Set(FP.rows.map(function(x){return x.grupo})).size')) === 1 && /Imobiliária Central/.test(r[0]));
  check('value shown negative (a pagar)?', /−R\$\s?3\.000,00/.test(r[0]));
  // dia 31 -> último dia do mês
  check('fpAddMonths clamps to the last day?', (await ev('fpAddMonths("2026-01-31", 1)')) === '2026-02-28' && (await ev('fpAddMonths("2026-11-30", 3)')) === '2027-02-28' && (await ev('fpAddMonths("2026-12-15", 2)')) === '2027-02-15');
  // conta a receber avulsa e vencida
  await page.click('#fpAdd'); await page.waitForSelector('#ovFp');
  await page.fill('#fpDesc', 'Repasse convênio X'); await setSel('#fpSub', 'conv'); await setSel('#fpVenc', '2020-02-10'); await page.fill('#fpValor', '5000');
  await page.click('#fpSave'); await page.waitForTimeout(250);
  r = await rows();
  check('open list has 4 (3 + the overdue)?', r.length === 4, r.length);
  check('overdue one marked "Vencida" and positive?', r.some((x) => /Repasse convênio X/.test(x) && /Vencida há/.test(x) && /R\$\s?5\.000,00/.test(x) && !/−R\$\s?5/.test(x)), r);
  const sum = await page.textContent('#fpSum');
  check('summary: a pagar 9.000, a receber 5.000, resultado −4.000, 1 vencida?', /A pagar \(em aberto\)\s*R\$\s?9\.000,00/.test(sum) && /A receber \(em aberto\)\s*R\$\s?5\.000,00/.test(sum) && /Resultado previsto\s*−R\$\s?4\.000,00/.test(sum) && /Vencidas\s*1 conta/.test(sum), sum);
  await setSel('#fpSt', 'vencida');
  check('Vencidas filter shows only the overdue?', (await rows()).length === 1);
  await setSel('#fpSt', 'aberta'); await setSel('#fpTipo', 'receber');
  check('tipo a receber shows 1?', (await rows()).length === 1);
  await setSel('#fpTipo', ''); await setSel('#fpMonth', '2099-02');
  check('month filter shows Feb only?', (await rows()).length === 1 && /\(2\/3\)/.test((await rows())[0]));
  await setSel('#fpMonth', '');
  await page.fill('#fpSearch', 'IMOBILIARIA'); await page.waitForTimeout(150);
  check('search finds by supplier ignoring accent/case?', (await rows()).length === 3);
  await page.fill('#fpSearch', ''); await page.waitForTimeout(150);

  // ---- editar com "próximas" ----
  await page.click('#reg-pagar-host tbody tr:has-text("(1/3)")'); await page.waitForSelector('#ovFp');
  check('apply-to-next checkbox offered (2 later)?', /2 próximas contas/.test(await page.textContent('#ovFp .fp-next')));
  await page.fill('#fpValor', '3.200,00'); await page.check('#fpNext'); await page.click('#fpSave'); await page.waitForTimeout(250);
  check('value applied to all three?', (await ev('FP.rows.filter(function(x){return x.grupo}).map(function(x){return x.valor}).join()')) === '3200,3200,3200');
  // sem marcar: só esta
  await page.click('#reg-pagar-host tbody tr:has-text("(2/3)")'); await page.waitForSelector('#ovFp');
  await page.fill('#fpValor', '3.300,00'); await page.click('#fpSave'); await page.waitForTimeout(250);
  check('only this one changed without the checkbox?', (await ev('FP.rows.filter(function(x){return x.grupo}).map(function(x){return x.valor}).join()')) === '3200,3300,3200');

  // ---- baixar ----
  await page.click('[data-fp-pay]:near(:text("Aluguel sede (1/3)"))').catch(() => {});
  await ev('openBaixa(FP.rows.filter(function(x){return x.parcela===1})[0])'); await page.waitForSelector('#ovFpb');
  check('payment window prefilled with the supposed value and account?', (await page.inputValue('#fpbValor')) === '3.200,00' && (await page.inputValue('#fpbConta')) === 'viacredi');
  await setSel('#fpbData', '2026-03-15'); await page.fill('#fpbValor', '3.250,00');
  await ev('FC.closed = {"2026-03": {ym: "2026-03"}}');
  await page.click('#fpbOk'); await page.waitForTimeout(200);
  check('closed month refuses the payment?', !!(await page.$('#ovFpb')) && (await ev('FL.rows.length')) === 0);
  await ev('FC.closed = {}');
  await page.click('#fpbOk'); await page.waitForTimeout(300);
  check('lançamento created with the paid value, subcategory and label?', (await ev('FL.rows.length')) === 1 && (await ev('FL.rows[0].valor')) === 3250 && (await ev('FL.rows[0].plan')) === 'alu' && /Aluguel sede \(1\/3\)/.test(await ev('FL.rows[0].desc')) && (await ev('FL.rows[0].date')) === '2026-03-15');
  check('account is now paid and linked?', !!(await ev('FP.rows.filter(function(x){return x.parcela===1})[0].entry')));
  check('open list lost it (3 left)?', (await rows()).length === 3);
  await setSel('#fpSt', 'paga');
  check('Pagas filter shows it with "Paga em 15/03"?', (await rows()).length === 1 && /Paga em 15\/03/.test((await rows())[0]), await rows());
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#ovFp');
  check('paid account opens read-only with undo?', !!(await page.$('#fpUndo')) && !(await page.$('#fpSave')) && !(await page.$('#fpDel')) && await page.$eval('#fpDesc', (e) => e.disabled));
  await page.click('#fpUndo'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('undo deletes the lançamento and reopens the account?', (await ev('FL.rows.length')) === 0 && !(await ev('FP.rows.filter(function(x){return x.parcela===1})[0].entry')));
  await setSel('#fpSt', 'aberta');
  check('back to 4 open?', (await rows()).length === 4);
  // apagar o lançamento direto reabre
  await ev('openBaixa(FP.rows.filter(function(x){return x.parcela===2})[0])'); await page.waitForSelector('#ovFpb');
  await setSel('#fpbData', '2026-03-16'); await page.click('#fpbOk'); await page.waitForTimeout(300);
  await ev('flDeleteRow(FL.rows[0].id)'); await page.waitForTimeout(150);
  await ev('renderPagar(); 1');
  check('deleting the lançamento in Lançamentos reopens the account?', !(await ev('FP.rows.filter(function(x){return x.parcela===2})[0].entry')));

  // ---- excluir com "próximas" ----
  await page.click('#reg-pagar-host tbody tr:has-text("(2/3)")'); await page.waitForSelector('#ovFp');
  await page.check('#fpNext'); await page.click('#fpDel'); await page.waitForSelector('#cfOk');
  check('delete message says 2 accounts?', /2 contas/.test(await page.textContent('.confirm-overlay')));
  await page.click('#cfOk'); await page.waitForTimeout(300);
  check('(2/3) and (3/3) gone, (1/3) kept?', (await ev('FP.rows.filter(function(x){return x.grupo}).length')) === 1);

  // ---- uso: conta e subcategoria com contas a pagar não excluem ----
  const useP = await ev('USAGE.planocontas({id: "alu"})');
  check('subcategory with accounts counts as in use?', useP.some((t) => /conta a pagar/.test(t)), useP);
  const useC = await ev('USAGE.contas({id: "viacredi"})');
  check('bank account named in an account counts as in use?', useC.some((t) => /conta a pagar/.test(t)), useC);

  // ---- previsto do Fluxo de caixa ----
  await ev(`(function(){
    var mk = function(id, d, plan, v){ return {id: id, acc: 'viacredi', date: d, desc: id, plan: plan, valor: v, extDate: '', extVal: null, obs: '', key: ''}; };
    FL.rows = [mk('a1','2026-01-05','alu',1000), mk('a2','2026-02-05','alu',1000), mk('a3','2026-03-05','alu',1000),
               mk('w1','2026-01-06','agua',90), mk('w2','2026-02-06','agua',120), mk('w3','2026-03-06','agua',150),
               mk('c1','2026-01-07','conv',4000), mk('c2','2026-02-07','conv',4000), mk('c3','2026-03-07','conv',4000)];
    FP.rows = [
      {id:'p1', venc:'2026-04-10', desc:'Aluguel abril', plan:'alu', acc:'viacredi', sup:'', valor:1500, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'p2', venc:'2026-04-20', desc:'Material', plan:'alu', acc:'', sup:'', valor:500, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'p3', venc:'2026-05-10', desc:'Maio não entra', plan:'agua', acc:'', sup:'', valor:9999, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'p4', venc:'2026-04-12', desc:'Já paga', plan:'agua', acc:'', sup:'', valor:777, entry:'x', grupo:'', parcela:0, parcelas:0, obs:''}];
    return 1; })()`);
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="demonstrativos"]'); await page.waitForTimeout(500);
  await ev('FL.acc = ""; DM.view = "flu"; DM.per = "ano"; renderDemonstrativos(); 1');
  await page.waitForTimeout(200);
  const col = JSON.parse(await ev('(function(){ var c = DM.cols.filter(function(x){return x.prev})[0]; return JSON.stringify({n: c.n, inj: c.inj, fpN: c.fpN, alu: DM.ix.plan.alu["2026-04"], agua: DM.ix.plan.agua["2026-04"], conv: DM.ix.plan.conv["2026-04"]}); })()'));
  check('previsto column exists for the month after the last one with entries', /abr/i.test(col.n) && col.inj, JSON.stringify(col));
  check('subcategory with accounts uses the sum of the open ones (1500 + 500)?', col.alu === 2000, col.alu);
  check('subcategory without accounts in that month uses the 3-month average (120)?', Math.abs(col.agua - 120) < 0.01, col.agua);
  check('income without accounts uses the average (4000)?', col.conv === 4000, col.conv);
  check('only April accounts counted (paid and May ones ignored): 2 accounts', col.fpN === 2, col.fpN);
  const sai = await ev('DM.SAI(["2026-04"])');
  check('saídas of the previsto month = 2000 + 120?', Math.abs(sai - 2120) < 0.01, sai);
  const body = await page.textContent('#demBody');
  check('note explains the forecast source (2 contas cadastradas)?', /2 contas a pagar\/receber cadastradas/.test(body), body.slice(body.indexOf('previsto') - 40, body.indexOf('previsto') + 160));
  check('overdue accounts raise the alert chip?', /conta a pagar\/receber vencida em aberto|contas a pagar\/receber vencidas em aberto/.test(body));
  const hasChart = await page.$('#demBody svg.dem-chart');
  check('balance chart still draws?', !!hasChart);
  // a conta bancária filtrada exclui só as com conta diferente
  await ev('FP.rows[1].acc = "outra"; FL.acc = "viacredi"; renderDemonstrativos(); 1');
  check('account filter skips accounts tied to another bank account (1 left)', (await ev('DM.cols.filter(function(x){return x.prev})[0].fpN')) === 1);
  // sem contas cadastradas: volta para a média
  await ev('FL.acc = ""; FP.rows = []; renderDemonstrativos(); 1');
  check('with no accounts the forecast is the average and the note says so?', /nenhuma conta a pagar\/receber cadastrada/.test(await page.textContent('#demBody')));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
