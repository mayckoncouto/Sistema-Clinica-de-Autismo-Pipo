// Planner: Conferência, Pacientes Faltando Sessões, Cópias, Imprimir, Substituir Terapeuta, Abrir Vaga, Limpar por Filtro e Copiar Semana.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_plt.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // Cenário: sala "Fonoaudiologia" com 2 colunas (f1 e f2, os dois fono); 3 pacientes
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('config/specialties').set({list: [{id: 'fono', name: 'Fonoaudiologia', sigla: 'FN'}]});
    await db.doc('config/professionals').set({list: [{id: 'f1', nome: 'Fono Um', name: 'Fono Um', specialtyId: 'fono'}, {id: 'f2', nome: 'Fono Dois', name: 'Fono Dois', specialtyId: 'fono'}]});
    await db.doc('config/rooms').set({list: [{id: 'rA', name: 'Fonoaudiologia', aba: false, color: 'teal', therapists: [{id: 'a1', name: 'Fono Um', professionalId: 'f1'}, {id: 'a2', name: 'Fono Dois', professionalId: 'f2'}]}]});
    await db.doc('patients/all').set({list: [{id: 'pa', nome: 'Paciente A', idade: 8}, {id: 'pb', nome: 'Paciente B', idade: 8}, {id: 'pc', nome: 'Paciente C', idade: 8}, {id: 'pd', nome: 'Paciente D', idade: 8}]});
    var ids = []; ['seg','ter','qua','qui','sex'].forEach(function(d){ for (var w = 1; w <= 4; w++) ids.push(d + '-' + w); });
    for (var k = 0; k < ids.length; k++) await db.doc('schedule/' + ids[k]).set({bookings: {}});
    await db.doc('schedule/seg-1').set({bookings: {'07:20|rA|a1': {patient: 'Paciente A', note: ''}, '08:00|rA|a1': {patient: 'Paciente B', note: ''}, '08:40|rA|a1': {patient: 'Paciente D', note: ''}, '08:40|rA|a2': {patient: 'Paciente C', note: ''}}});
    await db.doc('schedule/seg-2').set({bookings: {'07:20|rA|a1': {patient: 'Paciente A', note: ''}}});
  })()`);
  await page.waitForTimeout(600);
  await ev(`(function(){ state.treatments = [{id: 'ta', patientId: 'pa', inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem', specHours: [{id: 'la', specId: 'fono', hours: 4, service: 'sessao', aba: 'Não'}]}]; rebuildPatients(); })()`);
  const store = (p) => ev(`JSON.stringify((window.__STORE__[${JSON.stringify(p)}] || {}).bookings || {})`).then(JSON.parse);
  const confirmBoth = async () => {
    for (let k = 0; k < 2; k++) { await page.waitForSelector('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)'); await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)'); await page.waitForTimeout(250); }
    await page.waitForTimeout(400);
  };
  const openTool = async (id) => { await page.click('#plToolsBtn'); await page.waitForTimeout(150); await page.$eval('#' + id, (b) => b.click()); };
  const setSel = (id, v) => page.$eval('#' + id, (s, x) => { s.value = x; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const hidden = (id) => page.$eval('#' + id, (b) => b.hidden);

  // menu
  await page.click('#plToolsBtn');
  check('Planner tools visible and the Auto Planner buttons are gone?', !(await hidden('plConfBtn')) && !(await hidden('plMissBtn')) && !(await hidden('plCopiesBtn')) && !(await hidden('plSubBtn')) && !(await hidden('plVagaBtn')) && !(await hidden('plCopyWeekBtn')) && !(await hidden('plPrintBtn')) && !(await page.$('#apQualityBtn')) && !(await page.$('#autoPlannerBtn')) && !(await page.$('#apDraftsBtn')) && !(await page.$('#apSendPlannerBtn')) && !(await page.$('#mainTabs button[data-tab="autoplanner"]')));
  check('Limpar Semana became Limpar por Filtro; Imprimir e Exportar became Imprimir?', (await page.$eval('#plClearWeekBtn', (b) => b.textContent)) === 'Limpar por Filtro' && (await page.$eval('#plPrintBtn', (b) => b.textContent)) === 'Imprimir');
  await page.click('#plToolsBtn');

  // 1. Conferência do Planner
  await openTool('plConfBtn'); await page.waitForSelector('#ovApQ'); await page.waitForFunction(() => /Sessões Colocadas/.test(document.getElementById('apqOut').textContent));
  const conf = await page.innerText('#ovApQ');
  check('Conferência do Planner: title, 2 of 4 sessions for Paciente A, no Montar Proposta simulation?', /Conferência do Planner/.test(conf) && /Paciente A\s+\S+\s+4\s+2\s+-2/.test(conf.replace(/\n/g, ' ')) && /Pacientes Faltando Sessões/.test(conf) && !/Não Couberam/.test(conf), conf.replace(/\s+/g, ' ').slice(0, 300));
  // tempo real: alteração feita aqui e alteração vinda de outra pessoa atualizam a janela aberta
  const flat = () => page.$eval('#apqOut', (o) => o.innerText.replace(/\s+/g, ' '));
  await ev("applyBookingChanges({'seg-1': {'08:00|rA|a2': {patient: 'Paciente A', note: ''}}}, {patientHoursOk: true, routineOk: true, therapistOk: true, areaOk: true, tipoOk: true})");
  await page.waitForFunction(() => /Paciente A \S+ 4 3 -1/.test(document.getElementById('apqOut').innerText.replace(/\s+/g, ' ')), null, {timeout: 5000}).catch(() => {});
  const live1 = await flat();
  check('Conferência live: in-app change updates the open window (3 of 4)?', /Paciente A \S+ 4 3 -1/.test(live1) && /Atualizado às/.test(live1), live1.slice(0, 200));
  await ev("(async function(){ var db = await window.claude.use('db'); await db.doc('schedule/qua-3').set({bookings: {'07:20|rA|a1': {patient: 'Paciente A', note: ''}}}); })()");
  await page.waitForFunction(() => !/Paciente A \S+ 4 3/.test(document.getElementById('apqOut').innerText.replace(/\s+/g, ' ')), null, {timeout: 5000}).catch(() => {});
  const live2 = await flat();
  check('Conferência live: change from another person (other day) completes Paciente A?', !/Paciente A/.test(live2) && /completos/.test(live2), live2.slice(0, 200));
  // tratamento mudou (Contratadas): a janela aberta também se atualiza
  const trBak = await ev("JSON.stringify(state.treatments)");
  await ev("(async function(){ var pa = state.patients.filter(function(p){ return p.nome === 'Paciente A'; })[0]; var list = cloneJson(state.treatments); var t = list.filter(function(x){ return x.patientId === pa.id && x.status === 'ativo'; })[0]; t.specHours[0].hours = String((+t.specHours[0].hours || 0) + 2); var db = await window.claude.use('db'); await db.doc('treatments/all').set({list: list}); })()");
  await page.waitForFunction(() => /Paciente A \S+ 6 4 -2/.test(document.getElementById('apqOut').innerText.replace(/\s+/g, ' ')), null, {timeout: 5000}).catch(() => {});
  const live3 = await flat();
  check('Conferência live: treatment change (Contratadas) updates the open window (6 × 4)?', /Paciente A \S+ 6 4 -2/.test(live3), live3.slice(0, 200));
  check('Conferência has the "Fora do Horário" column?', /DIFERENÇA FORA DO HORÁRIO/i.test(live3) && /Paciente A \S+ 6 4 -2 0/.test(live3), live3.slice(0, 300));
  const foraN = await ev("(function(){ var o = patientSlotOk; patientSlotOk = function(){ return false; }; var q = plQuality(); patientSlotOk = o; return q.contr.map(function(c){ return c.fora + '/' + c.got; }).join(); })()");
  check('Fora do Horário counts the sessions outside the patient hours?', foraN === '4/4', foraN);
  const qb = await ev(`[quadroHoraBate({hora: "15:30", dia: "qua"}, "orientacao-familiar", "qua", "15:30"), quadroHoraBate({hora: "15:30", dia: "qua"}, "sessao", "qua", "15:30"), quadroHoraBate({hora: "15:30", dia: "qua"}, "orientacao-familiar", "ter", "15:30"), quadroHoraBate({hora: "15:30"}, "orientacao-familiar", "seg", "14:10")].join()`);
  check('Serviço no dia/horário do próprio quadro não conta como fora do horário (Sessão conta)?', qb === 'true,false,false,false', qb);
  await ev("(async function(){ var db = await window.claude.use('db'); await db.doc('treatments/all').set({list: " + trBak + "}); })()");
  await page.waitForTimeout(800);
  await ev("(async function(){ var db = await window.claude.use('db'); await db.doc('schedule/qua-3').set({bookings: {}}); })()");
  await ev("applyBookingChanges({'seg-1': {'08:00|rA|a2': null}}, {noHistory: true})");
  await page.waitForTimeout(900);
  await page.click('#apqClose');

  // 5. Pacientes Faltando Sessões
  await openTool('plMissBtn'); await page.waitForSelector('#ovPlMs table');
  const miss = await page.innerText('#ovPlMs');
  check('Faltando Sessões lists Paciente A with -2?', /Paciente A/.test(miss) && /-2/.test(miss), miss.replace(/\s+/g, ' ').slice(0, 200));
  await page.click('#ovPlMs [data-plt-x]');

  // 3. Imprimir no Planner
  await ev(`window.__printed = null; demPrintFrame = function(t, css, body){ window.__printed = {t: t, body: body}; };`);
  await openTool('plPrintBtn'); await page.waitForSelector('#ovApP');
  check('Imprimir modal says Planner (not Auto Planner)?', /Planner agora/.test(await page.innerText('#ovApP')) && !/Excel/.test(await page.innerText('#ovApP')));
  await page.click('#appPrintTher'); await page.waitForFunction(() => window.__ev('window.__printed') !== null);
  const pr = JSON.parse(await ev('JSON.stringify(window.__printed)'));
  check('Grade por Terapeuta printed from the real Planner?', pr.t === 'Grade por Terapeuta' && /Paciente A/.test(pr.body) && /1ª semana · Planner/.test(pr.body), pr.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));
  await page.click('#appCancel');

  // 2. Cópias do Planner
  await openTool('plCopiesBtn'); await page.waitForSelector('#ovPlCp #pcSave');
  await page.waitForFunction(() => document.querySelector('#pcSlot option'));
  await page.fill('#pcName', 'Antes da reorganização'); await page.click('#pcSave'); await page.waitForTimeout(500);
  const copy1 = await ev(`JSON.stringify(window.__STORE__["planner-copias/1"] || null)`).then(JSON.parse);
  check('copy 1 saved with name and the 4 bookings of seg-1?', copy1 && copy1.name === 'Antes da reorganização' && Object.keys((copy1.docs || {})['seg-1'] || {}).length === 4, JSON.stringify(copy1).slice(0, 120));
  await page.click('#ovPlCp [data-plt-x]');
  // muda o Planner (apaga Paciente A da semana 2) e restaura
  await ev(`(async function(){ var db = await window.claude.use('db'); await db.doc('schedule/seg-2').set({bookings: {}}); })()`);
  await page.waitForTimeout(400);
  await openTool('plCopiesBtn'); await page.waitForSelector('[data-pc-load="1"]');
  await page.click('[data-pc-load="1"]'); await confirmBoth();
  const seg2 = await store('schedule/seg-2');
  check('restore brought Paciente A back to seg-2?', seg2['07:20|rA|a1'] && seg2['07:20|rA|a1'].patient === 'Paciente A', JSON.stringify(seg2));
  const auto = await ev(`JSON.stringify(window.__STORE__["planner-copias/auto"] || null)`).then(JSON.parse);
  check('automatic copy of the previous state saved?', auto && /antes de restaurar/.test(auto.name), auto && auto.name);
  await ev(`bookingHistory.undo.length`).then((n) => check('restore went into undo?', n > 0, n));
  await page.waitForFunction(() => !document.getElementById('ovPlCp'));

  // 6. Abrir Vaga
  await openTool('plVagaBtn'); await page.waitForSelector('#pvGo'); await page.$eval('#pvSpec', (s) => { s.value = 'fono'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#pvGo'); await page.waitForFunction(() => document.querySelectorAll('#pvOut .fr-slot').length > 0);
  const vg = await page.innerText('#pvOut');
  check('Abrir Vaga lists free slots and the movers section?', /vagas livres|vaga livre/i.test(vg) && /Quem Poderia Mudar de Lugar/i.test(vg), vg.replace(/\s+/g, ' ').slice(0, 200));
  check('occupied cells are not offered (seg-1 07:20 a1)?', !(await page.$$eval('#pvOut .fr-slot', (a) => a.some((b) => /07:20 Fono Um/.test(b.textContent) && /1ª semana/.test(b.closest('details').querySelector('summary').textContent) && /Segunda/.test(b.closest('.fr-day').textContent)))));
  // janela só às 07:20: quem ocupa esse horário e tem outro lugar livre aparece em "Quem Poderia Mudar de Lugar"
  await setSel('pvFrom', '07:20'); await setSel('pvTo', '07:20');
  await page.click('#pvGo'); await page.waitForSelector('#pvOut tr[data-mv]');
  const mv = await page.innerText('#pvOut');
  check('movers table lists Paciente A (07:20 today, other slots free)?', /Paciente A/.test(mv) && /Poderia Ir Para/i.test(mv), mv.replace(/\s+/g, ' ').slice(-200));
  await page.click('#ovPlVg [data-plt-x]');

  // 8. Copiar Semana (1ª → 3ª)
  await openTool('plCopyWeekBtn'); await page.waitForSelector('#cwPrev');
  await page.$eval('#cwFrom', (s) => { s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate(() => { document.querySelectorAll('#cwTo input').forEach((c) => { c.checked = c.getAttribute('data-pw') === '3'; }); });
  await page.click('#cwPrev'); await page.waitForFunction(() => /serão copiadas|será copiada/.test(document.getElementById('cwOut').textContent));
  check('Copiar Semana preview: 4 copied', /4 de 4/.test(await page.innerText('#cwOut')), (await page.innerText('#cwOut')).replace(/\s+/g, ' ').slice(0, 120));
  await page.click('#cwApply'); await confirmBoth();
  const s3 = await store('schedule/seg-3');
  check('seg-3 got the 4 bookings (same cells)?', Object.keys(s3).filter((k) => s3[k].patient).length === 4 && s3['08:40|rA|a2'].patient === 'Paciente C', JSON.stringify(Object.keys(s3)));

  // 7. Limpar por Filtro: só o Paciente A da 3ª semana
  await openTool('plClearWeekBtn'); await page.waitForSelector('#pcApply');
  await page.evaluate(() => { document.querySelectorAll('#pcW input').forEach((c) => { c.checked = c.getAttribute('data-pw') === '3'; }); });
  await page.$eval('#pcPat', (s) => { s.value = 'pa'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => /1 marcação será apagada/.test(document.getElementById('pcOut').textContent));
  await page.click('#pcApply'); await confirmBoth();
  const s3b = await store('schedule/seg-3');
  check('only Paciente A removed from the 3rd week?', !s3b['07:20|rA|a1'] || !s3b['07:20|rA|a1'].patient, JSON.stringify(Object.keys(s3b).filter((k) => s3b[k].patient)));
  check('others stayed in the 3rd week?', Object.keys(s3b).filter((k) => s3b[k].patient).length === 3);

  // 4. Substituir Terapeuta: f1 → f2 na 1ª semana (08:40 do f2 está ocupado por Paciente C, então Paciente D fica)
  await openTool('plSubBtn'); await page.waitForSelector('#psPrev');
  await setSel('psFrom', 'f1'); await setSel('psTo', 'f2');
  await page.evaluate(() => { document.querySelectorAll('#psW input').forEach((c) => { c.checked = c.getAttribute('data-pw') === '1'; }); });
  await page.click('#psPrev'); await page.waitForFunction(() => /passam para|passa para/.test(document.getElementById('psOut').textContent));
  const so = await page.innerText('#psOut');
  check('Substituir preview: 2 of 3 move, Paciente D stays (cell taken)?', /2 de 3/.test(so) && /Paciente D/.test(so) && /Horário já ocupado/.test(so), so.replace(/\s+/g, ' ').slice(0, 260));
  await page.click('#psApply'); await confirmBoth();
  const s1 = await store('schedule/seg-1');
  check('Paciente A and B now in Fono Dois; D still in Fono Um; C untouched?', s1['07:20|rA|a2'] && s1['07:20|rA|a2'].patient === 'Paciente A' && s1['08:00|rA|a2'].patient === 'Paciente B' && s1['08:40|rA|a1'].patient === 'Paciente D' && s1['08:40|rA|a2'].patient === 'Paciente C' && !(s1['07:20|rA|a1'] && s1['07:20|rA|a1'].patient), JSON.stringify(s1));
  const s2n = await store('schedule/seg-2');
  check('other weeks not touched by the substitution?', s2n['07:20|rA|a1'] && s2n['07:20|rA|a1'].patient === 'Paciente A');

  // 5b. Pacientes Faltando Sessões: o botão Sugerir abre o Sugerir Agendamento já no paciente
  await openTool('plMissBtn'); await page.waitForSelector('#ovPlMs [data-pm-sug]');
  check('Faltando Sessões has Sugerir and no Auto Planner button?', !(await page.$('#pmAuto')) && !!(await page.$('#ovPlMs [data-pm-sug]')));
  const sugPid = await page.$eval('#ovPlMs [data-pm-sug]', (b) => b.getAttribute('data-pm-sug'));
  await page.click('#ovPlMs [data-pm-sug]'); await page.waitForSelector('#ovPlSg');
  await page.waitForFunction(() => !/Escolha um paciente|Analisando/.test(document.getElementById('sgOut').textContent), null, {timeout: 5000}).catch(() => {});
  check('Sugerir opened on that patient?', (await page.$eval('#sgPat', (e) => e.value)) === sugPid, sugPid);
  await page.$eval('#ovPlSg [data-plt-x]', (b) => b.click());

  check('no JS errors?', errors.length === 0, errors.join('|'));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
