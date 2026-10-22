// Venda com mais de um vendedor: o outro vendedor recebe o valor digitado, o principal fica com o resto,
// e cada um ganha a própria comissão (regra dele sobre a parte dele).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vdiv.html');
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
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await ev(`(function(){
    state.chartAccounts = [{id: "pl-com", name: "Comissões", categoria: "Despesas com Funcionários", tipo: "Despesa"}];
    state.bankAccounts = [{id: "cc1", name: "Conta Um", tipo: "Banco"}];
    var pid = state.patientsRaw[0].id;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", specHours: []}];
    rebuildPatients();
    FP.rows = []; SALES.rows = []; COMM.rules = []; COMM.rows = []; TR.done = {};
    trLoadLast = function(){ return Promise.resolve(); };
    SALES.rows.push({id: "s1", treatment: "t1", patient: pid, tipo: "nova", data: "2026-10-01", seller: "prof-x", sellerName: "Vendedora X", valorMensal: 1000, meses: 3, total: 3000, forma: "PIX", status: "ativa", replacedBy: "", obs: "", by: "", at: "",
      partes: [{seller: "prof-y", sellerName: "Vendedor Y", valor: 1000}]});
    window.__pid = pid; })()`);
  await ev(`comRuleSave({name: "Geral", tipo: "todas", pct: 5, seller: "", plan: "pl-com", acc: "cc1", day: 10, inativo: false})`);
  await ev(`comRuleSave({name: "Nova da X", tipo: "nova", pct: 8, seller: "prof-x", plan: "pl-com", acc: "cc1", day: 15, inativo: false})`);

  const sh = JSON.parse(await ev(`JSON.stringify(slShares(SALES.rows[0]))`));
  check('partes: X fica com 2.000 (3.000 − 1.000) e Y com 1.000', sh.length === 2 && sh[0].seller === 'prof-x' && sh[0].valor === 2000 && sh[1].seller === 'prof-y' && sh[1].valor === 1000, JSON.stringify(sh));

  await ev(`TR.done[window.__pid] = ["2026-10-05"]`);
  const r = JSON.parse(await ev(`comApurar(true).then(function(o){ return JSON.stringify(o); })`));
  const st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  const cx = st.c.filter((c) => c.seller === 'prof-x')[0], cy = st.c.filter((c) => c.seller === 'prof-y')[0];
  check('gera duas comissões', r.made === 2 && st.c.length === 2, JSON.stringify(r));
  check('X: 8% de 2.000 = 160 (regra dela)', cx && cx.base === 2000 && cx.valor === 160, JSON.stringify(cx));
  check('Y: 5% de 1.000 = 50 (regra geral)', cy && cy.base === 1000 && cy.valor === 50, JSON.stringify(cy));
  check('duas contas a pagar, uma para cada vendedor', st.fp.length === 2 && st.fp.some((x) => x.staff === 'prof-y' && x.valor === 50), JSON.stringify(st.fp));
  const r2 = JSON.parse(await ev(`comApurar(true).then(function(o){ return JSON.stringify(o); })`));
  check('apurar de novo não duplica', (r2 === null || r2.made === 0) && JSON.parse(await ev(`JSON.stringify(COMM.rows.length)`)) === 2);

  // Painel: cada vendedor com a parte dele
  const pv = JSON.parse(await ev(`JSON.stringify(pvCompute("2026-10-01", "2026-10-31", "", {}).sellers)`));
  const px = pv.filter((o) => o.seller === 'prof-x')[0], py = pv.filter((o) => o.seller === 'prof-y')[0];
  check('Painel de Vendas: X 2.000 e Y 1.000, cada um com a comissão dele', px && py && px.total === 2000 && py.total === 1000 && px.com === 160 && py.com === 50, JSON.stringify(pv));

  // Detalhe da venda mostra os vendedores e as duas comissões
  await ev(`openVendaDetalhe("s1")`);
  await page.waitForSelector('#ovVn');
  const det = await page.$eval('#ovVn', (x) => x.innerText);
  check('detalhe da venda mostra Vendedores e as duas comissões', /Vendedores/.test(det) && /Vendedor Y/.test(det) && /160,00/.test(det) && /50,00/.test(det), det.slice(0, 300));
  await page.click('#vnDOk');

  // Registrar Venda: soma dos outros vendedores precisa ser menor que o total
  await ev(`(function(){ COMM.rows = []; FP.rows = []; })()`);
  const staff = JSON.parse(await ev(`JSON.stringify(fpStaffList().slice(0, 2).map(function(x){ return x.id; }))`));
  if (staff.length >= 2){
    await ev(`(slSaleDialog({rec: state.treatments[0], isNew: true, opts: {}, others: [], plan: {valorFinal: 1000, tipo: "nova"}, valorFinal: 1000}), 1)`);
    await page.waitForSelector('#ovSale');
    await page.evaluate((id) => { const s = document.getElementById('slSeller'); s.value = id; s.dispatchEvent(new Event('change')); }, staff[0]);
    await page.click('#slSpAdd');
    await page.evaluate((id) => { const s = document.querySelector('#slSpRows select.sp-seller'); s.value = id; s.dispatchEvent(new Event('change', {bubbles: true})); }, staff[1]);
    await page.fill('#slSpRows input.sp-val', '400,00');
    const hint = await page.textContent('#slSpHint');
    check('dica mostra a parte do principal (total 1.000 × meses − 400)', /Parte do vendedor principal/.test(hint), hint);
    await page.fill('#slMeses', '1');
    await page.fill('#slSpRows input.sp-val', '1000,00');
    await page.click('#slSave'); await page.waitForTimeout(200);
    check('soma igual ao total é recusada', !!(await page.$('#ovSale')));
    await page.fill('#slSpRows input.sp-val', '400,00');
    await page.click('#slSave'); await page.waitForTimeout(400);
    const n = JSON.parse(await ev(`JSON.stringify(SALES.rows[SALES.rows.length - 1])`));
    check('venda gravada com a parte do outro vendedor', n.partes && n.partes.length === 1 && n.partes[0].seller === staff[1] && n.partes[0].valor === 400 && n.seller === staff[0], JSON.stringify(n.partes));
  } else console.log('(sem colaboradores suficientes no mock para testar a janela)');

  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
