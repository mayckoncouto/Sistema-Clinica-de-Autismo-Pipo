// Atendimento com status ou evolução fica protegido na Agenda (2026-10-10):
// excluir e mudar data/horário/profissional só o Administrador; trocar o paciente, ninguém.
// Cria tests/page_ad.html com um "eval" para chamar as regras do app direto.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_ad.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + pg);
  await page.waitForTimeout(700);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };

  const r = await ev(`(function(){
    var row = {id: "a1", date: "2026-10-01", time: "08:00", professional_id: "p1", room_id: "r1", patient: "Ana Azul", patient_id: "ana", status: "finalizado", note: ""};
    var free = Object.assign({}, row, {status: null});
    var out = {};
    out.same = agdDoneLockMsg(row, Object.assign({}, row, {note: "obs", room_id: "r2"}), false);
    out.moved = agdDoneLockMsg(row, Object.assign({}, row, {time: "08:40"}), false);
    out.prof = agdDoneLockMsg(row, Object.assign({}, row, {professional_id: "p2"}), false);
    out.pat = agdDoneLockMsg(row, Object.assign({}, row, {patient: "Bruno Verde", patient_id: "bruno"}), false);
    out.blk = agdDoneLockMsg(row, Object.assign({}, row, {blocked: true, patient: ""}), false);
    out.legacyId = agdDoneLockMsg(Object.assign({}, row, {patient_id: null}), Object.assign({}, row), false);
    out.free = agdDoneLockMsg(free, Object.assign({}, free, {time: "09:00", patient: "Outro"}), false);
    out.evo = agdDoneLockMsg(free, Object.assign({}, free, {time: "09:00"}), true);
    window.pipoAuth = {isAdmin: function(){ return true; }, can: function(){ return true; }};
    out.adminMoved = agdDoneLockMsg(row, Object.assign({}, row, {time: "08:40"}), false);
    out.adminPat = agdDoneLockMsg(row, Object.assign({}, row, {patient: "Bruno Verde"}), false);
    delete window.pipoAuth;
    return out;
  })()`);
  check('observação e sala mudam livremente?', r.same === '', r.same);
  check('horário: só o Administrador?', /só o Administrador/.test(r.moved), r.moved);
  check('profissional: só o Administrador?', /só o Administrador/.test(r.prof), r.prof);
  check('paciente não troca?', /paciente não pode ser trocado/.test(r.pat), r.pat);
  check('virar bloqueio = trocar paciente?', /paciente não pode ser trocado/.test(r.blk), r.blk);
  check('atendimento antigo sem código não acusa troca?', r.legacyId === '', r.legacyId);
  check('sem status nem evolução: livre?', r.free === '', r.free);
  check('com evolução (sem status): protegido?', /evolução/.test(r.evo), r.evo);
  check('Administrador move?', r.adminMoved === '', r.adminMoved);
  check('Administrador também não troca paciente?', /paciente não pode ser trocado/.test(r.adminPat), r.adminPat);

  const sp = await ev(`agdSplitByRecords([{id: "x1", status: "finalizado"}, {id: "x2", status: "nao-compareceu"}]).then(function(s){ return {del: s.del.length, kept: s.kept.length}; })`);
  check('excluir com status (não Administrador): ficam?', sp.del === 0 && sp.kept === 2, sp);
  check('mensagem fala de status?', /status/.test(await ev('AGD_KEPT_MSG')));

  // Item 3: evolução do atendimento Finalizado não é excluída (sem sistema online lê AD.rows / PR.records).
  const dc = await ev(`(function(){
    AD.rows = [{id: "f1", status: "finalizado"}, {id: "f2", status: null}];
    PR.records = [{id: "e1", appointment_id: "f1"}, {id: "e2", appointment_id: "f2"}];
    var out = {};
    return prDelFinalCheck(PR.records[0]).then(function(m){ out.final = m; return prDelFinalCheck(PR.records[1]); })
      .then(function(m){ out.semStatus = m; PR.records.push({id: "e3", appointment_id: "f1"}); return prDelFinalCheck(PR.records[0]); })
      .then(function(m){ out.duas = m; return prDelFinalCheck({id: "e9"}); })
      .then(function(m){ out.solta = m; return out; });
  })()`);
  check('evolução do Finalizado: recusa?', /tire o status Finalizado/.test(dc.final), dc.final);
  check('atendimento sem status: exclui?', dc.semStatus === '', dc.semStatus);
  check('outra evolução no mesmo atendimento: exclui?', dc.duas === '', dc.duas);
  check('evolução sem atendimento: exclui?', dc.solta === '', dc.solta);

  // Item 4: paciente com evolução, plano ou tarefa do CRM está "em uso" (vira Inativar).
  const pu = await ev(`(function(){
    var p = state.patients.filter(function(x){ return !treatmentsOf(x.id).length; })[0] || state.patients[0];
    PLAN.evoMem = [{id: "r1", patient_id: p.id}]; PLAN.mem = [{id: "pl1", patient_id: p.id}];
    CRM.mem.tasks = [{id: "t1", patient_id: p.id}];
    return USAGE.pacientes(p).then(function(u){ PLAN.evoMem = []; PLAN.mem = []; CRM.mem.tasks = []; return u.join(" | "); });
  })()`);
  check('paciente em uso por evolução, plano e tarefa?', /evolução no Prontuário/.test(pu) && /plano terapêutico/.test(pu) && /tarefa no CRM/.test(pu), pu);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
