// Relatório Elegibilidade: um registro por paciente atendido, com convênio, plano e carteirinha.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const f = path.join(__dirname, 'page_eleg.html');
  fs.writeFileSync(f, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + f);
  await page.waitForTimeout(800);
  let fails = 0;
  const check = (l, ok, x) => { console.log(l, ok, x === undefined ? '' : x); if (!ok) fails++; };
  const r = JSON.parse(await page.evaluate(() => window.__ev(`(function(){
    var p = state.patients[0], q = state.patients[1];
    p.carteirinha = "123456";
    var rows = [
      {patient: p.nome, date: "2026-10-15", time: "08:00"},
      {patient: p.nome, date: "2026-10-15", time: "09:00"},
      {patient: q.nome, date: "2026-10-15", time: "10:00"},
      {patient: "Reunião Clínica", date: "2026-10-15", time: "11:00", blocked: true}
    ];
    return JSON.stringify({p: p.nome, res: RP_BUILDERS["elegibilidade"](rows, {from: "2026-10-15", to: "2026-10-15", conv: ""})});
  })()`)));
  const sec = r.res.sections[0];
  check('cabeçalho Paciente/Convênio/Carteirinha', sec.head.join() === 'Paciente,Convênio,Carteirinha');
  check('um registro por paciente (2 pacientes, 3 atendimentos)', sec.rows.length === 2, JSON.stringify(sec.rows));
  const row = sec.rows.find((x) => x[0] === r.p);
  check('carteirinha aparecem', row && row[2] === '123456', JSON.stringify(row));
  check('no JS errors?', errors.length === 0, errors.join('|'));
  fs.unlinkSync(f);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
