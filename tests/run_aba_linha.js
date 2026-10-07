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

  const btnVisible = await page.$eval('#trOpenPat', (b) => !b.hidden).catch(() => false);
  if (btnVisible){ await page.click('#trMoreBtn'); await page.click('#trOpenPat'); }
  await page.waitForTimeout(300);
  const patOpen = !(await page.$('#ovTreat')) && !!(await page.$('#pNome'));
  check('"Cadastro do paciente" opens the patient window?', btnVisible && patOpen);
  // Trocar o ABA de UMA linha pela lista da tela e salvar: tem que ficar gravado.
  await ev(`(function(){ document.querySelectorAll(".overlay").forEach(function(o){ o.remove(); });
    var pat = state.patientsRaw[0];
    state.treatments = [{id: "tb", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", aba: "Sim", vencPor: "sem",
      specHours: [{specId: "psico", hours: "4"}, {specId: "fono", hours: "4"}]}]; rebuildPatients();
    openTreatmentModal(state.treatments[0]); })()`);
  await page.waitForTimeout(300);
  await page.click('.hours-row[data-i="0"] .spec-aba-wrap .dp-btn');
  await page.waitForTimeout(150);
  await page.click('#dpPop .dp-opt:has-text("Não")');
  await page.waitForTimeout(150);
  await page.click('#trSave');
  await page.waitForTimeout(600);
  const saved = await ev(`(function(){ var t = state.treatments.filter(function(x){ return x.id === "tb"; })[0];
    var p = findPatientByName(state.patientsRaw[0].nome);
    return {rows: JSON.stringify(t.specHours.map(function(r){ return r.aba || ""; })), psico: bookingAbaOf(p, "ana-terapeuta", "sessao"), fono: bookingAbaOf(p, "bia-terapeuta", "sessao")}; })()`);
  check('line ABA changed in the window is saved?', saved.rows === '["Não","Sim"]', saved.rows);
  check('saved line ABA rules the booking?', saved.psico === 'Não' && saved.fono === 'Sim', saved.psico + ' ' + saved.fono);
  // Regras "não ABA" só para Sessão (Planner e Agenda)
  const svc = await ev(`(function(){ document.querySelectorAll(".overlay").forEach(function(o){ o.remove(); });
    var out = {}, d = state.scheduleDocs["seg-1"] = state.scheduleDocs["seg-1"] || {bookings: {}};
    out.flagSess = isNaoABABooking({patient: "Duda Vermelho", service: "sessao"}, "ana-terapeuta");
    out.flagTri = isNaoABABooking({patient: "Duda Vermelho", service: "triagem"}, "ana-terapeuta");
    d.bookings["09:20|r1|r1-t1"] = {patient: "Duda Vermelho", note: "", service: "sessao"};
    out.sessBlocked = !!plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "sessao"});
    out.otherFree = plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "triagem"});
    renderGrid();
    var td = document.querySelector('table.sched[data-doc="seg-1"] td.slotcell[data-key="09:20|r1|r1-t2"]');
    out.soft = !!td && td.classList.contains("aba-lock") && td.classList.contains("aba-soft");
    d.bookings["09:20|r1|r1-t1"] = {patient: "Duda Vermelho", note: "", service: "triagem"};
    out.triNoLock = plannerConflict("seg-1", "09:20|r1|r1-t2", {patient: "Bruno Verde", note: "", service: "sessao"});
    delete d.bookings["09:20|r1|r1-t1"]; renderGrid();
    var rows = [{id: "o1", date: "2030-01-07", time: "08:00", professional_id: "ana-terapeuta", room_id: "r1", patient: "Duda Vermelho", service: "sessao"}];
    out.agdSess = !!agdConflictIn(rows, {date: "2030-01-07", time: "08:00", professional_id: "bia-terapeuta", room_id: "r1", patient: "Bruno Verde", service: "sessao"});
    out.agdOther = agdConflictIn(rows, {date: "2030-01-07", time: "08:00", professional_id: "bia-terapeuta", room_id: "r1", patient: "Bruno Verde", service: "avaliacao"});
    rows[0].service = "triagem";
    out.agdTriNoLock = agdConflictIn(rows, {date: "2030-01-07", time: "08:00", professional_id: "bia-terapeuta", room_id: "r1", patient: "Bruno Verde", service: "sessao"});
    return out;
  })()`);
  check('não ABA flag only for Sessão?', svc.flagSess === true && svc.flagTri === false, JSON.stringify(svc));
  check('Planner: Sessão blocked, other service allowed next to a não ABA?', svc.sessBlocked && svc.otherFree === null);
  check('Planner: locked cell still accepts another service (aba-soft)?', svc.soft);
  check('Planner: não ABA patient in another service does not lock the room?', svc.triNoLock === null, svc.triNoLock);
  check('Agenda: same rules by service?', svc.agdSess && svc.agdOther === null && svc.agdTriNoLock === null, JSON.stringify([svc.agdOther, svc.agdTriNoLock]));

  // Sem exceção: grupo de suporte marcando a sala NÃO libera dois "não ABA" do mesmo profissional.
  const grp = await ev(`(function(){
    var out = {};
    state.patients = state.patients.concat([{id: "eva-x", nome: "Eva Teste", idade: 8, aba: "Não"}]);
    state.rooms = state.rooms.concat([{id: "rx", name: "Sala Fono ABA", color: "teal", therapists: [{id: "rx-1", name: "Ana", professionalId: "ana-terapeuta"}, {id: "rx-2", name: "Ana", professionalId: "ana-terapeuta"}]}, {id: "gx", name: "Aplicador Teste", group: true, color: "slate", therapists: [{id: "gx-1", name: "Bia", professionalId: "bia-terapeuta"}]}]);
    var d = state.scheduleDocs["ter-1"] = state.scheduleDocs["ter-1"] || {bookings: {}};
    d.bookings["10:00|rx|rx-1"] = {patient: "Duda Vermelho", note: "", service: "sessao"};
    d.bookings["10:00|gx|gx-1"] = {patient: "Sala Fono ABA", note: ""};
    out.planner = plannerConflict("ter-1", "10:00|rx|rx-2", {patient: "Eva Teste", note: "", service: "sessao"});
    out.noDepFn = typeof abaGroupDependencyDenied === "undefined" && typeof groupBookedRoom === "undefined";
    delete d.bookings["10:00|rx|rx-1"]; delete d.bookings["10:00|gx|gx-1"];
    var rows = [{id: "a1", date: "2030-01-07", time: "10:00", professional_id: "ana-terapeuta", room_id: "rx", patient: "Duda Vermelho", service: "sessao"},
      {id: "g1", date: "2030-01-07", time: "10:00", professional_id: "bia-terapeuta", room_id: "rx", patient: "Aplicador Teste"}];
    out.agenda = agdConflictIn(rows, {date: "2030-01-07", time: "10:00", professional_id: "ana-terapeuta", room_id: "rx", patient: "Eva Teste", service: "sessao"});
    return out;
  })()`);
  check('Planner: group booked for the room does NOT allow two não ABA together?', /não faz intervenção ABA/.test(grp.planner || '') && grp.noDepFn, JSON.stringify(grp));
  check('Agenda: group row in the room does NOT allow two não ABA together?', /não faz intervenção ABA/.test(grp.agenda || ''), JSON.stringify(grp));

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
