// Financeiro ▾ Vendas: lista de todas as vendas, cartões, filtros, alertas e detalhes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vl.html');
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
    var pid = state.patientsRaw[0].id;
    state.treatments = [{id: "t1", patientId: pid, inicio: "2026-01-01", status: "ativo", tipo: "novo", sessoesMes: 8, convenio: "Particular", specHours: []}];
    rebuildPatients();
    function s(id, tipo, data, seller, total, status){ return {id: id, treatment: "t1", patient: pid, tipo: tipo, data: data, seller: seller, sellerName: seller ? "Vend " + seller : "", valorMensal: total / 3, meses: 3, total: total, forma: "PIX", status: status || "ativa", replacedBy: "", obs: "", by: "", at: data};}
    SALES.rows = [s("a", "nova", "2026-10-02", "v1", 3000), s("b", "nova", "2026-10-05", "", 1200), s("c", "aditivo", "2026-10-09", "v1", 600), s("e", "nova", "2026-10-11", "v2", 900, "cancelada")];
    function p(id, sale, venc, valor, entry){ return {id: id, venc: venc, desc: "Venda", plan: "", acc: "", sup: "", valor: valor, entry: entry, grupo: sale, parcela: 1, parcelas: 2, obs: "", linhas: [], loan: "", staff: "", abate: "", sale: sale}; }
    FP.rows = [p("p1", "a", "2026-10-01", 1000, "L1"), p("p2", "a", "2026-10-02", 500, ""), p("p3", "c", "2026-10-09", 600, "L2")];
    COMM.rows = []; COMM.rules = [];
  })()`);
  await page.waitForSelector('#mainTabs [data-tab="vendas"]', { state: 'attached' });
  check('botão Vendas existe no menu Financeiro', (await ev(`FIN_ITEMS.some(function(i){ return i.key === "vendas" && i.tab === "vendas"; })`)) === true);
  const order = await ev(`FIN_ITEMS.map(function(i){ return i.key; }).slice(5, 9).join()`);
  check('Vendas vem depois de Demonstrativos', order === 'conciliacao,demonstrativos,vendas,painelvendas', order);
  await page.$eval('#mainTabs [data-tab="vendas"]', (b) => b.click());
  await page.waitForSelector('#reg-vendas-host tr[data-vn-id]', { timeout: 4000 });
  check('lista as 4 vendas (inclusive cancelada)', (await page.$$eval('#reg-vendas-host tr[data-vn-id]', (t) => t.length)) === 4);
  const sum = await page.$eval('#vnSum', (x) => x.innerText.replace(/\s+/g, ' '));
  check('cartões: 3 vendas, total 4.800, recebido 1.600, a receber 500, atraso 500', /3 · R\$\s?4\.800,00/.test(sum) && /1\.600,00/.test(sum) && /500,00/.test(sum), sum);
  const pay = await page.$eval('#reg-vendas-host', (x) => x.innerText.replace(/\s+/g, ' '));
  check('situação de pagamento: Em Atraso, Quitada, Sem Parcelas', /Em Atraso/.test(pay) && /Quitada/.test(pay) && /Sem Parcelas/.test(pay), pay.slice(0, 300));
  const al = await page.$eval('#vnAlerts', (x) => x.innerText.replace(/\s+/g, ' '));
  check('alertas: atraso, sem parcelas, sem vendedor', /1 venda com parcela em atraso/.test(al) && /sem parcelas geradas/.test(al) && /sem vendedor/.test(al), al);
  await page.click('[data-vn-alert="atraso"]');
  check('alerta filtra a lista', (await page.$$eval('#reg-vendas-host tr[data-vn-id]', (t) => t.length)) === 1);
  await page.click('[data-vn-alert=""]');
  await page.$eval('#vnSt', (x) => { x.value = 'cancelada'; x.dispatchEvent(new Event('change', { bubbles: true })); });
  check('filtro de tipo', (await page.$$eval('#reg-vendas-host tr[data-vn-id]', (t) => t.length)) === 1);
  await page.$eval('#vnSt', (x) => { x.value = ''; x.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#vnSearch', 'zzzz'); await page.waitForTimeout(300);
  check('busca sem resultado mostra aviso', /Nenhuma venda com esses filtros/.test(await page.$eval('#reg-vendas-host', (x) => x.innerText)));
  await page.fill('#vnSearch', ''); await page.waitForTimeout(300);
  await page.click('#reg-vendas-host tr[data-vn-id="a"]');
  await page.waitForSelector('#ovVn', { timeout: 3000 });
  const det = await page.$eval('#ovVn', (x) => x.innerText.replace(/\s+/g, ' '));
  check('detalhe mostra total, parcelas e situação', /3\.000,00/.test(det) && /parcela/i.test(det) && /Em Atraso/.test(det), det.slice(0, 300));
  await page.click('#vnDOk');
  await page.click('#vnMenuBtn');
  check('Outras Opções tem Exportar Excel e Painel de Vendas', /Exportar Excel/.test(await page.$eval('#vnMenu', (x) => x.innerText)) && /Painel de Vendas/.test(await page.$eval('#vnMenu', (x) => x.innerText)));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  if (fails) process.exit(1);
})();
