// Importar Planilha do Planner: leitura da grade (sala/coluna/profissional, serviço e observação, não cadastrados).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_pli.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const b = await chromium.launch(require('./launch-opts')); const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + pg); await page.waitForTimeout(800);
  const r = await page.evaluate(() => window.__ev(`(function(){
    state.services = [{id: 'orientacao-familiar', name: 'Acolhimento Familiar'}, {id: 'avaliacao', name: 'Avaliação'}];
    var t = 7 * 60 + 20, f = t / 1440;
    var rows = [
      ["", "1ª Segunda-Feira", "1ª Segunda-Feira", "1ª Segunda-Feira", "1ª Segunda-Feira"],
      ["", "Coordenador", "Sala Teste", "", ""],
      ["Horario", "Ana", "Ana", "Bia", "ERROS"],
      [f, "Sala Teste", "Paciente Um - Acolhimento Maria", ",", "x"],
      [f + 40 / 1440, "Reunião Clinica!", "Fulano Inexistente", "Paciente Um - Avaliação - Pg", ""],
      [], ["", "2ª Terça-Feira"], ["", "Sala Teste"], ["Horario", "Ana"], [f, "Paciente Um"]
    ];
    var res = plImpParse(rows);
    return {n: res.items.length, items: res.items.map(function(i){ return [i.docId, i.key, i.rec.patient, i.rec.service, i.rec.note, i.rec.roomRef || ""]; }),
      missing: Object.keys(res.missing), ignored: res.ignored.length, unknown: res.unknown};
  })()`));
  console.log(JSON.stringify(r));
  const g = r.items.filter(x => x[1].indexOf('coord') > 0)[0];
  const ok = r.n === 4 && r.unknown.length === 0 && r.items.some(x => x[3] === 'orientacao-familiar' && x[4] === 'Maria') && r.items.some(x => x[3] === 'avaliacao' && x[4] === 'Pg') && g && g[2] === 'Sala Teste' && g[5] === 'r1' &&
    r.items.some(x => x[4] === 'Maria') && r.items.some(x => x[4] === 'Pg') && r.missing.join() === 'Fulano Inexistente' && !errs.length;
  console.log('importar planilha do Planner?', ok, errs.join('|'));
  fs.unlinkSync(pg); await b.close(); process.exit(ok ? 0 : 1);
})();
