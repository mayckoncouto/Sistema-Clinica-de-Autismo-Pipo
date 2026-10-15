// Painel de Vendas: números do período, vendedores, metas, parcelas vencidas, contrato do tratamento e limite de desconto.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_pv.html');
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

  await ev(`(function(){
    var pid = state.patientsRaw[0].id; window.__pid = pid;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", sessoesMes: 8, convenio: "Particular", specHours: []}];
    rebuildPatients();
    FP.rows = []; COMM.rows = []; COMM.rules = []; GOALS.rows = [];
    function s(id, tipo, data, seller, total, status){ return {id: id, treatment: "t1", patient: pid, tipo: tipo, data: data, seller: seller, sellerName: seller ? "Vend " + seller : "", valorMensal: total / 3, meses: 3, total: total, forma: "PIX", status: status || "ativa", replacedBy: "", obs: "", by: "", at: ""}; }
    SALES.rows = [s("a", "nova", "2026-10-02", "v1", 3000), s("b", "nova", "2026-10-05", "v2", 1200), s("c", "renovacao", "2026-10-09", "v1", 2400), s("d", "aditivo", "2026-10-10", "v1", 600),
      s("e", "nova", "2026-10-11", "v2", 900, "cancelada"), s("f", "nova", "2026-09-20", "v1", 5000)];
    FP.rows.push({id: "p1", venc: "2026-10-01", desc: "Venda", plan: "", acc: "", sup: "", valor: 400, entry: "", grupo: "a", parcela: 1, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: "a"});
    FP.rows.push({id: "p2", venc: "2099-01-01", desc: "Venda", plan: "", acc: "", sup: "", valor: 400, entry: "", grupo: "a", parcela: 2, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: "a"});
    GOALS.rows = [{id: "g1", seller: "", ym: "2026-10", valor: 10000, qtd: 5}];
  })()`);
  const r = JSON.parse(await ev(`JSON.stringify((function(){ var x = pvCompute("2026-10-01", "2026-10-31", ""); return {n: x.n, total: x.total, ticket: x.ticket, canc: x.canc.length, cancTotal: x.cancTotal, tipos: [x.byTipo.nova.n, x.byTipo.renovacao.n, x.byTipo.aditivo.n], sellers: x.sellers.map(function(o){ return [o.seller, o.n, o.total]; }), months: x.months, overdue: x.overdue.length}; })())`));
  check('período: 4 vendas, total 7.200, ticket 1.800 (cancelada e setembro ficam de fora)', r.n === 4 && r.total === 7200 && r.ticket === 1800, JSON.stringify(r));
  check('cancelada separada: 1 venda de 900', r.canc === 1 && r.cancTotal === 900);
  check('por tipo: 2 novas, 1 renovação, 1 aditivo', r.tipos.join() === '2,1,1', r.tipos.join());
  check('por vendedor: v1 (3 vendas, 6.000) e v2 (1 venda, 1.200)', JSON.stringify(r.sellers) === '[["v1",3,6000],["v2",1,1200]]', JSON.stringify(r.sellers));
  check('1 parcela vencida (a de 2099 não conta)', r.overdue === 1);
  const r2 = JSON.parse(await ev(`JSON.stringify((function(){ var x = pvCompute("2026-10-01", "2026-10-31", "v2"); return {n: x.n, total: x.total}; })())`));
  check('filtro por vendedor v2', r2.n === 1 && r2.total === 1200, JSON.stringify(r2));

  await ev(`openPainelVendas()`);
  await page.waitForSelector('#ovPv #pvCards .fl-card', { timeout: 3000 });
  await page.evaluate(() => { document.getElementById('pvFrom').value = '2026-10-01'; document.getElementById('pvTo').value = '2026-10-31'; document.getElementById('pvFrom').dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  const cards = await page.$eval('#pvCards', (x) => x.innerText.replace(/\s+/g, ' '));
  check('cartões mostram vendas, ticket e parcelas vencidas', /4 · R\$\s?7\.200,00/.test(cards) && /1\.800,00/.test(cards) && /1 · R\$\s?400,00/.test(cards), cards);
  const body = await page.$eval('#pvBody', (x) => x.innerText.replace(/\s+/g, ' '));
  check('metas do mês: valor 7.200 de 10.000 (72%) e 4 de 5 vendas (80%)', /72%/.test(body) && /80%/.test(body), body.slice(body.indexOf('Metas'), body.indexOf('Metas') + 140));
  await page.click('#pvOk');

  // Metas
  await ev(`openMetasVendas()`);
  await page.waitForSelector('#ovMetas #mtAdd');
  await page.$eval('#mtYm', (x) => { x.value = x.options[x.options.length - 1].value; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#mtValor', '5.000,00'); await page.fill('#mtQtd', '3'); await page.click('#mtAdd'); await page.waitForTimeout(200);
  check('meta nova entra na lista', (await ev(`GOALS.rows.length`)) === 2 && /5\.000,00/.test(await page.$eval('#mtHost', (x) => x.innerText)));
  await page.fill('#mtValor', '6.000,00'); await page.click('#mtAdd'); await page.waitForTimeout(200);
  check('mesma meta (vendedor + mês) é atualizada, não duplicada', (await ev(`GOALS.rows.length`)) === 2);
  await page.click('#mtOk');

  // Contrato do tratamento
  await ev(`state.contracts = [{id: "ct1", name: "Contrato de Tratamento", tipo: "tratamento", content: "<p>{{paciente_nome}} contrata {{venda_tipo}} de {{venda_total}} em {{venda_meses}} meses. {{tabela_parcelas_venda}}</p>"}]`);
  const ctx = JSON.parse(await ev(`JSON.stringify(contractContextSale(SALES.rows[0]))`));
  check('contexto do contrato traz paciente, venda e total', ctx.paciente_nome === 'Paciente Um' && ctx.venda_tipo === 'Nova' && /3\.000,00/.test(ctx.venda_total) && ctx.venda_meses === '3', JSON.stringify([ctx.paciente_nome, ctx.venda_tipo, ctx.venda_total]));
  await ev(`slContratoDialog(SALES.rows[0])`);
  await page.waitForSelector('#ovCtVenda #cvPrev');
  const prev = await page.$eval('#cvPrev', (x) => x.innerText.replace(/\s+/g, ' '));
  check('prévia do contrato preenchida com as parcelas da venda', /Paciente Um contrata Nova/.test(prev) && /Vencimento/.test(prev), prev.slice(0, 160));
  await page.click('#cvCancel');
  check('variáveis da venda aparecem na barra do tipo Tratamento', (await ev(`contractVarsHtml("tratamento").indexOf("venda_total") !== -1`)) === true);

  // Desconto máximo
  await ev(`(function(){ state.clinic = Object.assign({}, state.clinic, {descontoMax: 10}); FP.rows = []; SALES.rows = []; state.treatments = []; rebuildPatients(); openTreatmentModal(null, {patientId: window.__pid}); })()`);
  await page.waitForSelector('#ovTreat');
  await page.fill('#trVal', '1.000,00'); await page.fill('#trDesp', '300,00');
  await page.click('#trSave');
  await page.waitForSelector('#ovConfirm', { timeout: 3000 });
  const cf = await page.$eval('#ovConfirm', (x) => x.innerText.replace(/\s+/g, ' '));
  check('desconto de 30% com limite de 10%: pede aprovação', /Desconto Acima do Limite/.test(cf) && /30%/.test(cf), cf.slice(0, 120));
  check('limite de desconto vira o padrão da Clínica (clinicDescMax)', (await ev(`clinicDescMax()`)) === 10);
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
