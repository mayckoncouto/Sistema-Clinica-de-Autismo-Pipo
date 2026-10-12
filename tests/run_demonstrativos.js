// Financeiro: Demonstrativos (Fluxo de caixa, DRE e Lançamentos) — dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_dem.html');
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
  const setSel = (id, v) => page.$eval(id, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' '));
  const rowTxt = (label) => page.$$eval('#demBody .dem-table tbody tr', (rs, l) => { const r = rs.find((x) => x.cells[0].textContent.replace(/[▾▸]/g, '').trim() === l); return r ? Array.from(r.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()) : null; }, label);

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [
      { id: 'viacredi', name: 'Viacredi', tipo: 'Banco', saldoInicial: 10000, dataSaldo: '2026-01-01' },
      { id: 'caixa', name: 'Caixa', tipo: 'Caixa', saldoInicial: 2000, dataSaldo: '2026-01-01' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'unimed', name: 'Unimed', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'part', name: 'Particular', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'sal', name: 'Salários', categoria: 'Despesas com Funcionários', tipo: 'Despesa' },
      { id: 'enc', name: 'Encargos', categoria: 'Despesas com Funcionários', tipo: 'Despesa' },
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'aporte', name: 'Aporte de sócios', categoria: 'Sócios', tipo: 'Entrada' },
      { id: 'ret', name: 'Retirada', categoria: 'Sócios', tipo: 'Saída' }] });
  });
  await page.waitForTimeout(300);
  // lançamentos: jan, fev, mar de 2026
  await page.evaluate(() => {
    const mk = (id, acc, date, desc, plan, valor, extVal) => ({ id, acc, date, desc, plan, valor, extDate: '', extVal: extVal == null ? null : extVal, obs: '', key: '' });
    window.__ev('FL.rows = ' + JSON.stringify([
      mk('a1', 'viacredi', '2026-01-05', 'Unimed jan', 'unimed', 10000), mk('a2', 'caixa', '2026-01-10', 'Particular jan', 'part', 2000),
      mk('a3', 'viacredi', '2026-01-06', 'Folha jan', 'sal', 5000), mk('a4', 'viacredi', '2026-01-07', 'Aluguel jan', 'alu', 1000),
      mk('b1', 'viacredi', '2026-02-05', 'Unimed fev', 'unimed', 12000), mk('b2', 'caixa', '2026-02-10', 'Particular fev', 'part', 2000),
      mk('b3', 'viacredi', '2026-02-06', 'Folha fev', 'sal', 6000), mk('b4', 'viacredi', '2026-02-07', 'Aluguel fev', 'alu', 1000), mk('b5', 'viacredi', '2026-02-20', 'Aporte', 'aporte', 3000, 3100),
      mk('c1', 'viacredi', '2026-03-05', 'Unimed mar', 'unimed', 9000), mk('c2', 'caixa', '2026-03-10', 'Particular mar', 'part', 3000),
      mk('c3', 'viacredi', '2026-03-06', 'Folha mar', 'sal', 9000), mk('c4', 'viacredi', '2026-03-07', 'Aluguel mar', 'alu', 1000), mk('c5', 'viacredi', '2026-03-21', 'Retirada', 'ret', 2000)
    ]));
  });

  // ---- abre em Fluxo de caixa ----
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="demonstrativos"]'); await page.waitForTimeout(300);
  check('opens on Fluxo de caixa', await page.$eval('#demSeg [data-dv="flu"]', (b) => b.classList.contains('active')));
  check('two buttons in order (Lançamentos is its own screen)', (await page.$$eval('#demSeg button', (b) => b.map((x) => x.textContent.trim()))).join('|') === 'Fluxo de caixa|DRE');
  check('no "Valores em" selector', !(await page.$('#demValores')) && !/Valores em/.test(await text('#tab-lancamentos')));
  const ini = await rowTxt('Saldo inicial');
  check('Saldo inicial jan = 12.000, fev = 14.000 (10k+2k, +10k-... )', ini && /12\.000/.test(ini[1]), JSON.stringify(ini));
  const ent = await rowTxt('Entradas'), sai = await rowTxt('Saídas');
  check('Entradas jan 12.000, fev 17.000, mar 12.000', /12\.000/.test(ent[1]) && /17\.000/.test(ent[2]) && /12\.000/.test(ent[3]), JSON.stringify(ent));
  check('Saídas jan 6.000, fev 7.000, mar 12.000', /6\.000/.test(sai[1]) && /7\.000/.test(sai[2]) && /12\.000/.test(sai[3]), JSON.stringify(sai));
  const fin = await rowTxt('Saldo final');
  check('Saldo final mar = 12.000 + 6.000 + 10.000 + 0 = 28.000', /28\.000/.test(fin[3]), JSON.stringify(fin));
  check('forecast column "abr/26 previsto"', /abr\/26/.test(await text('#demBody thead')) && /previsto/.test(await text('#demBody thead')));
  const ent4 = ent[4];
  check('forecast entradas = média dos 3 meses (13.667)', /13\.667/.test(ent4), ent4);
  check('table header and first column are sticky', await page.$eval('#demBody .dem-table thead th', (t) => getComputedStyle(t).position === 'sticky') && await page.$eval('#demBody .dem-table tbody td', (t) => getComputedStyle(t).position === 'sticky'));
  const wd = await page.$$eval('#demBody .dem-table thead th', (t) => t.map((x) => Math.round(x.getBoundingClientRect().width)));
  const sc = await page.$eval('#demBody .dem-tbwrap', (e) => [e.scrollWidth, e.clientWidth]);
  check('table uses the full width (no horizontal scroll)', sc[0] <= sc[1] + 1, JSON.stringify(sc));
  check('month, previsto and total columns have the same width; trend column is wider', Math.max.apply(null, wd.slice(1, -1)) - Math.min.apply(null, wd.slice(1, -1)) <= 2 && wd[wd.length - 1] >= wd[1], JSON.stringify(wd));
  check('chart saldo dia a dia present', !!(await page.$('#demBody svg.dem-chart')));
  const bal = await page.$$eval('#demBody .fl-card', (c) => c.map((x) => x.textContent));
  check('summary has Saldo Viacredi / Caixa', bal.some((t) => /Saldo Viacredi/.test(t)) && bal.some((t) => /Saldo Caixa/.test(t)), JSON.stringify(bal));

  // ---- clicar no valor leva a Lançamentos filtrado ----
  await page.click('#demBody [data-dtg="ent"]'); await page.waitForTimeout(100);
  await page.evaluate(() => { const r = Array.from(document.querySelectorAll('#demBody .dem-table tbody tr')).find((x) => x.cells[0].textContent.includes('Receita Operacional')); r.cells[2].querySelector('.dem-cell').click(); });
  await page.waitForTimeout(200);
  check('went to Lançamentos with strip', (await ev('state.tab')) === 'lancamentos' && /Voltar ao Fluxo de caixa/.test(await text('#demStrip')));
  const lr = await page.$$eval('#reg-lancamentos-host tbody tr', (r) => r.map((x) => x.textContent));
  check('filtered to the 2 Receita Operacional entries of fev', lr.length === 2 && lr.every((t) => /\/02\/2026/.test(t)), JSON.stringify(lr));
  check('strip sum = 14.000,00', /14\.000,00/.test(await text('#demStrip')));
  await page.click('#demBack'); await page.waitForTimeout(200);
  check('Voltar returns to Fluxo (Demonstrativos screen)', (await ev('state.tab')) === 'demonstrativos' && await page.$eval('#demSeg [data-dv="flu"]', (b) => b.classList.contains('active')) && (await ev('FL.dm')) === null);

  // ---- DRE ----
  await page.click('#demSeg [data-dv="dre"]'); await page.waitForTimeout(200);
  const rec = await rowTxt('Receita total'), des = await rowTxt('Despesas totais'), res = await rowTxt('Resultado'), mg = await rowTxt('Margem do resultado');
  check('Receita total jan 12.000', /12\.000/.test(rec[1]), JSON.stringify(rec));
  check('Despesas totais mar 10.000', /10\.000/.test(des[3]), JSON.stringify(des));
  check('Resultado mar 2.000 (aporte e retirada fora)', /2\.000/.test(res[3]) && !/−/.test(res[3]), JSON.stringify(res));
  check('Margem jan 50,0%', /50,0%/.test(mg[1]), JSON.stringify(mg));
  check('no previsto column in DRE', !/previsto/.test(await text('#demBody thead')));
  check('Entrada/Saída categories not in DRE', !(await rowTxt('Sócios')));
  // expandir categoria
  await page.click('#demBody [data-dtg^="Despesas com Funcionários"]'); await page.waitForTimeout(100);
  check('expand shows Salários', !!(await rowTxt('Salários')));

  // ---- comparação ----
  await setSel('#demCmp', 'prev'); await page.waitForTimeout(150);
  check('modo buttons appear with comparison', await page.$eval('#demModo', (e) => !e.classList.contains('dem-off')));
  let r2 = await rowTxt('Receita total');
  check('% vs previous month (fev vs jan: +33,3% receita... )', /▲/.test(r2[2]) && /%/.test(r2[2]), r2[2]);
  await page.click('#demModo [data-md="brl"]'); await page.waitForTimeout(100);
  r2 = await rowTxt('Receita total'); check('R$ mode', /R\$ 2\.000/.test(r2[2]) && !/%/.test(r2[2].split('R$ 14.000')[1] || ''), r2[2]);
  await page.click('#demModo [data-md="both"]'); await page.waitForTimeout(100);
  r2 = await rowTxt('Receita total'); check('R$ e % mode', /R\$ 2\.000 \(16,7%\)/.test(r2[2]), r2[2]);
  await setSel('#demCmp', 'ref'); await page.waitForTimeout(150);
  r2 = await rowTxt('Receita total');
  check('reference month marked (mar default = latest)', /referência/.test(r2[3]), JSON.stringify(r2));
  await setSel('#demCmp', 'off');

  // ---- visões salvas ----
  await page.click('#demMenuBtn'); await page.click('#demMenu [data-dact="vnew"]'); await page.waitForTimeout(150);
  check('editor opens', !!(await page.$('#demVSave')));
  await page.$$eval('#demEditor [data-vc]', (c) => c.forEach((x) => { x.checked = x.getAttribute('data-vc').indexOf('Despesas Fixas') === 0; }));
  await page.fill('#demVName', 'Só fixas');
  await page.click('#demVSave'); await page.waitForTimeout(400);
  check('saved view listed & selected', (await page.$eval('#demVisao', (s) => s.options[s.selectedIndex].textContent)) === 'Visão: Só fixas');
  check('saved view limits categories', !(await rowTxt('Receita Operacional')) && !!(await rowTxt('Despesas Fixas')));
  check('persisted in state.dreViews', (await ev('state.dreViews.length')) === 1);
  await page.click('#demMenuBtn'); await page.click('#demMenu [data-dact="vedit"]'); await page.waitForTimeout(100);
  await page.click('#demVDel'); await page.waitForSelector('#confirmHost .modal, #confirmHost .overlay'); 
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#confirmHost button')).find((x) => /Confirmar exclusão/.test(x.textContent)); b.click(); });
  await page.waitForTimeout(400);
  check('view deleted', (await ev('state.dreViews.length')) === 0 && (await page.$eval('#demVisao', (s) => s.value)) === 'completo');

  // ---- alertas e exportação ----
  await page.click('#demSeg [data-dv="flu"]'); await page.waitForTimeout(150);
  check('alert for valor ≠ extrato', /valor diferente do extrato/.test(await text('#demBody .dem-alerts')));
  await page.evaluate(() => Array.from(document.querySelectorAll('#demBody [data-dal]')).find((b) => /valor diferente do extrato/.test(b.textContent)).click()); await page.waitForTimeout(200);
  check('alert filters Lançamentos', (await page.$$eval('#reg-lancamentos-host tbody tr', (r) => r.length)) === 1);
  await page.click('#demClear'); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="demonstrativos"]').click()); await page.waitForTimeout(200);
  await page.click('#demSeg [data-dv="flu"]'); await page.waitForTimeout(150);
  const model = await ev('JSON.stringify(DM.model.rows.map(function(r){ return r.label; }))');
  check('export model has rows', /Saldo inicial/.test(model) && /Saldo final/.test(model), model);

  // ---- conta filtra ----
  await setSel('#demAcc', 'caixa'); await page.waitForTimeout(200);
  const ini2 = await rowTxt('Saldo inicial'), ent2 = await rowTxt('Entradas');
  check('Conta=Caixa: saldo inicial jan 2.000, entradas jan 2.000', /2\.000/.test(ini2[1]) && /2\.000/.test(ent2[1]), JSON.stringify([ini2, ent2]));
  await setSel('#demAcc', '');

  // ---- etapa 2: fechamento de mês ----
  await page.click('#demSeg [data-dv="flu"]'); await page.waitForTimeout(150);
  check('alert: oldest month not closed', /jan\/26 ainda não foi fechado/.test(await text('#demBody .dem-alerts')));
  const openMenu = async () => { await page.click('#demMenuBtn'); await page.waitForTimeout(80); };
  await openMenu();
  check('menu has Fechamento de mês and Resumo mensal', !!(await page.$('#demMenu [data-dact="fech"]')) && !!(await page.$('#demMenu [data-dact="resumo"]')));
  await page.click('#demMenu [data-dact="fech"]'); await page.waitForSelector('#ovFc');
  check('window opens on the oldest open month (jan)', (await page.$eval('#fcMes', (s) => s.value)) === '2026-01');
  check('jan has no pendências and no ciente box', !(await page.$('#fcOk')));
  await page.click('#fcGo'); await page.waitForTimeout(300);
  check('jan closed (history + lock)', /jan\/26 · Fechado por/.test(await text('#ovFc .dem-hist')) && !!(await ev('FC.closed["2026-01"]')));
  await setSel('#fcMes', '2026-02'); await page.waitForTimeout(100);
  check('fev has 1 pendência and needs ciente', !!(await page.$('#fcOk')));
  await page.click('#fcGo'); await page.waitForTimeout(150);
  check('closing fev without ciente refused', !(await ev('FC.closed["2026-02"]')));
  await page.check('#fcOk'); await page.click('#fcGo'); await page.waitForTimeout(300);
  check('fev closed after ciente', !!(await ev('FC.closed["2026-02"]')));
  await setSel('#fcMes', '2026-03'); await page.waitForTimeout(100); await page.click('#fcGo'); await page.waitForTimeout(300);
  check('mar closed', !!(await ev('FC.closed["2026-03"]')));
  // reabrir fev (do meio): aviso de saldo
  await setSel('#fcMes', '2026-02'); await page.waitForTimeout(100);
  const warn = await text('#ovFc .dem-warn');
  check('reopening a middle month warns about the next months balance', /muda o saldo inicial dos meses seguintes/.test(warn) && /mar\/26/.test(warn) && /Saldo inicial hoje/.test(warn), warn);
  await page.click('#fcGo'); await page.waitForTimeout(150);
  check('reopen needs motive', !!(await ev('FC.closed["2026-02"]')));
  await page.fill('#fcMot', 'Corrigir valor'); await page.click('#fcGo'); await page.waitForTimeout(150);
  check('reopen needs ciente of balance', !!(await ev('FC.closed["2026-02"]')));
  await page.check('#fcSal'); await page.click('#fcGo'); await page.waitForTimeout(300);
  check('fev reopened; mar stays closed', !(await ev('FC.closed["2026-02"]')) && !!(await ev('FC.closed["2026-03"]')));
  check('history shows reopening with motive', /fev\/26 · Reaberto por/.test(await text('#ovFc .dem-hist')) && /Corrigir valor/.test(await text('#ovFc .dem-hist')));
  await page.click('#fcCancel'); await page.waitForTimeout(150);
  check('closed month column has a lock in the header', (await page.$$eval('#demBody thead th', (t) => t.filter((x) => x.querySelector('.dem-lk')).length)) === 2);
  // trava no app: Lançamentos
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="lancamentos"]').click()); await page.waitForTimeout(200);
  await setSel('#flMonth', '2026-01'); await page.waitForTimeout(150);
  await page.click('#flMenuBtn'); await page.waitForTimeout(80);
  check('Lançamentos menu: export, import and Fechamento de mês', !!(await page.$('#flMenu [data-dact="ioexp"]')) && !!(await page.$('#flMenu [data-dact="ioimp"]')) && !!(await page.$('#flMenu [data-dact="fech"]')));
  await page.keyboard.press('Escape');
  check('lançamento list shows lock on closed month', (await page.$$eval('#reg-lancamentos-host tbody .dem-lk', (e) => e.length)) > 0);
  await page.evaluate(() => document.querySelector('#reg-lancamentos-host tr[data-fl-id]').click()); await page.waitForSelector('#ovFl');
  check('closed month lançamento opens read-only without Save/Excluir', await page.$eval('#flSave', (b) => b.hidden) && await page.$eval('#flDesc', (i) => i.disabled) && /Mês fechado/.test(await text('#ovFl .dem-warn')));
  await page.click('#flCancel'); await page.waitForTimeout(100);
  await page.click('#flAdd'); await page.waitForSelector('#ovFl');
  await setSel('#flConta', 'viacredi'); await setSel('#flData', '2026-01-20'); await page.fill('#flDesc', 'Novo em mês fechado'); await setSel('#flSub', 'alu'); await page.fill('#flValor', '10');
  await page.click('#flSave'); await page.waitForTimeout(200);
  check('new lançamento in a closed month refused', !!(await page.$('#ovFl')) && (await ev('FL.rows.length')) === 14);
  await page.click('#flCancel'); await page.waitForTimeout(100);
  // importação: mês fechado vira problema
  const plan = await ev(`(function(){ return JSON.stringify(ioFlPlan([{conta:'Viacredi', descricao:'Imp jan', data:'20/01/2026', valor:'10', sub:'Aluguel', _line:2}, {conta:'Viacredi', descricao:'Imp fev', data:'20/02/2026', valor:'10', sub:'Aluguel', _line:3}]).items.map(function(i){ return i.st; })); })()`);
  check('import: closed month row is a problem, open month row is new', plan === '["problema","novo"]', plan);

  // ---- sem campos de anotação; resumo mensal ----
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="demonstrativos"]').click()); await page.waitForTimeout(200);
  await page.click('#demSeg [data-dv="dre"]'); await page.waitForTimeout(200);
  check('no comment/note buttons in the DRE or Fluxo cells', !(await page.$('#demBody .dem-nt')) && !(await page.$('#demNotePop')));
  const rs = await ev(`(function(){ return fcResumoHtml(fcFigures('2026-03'), {g:1,d:1,f:1,a:1}); })()`);
  check('resumo has title, KPIs, DRE, fluxo, mudou, fechado and no notes', /Resumo financeiro de Março de 2026/.test(rs) && /R\$ 12\.000/.test(rs) && /DRE resumido/.test(rs) && /Fluxo de caixa/.test(rs) && /O que mais mudou/.test(rs) && /Mês fechado por/.test(rs) && !/Anotaç/.test(rs));
  await openMenu(); await page.click('#demMenu [data-dact="resumo"]'); await page.waitForSelector('#ovRm');
  check('Resumo mensal window lists months and 4 options', (await page.$$eval('#rmMes option', (o) => o.length)) === 3 && (await page.$$eval('#ovRm [data-ro]', (o) => o.length)) === 4);
  await page.click('#rmCancel'); await page.waitForTimeout(100);

  // ---- permissões do fechamento ----
  await page.evaluate(() => { window.pipoAuth = { can: (m, a) => m === 'financeiro' && a === 'view', canDefault: () => true, isAdmin: () => false, onProfile: () => {} }; });
  await ev('renderDemonstrativos()'); await page.waitForTimeout(150);
  await openMenu();
  check('without fechamento_mes: no Fechamento item; no alert', !(await page.$('#demMenu [data-dact="fech"]')) && !/ainda não foi fechado/.test(await page.$eval('#demBody', (e) => e.textContent)));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.pipoAuth = { can: (m, a) => (m === 'financeiro' && a === 'view') || (m === 'fechamento_mes' && a === 'create'), canDefault: () => true, isAdmin: () => false, onProfile: () => {} }; });
  await ev('renderDemonstrativos()'); await page.waitForTimeout(150);
  await openMenu(); await page.click('#demMenu [data-dact="fech"]'); await page.waitForSelector('#ovFc');
  await setSel('#fcMes', '2026-03'); await page.waitForTimeout(100);
  check('only "fechar" permission: cannot reopen a closed month', await page.$eval('#fcGo', (b) => b.disabled) && /não permite reabrir/.test(await text('#ovFc .modal-body')));
  await page.click('#fcCancel');
  await page.evaluate(() => { delete window.pipoAuth; });
  await page.click('#demSeg [data-dv="flu"]'); await page.waitForTimeout(150);

  // ---- sem Financeiro – valores: sem saldo ----
  await page.evaluate(() => { window.pipoAuth = { can: (m, a) => m === 'financeiro' && a === 'view', canDefault: () => true, isAdmin: () => false, onProfile: () => {} }; });
  await ev('renderDemonstrativos()'); await page.waitForTimeout(150);
  check('without valores: no Saldo rows', !(await rowTxt('Saldo inicial')) && !(await rowTxt('Saldo final')) && !!(await rowTxt('Entradas')));
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="lancamentos"]').click()); await page.waitForTimeout(150);
  check('without create: Incluir hidden', await page.$eval('#flAdd', (b) => b.hidden));
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="demonstrativos"]').click()); await page.waitForTimeout(150);
  await page.evaluate(() => { delete window.pipoAuth; });

  // ---- tri e mês ----
  await ev('renderDemonstrativos()');
  await setSel('#demPer', 'tri'); await page.waitForTimeout(150);
  const e3 = await rowTxt('Entradas'); check('trimestre: 41.000', /41\.000/.test(e3[1]), JSON.stringify(e3));
  await setSel('#demPer', 'mes'); await page.waitForTimeout(150);
  check('um mês: single column', (await page.$$eval('#demBody .dem-table thead th', (t) => t.length)) === 4);
  await setSel('#demPer', 'ano');
  await page.screenshot({ path: '/tmp/dem_flu.png' });

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
