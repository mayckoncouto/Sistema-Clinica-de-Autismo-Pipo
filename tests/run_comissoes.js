// Comissões de venda: regra mais específica, apuração no 1º atendimento finalizado, conta a pagar do vendedor, aditivo pela diferença, estorno.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_comm.html');
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
    state.chartAccounts = [{id: "pl-com", name: "Comissões", categoria: "Despesas com Funcionários", tipo: "Despesa"}, {id: "pl-rec", name: "Mensalidade", categoria: "Receita", tipo: "Receita"}];
    state.bankAccounts = [{id: "cc1", name: "Conta Um", tipo: "Banco"}];
    var pid = state.patientsRaw[0].id;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", specHours: []}];
    rebuildPatients();
    FP.rows = []; SALES.rows = []; COMM.rules = []; COMM.rows = []; TR.done = {};
    trLoadLast = function(){ return Promise.resolve(); };
    SALES.rows.push({id: "s1", treatment: "t1", patient: pid, tipo: "nova", data: "2026-10-01", seller: "prof-x", sellerName: "Vendedora X", valorMensal: 1000, meses: 3, total: 3000, forma: "PIX", status: "ativa", replacedBy: "", obs: "", by: "", at: ""});
    window.__pid = pid; })()`);
  const rule = (o) => ev(`comRuleSave(${JSON.stringify(o)})`);
  await rule({ name: 'Geral', tipo: 'todas', pct: 5, seller: '', plan: 'pl-com', acc: 'cc1', day: 10, inativo: false });
  await rule({ name: 'Nova da X', tipo: 'nova', pct: 8, seller: 'prof-x', plan: 'pl-com', acc: 'cc1', day: 15, inativo: false });
  await rule({ name: 'Antiga', tipo: 'nova', pct: 50, seller: 'prof-x', plan: 'pl-com', acc: 'cc1', day: 15, inativo: true });
  const pick = async (sale) => ev(`(function(){ var r = comRuleFor(${JSON.stringify(sale)}); return r ? r.name : ""; })()`);
  check('vendedor + tipo vence a regra geral (e ignora regra inativa)', (await pick({ tipo: 'nova', seller: 'prof-x' })) === 'Nova da X');
  check('outro vendedor cai na regra geral', (await pick({ tipo: 'nova', seller: 'prof-y' })) === 'Geral');
  check('renovação cai na regra geral', (await pick({ tipo: 'renovacao', seller: 'prof-x' })) === 'Geral');
  check('aditivo: base = diferença para a venda substituída', (await ev(`(function(){ SALES.rows.push({id: "s0", tipo: "nova", total: 2000, replacedBy: "s2"}); return comBase({id: "s2", tipo: "aditivo", total: 2600}); })()`)) === 600);
  await ev(`SALES.rows = SALES.rows.filter(function(s){ return s.id !== "s0"; })`);

  // Sem atendimento finalizado: aguarda
  let r = JSON.parse(await ev(`comApurar(true).then(function(o){ return JSON.stringify(o); })`));
  check('sem atendimento finalizado nada é gerado (a venda aguarda)', r.made === 0 && r.wait === 1, JSON.stringify(r));
  // Com 1º finalizado: gera
  await ev(`TR.done[window.__pid] = ["2026-10-05"]`);
  r = JSON.parse(await ev(`comApurar(true).then(function(o){ return JSON.stringify(o); })`));
  const st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('1º atendimento finalizado gera a comissão: 8% de 3.000 = 240', r.made === 1 && st.c.length === 1 && st.c[0].valor === 240 && st.c[0].pct === 8 && st.c[0].status === 'gerada', JSON.stringify(st.c));
  check('vira conta a pagar do vendedor no dia 15 do mês seguinte', st.fp.length === 1 && st.fp[0].valor === 240 && st.fp[0].staff === 'prof-x' && /-15$/.test(st.fp[0].venc) && st.fp[0].plan === 'pl-com', JSON.stringify(st.fp));
  r = JSON.parse(await ev(`comApurar(true).then(function(o){ return JSON.stringify(o); })`));
  check('apurar de novo não duplica', (r === null || r.made === 0) && JSON.parse(await ev(`JSON.stringify(COMM.rows.length)`)) === 1);

  // Janela de comissões
  await ev(`openComissoes()`);
  await page.waitForSelector('#ovComm tr[data-id]', { timeout: 3000 });
  const sum = await page.$eval('#cmSum', (x) => x.innerText);
  check('janela Comissões lista a comissão e soma "A pagar"', /240,00/.test(sum), sum);
  await page.click('#cmOk');
  await ev(`openComRules()`);
  await page.waitForSelector('#ovComRules tr[data-rid]', { timeout: 3000 });
  check('janela Regras lista as 3 regras', (await page.$$eval('#ovComRules tr[data-rid]', (t) => t.length)) === 3);
  await page.click('#crClose');

  // Estorno ao cancelar a venda (conta a pagar em aberto é excluída)
  const rv = JSON.parse(await ev(`comReverse(["s1"]).then(function(o){ return JSON.stringify(o); })`));
  const st2 = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('estorno: comissão estornada e conta a pagar em aberto excluída', rv.n === 1 && rv.del === 1 && st2.c[0].status === 'estornada' && st2.fp.length === 0, JSON.stringify(rv));
  // Comissão já paga: só avisa
  await ev(`(function(){ FP.rows = [{id: "pg", venc: "2026-10-15", desc: "c", plan: "pl-com", acc: "", sup: "", valor: 100, entry: "lanc", grupo: "", parcela: 0, parcelas: 0, obs: "", linhas: [], loan: "", staff: "prof-x", abate: "", sale: ""}];
    COMM.rows = [{id: "c9", sale: "s9", treatment: "t1", patient: window.__pid, seller: "prof-x", sellerName: "X", rule: "", base: 1000, pct: 10, valor: 100, status: "gerada", payable: "pg", obs: "", at: ""}]; })()`);
  const rv2 = JSON.parse(await ev(`comReverse(["s9"]).then(function(o){ return JSON.stringify(o); })`));
  check('comissão já paga: estornada, conta mantida e valor a descontar avisado', rv2.paid === 100 && rv2.del === 0 && JSON.parse(await ev(`JSON.stringify(FP.rows.length)`)) === 1, JSON.stringify(rv2));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
