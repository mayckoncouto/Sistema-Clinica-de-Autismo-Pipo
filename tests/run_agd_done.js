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
    AD.rows = {f1: {id: "f1", status: "finalizado"}, f2: {id: "f2", status: null}};
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

  // Item 5: mesclar com Plano Terapêutico vigente nos dois = não deixa; com um só, mostra o que passa.
  const mg = await ev(`(function(){
    window.pipoAuth = {isAdmin: function(){ return true; }, can: function(){ return true; }, canDefault: function(){ return true; }, profile: {}};
    var a = state.patients[0], b = state.patients[1];
    PLAN.rows = null; PLAN.mem = [{id: "v1", patient_id: a.id, status: "vigente"}, {id: "v2", patient_id: b.id, status: "vigente"}];
    CRM.mem.tasks = [{id: "t9", patient_id: b.id}];
    openPatientMergeModal();
    var k = document.getElementById("mgKeep"), d = document.getElementById("mgDrop");
    k.value = a.id; k.dispatchEvent(new Event("change")); d.value = b.id; d.dispatchEvent(new Event("change"));
    return new Promise(function(res){ setTimeout(function(){
      var out = {both: document.getElementById("mgPreview").textContent, bothDis: document.getElementById("mgGo").disabled};
      PLAN.rows = null; PLAN.mem = [{id: "v2", patient_id: b.id, status: "vigente"}];
      d.dispatchEvent(new Event("change"));
      setTimeout(function(){
        out.one = document.getElementById("mgPreview").textContent; out.oneDis = document.getElementById("mgGo").disabled;
        document.getElementById("modalHost").innerHTML = ""; PLAN.mem = []; PLAN.rows = null; CRM.mem.tasks = []; delete window.pipoAuth;
        res(out);
      }, 300);
    }, 300); });
  })()`);
  check('mesclar com dois planos vigentes: recusa?', /Plano Terapêutico vigente/.test(mg.both) && mg.bothDis, mg);
  check('mesclar: conta planos e tarefas do 2º?', /1 plano\(s\) terapêutico\(s\) e 1 tarefa\(s\) no CRM/.test(mg.one) && !mg.oneDis, mg.one);

  // Item 6: status do sistema só muda a cor; status em uso na Agenda não sai.
  const st = await ev(`(function(){
    openStatusItem({id: "finalizado", name: "Finalizado", color: "#2a7"});
    var out = {nameOff: document.getElementById("stiName").disabled, noDel: !document.getElementById("stiDel")};
    document.getElementById("modalHost").innerHTML = "";
    AD.rows = {a1: {id: "a1", status: "meu-status"}};
    return statusUseCount("meu-status").then(function(n){ out.used = n; AD.rows = {}; return out; });
  })()`);
  check('status do sistema: nome travado e sem Excluir?', st.nameOff && st.noDel, st);
  check('status em uso: conta os atendimentos?', st.used === 1, st);

  // Item 7: plano com evolução não é excluído; excluir a vigente reabre a anterior.
  const pl = await ev(`(function(){
    PLAN.mem = [{id: "v1", patient_id: "pa", version: 1, status: "encerrado"}, {id: "v2", patient_id: "pa", version: 2, status: "vigente", prev_id: "v1"},
                {id: "w1", patient_id: "pb", version: 1, status: "vigente"}];
    PLAN.rows = PLAN.mem; PLAN.evoMem = [{id: "e1", patient_id: "pb", plan_goals: [{planId: "w1", objId: "o1"}]}];
    var out = {};
    return planEvoUseCount("w1").then(function(n){ out.used = n; return planEvoUseCount("v2"); })
      .then(function(n){ out.free = n; return planDelete("v2"); })
      .then(function(){ out.reopened = (PLAN.mem.filter(function(r){ return r.id === "v1"; })[0] || {}).status; PLAN.mem = []; PLAN.rows = null; PLAN.evoMem = []; return out; });
  })()`);
  check('plano com evolução: em uso?', pl.used === 1 && pl.free === 0, pl);
  check('excluir a vigente: a anterior volta a valer?', pl.reopened === 'vigente', pl);

  // Item 8: grupo de suporte com atendimentos na Agenda (pelo código ou pelo nome) = em uso.
  const gr = await ev(`(function(){
    AD.rows = {a1: {id: "a1", group_id: "g1", patient: "Grupo X", room_id: "s1"}, a2: {id: "a2", patient: "grupo x", room_id: "s2"}, a3: {id: "a3", patient: "Outro", room_id: "g1"}};
    return Promise.all([USAGE.salas({id: "g1", name: "Grupo X", group: true}), apptGroupCount({id: "g2", name: "Nada"})])
      .then(function(r){ AD.rows = {}; return {uses: r[0], none: r[1]}; });
  })()`);
  check('grupo com atendimentos na Agenda: em uso (2)?', gr.uses.length === 1 && /^2 atendimentos/.test(gr.uses[0]) && gr.none === 0, gr);

  // Item 9: colaborador com evolução ou bloqueio de horário = em uso.
  const cb = await ev(`(function(){
    var saved = PLB.list; PLB.list = [{id: "b1", alvo: "prof", profId: "px"}];
    PLAN.evoMem = [{id: "e1", patient_id: "pa", professional_id: "px"}];
    return USAGE.profissionais({id: "px", nome: "Prof X"}).then(function(r){ PLB.list = saved; PLAN.evoMem = []; return r; });
  })()`);
  check('colaborador com evolução e bloqueio: em uso?', cb.indexOf('1 evolução no Prontuário') !== -1 && cb.indexOf('1 bloqueio de horário no Planner') !== -1, cb);

  // Item 10: especialidade, escala e habilidade contam o Banco de objetivos e os planos.
  const sp10 = await ev(`(function(){
    var gb = state.goalBank, profs = state.professionals, areas = state.skillAreas;
    state.goalBank = [{id: "g1", name: "Obj", areaId: "hab1", scaleId: "esc1", specIds: ["spx"]}];
    state.professionals = profs.concat([{id: "pz", nome: "Prof Z", specialtyId: "outra", complementares: ["spx"]}]);
    state.skillAreas = [{id: "hab1", name: "Hab", specIds: ["spx"]}];
    PLAN.mem = [{id: "p1", patient_id: "pa", version: 1, status: "vigente", sections: [{areaId: "hab1", objectives: [{id: "o1", specIds: ["spx"], scaleId: "esc1"}]}]}];
    PLAN.rows = null;
    return Promise.all([USAGE.especialidades({id: "spx"}), USAGE.escalas({id: "esc1"}), USAGE.habilidades({id: "hab1"})]).then(function(r){
      state.goalBank = gb; state.professionals = profs; state.skillAreas = areas; PLAN.mem = []; PLAN.rows = null; return r;
    });
  })()`);
  check('especialidade: complementar, habilidade, banco e plano?', sp10[0].join('|') === '1 profissional com ela como área complementar|1 habilidade (especialidade sugerida)|1 objetivo no Banco de objetivos|1 objetivo de plano terapêutico', sp10[0]);
  check('escala e habilidade: plano e banco?', sp10[1].length === 2 && sp10[2].length === 2 && /Banco/.test(sp10[1][1]) && /Banco/.test(sp10[2][1]), sp10);

  // Item 11: lista/status do CRM com tarefas não sai (conta as tarefas).
  const cl = await ev(`(function(){
    var saved = CRM.lists, savedT = CRM.tasks, toasts = [], st = window.showToast;
    CRM.lists = [{id: "lx", name: "Lista X", statuses: [{id: "s1", name: "S1"}, {id: "s2", name: "S2"}]}];
    CRM.tasks = {t1: {id: "t1", list_id: "lx", status: "s1"}, t2: {id: "t2", list_id: "lx", status: "s1"}};
    showToast = function(m){ toasts.push(m); };
    crmOpenListEdit(CRM.lists[0]);
    document.querySelectorAll('#crmLSts [data-sdel]')[0].click();
    document.getElementById('crmLDel').click();
    var left = document.querySelectorAll('#crmLSts [data-si]').length;
    document.getElementById("modalHost").innerHTML = ""; showToast = st; CRM.lists = saved; CRM.tasks = savedT;
    return {toasts: toasts, left: left};
  })()`);
  check('CRM: status e lista com tarefas não saem (com a contagem)?', cl.left === 2 && /2 tarefas/.test(cl.toasts[0] || '') && /2 tarefas/.test(cl.toasts[1] || ''), cl);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
