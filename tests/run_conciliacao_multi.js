// Conciliação: várias linhas↔vários lançamentos, dividir, aprender com o histórico e transferências. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cn2.html');
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
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco' }, { id: 'bradesco', name: 'Bradesco', tipo: 'Banco' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'luz', name: 'Energia', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'tsa', name: 'Transferência Saída', categoria: 'Transferências', tipo: 'Saída' },
      { id: 'ten', name: 'Transferência Entrada', categoria: 'Transferências', tipo: 'Entrada' }] });
  });
  await page.waitForTimeout(300);
  await ev(`FL.rows = [
    {id:'a1', acc:'viacredi', date:'2026-09-05', desc:'PIX Charline Fraga', plan:'alu', valor:100, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'a2', acc:'viacredi', date:'2026-09-06', desc:'PIX Charline Fraga', plan:'alu', valor:100, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'a3', acc:'viacredi', date:'2026-09-07', desc:'PIX Charline Fraga', plan:'luz', valor:100, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'j1', acc:'viacredi', date:'2026-10-10', desc:'Parte um', plan:'alu', valor:60, extDate:'', extVal:null, obs:'', key:'', pay:''},
    {id:'j2', acc:'viacredi', date:'2026-10-10', desc:'Parte dois', plan:'alu', valor:40, extDate:'', extVal:null, obs:'', key:'', pay:''}];
    CN.rows = [
    {id:'L1', acc:'viacredi', date:'2026-10-10', desc:'LOTE', valor:-100, doc:'', key:'k1', entry:''},
    {id:'L2', acc:'viacredi', date:'2026-10-12', desc:'PIX Charline Fraga', valor:-250, doc:'', key:'k2', entry:''},
    {id:'T1', acc:'viacredi', date:'2026-10-15', desc:'TED enviada', valor:-500, doc:'', key:'k3', entry:''},
    {id:'T2', acc:'bradesco', date:'2026-10-15', desc:'TED recebida', valor:500, doc:'', key:'k4', entry:''}]; CN.acc = 'viacredi'; CN.st = ''`);
  const lp = await ev('cnLearnPlan("PIX Charline Fraga", "viacredi", -1)');
  check('aprendizado: subcategoria mais usada (2 de 3)?', lp && lp.plan === 'alu' && lp.n === 2 && lp.total === 3, JSON.stringify(lp));
  check('aprendizado: descrição sem histórico não sugere?', (await ev('cnLearnPlan("XYZ QUALQUER", "viacredi", -1)')) === null);
  // juntar
  await ev('cnSetEntries("L1", ["j1","j2"])'); await page.waitForTimeout(100);
  check('juntar: linha com 2 lançamentos fecha (conciliada)?', (await ev('cnState(CN.rows.filter(function(l){return l.id==="L1";})[0])')) === 'conc' && (await ev('cnMatched("j1") && cnMatched("j2")')));
  check('um lançamento só pertence a uma linha (cnByEntry)?', (await ev('cnByEntry()["j1"].id === "L1"')));
  await ev('cnSetEntries("L1", ["j1"])');
  check('só 1 de 2: linha fica Parcial?', (await ev('cnState(CN.rows.filter(function(l){return l.id==="L1";})[0])')) === 'parcial');
  // dividir
  await ev('cnSplitDialog(CN.rows.filter(function(l){return l.id==="L2";})[0])'); await page.waitForSelector('#ovCnSplit');
  check('dividir: já sugere a subcategoria aprendida?', (await page.$eval('#ovCnSplit .cn-sp-plan', (e) => e.value)) === 'alu');
  await page.evaluate(() => { const r = document.querySelectorAll('#ovCnSplit .cn-sp-row'); r[0].querySelector('.cn-sp-val').value = '150,00'; r[1].querySelector('.cn-sp-val').value = '100,00'; const s = r[1].querySelector('.cn-sp-plan'); s.value = 'luz'; s.dispatchEvent(new Event('change', { bubbles: true })); r[0].querySelector('.cn-sp-val').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#cnsOk'); await page.waitForTimeout(500);
  check('dividir: 2 lançamentos criados e ligados, linha conciliada?', (await ev('cnEntriesOf(CN.rows.filter(function(l){return l.id==="L2";})[0]).length')) === 2 && (await ev('cnState(CN.rows.filter(function(l){return l.id==="L2";})[0])')) === 'conc');
  // soma errada
  await ev('cnSplitDialog(CN.rows.filter(function(l){return l.id==="T1";})[0])'); await page.waitForSelector('#ovCnSplit');
  await page.click('#cnsOk'); await page.waitForTimeout(200);
  check('dividir sem valores não grava?', (await ev('cnEntriesOf(CN.rows.filter(function(l){return l.id==="T1";})[0]).length')) === 0);
  await page.click('#cnsCancel');
  // transferência
  check('transferência: acha o par saída/entrada?', (await ev('cnTransferPairs(0).length')) === 1);
  await ev('cnTransfersModal()'); await page.waitForSelector('#ovCnTr');
  check('subcategorias de transferência já escolhidas?', (await page.$eval('#cntOut', (e) => e.value)) === 'tsa' && (await page.$eval('#cntIn', (e) => e.value)) === 'ten');
  await page.click('#cntOk'); await page.waitForTimeout(600);
  check('transferência: 2 lançamentos e as 2 linhas conciliadas?', (await ev('cnState(CN.rows.filter(function(l){return l.id==="T1";})[0]) === "conc" && cnState(CN.rows.filter(function(l){return l.id==="T2";})[0]) === "conc"')));
  check('não restam pares?', (await ev('cnTransferPairs(1).length')) === 0);
  await ev('cnLearnedModal()'); await page.waitForSelector('#ovCnLrn');
  check('janela do aprendizado lista a descrição repetida?', /charline/.test(await page.textContent('#cnlBody')));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails ? 1 : 0);
})();
