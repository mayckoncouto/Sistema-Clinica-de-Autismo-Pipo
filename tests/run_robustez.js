// Etapa 7 (robustez): 1) tratamentos gravam só o item alterado (patch_list);
// 2) "Enviar para a Agenda" avisa fora do horário do paciente / terapeuta diferente
// e deixa desmarcar; 3) resumo dos atendimentos pelo banco (com volta ao modo antigo);
// 4) inativar paciente oferece cancelar o tratamento ativo. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_rb.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  // 1) patch_list: só o alterado vai, excluído vai na lista de excluídos.
  const r1 = await ev(`(function(){
    state.treatments = [
      {id: "t1", patientId: "ana-azul", inicio: "2026-01-01", tipo: "novo", status: "ativo"},
      {id: "t2", patientId: "bruno-verde", inicio: "2026-01-01", tipo: "novo", status: "ativo"},
      {id: "t3", patientId: "carla-laranja", inicio: "2026-01-01", tipo: "novo", status: "ativo"}
    ];
    var calls = [], realDoc = db.doc.bind(db);
    db.doc = function(p){ var r = realDoc(p); if (p === "treatments/all") r.patchList2 = function(u, d){ calls.push({u: u.map(function(x){ return x.id; }), d: d}); return Promise.resolve(); }; return r; };
    var list = state.treatments.map(function(t){ return t.id === "t2" ? Object.assign({}, t, {obs: "mudou"}) : t; }).filter(function(t){ return t.id !== "t3"; })
      .concat([{id: "t4", patientId: "duda-vermelho", inicio: "2026-02-01", tipo: "novo", status: "ativo"}]);
    return writeTreatments(list).then(function(ok){ db.doc = realDoc; return {ok: ok, calls: calls}; });
  })()`);
  console.log('saving treatments sends only changed/new items and the deleted ids?', r1.ok === true && r1.calls.length === 1 &&
    JSON.stringify(r1.calls[0].u) === '["t2","t4"]' && JSON.stringify(r1.calls[0].d) === '["t3"]', JSON.stringify(r1));
  const r1b = await ev(`(function(){
    var sets = 0, realDoc = db.doc.bind(db);
    db.doc = function(p){ var r = realDoc(p); if (p === "treatments/all"){ var s0 = r.set; r.set = function(o){ sets++; return s0.call(r, o); };
      r.patchList = function(){ var e = new Error("function patch_list does not exist"); e.code = "nofunc"; return Promise.reject(e); }; } return r; };
    return writeTreatments(state.treatments.map(function(t){ return Object.assign({}, t, {obs: "x"}); })).then(function(ok){ db.doc = realDoc; return {ok: ok, sets: sets}; });
  })()`);
  console.log('without the SQL (no patch_list) it falls back to saving the whole list?', r1b.ok === true && r1b.sets === 1, JSON.stringify(r1b));

  // 2) Enviar para a Agenda: prévia com avisos e caixa para desmarcar.
  const r2 = await ev(`(function(){
    // Paciente Um com horário só de manhã na segunda e terapeuta fixo diferente (Bia) para Psicologia.
    state.treatments = [{id: "tp", patientId: "paciente-um", inicio: "2026-01-01", tipo: "novo", status: "ativo",
      horarios: {seg: {ativo: true, manha: {inicio: "07:20", fim: "08:00"}, tarde: {inicio: "", fim: ""}}},
      specHours: [{specId: "psico", hours: 4, profId: "bia-terapeuta"}]}];
    rebuildPatients();
    var fake = {from: function(){ var q = {select: function(){ return q; }, eq: function(){ return Promise.resolve({data: []}); }}; return q; }};
    agdClient = function(){ return fake; };
    return db.doc("schedule/seg-1").set({bookings: {"16:10|r1|r1-t1": {patient: "Paciente Um", service: "sessao"}}}).then(function(){
      return plannerSendPlan("seg", "1", "2030-01-07");
    }).then(function(plan){
      var w = plan.warns.filter(function(x){ return x.info.time === "16:10"; })[0];
      return {sent: plan.send.length, warn: w ? w.msgs : null};
    });
  })()`);
  console.log('preview flags "outside patient hours" and "different therapist"?', !!r2.warn && r2.warn.indexOf('Fora do horário do paciente') !== -1 && r2.warn.indexOf('Terapeuta diferente do tratamento') !== -1, JSON.stringify(r2));
  await ev(`openSendToAgendaModal()`);
  await page.waitForTimeout(300);
  await ev(`(function(){ var d = document.getElementById("sendDate"); d.value = "2030-01-07"; d.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(500);
  const before = await page.textContent('#sendOk');
  await page.click('#sendPreview [data-warn]');
  await page.waitForTimeout(100);
  const after = await page.textContent('#sendOk');
  console.log('unchecking a warned item removes it from the send count?', /Enviar \(\d+\)/.test(before) && (parseInt(before.match(/\d+/)[0], 10) - 1 === (parseInt((after.match(/\d+/) || ['0'])[0], 10))), before, after);
  // Período Mês na mesma janela (antigo "Gerar mês"); voltar para Semana.
  await ev(`(function(){ var m = document.getElementById("sendMode"); m.value = "mes"; m.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(300);
  const mesOk = await page.evaluate(() => !!document.getElementById('genMonth') && /Enviar para a Agenda/.test(document.querySelector('#ovGen h3').textContent) && document.getElementById('sendMode').value === 'mes');
  await ev(`(function(){ var m = document.getElementById("sendMode"); m.value = "semana"; m.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(300);
  const semOk = await page.evaluate(() => !!document.getElementById('sendDay') && document.getElementById('sendMode').value === 'semana');
  console.log('Enviar para a Agenda starts with Período and switches Semana ↔ Mês in the same window?', mesOk && semOk);
  await page.click('#sendCancel');

  // 3) Resumo do banco: rpc treatment_appt_summary com quantidade (n).
  const r3 = await ev(`(function(){
    TR.loading = false; TR.last = null;
    var rows = [{patient: "Ana Azul", d: "2020-01-02", prof: "bia-terapeuta", svc: "sessao", st: "finalizado", n: 2}];
    var fake = {rpc: function(){ return {range: function(){ return Promise.resolve({data: rows}); }}; }};
    agdClient = function(){ return fake; };
    return trLoadLast(true).then(function(){ var k = "ana-azul"; return {appts: (TR.appts[k] || []).length, done: (TR.done[k] || []).length}; });
  })()`);
  console.log('treatment summary comes grouped from the database (count expanded)?', r3.appts === 2 && r3.done === 2, JSON.stringify(r3));
  const r3b = await ev(`(function(){
    TR.loading = false; TR.last = null;
    var fake = {rpc: function(){ return {range: function(){ return Promise.resolve({error: {message: "Could not find the function public.treatment_appt_summary"}}); }}; },
      from: function(){ var q = {select: function(){ return q; }, eq: function(){ return q; }, lte: function(){ return q; }, order: function(){ return q; },
        range: function(){ return Promise.resolve({data: [{patient: "Bruno Verde", date: "2020-01-03", status: "finalizado", professional_id: "bia-terapeuta", service: "sessao"}]}); }}; return q; }};
    agdClient = function(){ return fake; };
    return trLoadLast(true).then(function(){ return (TR.appts["bruno-verde"] || []).length; });
  })()`);
  console.log('without the SQL it reads appointments one by one as before?', r3b === 1, r3b);
  await ev(`agdClient = function(){ return null; }`);

  // 4) Inativar paciente com tratamento ativo: pergunta e cancela com motivo.
  await ev(`(function(){
    state.treatments = [{id: "tb", patientId: "bruno-verde", inicio: "2026-01-01", tipo: "novo", status: "ativo"}];
    rebuildPatients();
    offerCancelActiveTreatment({id: "bruno-verde", nome: "Bruno Verde"});
  })()`);
  await page.waitForTimeout(200);
  console.log('inactivating a patient asks to cancel the active treatment?', await page.isVisible('#ovCancTr'));
  await page.click('#ctYes'); await page.waitForTimeout(100);
  console.log('cancelling requires a reason?', await page.isVisible('#ovCancTr'));
  await page.$eval('#ctMot', (s) => { s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#ctYes'); await page.waitForTimeout(200);
  const r4 = await ev(`(function(){ var t = state.treatments[0]; return {st: t.status, mot: t.motivoCancel, hist: (t.historico || []).length, statusEm: t.statusEm === trTodayIso()}; })()`);
  console.log('treatment becomes Cancelado with reason, date and history?', r4.st === 'cancelado' && !!r4.mot && r4.hist === 1 && r4.statusEm, JSON.stringify(r4));
  await ev(`offerCancelActiveTreatment({id: "bruno-verde", nome: "Bruno Verde"})`);
  await page.waitForTimeout(100);
  console.log('no question when there is no active treatment?', !(await page.isVisible('#ovCancTr')));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
