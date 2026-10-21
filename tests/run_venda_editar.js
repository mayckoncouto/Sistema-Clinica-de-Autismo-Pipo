// Editar venda: data, vendedor, forma e observações; bloqueios; comissão recalculada ao trocar o vendedor.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vned.html');
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

  const staff = JSON.parse(await ev(`JSON.stringify(fpStaffList().slice(0, 2))`));
  check('há dois colaboradores para vendedor', staff.length === 2, JSON.stringify(staff));
  const A = staff[0], B = staff[1];
  await ev(`(function(){
    state.chartAccounts = [{id: "pl-com", name: "Comissões", categoria: "Despesas", tipo: "Despesa"}];
    state.bankAccounts = [{id: "cc1", name: "Conta Um", tipo: "Banco"}];
    var pid = state.patientsRaw[0].id;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", specHours: []}];
    rebuildPatients();
    FP.rows = []; SALES.rows = []; COMM.rules = []; COMM.rows = []; TR.done = {};
    trLoadLast = function(){ return Promise.resolve(); };
    SALES.rows.push({id: "s1", treatment: "t1", patient: pid, tipo: "nova", data: "2026-10-01", seller: ${JSON.stringify(A.id)}, sellerName: ${JSON.stringify(A.nome)}, valorMensal: 1000, meses: 3, total: 3000, forma: "PIX", status: "ativa", replacedBy: "", obs: "", by: "", at: ""});
    TR.done[pid] = ["2026-10-05"]; })()`);
  await ev(`comRuleSave({name: "Geral", tipo: "todas", pct: 5, seller: "", plan: "pl-com", acc: "cc1", day: 10, inativo: false})`);
  await ev(`comRuleSave({name: "Do B", tipo: "todas", pct: 10, seller: ${JSON.stringify(B.id)}, plan: "pl-com", acc: "cc1", day: 20, inativo: false})`);
  await ev(`comApurar(true)`);
  let st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('comissão inicial: 5% de 3.000 = 150 para A', st.c.length === 1 && st.c[0].valor === 150 && st.fp[0].staff === A.id, JSON.stringify(st.c));

  // Pela janela: abre a venda, Editar, troca data, vendedor e forma
  await ev(`openVendaDetalhe("s1")`);
  await page.waitForSelector('#vnDEdit');
  await page.click('#vnDEdit');
  await page.waitForSelector('#ovVnEd');
  await ev(`(function(){ var d = document.getElementById("vnEData"); d.value = "2026-09-20"; d.dispatchEvent(new Event("change")); var s = document.getElementById("vnESeller"); s.value = ${JSON.stringify(B.id)}; s.dispatchEvent(new Event("change")); var f = document.getElementById("vnEForma"); f.value = "Boleto"; f.dispatchEvent(new Event("change")); document.getElementById("vnEObs").value = "Ajuste"; })()`);
  await page.click('#vnESave');
  await page.waitForSelector('#ovVn');
  await page.waitForTimeout(200);
  const s1 = JSON.parse(await ev(`JSON.stringify(SALES.rows.filter(function(s){ return s.id === "s1"; })[0])`));
  check('venda gravada com data, vendedor, forma e observação novos', s1.data === '2026-09-20' && s1.seller === B.id && s1.sellerName === B.nome && s1.forma === 'Boleto' && s1.obs === 'Ajuste', JSON.stringify(s1));
  check('valor da venda não mudou', s1.total === 3000 && s1.valorMensal === 1000);
  st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('comissão recalculada para B: 10% = 300, mesma conta a pagar atualizada', st.c.length === 1 && st.c[0].valor === 300 && st.c[0].seller === B.id && st.fp.length === 1 && st.fp[0].valor === 300 && st.fp[0].staff === B.id && st.c[0].payable === st.fp[0].id, JSON.stringify(st));
  await page.click('#vnDOk');

  // Convênio gravado na venda: ao registrar vem do tratamento; Editar troca; Painel usa o gravado
  const cv = JSON.parse(await ev(`(function(){
    state.convenios = [{id: "cvA", name: "Conv A"}, {id: "cvB", name: "Conv B"}];
    state.treatments[0].convenioId = "cvA"; state.treatments[0].convenio = "";
    return slInsert({treatment: "t1", patient: state.treatments[0].patientId, tipo: "aditivo", data: "2026-10-10", valorMensal: 10, meses: 1, total: 10, status: "ativa"}).then(function(n){
      state.treatments[0].convenioId = "cvB";
      return JSON.stringify({id: n.id, name: n.convName, painel: pvConvName(n)});
    }); })()`));
  check('venda registrada guarda o convênio do tratamento e o Painel usa o gravado', cv.name === 'Conv A' && cv.painel === 'Conv A', JSON.stringify(cv));
  await ev(`openVendaDetalhe(${JSON.stringify(cv.id)})`);
  await page.waitForSelector('#vnDEdit'); await page.click('#vnDEdit'); await page.waitForSelector('#vnEConv', {state: 'attached'});
  await ev(`(function(){ var c = document.getElementById("vnEConv"); c.value = "cvB"; c.dispatchEvent(new Event("change")); })()`);
  await page.click('#vnESave'); await page.waitForSelector('#ovVn'); await page.waitForTimeout(200);
  const cv2 = await ev(`(SALES.rows.filter(function(s){ return s.id === ${JSON.stringify(cv.id)}; })[0] || {}).convName`);
  check('Editar Venda troca o convênio gravado', cv2 === 'Conv B', cv2);
  await page.click('#vnDOk');
  await ev(`SALES.rows = SALES.rows.filter(function(s){ return s.id !== ${JSON.stringify(cv.id)}; }); 1`);

  // Sem vendedor: estorna; vendedor de volta: gera de novo
  await ev(`(function(){ var s = SALES.rows[0]; return slUpdate("s1", {data: s.data, seller: "", sellerName: "", forma: s.forma, obs: s.obs}).then(function(){ return comResync(SALES.rows[0]); }); })()`);
  st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('vendedor tirado: comissão estornada e conta a pagar excluída', st.c[0].status === 'estornada' && st.fp.length === 0, JSON.stringify(st));
  await ev(`(function(){ var s = SALES.rows[0]; return slUpdate("s1", {data: s.data, seller: ${JSON.stringify(A.id)}, sellerName: ${JSON.stringify(A.nome)}, forma: s.forma, obs: s.obs}).then(function(){ return comResync(SALES.rows[0]); }); })()`);
  st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('vendedor de volta: comissão gerada de novo (150) com conta a pagar', st.c.length === 1 && st.c[0].status === 'gerada' && st.c[0].valor === 150 && st.fp.length === 1 && st.fp[0].staff === A.id, JSON.stringify(st));

  // Comissão paga: troca de vendedor só avisa
  await ev(`FP.rows[0].entry = "lanc1"`);
  const msg = await ev(`(function(){ var s = SALES.rows[0]; return slUpdate("s1", {data: s.data, seller: ${JSON.stringify(B.id)}, sellerName: ${JSON.stringify(B.nome)}, forma: s.forma, obs: s.obs}).then(function(){ return comResync(SALES.rows[0]); }); })()`);
  st = JSON.parse(await ev(`JSON.stringify({c: COMM.rows, fp: FP.rows})`));
  check('comissão já paga: não muda e avisa', /já foi paga/.test(msg) && st.c[0].valor === 150 && st.c[0].seller === A.id, msg);

  // Bloqueios
  await ev(`FP.rows.push({id: "par1", venc: "2026-10-05", desc: "Parcela", plan: "", acc: "", sup: "", valor: 1000, entry: "lancP", sale: "s1", grupo: "s1", parcela: 1, parcelas: 3, obs: "", linhas: [], loan: "", staff: "", abate: ""})`);
  check('parcela recebida bloqueia a edição', /parcela recebida/.test(await ev(`slEditBlocked(SALES.rows[0])`)));
  check('venda cancelada não é editada', /ativa/.test(await ev(`slEditBlocked(Object.assign({}, SALES.rows[0], {status: "cancelada"}))`)));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
