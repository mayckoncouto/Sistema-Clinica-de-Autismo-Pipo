// Excluir venda e excluir tratamento com venda: parcelas/comissão em aberto saem junto; recebida ou comissão paga bloqueiam.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vnex.html');
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
  const par = (id, sale, entry) => `{id: "${id}", venc: "2026-11-05", desc: "Parcela", plan: "", acc: "", sup: "", valor: 500, entry: "${entry || ''}", sale: "${sale}", grupo: "${sale}", parcela: 1, parcelas: 2, obs: "", linhas: [], loan: "", staff: "", abate: ""}`;
  const setup = () => ev(`(function(){
    var pid = state.patientsRaw[0].id;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", specHours: []}, {id: "t0", patientId: pid, inicio: "2025-01-01", status: "renegociado", tipo: "novo", specHours: []}];
    rebuildPatients(); TR.done = {}; trLoadLast = function(){ return Promise.resolve(); };
    SALES.rows = [{id: "s0", treatment: "t0", patient: pid, tipo: "nova", data: "2025-01-01", seller: "", sellerName: "", valorMensal: 500, meses: 2, total: 1000, forma: "", status: "substituida", replacedBy: "s1", obs: "", by: "", at: ""},
      {id: "s1", treatment: "t1", patient: pid, tipo: "aditivo", data: "2026-10-01", seller: "v1", sellerName: "Vendedora", valorMensal: 1000, meses: 2, total: 2000, forma: "PIX", status: "ativa", replacedBy: "", obs: "", by: "", at: ""}];
    FP.rows = [${par('p1', 's1')}, ${par('p2', 's1')}, {id: "cp", venc: "2026-11-10", desc: "Comissão", plan: "pl", acc: "", sup: "", valor: 100, entry: "", sale: "", grupo: "", parcela: 0, parcelas: 0, obs: "", linhas: [], loan: "", staff: "v1", abate: ""}];
    COMM.rules = []; COMM.rows = [{id: "c1", sale: "s1", treatment: "t1", patient: pid, seller: "v1", sellerName: "Vendedora", rule: "", base: 1000, pct: 10, valor: 100, status: "gerada", payable: "cp", obs: "", at: ""}]; })()`);
  await setup();
  // Bloqueios
  await ev(`FP.rows[0].entry = "lanc"`);
  check('parcela recebida bloqueia excluir', /parcela recebida/.test(await ev(`slDeleteCheck([SALES.rows[1]]).why`)));
  await ev(`FP.rows[0].entry = ""; FP.rows[2].entry = "lanc"`);
  check('comissão paga bloqueia excluir', /já foi paga/.test(await ev(`slDeleteCheck([SALES.rows[1]]).why`)));
  await ev(`FP.rows[2].entry = ""`);
  // Pela janela da venda
  await ev(`openVendaDetalhe("s1")`);
  await page.waitForSelector('#vnDDel');
  await page.click('#vnDDel');
  await page.waitForSelector('.confirm-overlay');
  const msg = await page.$eval('.confirm-overlay', (x) => x.innerText);
  check('confirmação fala das parcelas e da comissão', /2 parcelas em aberto/.test(msg) && /comissão/.test(msg), msg);
  await page.click('#cfOk');
  await page.waitForTimeout(300);
  let st = JSON.parse(await ev(`JSON.stringify({s: SALES.rows, fp: FP.rows, c: COMM.rows})`));
  check('venda, parcelas, comissão e conta a pagar excluídas', !st.s.some((x) => x.id === 's1') && st.fp.length === 0 && st.c.length === 0, JSON.stringify(st));
  check('venda substituída por ela volta a ser ativa', st.s.filter((x) => x.id === 's0')[0].status === 'ativa');
  check('janela fechou', !(await page.$('#ovVn')));

  // Excluir o tratamento leva a venda
  await setup();
  await ev(`openTreatmentModal(state.treatments[0])`);
  await page.waitForSelector('#trDel');
  await page.click('#trDel');
  await page.waitForSelector('.confirm-overlay');
  const m2 = await page.$eval('.confirm-overlay', (x) => x.innerText);
  check('confirmação do tratamento avisa a venda junto', /Será excluído junto/.test(m2) && /2 parcelas/.test(m2), m2);
  await page.click('#cfOk');
  await page.waitForTimeout(500);
  st = JSON.parse(await ev(`JSON.stringify({t: state.treatments.map(function(x){ return x.id; }), s: SALES.rows.map(function(x){ return x.id; }), fp: FP.rows.length, c: COMM.rows.length})`));
  check('tratamento e venda excluídos juntos', st.t.indexOf('t1') === -1 && st.s.indexOf('s1') === -1 && st.fp === 0 && st.c === 0, JSON.stringify(st));

  // Tratamento com venda bloqueada não é excluído
  await setup();
  await ev(`FP.rows[0].entry = "lanc"`);
  await ev(`openTreatmentModal(state.treatments[0])`);
  await page.waitForSelector('#trDel');
  await page.click('#trDel');
  await page.waitForTimeout(400);
  check('tratamento com parcela recebida na venda não é excluído', !(await page.$('.confirm-overlay')) && JSON.parse(await ev(`JSON.stringify(state.treatments.some(function(x){ return x.id === "t1"; }))`)));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
