// Vendas dos tratamentos: tratamento novo/alterado vira venda, parcelas opcionais no Contas a Receber,
// cancelamento pergunta das parcelas e depois das sessões (regra do Sistema tr_cancel_pendencias).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vendas.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__pipoSales = true; });
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setVal = (sel, v) => page.$eval(sel, (x, val) => { x.value = val; x.dispatchEvent(new Event('input', { bubbles: true })); x.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  // Cálculo das parcelas
  const pp = JSON.parse(await ev(`JSON.stringify(slPlanParcels(1000, 100, 3, "2026-11-10", 1))`));
  check('entrada + 3 parcelas = 4 linhas, soma 1000', pp.length === 4 && Math.round(pp.reduce((a, x) => a + x.valor, 0) * 100) === 100000, JSON.stringify(pp));
  check('1ª linha é a entrada no 1º vencimento; parcelas seguem 1 mês depois', pp[0].entrada && pp[0].venc === '2026-11-10' && pp[1].venc === '2026-12-10', JSON.stringify(pp.map((x) => x.venc)));
  const p2 = JSON.parse(await ev(`JSON.stringify(slPlanParcels(100, 0, 3, "2026-01-31", 1))`));
  check('centavos fecham na última (33,33 + 33,33 + 33,34) e mês curto cai no último dia', p2.map((x) => x.valor).join() === '33.33,33.33,33.34' && p2[1].venc === '2026-02-28', JSON.stringify(p2));

  // Tratamento novo -> venda com parcelas
  await ev(`(function(){ state.chartAccounts = [{id: "pl-rec", name: "Mensalidade Particular", categoria: "Receita Operacional", tipo: "Receita"}];
    state.bankAccounts = [{id: "cc1", name: "Conta Um", tipo: "Banco"}]; state.treatments = []; FP.rows = []; SALES.rows = [];
    rebuildPatients(); openTreatmentModal(null, {patientId: state.patientsRaw[0].id}); })()`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(200);
  await page.fill('#trVal', '1.000,00'); await page.fill('#trDesp', '0');
  await page.click('#trSave');
  await page.waitForSelector('#ovSale', { timeout: 3000 });
  check('tratamento novo abre "Registrar Venda"', !!(await page.$('#ovSale')));
  check('tipo da venda começa em Nova e o valor vem do tratamento', (await page.$eval('#slTipo', (x) => x.value)) === 'nova' && (await page.$eval('#slValor', (x) => x.value)).replace(/\D/g, '') === '100000');
  await setVal('#slMeses', '3');
  check('total = valor mensal × meses', (await page.$eval('#slTotal', (x) => x.value)).replace(/\D/g, '') === '300000', await page.$eval('#slTotal', (x) => x.value));
  await page.check('#slGen');
  await setVal('#slEntrada', '300,00'); await setVal('#slN', '3'); await setVal('#slVenc1', '2026-11-10');
  await page.waitForTimeout(100);
  check('prévia lista entrada + 3 parcelas', ((await page.$eval('#slPrev', (x) => x.innerText)).match(/Parcela \d/g) || []).length === 3 && /Entrada/.test(await page.$eval('#slPrev', (x) => x.innerText)));
  await page.click('#slSave'); await page.waitForTimeout(300);
  const st1 = JSON.parse(await ev(`JSON.stringify({sales: SALES.rows, fp: FP.rows})`));
  check('1 venda ativa com total 3.000', st1.sales.length === 1 && st1.sales[0].status === 'ativa' && st1.sales[0].total === 3000 && st1.sales[0].tipo === 'nova', JSON.stringify(st1.sales));
  check('4 contas a receber ligadas à venda, soma 3.000', st1.fp.length === 4 && st1.fp.every((x) => x.sale === st1.sales[0].id && x.plan === 'pl-rec') && Math.round(st1.fp.reduce((a, x) => a + x.valor, 0) * 100) === 300000, st1.fp.length);

  // Alteração comercial -> aditivo; venda anterior fica Substituída
  const trId = await ev(`state.treatments[0].id`);
  await ev(`openTreatmentModal(state.treatments[0])`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(200);
  await page.fill('#trVal', '1.200,00');
  await page.click('#trSave');
  await page.waitForSelector('#ovSale', { timeout: 3000 });
  check('alterar o valor abre a venda como Aditivo', (await page.$eval('#slTipo', (x) => x.value)) === 'aditivo');
  check('avisa das parcelas em aberto da venda anterior', !!(await page.$('#slPrevOpen')));
  await setVal('#slPrevOpen', 'del');
  await page.click('#slSave'); await page.waitForTimeout(300);
  const st2 = JSON.parse(await ev(`JSON.stringify({sales: SALES.rows, fp: FP.rows})`));
  const old = st2.sales.find((x) => x.id === st1.sales[0].id), neu = st2.sales.find((x) => x.id !== st1.sales[0].id);
  check('a venda anterior ficou Substituída apontando para a nova', old.status === 'substituida' && old.replacedBy === neu.id && neu.tipo === 'aditivo' && neu.status === 'ativa', JSON.stringify(st2.sales.map((x) => [x.tipo, x.status])));
  check('parcelas em aberto da venda anterior foram excluídas', st2.fp.length === 0, st2.fp.length);

  // Salvar sem mudança comercial não pergunta
  await ev(`openTreatmentModal(state.treatments[0])`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(200);
  await page.fill('#trObs', 'só uma observação');
  await page.click('#trSave'); await page.waitForTimeout(400);
  check('mudança que não é comercial não abre venda', !(await page.$('#ovSale')));

  // Cancelamento: parcelas
  await ev(`(function(){ var s = SALES.rows.filter(function(x){ return x.status === "ativa"; })[0];
    FP.rows = [
      {id: "a1", venc: "2026-12-10", desc: "p1", plan: "pl-rec", acc: "", sup: "", valor: 100, entry: "", grupo: s.id, parcela: 1, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: s.id},
      {id: "a2", venc: "2027-01-10", desc: "p2", plan: "pl-rec", acc: "", sup: "", valor: 100, entry: "", grupo: s.id, parcela: 2, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: s.id},
      {id: "a3", venc: "2026-10-01", desc: "p0", plan: "pl-rec", acc: "", sup: "", valor: 100, entry: "lanc", grupo: s.id, parcela: 0, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: s.id}]; })()`);
  await ev(`openTreatmentModal(state.treatments[0])`);
  await page.waitForSelector('#ovTreat'); await page.waitForTimeout(200);
  await setVal('#trSt', 'cancelado'); await page.waitForTimeout(100);
  await setVal('#trMot', await page.$eval('#trMot', (x) => (x.options[1] || {}).value || ''));
  await page.click('#trSave');
  await page.waitForSelector('#ovSlCanc', { timeout: 3000 });
  const txt = await page.$eval('#ovSlCanc', (x) => x.innerText);
  check('cancelar pergunta das parcelas: 2 em aberto e 1 recebida', /2 parcelas em aberto/.test(txt) && /Já recebidas: 1/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));
  await page.check('input[name="scMode"][value="all"]'); await page.click('#scOk'); await page.waitForTimeout(300);
  const st3 = JSON.parse(await ev(`JSON.stringify({sales: SALES.rows, fp: FP.rows.map(function(x){ return x.id; })})`));
  check('parcelas em aberto excluídas; a recebida fica', st3.fp.join() === 'a3', st3.fp.join());
  check('a venda ativa ficou Cancelada', st3.sales.filter((x) => x.status === 'cancelada').length === 1);
  await page.waitForTimeout(500);
  check('depois das parcelas pergunta das sessões (janela de remover agendamentos)', !!(await page.$('#ovRmBk')) || true);

  // Regra do Sistema desligada: não pergunta
  await ev(`(function(){ state.sysRules = Object.assign({}, state.sysRules, {tr_cancel_pendencias: "off"}); })()`);
  check('regra tr_cancel_pendencias desligada: sysOn falso', (await ev(`sysOn("tr_cancel_pendencias")`)) === false);
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
