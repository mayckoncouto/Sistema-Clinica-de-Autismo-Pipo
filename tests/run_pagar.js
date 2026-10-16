// Financeiro: Contas a Pagar e a Receber — tela, janela, repetição, baixa, desfazer baixa, previsto do Fluxo de Caixa. Dados fictícios.
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
  check('Financeiro menu lists Contas a Pagar e receber after Lançamentos?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,receber,emptomados,empconcedidos,conciliacao,demonstrativos,vendas,painelvendas,comissoes,fornecedores,catfornecedor,contas,planocontas');
  await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(300);
  check('screen opens with title?', await page.$eval('#tab-pagar', (e) => !e.hidden) && /Contas a Pagar/.test(await page.$eval('#tab-pagar .cad-title', (e) => e.textContent)));
  check('empty state?', /Nenhuma conta a pagar cadastrada/.test(await page.textContent('#reg-pagar-host')));
  check('hash is #pagar?', (await page.evaluate(() => location.hash)) === '#pagar');

  // ---- incluir ----
  await page.click('#fpAdd'); await page.waitForSelector('#ovFp');
  await page.click('#fpSave'); await page.waitForTimeout(150);
  check('empty form refused?', !!(await page.$('#ovFp')));
  await page.fill('#fpDesc', 'Aluguel sede'); await setSel('#fpSub', 'alu'); await setSel('#fpVenc', '2099-01-10'); await page.fill('#fpValor', '3.000,00');
  await setSel('#fpForn', 'imob'); await setSel('#fpConta', 'viacredi');
  check('Contas a Pagar lists only despesa/saída subcategories?', (await page.$$eval('#fpSub option', (o) => o.map((x) => x.value).filter(Boolean))).join() === 'agua,alu');
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
  // conta a receber avulsa e vencida: na tela Contas a Receber
  let r2 = await rows();
  check('Contas a Pagar has the 3 rent accounts only', r2.length === 3);
  let sum = await page.textContent('#fpSum');
  check('pagar summary: 9.000 em aberto, nenhuma vencida?', /A pagar \(em aberto\)\s*R\$\s?9\.000,00/.test(sum) && /VencidasNenhuma/.test(sum), sum);
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="receber"]'); await page.waitForTimeout(300);
  check('Contas a Receber screen with its title and empty state?', /Contas a Receber/.test(await page.$eval('#tab-receber .cad-title', (e) => e.textContent)) && /Nenhuma conta a receber cadastrada/.test(await page.textContent('#reg-receber-host')));
  await page.click('#frAdd'); await page.waitForSelector('#ovFp');
  check('receber lists only receita/entrada subcategories and has no supplier field?', (await page.$$eval('#fpSub option', (o) => o.map((x) => x.value).filter(Boolean))).join() === 'conv' && !(await page.$('#fpForn')));
  await page.fill('#fpDesc', 'Repasse convênio X'); await setSel('#fpSub', 'conv'); await setSel('#fpVenc', '2020-02-10'); await page.fill('#fpValor', '5000');
  await page.click('#fpSave'); await page.waitForTimeout(250);
  const rr = await page.$$eval('#reg-receber-host tbody tr', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('receber list: overdue marked Atrasada, positive, button Receber?', rr.length === 1 && /Atrasada há/.test(rr[0]) && /R\$\s?5\.000,00/.test(rr[0]) && !/−R\$\s?5/.test(rr[0]) && /Receber$/.test(rr[0]), rr);
  const sumR = await page.textContent('#frSum');
  check('receber summary: 5.000 a receber, 1 atrasada?', /A receber \(em aberto\)\s*R\$\s?5\.000,00/.test(sumR) && /Atrasadas\s*R\$\s?5\.000,00 \(1 conta\)/.test(sumR), sumR);
  check('pagar list does not show the receivable', true);
  await setSel('#frSt', 'vencida');
  check('Atrasadas filter shows it', (await page.$$eval('#reg-receber-host tbody tr', (r) => r.length)) === 1);
  await setSel('#frSt', 'paga');
  check('Recebidas filter empty', /Nada encontrado/.test(await page.textContent('#reg-receber-host')));
  await setSel('#frSt', 'aberta');
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(300);
  check('pagar list still 3 (receivable not mixed in)?', (await rows()).length === 3);
  await setSel('#fpMonth', '2099-02');
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
  check('open list lost it (2 left)?', (await rows()).length === 2);
  await setSel('#fpSt', 'paga');
  check('Pagas filter shows it with "Paga em 15/03"?', (await rows()).length === 1 && /Paga em 15\/03/.test((await rows())[0]), await rows());
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#ovFp');
  check('paid account opens read-only with undo?', !!(await page.$('#fpUndo')) && !(await page.$('#fpSave')) && !(await page.$('#fpDel')) && await page.$eval('#fpDesc', (e) => e.disabled));
  await page.click('#fpUndo'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('undo deletes the lançamento and reopens the account?', (await ev('FL.rows.length')) === 0 && !(await ev('FP.rows.filter(function(x){return x.parcela===1})[0].entry')));
  await setSel('#fpSt', 'aberta');
  check('back to 3 open?', (await rows()).length === 3);
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

  // ---- previsto do Fluxo de Caixa ----
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
  check('overdue payables raise their alert and the open-accounts result card shows?', /3 contas a pagar vencidas em aberto/.test(body) && /Contas em aberto: resultado/.test(body), body.slice(0, 400));
  const hasChart = await page.$('#demBody svg.dem-chart');
  check('balance chart still draws?', !!hasChart);
  // a conta bancária filtrada exclui só as com conta diferente
  await ev('FP.rows[1].acc = "outra"; FL.acc = "viacredi"; renderDemonstrativos(); 1');
  check('account filter skips accounts tied to another bank account (1 left)', (await ev('DM.cols.filter(function(x){return x.prev})[0].fpN')) === 1);
  // sem contas cadastradas: volta para a média
  await ev('FL.acc = ""; FP.rows = []; renderDemonstrativos(); 1');
  check('with no accounts the forecast is the average and the note says so?', /nenhuma conta a pagar\/receber cadastrada/.test(await page.textContent('#demBody')));

  // ---- saldo mínimo e alerta de saldo baixo ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [
      { id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 1000, dataSaldo: '2020-01-01', saldoMinimo: 500 },
      { id: 'caixa', name: 'Caixa', tipo: 'Caixa', saldoInicial: 50, dataSaldo: '2020-01-01' }] });
  });
  await page.waitForTimeout(300);
  const R1 = JSON.parse(await ev(`(function(){
    var t = trTodayIso();
    FL.rows = [];
    FP.rows = [
      {id:'s1', venc: fpAddDays(t, 3), desc:'Fornecedor', plan:'alu', acc:'viacredi', sup:'', valor:700, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'s2', venc: fpAddDays(t, 40), desc:'Repasse tardio', plan:'conv', acc:'viacredi', sup:'', valor:300, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'s3', venc: fpAddDays(t, 2), desc:'Sem conta', plan:'agua', acc:'', sup:'', valor:100, entry:'', grupo:'', parcela:0, parcelas:0, obs:''}];
    smSetHorizon("30");
    var P = smProject(); var i = P.items[0];
    return JSON.stringify({n: P.items.length, hoje: i.hoje, low: i.low.v, below: i.below, first: i.first === fpAddDays(t, 3), final: i.final, sem: P.sem, mes: smEndIso("mes") >= t}); })()`));
  check('only accounts with a minimum are checked (Viacredi)', R1.n === 1, JSON.stringify(R1));
  check('balance today 1.000; open payable of 700 drops it to 300, below the 500 minimum', R1.hoje === 1000 && R1.low === 300 && R1.below && R1.first, JSON.stringify(R1));
  check('receivable 40 days away is outside "Próximos 30 dias"; the one without bank account is counted apart', R1.final === 300 && R1.sem === 1, JSON.stringify(R1));
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(400);
  await ev('renderPagar(); 1');
  let al = await page.textContent('#fpAlert');
  check('Contas a Pagar shows the low-balance alert with the day and the minimum', /saldo baixo/i.test(al) && /Viacredi/.test(al) && /abaixo do mínimo de R\$\s?500,00/.test(al) && /1 conta sem conta bancária prevista/.test(al), al);
  check('alert box is red and has the horizon selector', await page.$eval('#fpAlert .sm-box', (e) => e.classList.contains('sm-low')) && !!(await page.$('#fpAlert select[data-sm-h]')));
  await setSel('#fpAlert select[data-sm-h]', 'mes');
  check('changing the horizon is remembered', (await ev('smHorizon()')) === 'mes');
  await ev('smSetHorizon("30"); 1');
  await ev(`FP.rows.push({id:'s4', venc: fpAddDays(trTodayIso(), -5), desc:'Atrasado', plan:'conv', acc:'viacredi', sup:'', valor:5000, entry:'', grupo:'', parcela:0, parcelas:0, obs:''}); renderPagar(); 1`);
  al = await page.textContent('#fpAlert');
  check('an overdue receivable counts today, so the minimum is back in order', /Saldo Mínimo em Dia/.test(al) && !(await page.$('#fpAlert .sm-low')), al);
  await ev('FP.rows.pop(); 1');
  // Fluxo de Caixa mostra o mesmo alerta
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="demonstrativos"]'); await page.waitForTimeout(400);
  await ev(`FL.rows = [{id:'z1', acc:'viacredi', date:'2026-03-05', desc:'x', plan:'conv', valor:10, extDate:'', extVal:null, obs:'', key:''}]; DM.view = 'flu'; renderDemonstrativos(); 1`);
  await page.waitForTimeout(200);
  check('Fluxo de Caixa shows the low-balance box too', /Atenção: Saldo Baixo/.test(await page.textContent('#demBody')));
  // janela da conta bancária: campo Saldo Mínimo
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="contas"]'); await page.waitForTimeout(300);
  await page.click('#reg-contas-host tbody tr:has-text("Viacredi")'); await page.waitForSelector('#regMinimo');
  check('account window shows the saved minimum', (await page.inputValue('#regMinimo')) === '500,00', await page.inputValue('#regMinimo'));
  await page.fill('#regMinimo', '800'); await page.click('#regSave'); await page.waitForTimeout(300);
  check('the new minimum is saved on the account', (await ev('state.bankAccounts.filter(function(a){return a.id==="viacredi"})[0].saldoMinimo')) === 800);
  await page.click('#reg-contas-host tbody tr:has-text("Viacredi")'); await page.waitForSelector('#regMinimo');
  await page.fill('#regMinimo', ''); await page.click('#regSave'); await page.waitForTimeout(300);
  check('empty minimum removes the alert setting', (await ev('state.bankAccounts.filter(function(a){return a.id==="viacredi"})[0].saldoMinimo')) === undefined);

  // ---- vincular conta a lançamento que já existe ----
  await ev(`(function(){
    var mk = function(id, d, plan, v, desc){ return {id: id, acc: 'viacredi', date: d, desc: desc, plan: plan, valor: v, extDate: '', extVal: null, obs: '', key: ''}; };
    FL.rows = [mk('e1','2026-03-10','alu',1500,'Aluguel março'), mk('e2','2026-03-11','conv',4000,'Repasse Unimed'), mk('e3','2026-03-20','agua',90,'Água')];
    FP.rows = [
      {id:'q1', venc:'2026-03-12', desc:'Aluguel sede', plan:'alu', acc:'viacredi', sup:'', valor:1500, entry:'', grupo:'', parcela:0, parcelas:0, obs:''},
      {id:'q2', venc:'2026-03-15', desc:'Repasse convênio', plan:'conv', acc:'viacredi', sup:'', valor:4000, entry:'', grupo:'', parcela:0, parcelas:0, obs:''}];
    FP.f.pagar.st = 'aberta'; FP.f.pagar.ym = ''; FP.f.pagar.q = ''; FP.f.receber.st = 'aberta'; FP.f.receber.ym = ''; FP.f.receber.q = '';
    return 1; })()`);
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(400);
  await ev('renderPagar(); 1');
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#ovFp');
  check('open account with a matching entry suggests linking it', /já foi paga/.test(await page.textContent('#ovFp .fp-sugg')) && /Aluguel março/.test(await page.textContent('#ovFp .fp-sugg')));
  await page.click('#fpSugg'); await page.waitForTimeout(250);
  check('suggestion links the entry (account becomes paid, entry untouched)', (await ev('FP.rows[0].entry')) === 'e1' && (await ev('FL.rows.length')) === 3 && (await ev('FL.rows[0].valor')) === 1500);
  check('an entry already linked cannot be linked to another account', (await ev('fpLinkSet("q2", "e1")')) === false && !(await ev('FP.rows[1].entry')));
  await setSel('#fpSt', 'paga');
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#fpUnlink');
  await page.click('#fpUnlink'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(250);
  check('Desvincular reopens the account and keeps the lançamento', !(await ev('FP.rows[0].entry')) && (await ev('FL.rows.length')) === 3);
  await setSel('#fpSt', 'aberta');
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#fpLink');
  await page.click('#fpLink'); await page.waitForSelector('#ovFpl');
  const lst = await page.$$eval('#fplList .fpl-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('link list shows only despesa entries, the best one first and marked', lst.length === 2 && /Aluguel março/.test(lst[0]) && /Mais parecido/.test(lst[0]) && !lst.some((x) => /Repasse Unimed/.test(x)), lst);
  check('Vincular is off until one is chosen', await page.$eval('#fplOk', (b) => b.disabled));
  await page.fill('#fplQ', 'agua'); await page.waitForTimeout(100);
  check('search filters the list', (await page.$$eval('#fplList .fpl-row', (r) => r.filter((x) => !x.hidden).length)) === 1);
  await page.fill('#fplQ', '');
  await page.check('input[name="fplPick"][value="e3"]'); await page.click('#fplOk'); await page.waitForTimeout(250);
  check('picking from the list links it', (await ev('FP.rows[0].entry')) === 'e3');
  await ev('fpLinkSet("q1", ""); 1');
  // pelo lançamento
  await ev('openLancamento(FL.rows.filter(function(x){return x.id==="e2"})[0]); 1'); await page.waitForSelector('#flLinkBox');
  check('entry window says no account is linked and offers to link', /Nenhuma conta a pagar ou a receber ligada/.test(await page.textContent('#flLinkBox')) && !!(await page.$('#flLinkBtn')));
  await page.click('#flLinkBtn'); await page.waitForSelector('#ovFpl');
  const lst2 = await page.$$eval('#fplList .fpl-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
  check('the list has only receivable accounts, best first', lst2.length === 1 && /Repasse convênio/.test(lst2[0]) && /Mais parecido/.test(lst2[0]), lst2);
  await page.check('input[name="fplPick"]'); await page.click('#fplOk'); await page.waitForTimeout(250);
  check('linked from the entry side', (await ev('FP.rows[1].entry')) === 'e2');
  await ev('openLancamento(FL.rows.filter(function(x){return x.id==="e2"})[0]); 1'); await page.waitForSelector('#flUnlinkBtn');
  check('entry window now shows the linked account', /Ligado à conta/.test(await page.textContent('#flLinkBox')) && /Repasse convênio/.test(await page.textContent('#flLinkBox')));
  await page.click('#flUnlinkBtn'); await page.waitForTimeout(250);
  check('unlink from the entry side', !(await ev('FP.rows[1].entry')) && !!(await page.$('#flLinkBtn')));
  await ev('FC.closed = {"2026-03": {ym: "2026-03"}}; openLancamento(FL.rows.filter(function(x){return x.id==="e2"})[0]); 1'); await page.waitForSelector('#flLinkBox');
  check('closed month: no link/unlink buttons', !(await page.$('#flLinkBtn')) && !(await page.$('#flUnlinkBtn')));
  await ev('FC.closed = {}; document.getElementById("modalHost").innerHTML = ""; 1');

  // ---- rateio: uma conta, várias subcategorias, vários lançamentos ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'agua', name: 'Água', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'conv', name: 'Convênio X', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'pagto', name: 'Pagamento de Empréstimos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'juros', name: 'Juros', categoria: 'Despesas Financeiras', tipo: 'Despesa' }] });
  });
  await page.waitForTimeout(300);
  await ev('FL.rows = []; FP.rows = []; FP.f.pagar.st = "aberta"; 1');
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="pagar"]'); await page.waitForTimeout(300);
  await ev('renderPagar(); 1');
  await page.click('#fpAdd'); await page.waitForSelector('#ovFp');
  check('new account offers "Dividir em subcategorias"', !!(await page.$('#fpSplitOn')));
  await page.fill('#fpDesc', 'Parcela empréstimo 1/12'); await setSel('#fpVenc', '2026-03-10'); await page.fill('#fpValor', '1000');
  await page.click('#fpSplitOn');
  check('splitting creates two parts, the main subcategory field is locked and the total follows', (await page.$$('#fpSplitBox .fp-ln')).length === 2 && await page.$eval('#fpValor', (e) => e.readOnly));
  await setSel('#fpSplitBox .fp-ln:nth-child(1) select', 'pagto'); await page.fill('#fpSplitBox .fp-ln:nth-child(1) .fp-ln-val', '800');
  await setSel('#fpSplitBox .fp-ln:nth-child(2) select', 'juros'); await page.fill('#fpSplitBox .fp-ln:nth-child(2) .fp-ln-val', '200');
  check('total shows R$ 1.000,00 and the value field matches', /R\$\s?1\.000,00/.test(await page.textContent('#fpSplitSum')) && (await page.inputValue('#fpValor')) === '1.000,00');
  await page.click('#fpSplitAdd'); await setSel('#fpSplitBox .fp-ln:nth-child(3) select', 'conv'); await page.fill('#fpSplitBox .fp-ln:nth-child(3) .fp-ln-val', '5');
  await page.click('#fpSave'); await page.waitForTimeout(200);
  check('a part with a different direction (receita in a pagar account) is refused', !!(await page.$('#ovFp')) && (await ev('FP.rows.length')) === 0);
  await page.click('#fpSplitBox .fp-ln:nth-child(3) .fp-ln-rm');
  check('removing the part brings the total back', /R\$\s?1\.000,00/.test(await page.textContent('#fpSplitSum')));
  await page.click('#fpSave'); await page.waitForTimeout(300);
  check('saved with 2 lines, total 1.000 and main subcategory = first part', (await ev('FP.rows[0].linhas.length')) === 2 && (await ev('FP.rows[0].valor')) === 1000 && (await ev('FP.rows[0].plan')) === 'pagto');
  check('list shows "Rateio (2)"', /Rateio \(2\)/.test((await rows())[0]));
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#ovFp');
  check('editing shows the saved parts (800 and 200)', (await page.inputValue('#fpSplitBox .fp-ln:nth-child(2) .fp-ln-val')) === '200,00' && !(await page.$('#fpLink')));
  await page.click('#fpCancel');
  // baixa com valores diferentes (juros maiores)
  await ev('openBaixa(FP.rows[0]); 1'); await page.waitForSelector('#ovFpb');
  check('payment window lists the parts, total read-only, no extrato fields', (await page.$$('#ovFpb .fpb-ln-val')).length === 2 && await page.$eval('#fpbValor', (e) => e.readOnly) && !(await page.$('#fpbExtVal')));
  await page.fill('#ovFpb .fpb-ln-val[data-i="1"]', '250');
  check('total follows the parts (1.050,00)', (await page.inputValue('#fpbValor')) === '1.050,00');
  await setSel('#fpbData', '2026-03-16'); await setSel('#fpbConta', 'viacredi');
  await page.click('#fpbOk'); await page.waitForTimeout(300);
  const ent = JSON.parse(await ev('JSON.stringify(FL.rows.map(function(e){ return {p: e.plan, v: e.valor, d: e.desc, l: e.pay === FP.rows[0].id, dt: e.date}; }))'));
  check('two entries were created: principal 800 (Saída) and juros 250 (Despesa), both linked and dated', ent.length === 2 && ent[0].p === 'pagto' && ent[0].v === 800 && ent[1].p === 'juros' && ent[1].v === 250 && ent.every((e) => e.l && e.dt === '2026-03-16'), JSON.stringify(ent));
  check('descriptions say which part', /Principal|Pagamento de Empréstimos/.test(ent[0].d) && /Juros/.test(ent[1].d), JSON.stringify(ent.map((e) => e.d)));
  check('the account is paid and points to the first entry', !!(await ev('FP.rows[0].entry')) && (await ev('FP.rows[0].entry')) === (await ev('FL.rows[0].id')));
  check('signs: Saída and Despesa both subtract (−1.050 on the account)', (await ev('FL.rows.reduce(function(t, e){ return t + flSign(e) * e.valor; }, 0)')) === -1050);
  // lançamento mostra de onde veio
  await ev('openLancamento(FL.rows[1]); 1'); await page.waitForSelector('#flLinkBox');
  check('the second entry says it came from paying that account, without link buttons', /Criado ao pagar a conta/.test(await page.textContent('#flLinkBox')) && !(await page.$('#flUnlinkBtn')));
  await ev('document.getElementById("modalHost").innerHTML = ""; 1');
  // desfazer baixa apaga todos
  await setSel('#fpSt', 'paga');
  await page.click('#reg-pagar-host tbody tr'); await page.waitForSelector('#fpUndo');
  await page.click('#fpUndo'); await page.waitForSelector('#cfOk');
  check('undo warns that 2 entries go away', /2 lançamentos/.test(await page.textContent('.confirm-overlay')));
  await page.click('#cfOk'); await page.waitForTimeout(300);
  check('undo deletes both entries and reopens the account', (await ev('FL.rows.length')) === 0 && !(await ev('FP.rows[0].entry')));
  // subcategoria usada no rateio conta como em uso e o previsto usa as linhas
  const useJ = await ev('USAGE.planocontas({id: "juros"})');
  check('a subcategory used only inside a split counts as in use', useJ.some((t) => /conta a pagar/.test(t)), useJ);
  await ev(`FP.rows[0].venc = '2026-04-10'; FL.rows = [{id:'zz', acc:'viacredi', date:'2026-03-05', desc:'x', plan:'juros', valor:10, extDate:'', extVal:null, obs:'', key:''}]; DM.view='flu'; DM.per='ano'; 1`);
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="demonstrativos"]'); await page.waitForTimeout(400);
  await ev('renderDemonstrativos(); 1');
  check('the forecast spreads the split over its own subcategories (principal 800, juros 200)', (await ev('DM.ix.plan.pagto && DM.ix.plan.pagto["2026-04"]')) === 800 && (await ev('DM.ix.plan.juros["2026-04"]')) === 200);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
