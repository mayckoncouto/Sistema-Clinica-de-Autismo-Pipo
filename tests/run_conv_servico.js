// Serviço do quadro do tratamento coberto pelo convênio: a especialidade do quadro coberta libera os serviços;
// "Liberado pelas Especialidades" no cadastro do serviço restringe (ex.: Avaliação Neuropsicológica só pela Psicologia).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_convsvc.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage); await page.waitForTimeout(1200);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0; const check = (n, ok, x) => { console.log(n, !!ok, ok ? '' : JSON.stringify(x === undefined ? '' : x)); if (!ok) fails++; };
  const r = await ev(`(function(){
    state.specialties = [{id: "psico", name: "Psicologia"}, {id: "fono", name: "Fonoaudiologia", libera: ["pped"]}, {id: "pped", name: "Psicopedagogia"}, {id: "fisio", name: "Fisioterapia"}];
    state.services = [{id: "sessao", name: "Sessão"}, {id: "acol", name: "Acolhimento Familiar"}, {id: "aneuro", name: "Avaliação Neuropsicológica", liberadoPor: ["psico"]}];
    state.convenios = [{id: "c1", name: "Conv", especialidades: ["psico", "fono"]}];
    var f = function(sv, sp){ var c = convCoverage("c1", "svc:" + sv, sp); return c ? (c.none ? "nao" : "sim") : "-"; };
    return [f("acol", "psico"), f("acol", "pped"), f("acol", "fisio"), f("aneuro", "psico"), f("aneuro", "fono"), convCoverage("c1", "fisio").none ? "nao" : "sim"].join();
  })()`);
  check('Acolhimento: liberado por Psicologia e por Psicopedagogia (coberta via Fono); Fisioterapia não coberta; Avaliação Neuropsicológica só pela Psicologia?', r === 'sim,sim,nao,sim,nao,nao', r);
  await ev(`openRegistryItem("servicos", state.services[2])`); await page.waitForTimeout(400);
  const lib = await page.$$eval('#regSvcLib input:checked', (a) => a.map((x) => x.value));
  check('Cadastro do serviço mostra "Liberado pelas Especialidades" com Psicologia marcada?', lib.join() === 'psico', lib);
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close(); fs.unlinkSync(evPage); process.exit(fails || errors.length ? 1 : 0);
})();
