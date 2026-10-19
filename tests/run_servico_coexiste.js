// Tratamento de serviço (tipos svc:) pode ficar Ativo junto com um de especialidades.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_sc.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const b = await chromium.launch(require('./launch-opts')); const page = await b.newPage();
  await page.goto('file://' + pg); await page.waitForTimeout(800);
  const r = await page.evaluate(() => window.__ev(`(function(){
    var T = function(id, tipos){ return {id: id, patientId: "p1", status: "ativo", inicio: "2026-01-01", tipos: tipos}; };
    state.treatments = [T("b", ["svc:avaliacao"]), T("a", ["multidisciplinar"])];
    return {svcB: trIsService(state.treatments[0]), svcA: trIsService(state.treatments[1]),
      emptySvc: trIsService({tipos: []}), mixed: trIsService({tipos: ["svc:x", "spec:y"]}), active: activeTreatment("p1").id};
  })()`));
  const ok = r.svcB && !r.svcA && !r.emptySvc && !r.mixed && r.active === 'a';
  console.log('serviço coexiste (helper e tratamento atual)?', ok, JSON.stringify(r));
  fs.unlinkSync(pg); await b.close(); process.exit(ok ? 0 : 1);
})();
