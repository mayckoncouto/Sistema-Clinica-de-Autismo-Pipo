// ABA por especialidade/serviço no tratamento: a linha da especialidade do
// atendimento manda na cor e nas regras "não ABA"; fora das especialidades do
// tratamento vale o ABA do tratamento. Também confere "Sem vencimento".
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_aba.html');
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
    var pat = state.patientsRaw[0];
    state.treatments = [{id: "ta", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", aba: "Sim",
      specHours: [{specId: "psico", hours: 4, aba: "Não"}, {specId: "fono", hours: 4, aba: "Sim"}, {specId: "svc:triagem", hours: 1, aba: "Não"}]}];
    rebuildPatients();
    var p = findPatientByName(pat.nome), out = {};
    out.psico = bookingAbaOf(p, "ana-terapeuta", "sessao");      // principal psico -> Não
    out.fono = bookingAbaOf(p, "bia-terapeuta", "sessao");       // principal fono -> Sim
    out.svc = bookingAbaOf(p, "bia-terapeuta", "triagem");       // serviço -> Não
    out.outside = bookingAbaOf(p, "bia-terapeuta", "avaliacao"); // serviço fora -> Sim (tratamento)
    out.naoAna = isNaoABABooking({patient: pat.nome}, "ana-terapeuta");
    out.naoBia = isNaoABABooking({patient: pat.nome}, "bia-terapeuta");
    out.colorDiffers = patientColor(bookingPatient(p, {}, "ana-terapeuta")) !== patientColor(bookingPatient(p, {}, "bia-terapeuta"));
    out.agd = isNaoABABooking({patient: pat.nome, date: trTodayIso(), professional_id: "ana-terapeuta", service: "sessao"});
    // sem ABA nas linhas: vale o do tratamento
    state.treatments[0].specHours = [{specId: "psico", hours: 4}];
    state.treatments[0].aba = "Não"; rebuildPatients();
    out.noLines = isNaoABABooking({patient: pat.nome}, "bia-terapeuta");
    out.dueSem = trDue({status: "ativo", vencPor: "sem", validoAte: "2020-01-01"}) === null && trDueText({vencPor: "sem", validoAte: "2020-01-01"}) === "";
    return out;
  })()`);
  check('psico line ABA Não?', r.psico === 'Não', r.psico);
  check('fono line ABA Sim?', r.fono === 'Sim', r.fono);
  check('service line ABA Não?', r.svc === 'Não', r.svc);
  check('outside treatment uses treatment ABA?', r.outside === 'Sim', r.outside);
  check('não ABA only with psico professional?', r.naoAna === true && r.naoBia === false);
  check('color follows the line?', r.colorDiffers);
  check('Agenda uses professional_id of the row?', r.agd === true);
  check('no line ABA = treatment ABA?', r.noLines === true);
  check('Sem vencimento never due?', r.dueSem);

  // Editor: ABA de cima copia para as linhas; linha muda sozinha
  await ev(`(function(){ state.treatments = []; rebuildPatients(); openTreatmentModal(null, {patientId: state.patientsRaw[0].id}); })()`);
  await page.waitForTimeout(300);
  const ed = await ev(`(function(){
    var out = {};
    out.vencDefault = document.getElementById("trVencPor").value;
    out.dateHidden = document.getElementById("trDateBox").hidden;
    out.topOpts = Array.prototype.map.call(document.querySelectorAll("#pAba option"), function(o){ return o.value; }).join(",");
    out.topVal = document.getElementById("pAba").value;
    out.desc = !!document.querySelector('label[for="trDesp"]') && document.querySelector('label[for="trDesp"]').textContent;
    document.getElementById("specRowAdd").click(); document.getElementById("specRowAdd").click();
    out.head = (document.querySelector("#specHead:not([hidden])") || {}).textContent || "";
    out.lineOpts = Array.prototype.map.call(document.querySelectorAll(".spec-aba")[0].options, function(o){ return o.value; }).join(",");
    out.lineDefault = document.querySelectorAll(".spec-aba")[0].value;
    var aba = document.getElementById("pAba"); aba.value = "Não"; aba.dispatchEvent(new Event("change", {bubbles: true}));
    out.all = Array.prototype.map.call(document.querySelectorAll(".spec-aba"), function(s){ return s.value; }).join(",");
    var first = document.querySelector(".spec-aba"); first.value = "Sim"; first.dispatchEvent(new Event("change", {bubbles: true}));
    out.after = Array.prototype.map.call(document.querySelectorAll(".spec-aba"), function(s){ return s.value; }).join(",");
    return out;
  })()`);
  check('Vencimento por defaults to Sem vencimento, date box hidden?', ed.vencDefault === 'sem' && ed.dateHidden === true, ed.vencDefault);
  check('label Descontos?', ed.desc === 'Descontos', ed.desc);
  check('top ABA only Sim/Não, default Sim?', ed.topOpts === 'Sim,Não' && ed.topVal === 'Sim', ed.topOpts + ' ' + ed.topVal);
  check('column titles above the lines?', /Especialidade ou serviço/.test(ed.head) && /Sessões\/mês/.test(ed.head) && /Terapeuta/.test(ed.head) && /ABA/.test(ed.head), ed.head);
  check('line ABA only Sim/Não, new line = Sim?', ed.lineOpts === 'Sim,Não' && ed.lineDefault === 'Sim', ed.lineOpts + ' ' + ed.lineDefault);
  check('top ABA copies to all lines?', ed.all === 'Não,Não', ed.all);
  check('one line changes alone?', ed.after === 'Sim,Não', ed.after);

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
