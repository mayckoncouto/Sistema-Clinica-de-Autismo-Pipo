// Relatório financeiro (Etapa 6): uma linha por mês (ativos, novos, renegociados,
// cancelados, receita prevista, ticket médio), total do período e lista dos
// tratamentos ativos com valor. O Início continua em branco. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_fin.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  const r = await ev(`(function(){
    state.treatments = [
      // a: ativo desde jan (vale fev e mar)
      {id: "a", patientId: "ana-azul", inicio: "2026-01-10", tipo: "novo", status: "ativo", valor: 1000, despesas: 100},
      // b: novo em março
      {id: "b", patientId: "bruno-verde", inicio: "2026-03-05", tipo: "novo", status: "ativo", valor: 500, despesas: 0},
      // c: desde jan, renegociado em 15/03 por d (c vale até 14/03)
      {id: "c", patientId: "carla-laranja", inicio: "2026-01-02", tipo: "novo", status: "renegociado", statusEm: "2026-03-15", valor: 300, despesas: 0},
      {id: "d", patientId: "carla-laranja", inicio: "2026-03-15", tipo: "renegociado", status: "ativo", valor: 400, despesas: 0},
      // e: cancelado em 20/02 (vale em fev, não em mar)
      {id: "e", patientId: "duda-vermelho", inicio: "2026-01-05", tipo: "novo", status: "cancelado", statusEm: "2026-02-20", valor: 200, despesas: 0, motivoCancel: "financeiro"}
    ];
    var m = finMonth("2026-03"), p = finMonth("2026-02");
    var rep = RP_BUILDERS.financeiro([], {from: "2026-02-01", to: "2026-03-31"});
    return {m: m, p: p, rep: rep};
  })()`);
  // Março: ativos a, b, c (até 14/03), d → 4; novos b; renegociados d; nenhum cancelado.
  console.log('march: active, new, renegotiated, cancelled?', r.m.ativos === 4 && r.m.novos === 1 && r.m.reneg === 1 && r.m.canc === 0, JSON.stringify(r.m));
  // Receita = (1000-100) + 500 + 300 + 400 = 2100; ticket = 525.
  console.log('march: expected revenue and average ticket (monthly value)?', r.m.receita === 2100 && r.m.ticket === 525);
  // Fevereiro: ativos a, c, e → 3; cancelado e; receita 900 + 300 + 200 = 1400.
  console.log('february: active, cancelled and revenue?', r.p.ativos === 3 && r.p.canc === 1 && r.p.receita === 1400, JSON.stringify(r.p));
  const s0 = r.rep.sections[0], s1 = r.rep.sections[1];
  console.log('report: one row per month of the period?', s0.rows.length === 2 && /fevereiro\/2026/.test(s0.rows[0][0]) && /março\/2026/.test(s0.rows[1][0]));
  console.log('report: totals row (revenue 3.500,00)?', /3\.500,00/.test(s0.foot[5]) && s0.foot[4] === 1 && s0.foot[2] === 1, JSON.stringify(s0.foot));
  // Lista: a (2 meses × 900), b (1 × 500), c (2 × 300), d (1 × 400), e (1 × 200) = 1800+500+600+400+200 = 3500.
  console.log('report: list of active treatments with months and total?', s1.rows.length === 5 && /3\.500,00/.test(s1.foot[7]), JSON.stringify(s1.foot));

  // Aparece na lista de tipos da aba Relatórios, com o nome de relatório.
  await page.$eval('#mainTabs button[data-tab=relatorios]', (b) => b.click()); await page.waitForTimeout(300);
  const opt = await page.$$eval('#rpType option', (a) => a.map((o) => o.value + '|' + o.textContent));
  console.log('"Relatório financeiro" is a report type?', opt.some((o) => o === 'financeiro|Relatório financeiro'));
  // Início continua em branco.
  await page.$eval('#mainTabs button[data-tab=inicio]', (b) => b.click()); await page.waitForTimeout(200);
  console.log('Início stays blank?', (await page.innerHTML('#tab-inicio')).trim() === '');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
