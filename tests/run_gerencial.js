// Gerencial: contratos (ativos, novos, negociados, cancelados), avaliações, triagens, funil, tendência, metas, fechamento e listas.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_gc.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await ev(`(function(){
    var P = state.patientsRaw.map(function(p){ return p.id; }); window.__P = P;
    var tp = ["multidisciplinar"];
    state.treatments = [
      {id: "a1", patientId: P[0], inicio: "2026-01-05", status: "renegociado", statusEm: "2026-03-01", tipo: "novo", tipos: tp, convenio: "Particular", valor: 1000, specHours: []},
      {id: "a2", patientId: P[0], inicio: "2026-03-01", status: "ativo", tipo: "renegociado", tipos: tp, convenio: "Particular", valor: 1200, specHours: []},
      {id: "b1", patientId: P[1], inicio: "2026-02-10", status: "cancelado", statusEm: "2026-04-15", termino: "2026-04-15", tipo: "novo", tipos: tp, convenio: "Particular", valor: 800, motivoCancelNome: "Outro", specHours: []},
      {id: "c1", patientId: P[2], inicio: "2026-03-20", status: "ativo", tipo: "novo", tipos: tp, convenio: "Particular", valor: 500, specHours: []},
      {id: "c2", patientId: P[3], inicio: "2026-04-01", status: "ativo", tipo: "novo", tipos: tp, convenio: "Particular", valor: 700, specHours: []},
      {id: "s1", patientId: P[3], inicio: "2026-02-12", status: "finalizado", tipo: "novo", tipos: ["svc:avaliacao"], convenio: "Particular", valor: 300, specHours: []},
      {id: "s2", patientId: P[3], inicio: "2026-03-05", status: "finalizado", tipo: "novo", tipos: ["svc:avaliacao-neuropsicologica"], convenio: "Particular", valor: 2500, specHours: []}
    ];
    window.__gcTriagens = [{id: 1, date: "2026-02-01", patient_id: P[3]}, {id: 2, date: "2026-03-02", patient_id: P[2]}, {id: 3, date: "2026-03-15", patient_id: "fora"}];
    rebuildPatients();
    GC.year = "2026"; GC.ym = "2026-03"; GC.tri = window.__gcTriagens; GC.fech = {}; GC.metas = {padrao: {}, meses: {}};
  })()`);
  const num = (ym) => ev(`JSON.stringify(gcCalc("${ym}"))`).then(JSON.parse);
  const mar = await num('2026-03');
  check('março: 3 contratos ativos (a2, b1, c1) e valor 2.500', mar.contr === 3 && mar.ativosV === 2500, JSON.stringify(mar));
  check('março: 1 novo (c1) de 500', mar.novos === 1 && mar.novosV === 500);
  check('março: 1 negociado (a2) com variação +200 sobre o tratamento anterior', mar.negs === 1 && mar.negsV === 200);
  check('março: sem cancelados; neuropsicológica 1 (2.500); triagens 2', mar.canc === 0 && mar.neuro === 1 && mar.neuroV === 2500 && mar.tri === 2);
  const jan = await num('2026-01'), fev = await num('2026-02'), abr = await num('2026-04');
  check('janeiro: 1 contrato (a1) de 1.000, que é novo', jan.contr === 1 && jan.ativosV === 1000 && jan.novos === 1, JSON.stringify(jan));
  check('fevereiro: 2 contratos (a1 e b1), 1 novo (b1), 1 avaliação (300), 1 triagem', fev.contr === 2 && fev.ativosV === 1800 && fev.novos === 1 && fev.aval === 1 && fev.avalV === 300 && fev.tri === 1, JSON.stringify(fev));
  check('abril: b1 cancelado (800) e c2 novo; a1 não conta (acabou antes do a2)', abr.canc === 1 && abr.cancV === 800 && abr.novos === 1 && abr.contr === 4 && abr.ativosV === 3200, JSON.stringify(abr));
  check('tratamento de serviço (avaliação) não entra nos contratos', jan.contr === 1 && fev.contr === 2);
  const fun = JSON.parse(await ev(`JSON.stringify((function(){ var f = gcFunil(2026); return {t: f.tri.length, a: f.aval.length, n: f.novo.length}; })())`));
  check('funil: 3 pacientes com triagem, 1 com avaliação depois, 1 com contrato novo depois', fun.t === 3 && fun.a === 1 && fun.n === 1, JSON.stringify(fun));
  const funM = JSON.parse(await ev(`JSON.stringify([gcFunil(2026, "2026-02"), gcFunil(2026, "2026-03")].map(function(f){ return [f.tri.length, f.aval.length, f.novo.length]; }))`));
  check('funil mensal: fevereiro 1/1/1 (triagem, avaliação e contrato depois); março 2/0/0', funM[0].join() === "1,1,1" && funM[1].join() === "2,0,0", JSON.stringify(funM));
  check('filtro de convênio sem resultado zera os contratos', (await ev(`(function(){ GC.conv = "naoexiste"; var n = gcCalc("2026-03").contr; GC.conv = ""; return n; })()`)) === 0);

  // "Outros" da cascata: a lista explica a barra paciente por paciente (renegociado no meio do mês conta os dois tratamentos)
  const outs = JSON.parse(await ev(`(function(){
    var P = window.__P, tp = ["multidisciplinar"];
    state.treatments = state.treatments.concat([
      {id: "d1", patientId: P[4], inicio: "2026-01-10", status: "renegociado", statusEm: "2026-03-15", tipo: "novo", tipos: tp, convenio: "Particular", valor: 600, specHours: []},
      {id: "d2", patientId: P[4], inicio: "2026-03-15", status: "ativo", tipo: "renegociado", tipos: tp, convenio: "Particular", valor: 900, specHours: []}]);
    rebuildPatients();
    var keep = state.treatments.slice(0, -2), out = JSON.stringify(["2026-02", "2026-03", "2026-04"].map(function(ym, i){
      var pym = ["2026-01", "2026-02", "2026-03"][i], w = gcWaterfall(gcCalc(pym), gcCalc(ym), ym, pym), d = gcDrillData("out", ym);
      var soma = Math.round(d.rows.reduce(function(a, r){ return a + r.dif; }, 0) * 100) / 100;
      return {ym: ym, barra: w.outros, soma: soma, n: d.rows.length, txt: d.rows.map(function(r){ return r.plain[4]; }).join(" | ")};
    })); state.treatments = keep; rebuildPatients(); return out;
  })()`));
  check('a soma da lista Outros é igual à barra em todos os meses', outs.every((o) => o.barra === o.soma), JSON.stringify(outs));
  const mar2 = outs[1];
  check('março: renegociado no meio do mês aparece em Outros com o motivo', mar2.barra !== 0 && mar2.n >= 1 && /ainda vale/.test(mar2.txt), JSON.stringify(mar2));

  // tela
  await ev(`openGerencial(); 1`);
  await page.waitForSelector('#tab-gerencial:not([hidden]) #gcBody .gc-card', { timeout: 4000 });
  await ev('GC.year = "2026"; GC.ym = "2026-03"; GC.tri = window.__gcTriagens; gcRender(); 1'); await page.waitForTimeout(200);
  const cards = await page.$$eval('#gcBody .gc-cards:first-child .gc-card', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ')));
  check('7 cartões do mês em destaque (março)', cards.length === 7 && /Contratos 3/.test(cards[1]) && /Novos 1/.test(cards[2]) && /Negociados 1/.test(cards[3]) && /Triagens 2/.test(cards[6]), cards.join(' | '));
  check('título da tela: Gerencial', /Gerencial/.test(await page.$eval('#tab-gerencial .cad-title', (x) => x.innerText)));
  check('gráfico único Contratos e Movimento com eixo duplo, e gráficos dos ativos e da cascata', (await page.$$('#gcBody svg.gc-svg')).length >= 3 && /Contratos e Movimento/.test(await page.$eval('#gcBody', (x) => x.innerText)));
  const heads = await page.$$eval('#gcBody .gc-table thead th', (h) => h.map((x) => x.innerText.trim()));
  check('Detalhamento: Descrição, 12 meses e Ano', heads[0] === 'Descrição' && heads.length === 14 && heads[13] === 'Ano', heads.join(','));
  const labels = await page.$$eval('#gcBody .gc-table tbody tr td:first-child', (t) => t.map((x) => x.innerText.trim()));
  check('13 linhas na ordem pedida, sem grupos', labels.join('|') === 'Contratos Ativos|Contratos|Contratos Novos|Contratos Negociados|Contratos Cancelados|Contratos Novos Valor|Contratos Negociados Valor|Contratos Cancelados Valor|Triagens|Avaliações|Avaliações Neuro|Avaliações Valor|Avaliações Neuro Valor', labels.join('|'));
  check('colunas alinhadas à esquerda', (await page.$eval('#gcBody .gc-table tbody tr:nth-child(3) td:nth-child(4)', (x) => getComputedStyle(x).textAlign)) === 'left', await page.$eval('#gcBody .gc-table tbody tr:nth-child(3) td:nth-child(4)', (x) => getComputedStyle(x).textAlign));
  check('tabela cabe na tela sem rolar para o lado', await page.$eval('#gcBody .gc-tbwrap', (x) => x.scrollWidth <= x.clientWidth + 2));

  // lista que compõe o número
  await page.click('#gcBody .gc-table tbody tr:nth-child(3) td:nth-child(4)'); // novos, março
  await page.waitForSelector('#ovGcDrill', { timeout: 2000 });
  const dr = await page.$eval('#ovGcDrill', (x) => x.innerText.replace(/\s+/g, ' '));
  check('clicar em um número abre a lista de pacientes', /Contratos Novos/.test(dr) && /paciente/i.test(dr) && /1 item/.test(dr), dr.slice(0, 160));
  await page.click('#gdOk'); await page.waitForTimeout(100);
  await page.click('#gcBody .gc-table tbody tr:nth-child(9) td:nth-child(4)'); // triagens, março
  await page.waitForSelector('#ovGcDrill'); check('lista das triagens traz as 2 de março', /2 itens/.test(await page.$eval('#ovGcDrill', (x) => x.innerText)));
  await page.click('#gdOk');

  // tendência
  const trendPaths = async () => (await page.$$('#gcBody svg.gc-svg path[stroke-dasharray="6 5"]')).length;
  check('tendência linear desenha linhas tracejadas', (await trendPaths()) > 0);
  await page.$eval('#gcTend', (x) => { x.value = 'off'; x.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150);
  check('tendência desligada: sem tracejadas', (await trendPaths()) === 0);
  await page.$eval('#gcTend', (x) => { x.value = 'med'; x.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150);
  check('média dos 3 últimos meses: tracejadas e texto explicando', (await trendPaths()) > 0 && /média dos últimos 3 meses/.test(await page.$eval('#gcBody', (x) => x.innerText)));
  await page.$eval('#gcTend', (x) => { x.value = 'saz'; x.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150);
  check('sazonal sem dados do ano anterior avisa', /Sem dados do ano anterior/.test(await page.$eval('#gcBody', (x) => x.innerText)));
  await ev('GC.tend = "lin"; gcRender(); 1');

  // metas
  await ev('gcMetasModal(); 1'); await page.waitForSelector('#ovGcMetas #gmSave');
  await page.fill('#gmp-aval', '12'); await page.fill('#gmp-tri', '6'); await page.fill('#gmm-2-aval', '2'); await page.click('#gmSave'); await page.waitForTimeout(250);
  check('metas gravadas: padrão e meta própria de março', (await ev('gcMeta("2026-03","aval")')) === 2 && (await ev('gcMeta("2026-05","aval")')) === 12 && (await ev('gcMeta("2026-05","tri")')) === 6, JSON.stringify(await ev('GC.metas')));
  check('linhas de meta no gráfico', (await page.$$('#gcBody svg.gc-svg line[stroke-dasharray="2 4"]')).length > 0);

  // fechamento
  await ev('gcFechar("2026-03"); 1'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('março fechado guarda os números', !!(await ev('GC.fech["2026-03"]')) && (await ev('GC.fech["2026-03"].dados.ativosV')) === 2500);
  await ev('state.treatments.filter(function(t){ return t.id === "c1"; })[0].valor = 999; 1');
  check('mês fechado não muda com a correção de um tratamento', (await ev('gcMonth("2026-03").ativosV')) === 2500 && (await ev('gcCalc("2026-03").ativosV')) === 2999);
  await page.waitForTimeout(150);
  check('chip e cadeado na tabela do mês fechado', /Mar 🔒|🔒/.test(await page.$eval('#gcBody .gc-table thead', (x) => x.innerText)) && /Fechado/.test(await page.$eval('#gcChip', (x) => x.innerText)));
  await ev('gcReabrir("2026-03"); 1'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('reabrir volta a calcular com os tratamentos de hoje', !(await ev('GC.fech["2026-03"]')) && (await ev('gcMonth("2026-03").ativosV')) === 2999);

  // menu
  await page.click('#gcMenuBtn'); await page.waitForTimeout(100);
  const menu = await page.$$eval('#gcMenu [data-gc-m]', (b) => b.map((x) => x.getAttribute('data-gc-m')));
  check('Outras Opções: exportar, imprimir, períodos, metas, fechar e atualizar', ['xls', 'print', 'per', 'metas', 'fechar', 'refresh'].every((k) => menu.indexOf(k) !== -1), menu.join());
  await page.keyboard.press('Escape');
  check('Financeiro ▾ tem o item Gerencial depois de Demonstrativos', (await page.$$eval('#finMenu [data-nav]', (b) => b.map((x) => x.getAttribute('data-nav')))).join().indexOf('demonstrativos,gerencial') !== -1);

  check('sem erro de JavaScript', errors.length === 0, errors.join(' | '));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  console.log(fails ? 'FALHOU: ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
