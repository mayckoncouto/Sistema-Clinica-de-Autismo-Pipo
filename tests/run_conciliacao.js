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
  check('chaves: repetidas ganham nº e documento vale por si?', ks[0] !== ks[1] && ks[2] === 'id:Z9', JSON.stringify(ks));
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
  check('Financeiro menu tem Conciliação depois de Empréstimos Concedidos?', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join() === 'lancamentos,pagar,receber,emptomados,empconcedidos,conciliacao,demonstrativos,vendas,painelvendas,comissoes,fornecedores,catfornecedor,contas,planocontas');
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
  check('as 2 linhas pendentes mostram a sugestão certa?', t.length === 2 && t.some((x) => /Aluguel sede/.test(x) && /Sugestão/.test(x)) && t.some((x) => /Repasse convênio X/.test(x) && /Sugestão/.test(x)), JSON.stringify(t));
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
  check('valor diferente pede confirmação?', /Valor Diferente/.test(await page.textContent('#confirmHost')));
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

  // permissões: sem editar não mostra botões
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
