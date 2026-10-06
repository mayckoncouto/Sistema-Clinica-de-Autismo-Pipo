// Dados de saúde do paciente com permissão própria ("Pacientes – saúde"): saem do
// cadastro de pacientes para a tabela protegida; sem "ver" não aparecem em lugar nenhum.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_saude.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  const r = await ev(`(function(){
    var pid = state.patientsRaw[0].id, out = {};
    HEALTH.map = {}; HEALTH.map[pid] = {cid: "F84.0", alergias: "Amendoim"};
    rebuildPatients();
    var p = state.patients.filter(function(x){ return x.id === pid; })[0];
    out.merged = p.cid === "F84.0" && p.alergias === "Amendoim";
    out.rawClean = state.patientsRaw[0].cid === undefined;
    writePatients(state.patients.slice());   // grava o documento sem a saúde
    out.stripped = !state.patientsRaw.some(function(x){ return x.cid !== undefined || x.alergias !== undefined; }) &&
      state.patients.filter(function(x){ return x.id === pid; })[0].cid === "F84.0";
    return out;
  })()`);
  check('health merged into the patient the app reads?', r.merged);
  check('patient document itself has no health data?', r.rawClean);
  check('saving strips health from the patients document?', r.stripped);

  // Com permissão: a janela do paciente mostra Saúde.
  await ev(`openPatientModal(state.patients[0])`);
  await page.waitForTimeout(200);
  check('with permission the patient window shows Saúde?', !!(await page.$('#ovPat [data-pmsec="saude"]')));
  await ev(`document.getElementById("modalHost").innerHTML = ""`);

  // Sem permissão: some da janela, da ficha e do quadro clínico do plano.
  const no = await ev(`(function(){
    healthCanSee = function(){ return false; }; healthCanEdit = function(){ return false; };
    openPatientModal(state.patients[0]);
    var out = {modal: !document.querySelector('#ovPat [data-pmsec="saude"]'), shown: patFieldShown("cid"), nameShown: patFieldShown("nome")};
    document.getElementById("modalHost").innerHTML = "";
    out.plan = /permissão/.test(planClinicalHtml(state.patients[0]));
    return out;
  })()`);
  check('without permission Saúde is not in the patient window?', no.modal && no.shown === false && no.nameShown === true);
  check('without permission the plan shows no clinical data?', no.plan);

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
