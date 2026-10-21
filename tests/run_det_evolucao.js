// Detalhes do Agendamento: "Registrar Evolução" só com a regra "Finalizado exige evolução" em Avisar,
// atendimento Finalizado de paciente cadastrado e sem evolução ligada.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_detevo.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage); await page.waitForTimeout(1200);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0; const check = (n, ok, x) => { console.log(n, !!ok, ok ? '' : JSON.stringify(x === undefined ? '' : x)); if (!ok) fails++; };
  const open = async (mode, st, evo) => {
    await ev(`(function(){ state.sysRules = {ag_final_evolucao: "${mode}"}; PLAN.evoMem = ${evo ? '[{id: "e1", appointment_id: "r1"}]' : '[]'};
      var p = state.patients[0]; var row = {id: "r1", date: "2026-10-20", time: "08:00", professional_id: state.professionals[0].id, patient: p.nome, patient_id: p.id, status: ${st ? '"' + st + '"' : 'null'}};
      AD.rows = {r1: row}; agdOpenDetails(row); })()`);
    await page.waitForTimeout(300);
    return page.$eval('#agdDetEvo', (b) => !b.hidden).catch(() => 'sem botão');
  };
  check('Avisar + Finalizado sem evolução: botão aparece?', await open('warn', 'finalizado', false) === true);
  const order = await page.$$eval('#ovAgdDet .modal-foot button', (a) => a.map((b) => b.id));
  check('Botão logo depois de Fechar?', order.indexOf('agdDetEvo') === order.indexOf('agdDetOk') + 1, order);
  await page.click('#agdDetEvo'); await page.waitForTimeout(400);
  check('Abre a evolução?', await page.$('#prEditor, .pr-editor') !== null);
  check('Bloquear: não aparece?', await open('block', 'finalizado', false) === false);
  check('Avisar com evolução: não aparece?', await open('warn', 'finalizado', true) === false);
  check('Avisar sem status Finalizado: não aparece?', await open('warn', null, false) === false);
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close(); fs.unlinkSync(evPage); process.exit(fails || errors.length ? 1 : 0);
})();
