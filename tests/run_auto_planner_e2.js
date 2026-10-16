// Auto Planner, etapa 2: serviços fora de Sessão primeiro, meta de grupo, nível de suporte, "Não Agrupar com",
// tamanho do grupo por sala, horário vago por sala e Aplicador ABA nos grupos de 3 ou 4.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ap2.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);

  // Cenário: sala ABA com 4 colunas (Fono), sala dupla com 2 colunas, grupo de suporte com um Aplicador ABA
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('config/specialties').set({list: [{id: 'fono', name: 'Fonoaudiologia', sigla: 'FN'}, {id: 'aplic', name: 'Aplicador ABA'}]});
    var profs = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map(function(id){ return {id: id, name: id.toUpperCase(), specialtyId: 'fono'}; });
    profs.push({id: 'ap1', name: 'Aplic', specialtyId: 'aplic'});
    await db.doc('config/professionals').set({list: profs});
    await db.doc('config/rooms').set({list: [
      {id: 'rA', name: 'Fonoaudiologia ABA', aba: true, color: 'teal', therapists: ['f1', 'f2', 'f3', 'f4'].map(function(f){ return {id: 'rA-' + f, name: f, professionalId: f}; })},
      {id: 'rB', name: 'Fonoaudiologia', aba: false, color: '#2255aa', therapists: ['f5', 'f6'].map(function(f){ return {id: 'rB-' + f, name: f, professionalId: f}; })},
      {id: 'sup', name: 'Aplicador ABA', color: 'slate', group: true, therapists: [{id: 'sup-t1', name: 'Aplic', professionalId: 'ap1'}]}
    ]});
    var pats = [];
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function(x){ pats.push({id: 'p' + x, nome: 'Paciente ' + x.toUpperCase(), idade: 12, nascimento: '', aba: 'Sim'}); });
    await db.doc('patients/all').set({list: pats});
  })()`);
  await page.waitForTimeout(500);
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForTimeout(400);
  const setTr = (list) => ev(`(function(){ state.treatments = ${JSON.stringify(list)}.map(function(t){ return Object.assign({inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem'}, t); }); rebuildPatients(); })()`);
  const tr = (id, extra, lineExtra) => Object.assign({ id: 't' + id, patientId: id, specHours: [Object.assign({ id: 'l' + id, specId: 'fono', hours: 4, service: 'sessao', aba: 'Sim' }, lineExtra || {})] }, extra || {});
  const build = (ids, opts) => ev(`(function(){ var plan = apBuild(state.patients.filter(function(p){ return ${JSON.stringify(ids)}.indexOf(p.id) !== -1; }), ${JSON.stringify(opts || {})});
    return JSON.stringify({items: plan.items.map(function(it){ return {p: it.p.id, w: it.w, day: it.day, time: it.time, room: it.room.id, prof: it.prof.id, svc: it.rec.service, group: it.group}; }),
      goal: plan.goal.map(function(g){ return {p: g.p.id, total: g.total, group: g.group, ok: g.ok}; }), support: plan.support.map(function(s){ return {room: s.room.id, size: s.size, time: s.time, w: s.w}; }),
      cap: plan.capacity.map(function(c){ return [c.specId, c.need, c.free, c.placed]; }), gaps: plan.gaps.length}); })()`).then(JSON.parse);

  // 1) serviços que não são Sessão vêm antes das Sessões
  await setTr([{ id: 'ta', patientId: 'pa', specHours: [{ id: 'l1', specId: 'fono', hours: 2, service: 'sessao', aba: 'Não' }, { id: 'l2', specId: 'fono', hours: 1, service: 'avaliacao', aba: 'Não', dia: 'seg', hora: '07:20', semanas: '1' }] }]);
  let r = await build(['pa']);
  check('service other than Sessão is placed first?', r.items[0] && r.items[0].svc === 'avaliacao', JSON.stringify(r.items.map((x) => x.svc)));

  // 2) meta de grupo: 4 pacientes ABA Sim da mesma faixa, 4 sessões cada → 3 em grupo (75%)
  await setTr(['pa', 'pb', 'pc', 'pd'].map((id) => tr(id)));
  r = await build(['pa', 'pb', 'pc', 'pd']);
  check('group goal reported for each patient?', r.goal.length === 4, JSON.stringify(r.goal));
  check('every patient at 80% in group (3 of 4)?', r.goal.every((g) => g.total === 4 && g.group === 3 && g.ok), JSON.stringify(r.goal));
  check('capacity table lists Fono with sessions to place?', r.cap.length === 1 && r.cap[0][0] === 'fono' && r.cap[0][1] === 16, JSON.stringify(r.cap));

  // 3) grupos nunca passam de 4 na sala de 4 colunas nem de 2 na sala dupla
  const maxBy = {};
  r.items.forEach((x) => { const k = x.w + x.day + x.time + x.room; maxBy[k] = (maxBy[k] || 0) + 1; });
  check('group size within 4 in the 4-column room?', Object.keys(maxBy).filter((k) => /rA$/.test(k)).every((k) => maxBy[k] <= 4));
  check('group size within 2 in the 2-column room?', Object.keys(maxBy).filter((k) => /rB$/.test(k)).every((k) => maxBy[k] <= 2));

  // 4) Não Agrupar com
  await ev(`state.patients.forEach(function(p){ p.suporte = 'Nível 2'; })`);
  await setTr([tr('pa', { naoAgrupar: ['pb'] }, { hours: 2, dia: 'seg', hora: '07:20', semanas: '1,2' }), tr('pb', null, { hours: 2, dia: 'seg', hora: '07:20', semanas: '1,2' })]);
  await ev(`state.patients.forEach(function(p){ p.suporte = 'Nível 2'; })`);
  r = await build(['pa', 'pb']);
  const slots = {}; r.items.forEach((x) => { (slots[x.w + x.time + x.room] = slots[x.w + x.time + x.room] || []).push(x.p); });
  check('"Não Agrupar com" keeps the two apart (both ways)?', r.items.length === 4 && !Object.values(slots).some((l) => l.length > 1), JSON.stringify(slots));

  // 5) nível de suporte: A(2) e B(2) juntos, C(3) fora, na sala dupla
  await ev(`(async function(){ var db = await window.claude.use('db'); var rooms = JSON.parse(JSON.stringify(window.__STORE__['config/rooms'])); rooms.list = rooms.list.filter(function(x){ return x.id !== 'rA'; }); await db.doc('config/rooms').set(rooms); })()`);
  await page.waitForTimeout(400);
  await setTr(['pa', 'pb', 'pc'].map((id) => tr(id, null, { hours: 2, dia: 'seg', hora: '07:20', semanas: '1,2' })));
  await ev(`state.patients.forEach(function(p){ if (p.id === 'pa' || p.id === 'pb') p.suporte = 'Nível 2'; if (p.id === 'pc') p.suporte = 'Nível 3'; })`);
  r = await build(['pa', 'pb', 'pc']);
  const bySlot = {}; r.items.forEach((x) => { (bySlot[x.w + x.time + x.room] = bySlot[x.w + x.time + x.room] || []).push(x.p); });
  check('same support level share the room (A with B, C apart)?', Object.values(bySlot).some((l) => l.includes('pa') && l.includes('pb')) && !Object.values(bySlot).some((l) => l.includes('pc') && l.length > 1), JSON.stringify(bySlot));

  // 6) um horário vago por sala por turno: sala Dupla com a manhã cheia na coluna F5, menos o último horário
  await ev(`(async function(){ var db = await window.claude.use('db'); var d = await db.doc('schedule/seg-1').get(); })()`);
  const morning = await ev(`JSON.stringify(DAYS.filter(function(d){ return d.key === 'seg'; })[0].morning)`);
  const mt = JSON.parse(morning);
  await setTr([tr('pa', null, { hours: 1, aba: 'Não', dia: 'seg', semanas: '1' })]);
  await ev(`(function(){
    var times = ${morning}; var bk = {};
    times.slice(0, -1).forEach(function(t, i){ ["rB-f5", "rB-f6"].forEach(function(c, j){ bk[t + "|rB|" + c] = {patient: "Paciente E" + j, patientId: "pe" + j, note: "", service: "sessao"}; }); });
    state.scheduleDocs["seg-1"] = {bookings: bk};
    window.__apFill = true;
  })()`);
  r = await build(['pa']);
  const placed = r.items[0];
  check('keeps one empty morning time in the room (goes to the afternoon, not the last free morning time)?', placed && mt.indexOf(placed.time) === -1, JSON.stringify(placed));

  // 7) Aplicador ABA nos grupos de 3 ou 4 (sala ABA de volta)
  await ev(`(async function(){ var db = await window.claude.use('db'); var rooms = JSON.parse(JSON.stringify(window.__STORE__['config/rooms'])); rooms.list.unshift({id: 'rA', name: 'Fonoaudiologia ABA', aba: true, color: 'teal', therapists: ['f1', 'f2', 'f3', 'f4'].map(function(f){ return {id: 'rA-' + f, name: f, professionalId: f}; })}); await db.doc('config/rooms').set(rooms); })()`);
  await page.waitForTimeout(400);
  await ev(`state.scheduleDocs = {}`);
  await ev(`plannerAllDocIds().forEach(function(id){ state.scheduleDocs[id] = {bookings: {}}; })`);
  await setTr(['pa', 'pb', 'pc'].map((id) => tr(id, null, { hours: 2, dia: 'seg', hora: '07:20', semanas: '1,2' })));
  await ev(`state.patients.forEach(function(p){ p.suporte = 'Nível 2'; })`);
  r = await build(['pa', 'pb', 'pc']);
  check('group of 3 in the ABA room → Aplicador ABA proposed for each group?', r.support.length >= 1 && r.support.every((s) => s.size >= 3), JSON.stringify(r.support));
  r = await build(['pa', 'pb', 'pc'], { support: false });
  check('support option off → none proposed?', r.support.length === 0);

  // 9) só 2 sessões no mês: semanas alternadas (1ª e 3ª)
  await ev(`state.scheduleDocs = {}; plannerAllDocIds().forEach(function(id){ state.scheduleDocs[id] = {bookings: {}}; })`);
  await setTr([tr('pa', null, { hours: 2, aba: 'Não', specId: 'fono' })]);
  r = await build(['pa']);
  check('2 sessions in the month → alternate weeks (1 and 3)?', r.items.map((x) => x.w).sort().join() === '1,3', JSON.stringify(r.items.map((x) => x.w)));
  // com uma sessão já na 2ª semana, a outra vai para a 4ª
  await ev(`state.scheduleDocs["seg-2"] = {bookings: {"07:20|rB|rB-f6": {patient: "Paciente A", patientId: "pa", note: "", service: "sessao"}}}`);
  r = await build(['pa']);
  check('one already in week 2 → the other goes to week 4?', r.items.length === 1 && r.items[0].w === 4, JSON.stringify(r.items.map((x) => x.w)));
  await ev(`plannerAllDocIds().forEach(function(id){ state.scheduleDocs[id] = {bookings: {}}; })`);

  // 10) o Horário de Atendimento do paciente vale sempre, até com horário no quadro
  await setTr([tr('pa', null, { hours: 1, aba: 'Não', dia: 'seg', hora: '09:20', semanas: '1' })]);
  await ev(`state.patients.forEach(function(p){ if (p.id === 'pa') p.horarios = {seg: {ativo: true, tarde: {inicio: '13:30', fim: '18:10'}}}; })`);
  r = await build(['pa']);
  check('quadro time outside the patient availability is never suggested?', r.items.length === 0, JSON.stringify(r.items));
  await setTr([tr('pa', null, { hours: 1, aba: 'Não', dia: 'seg', semanas: '1' })]);
  await ev(`state.patients.forEach(function(p){ if (p.id === 'pa') p.horarios = {seg: {ativo: true, tarde: {inicio: '13:30', fim: '18:10'}}}; })`);
  r = await build(['pa']);
  check('quadro without time → follows the patient availability (afternoon)?', r.items.length === 1 && r.items[0].time >= '13:30', JSON.stringify(r.items));

  // 8) Montar Proposta exige "Pacientes – Saúde": sem a permissão não abre
  const gate = await ev(`(function(){ window.pipoAuth = {can: function(m, a){ return m === "saude_paciente" ? false : true; }, isAdmin: function(){ return false; }}; openAutoPlannerModal(); var open = !!document.getElementById("ovAp"); delete window.pipoAuth; return open; })()`);
  check('without Pacientes – Saúde the proposal window does not open?', gate === false, gate);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
