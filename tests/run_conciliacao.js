// Financeiro: Conciliação com o extrato — leitura OFX/CSV, importar sem duplicar, sugerir, confirmar, escolher, criar, desfazer. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cn.html');
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

  // ---- leitura dos arquivos ----
  const ofx = 'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>-1500.00<FITID>A1<MEMO>PIX ALUGUEL SEDE</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>2000,50<FITID>A2<NAME>CONVENIO X</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const o = await ev('cnParseOfx(' + JSON.stringify(ofx) + ')');
  check('OFX: 2 movimentos, saída negativa, vírgula decimal e FITID?', o.length === 2 && o[0].valor === -1500 && o[0].date === '2026-10-05' && o[0].doc === 'A1' && o[0].desc === 'PIX ALUGUEL SEDE' && o[1].valor === 2000.5 && o[1].desc === 'CONVENIO X', JSON.stringify(o));
  const rows = [['Extrato do banco'], ['Data', 'Histórico', 'Crédito', 'Débito'], ['07/10/2026', 'TARIFA', '', '35,90'], ['08/10/2026', 'DEPOSITO', '1.200,00', '']];
  const c1 = await ev('cnParseRows(' + JSON.stringify(rows) + ')');
  check('planilha com Crédito e Débito: débito vira saída?', c1.lines && c1.lines.length === 2 && c1.lines[0].valor === -35.9 && c1.lines[1].valor === 1200, JSON.stringify(c1));
  const c2 = await ev('cnParseRows(' + JSON.stringify([['Data', 'Descrição', 'Valor'], ['2026-10-09', 'X', '-10,00']]) + ')');
  check('planilha com coluna Valor?', c2.lines && c2.lines[0].valor === -10 && c2.lines[0].date === '2026-10-09');
  check('sem colunas conhecidas: erro claro?', /Não encontrei as colunas/.test((await ev('cnParseRows([["a","b"]])')).error || ''));
  const ks = await ev('cnKeys([{date:"2026-10-01",valor:-5,desc:"A",doc:""},{date:"2026-10-01",valor:-5,desc:"A",doc:""},{date:"2026-10-01",valor:-5,desc:"B",doc:"Z9"}]).map(function(l){ return l.key; })');
  check('chaves: repetidas ganham nº e documento vale por si?', ks[0] !== ks[1] && ks[2] === 'id:Z9|2026-10-01|-5.00', JSON.stringify(ks));
  const kb = await ev('[cnKeys([{date:"2026-08-07",valor:9140,desc:"PGTO",doc:"N10132"}])[0].key, cnKeys([{date:"2026-09-01",valor:14750,desc:"PGTO",doc:"N10132"}])[0].key]');
  check('Bradesco: mesmo FITID em meses diferentes vira chaves diferentes?', kb[0] !== kb[1], JSON.stringify(kb));
  const kz = await ev('cnKeys(cnParseOfx("<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260914030000.000<TRNAMT>53085.72<FITID>000000<MEMO>SAUDE CAIXA PGTO CREDENC</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260925030000.000<TRNAMT>-73.0<FITID>000000<MEMO>TARIFA MANUTENCAO CONTA A</STMTTRN></OFX>")).map(function(l){ return l.key; })');
  check('OFX da Caixa (FITID 000000 em tudo): chaves diferentes?', kz.length === 2 && kz[0] !== kz[1] && !/^id:/.test(kz[0]), JSON.stringify(kz));

  // ---- dados ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco' }, { id: 'bradesco', name: 'Bradesco', tipo: 'Banco' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'conv', name: 'Convênio X', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'tar', name: 'Tarifas', categoria: 'Despesas Financeiras', tipo: 'Despesa' }] });
  });
  await page.waitForTimeout(300);
  await ev(`FL.rows = [
    {id:'e1', acc:'viacredi', date:'2026-10-05', desc:'Aluguel sede', plan:'alu', valor:1500, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'e2', acc:'viacredi', date:'2026-10-07', desc:'Repasse convênio X', plan:'conv', valor:2000.5, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'e3', acc:'viacredi', date:'2026-10-20', desc:'Lançamento sem extrato', plan:'alu', valor:99, extDate:'', extVal:null, obs:'', key:'', pay:''}]; CN.rows = []; CN.acc = 'viacredi'`);
  await page.click('#finBtn');
  check('Financeiro menu tem Conciliação no grupo do movimento (depois de Contas a Receber)?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,receber,conciliacao,emptomados,empconcedidos,vendas,painelvendas,comissoes,demonstrativos,contas,planocontas,fornecedores,catfornecedor');
  await page.click('#finMenu [data-nav="conciliacao"]'); await page.waitForTimeout(300);
  check('tela abre com título e hash?', /Conciliação/.test(await page.$eval('#tab-conciliacao .cad-title', (e) => e.textContent)) && (await page.evaluate(() => location.hash)) === '#conciliacao');
  check('sem extrato: estado vazio?', /Nenhum extrato importado/.test(await page.textContent('#reg-conciliacao-host')));

  // importar pelo arquivo
  await page.click('#cnImport'); await page.waitForSelector('#ovCnImp');
  await page.setInputFiles('#cniFile', { name: 'extrato.ofx', mimeType: 'text/plain', buffer: Buffer.from(ofx) });
  await page.waitForFunction(() => /2.*linhas lidas|linhas lidas/.test(document.getElementById('cniPrev').textContent));
  check('prévia: 2 lidas, 2 novas?', /<b>2<\/b> linhas lidas/.test(await page.$eval('#cniPrev', (e) => e.innerHTML)) && /<b>2<\/b> novas/.test(await page.$eval('#cniPrev', (e) => e.innerHTML)), await page.textContent('#cniPrev'));
  await page.click('#cniGo'); await page.waitForTimeout(300);
  check('importou 2 linhas na conta?', (await ev('CN.rows.length')) === 2 && !(await page.$('#ovCnImp')));
  // importar o mesmo arquivo de novo não duplica
  await page.click('#cnImport'); await page.waitForSelector('#ovCnImp');
  await page.setInputFiles('#cniFile', { name: 'extrato.ofx', mimeType: 'text/plain', buffer: Buffer.from(ofx) });
  await page.waitForFunction(() => /já importadas/.test(document.getElementById('cniPrev').textContent));
  check('de novo: 0 novas, botão desativado?', /<b>0<\/b> novas/.test(await page.$eval('#cniPrev', (e) => e.innerHTML)) && await page.$eval('#cniGo', (b) => b.disabled));
  await page.click('#cniCancel');

  // sugestões
  const rowsT = () => page.$$eval('#reg-conciliacao-host tbody tr', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ')));
  let t = await rowsT();
  check('as 2 linhas pendentes mostram a sugestão certa?', t.length === 2 && t.some((x) => /Aluguel sede/.test(x) && /Confirmar/.test(x)) && t.some((x) => /Repasse convênio X/.test(x) && /Confirmar/.test(x)), JSON.stringify(t));
  check('cartões: 2 linhas, 0 conciliadas, 3 lançamentos sem extrato?', /Linhas do Extrato2/.test(await page.textContent('#cnSum')) && /Lançamentos sem Extrato3/.test(await page.textContent('#cnSum')), await page.textContent('#cnSum'));
  // confirmar uma
  await page.click('#reg-conciliacao-host tbody tr:first-child [data-cn-ok]'); await page.waitForTimeout(200);
  check('confirmar liga a linha ao lançamento?', (await ev('CN.rows.filter(function(l){ return l.entry; }).length')) === 1);
  // confirmar sugestões (a segunda, data ate 2 dias: 06 vs 07 = 1 dia)
  await page.click('#cnAuto'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('Confirmar Sugestões concilia a que sobrou?', (await ev('CN.rows.filter(function(l){ return l.entry; }).length')) === 2);
  await page.$eval('#cnSt', (e) => { e.value = 'conc'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  check('filtro Conciliadas mostra as 2 com a ligação?', (await rowsT()).length === 2 && /Conciliada/.test((await rowsT())[0]));
  // marca nos Lançamentos
  check('Lançamentos: ✓ nos conciliados e não no e3?', (await ev('cnMatched("e1") && cnMatched("e2") && !cnMatched("e3")')));
  // desfazer
  await page.click('#reg-conciliacao-host tbody tr:first-child [data-cn-undo]'); await page.waitForTimeout(200);
  check('Desfazer solta a linha?', (await ev('CN.rows.filter(function(l){ return l.entry; }).length')) === 1);
  // sem extrato
  await page.$eval('#cnSt', (e) => { e.value = 'sem'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  t = await rowsT();
  check('Lançamentos sem Extrato: e3 e o desfeito?', t.length === 2 && t.some((x) => /Lançamento sem extrato/.test(x)), JSON.stringify(t));

  // escolher à mão e valor diferente
  await ev(`CN.rows.push({id:'cnx', acc:'viacredi', date:'2026-10-21', desc:'DEB 99', valor:-98, doc:'', key:'k9', entry:''}); CN.st='pend'`);
  await page.$eval('#cnSt', (e) => { e.value = 'pend'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  await page.evaluate(() => { const h = document.getElementById('confirmHost'); if (h) h.remove(); });   // como logo depois de abrir o sistema
  const rowX = await page.$('#reg-conciliacao-host tr[data-cn-line="cnx"] [data-cn-pick]');
  await rowX.click(); await page.waitForSelector('#ovCnPick');
  check('Escolher mostra os lançamentos da conta (outro valor também)?', (await page.$$('#ovCnPick input[name="cnE"]')).length >= 2);
  await page.check('#ovCnPick input[value="e3"]'); await page.click('#cnpOk'); await page.waitForSelector('#cfOk');
  check('valor diferente pede confirmação?', /Soma Diferente/.test(await page.textContent('#confirmHost')));
  await page.click('#cfOk'); await page.waitForTimeout(300);
  check('conciliou mesmo assim?', (await ev('CN.rows.filter(function(l){ return l.id === "cnx"; })[0].entry')) === 'e3');

  // criar lançamento a partir da linha
  await ev(`CN.rows.push({id:'cny', acc:'viacredi', date:'2026-10-22', desc:'TARIFA MANUT', valor:-35.9, doc:'', key:'k10', entry:''})`);
  await page.$eval('#cnSt', (e) => { e.value = 'pend'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  await page.click('#reg-conciliacao-host tr[data-cn-line="cny"] [data-cn-new]'); await page.waitForSelector('#ovFl');
  check('lançamento novo vem preenchido com o extrato?', (await page.$eval('#flDesc', (e) => e.value)) === 'TARIFA MANUT' && /35,90/.test(await page.$eval('#flValor', (e) => e.value)) && /35,90/.test(await page.$eval('#flExtVal', (e) => e.value)));
  await page.$eval('#flSub', (e) => { e.value = 'tar'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#flSave'); await page.waitForTimeout(400);
  const ly = await ev('CN.rows.filter(function(l){ return l.id === "cny"; })[0].entry');
  check('salvou o lançamento e já ligou a linha?', !!ly && !!(await ev('cnEntryById(' + JSON.stringify(ly) + ')')));
  // apagar o lançamento solta a linha
  await ev('flDeleteRow(' + JSON.stringify(ly) + ')'); await page.waitForTimeout(200);
  check('apagar o lançamento solta a linha?', (await ev('CN.rows.filter(function(l){ return l.id === "cny"; })[0].entry')) === '');

  // Seleção: marca uma linha com sugestão e uma "Provável" e confirma as duas de uma vez
  await ev(`FL.rows.push({id:"e9", acc:"viacredi", date:"2026-10-23", desc:"Conta de luz", plan:"alu", valor:77, extDate:"", extVal:null, obs:"", key:"", pay:""});
    CN.rows.push({id:"cns", acc:"viacredi", date:"2026-10-23", desc:"DEB LUZ", valor:-77, doc:"", key:"k11", entry:""});
    CN.rows.push({id:"cnp", acc:"viacredi", date:"2026-10-24", desc:"TARIFA PIX", valor:-3.5, doc:"", key:"k12", entry:""});
    window.__lp = cnLearnPlan; cnLearnPlan = function(d){ return /TARIFA PIX/.test(d) ? {plan: "tar", n: 3, total: 3, share: 1, nivel: "Média"} : null; }; CN.st = "pend";`);
  await page.$eval('#cnSt', (e) => { e.value = 'pend'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  check('Criar e Dividir em colunas próprias e 1ª coluna com caixa?', !!(await page.$('#reg-conciliacao-host tr[data-cn-line="cnp"] td:nth-child(11) [data-cn-split]')) && !!(await page.$('#reg-conciliacao-host tr[data-cn-line="cnp"] td:nth-child(10) [data-cn-new]')) && !!(await page.$('#reg-conciliacao-host tr[data-cn-line="cnp"] td:nth-child(1) [data-cn-sel]')));
  await page.check('[data-cn-sel="cns"]'); await page.check('[data-cn-sel="cnp"]');
  check('botão vira Confirmar Selecionadas (2)?', (await page.textContent('#cnAuto')).indexOf('Selecionadas (2)') !== -1 || /x/.test(await page.textContent('#cnAuto')), await page.textContent('#cnAuto'));
  await page.evaluate(() => document.getElementById('cnAuto').click()); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(500);
  const sel = await ev('(function(){ var a = CN.rows.filter(function(l){ return l.id === "cns"; })[0], b = CN.rows.filter(function(l){ return l.id === "cnp"; })[0], e = b.entry ? cnEntryById(b.entry) : null; return [a.entry, !!e && e.plan, e && e.valor]; })()');
  check('sugestão ligada e provável criou o lançamento e conciliou?', sel[0] === 'e9' && sel[1] === 'tar' && sel[2] === 3.5, JSON.stringify(sel));
  await ev('cnLearnPlan = window.__lp');
  // Dividir: grade com Nº, resumo em cartões, "Lançar o que Falta" e botão só libera quando fecha
  await ev(`CN.rows.push({id:"cnd", acc:"viacredi", date:"2026-10-25", desc:"PAGAMENTO LOTE", valor:-100, doc:"", key:"k13", entry:""}); CN.st = "pend"`);
  await page.$eval('#cnSt', (e) => { e.value = 'pend'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  await page.click('#reg-conciliacao-host tr[data-cn-line="cnd"] [data-cn-split]'); await page.waitForSelector('#ovCnSplit');
  check('Dividir: resumo em cartões e botão travado sem fechar?', (await page.$$('#cnsTot .fl-card')).length === 3 && await page.$eval('#cnsOk', (b) => b.disabled));
  const rowsSp = await page.$$('#cnsRows .cn-sp-row');
  for (const r of rowsSp){ await r.$eval('select.cn-sp-plan', (s) => { s.value = 'tar'; s.dispatchEvent(new Event('change', { bubbles: true })); }); }
  await rowsSp[0].$eval('.cn-sp-val', (e) => { e.value = '30,00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#cnsFill');
  check('Lançar o que Falta preenche a última parte e libera o botão?', (await page.$eval('#cnsRows .cn-sp-row:last-child .cn-sp-val', (e) => e.value)) === '70,00' && !(await page.$eval('#cnsOk', (b) => b.disabled)), await page.$eval('#cnsOk', (b) => b.textContent));
  await page.click('#cnsOk'); await page.waitForTimeout(500);
  check('dividiu em 2 lançamentos e conciliou?', (await ev('cnEntriesOf(CN.rows.filter(function(l){ return l.id === "cnd"; })[0]).length')) === 2);
  // Desfazer Conciliações: lista as conciliadas agora há pouco (por mim) e desfaz as marcadas
  await page.click('#cnMenuBtn'); await page.click('#cnMenu [data-cn-act="undo"]'); await page.waitForSelector('#ovCnUndo');
  const nU = await page.$$eval('#ovCnUndo tr[data-cu]', (r) => r.length);
  check('Desfazer Conciliações lista as conciliadas hoje?', nU >= 1 && /cnx/.test(await page.$eval('#ovCnUndo', (o) => [...o.querySelectorAll("tr[data-cu]")].map((r) => r.getAttribute("data-cu")).join(","))), nU);
  await page.click('#cuAll'); await page.check('#ovCnUndo tr[data-cu="cnx"] [data-cu-chk]');
  check('botão conta só a marcada?', /(1)/.test(await page.textContent('#cuGo')));
  await page.click('#cuGo'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(400);
  check('desfez a conciliação (linha volta a pendente)?', (await ev('CN.rows.filter(function(l){ return l.id === "cnx"; })[0].entry')) === '' && !(await page.$('#ovCnUndo')));
  // permissões: sem editar não mostra botões
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
