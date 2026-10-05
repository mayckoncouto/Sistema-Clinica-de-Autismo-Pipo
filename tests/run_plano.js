// Plano terapêutico: menu Prontuário ▾, cadastros de Escalas e Habilidades,
// quadros por especialidade vindos do tratamento, objetivos com ▲▼, último nível
// da escala = Atingido, revisão com nova versão, modo do profissional e áreas
// complementares no colaborador. Sem sistema online os planos ficam na memória.
// Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_plano.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  const setv = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  // Menus: Prontuário ▾ com Prontuário, Plano terapêutico e os cadastros do plano.
  const menus = await ev(`(function(){ renderNavMenus(); return {
    pr: Array.prototype.map.call(document.querySelectorAll("#prMenu [data-nav]"), function(b){ return b.textContent; }),
    cad: Array.prototype.map.call(document.querySelectorAll("#cadMenu [data-nav]"), function(b){ return b.getAttribute("data-nav"); }) }; })()`);
  console.log('Prontuário menu has Prontuário, Plano terapêutico and its registries?', JSON.stringify(menus.pr) === '["Prontuário","Plano terapêutico","Banco de objetivos","Escalas","Habilidades"]', JSON.stringify(menus.pr));
  console.log('Escalas and Habilidades left Cadastros?', menus.cad.indexOf('escalas') === -1 && menus.cad.indexOf('habilidades') === -1);

  // Escalas: Likert e ABA pré-cadastradas, com cor; habilidades pré-cadastradas.
  await page.$eval('#mainTabs button[data-tab=escalas]', (b) => b.click()); await page.waitForTimeout(200);
  const scRows = await page.$$eval('#reg-escalas-host tbody tr', (r) => r.map((x) => x.cells[0].textContent.trim()));
  console.log('Escalas lists Likert and ABA?', scRows.join(',') === 'ABA,Likert', JSON.stringify(scRows));
  const lik = await ev('JSON.stringify(scaleById("likert").levels.map(function(l){ return l.name; }))');
  console.log('Likert has 6 levels 0..5?', JSON.parse(lik).length === 6 && JSON.parse(lik)[5] === '5 – Independente', lik);
  await page.click('#reg-escalas-host tbody tr:nth-child(2)'); await page.waitForSelector('#ovScale');
  const lvCount = await page.$$eval('#scLevels .sc-level', (r) => r.length);
  const finalTag = await page.$eval('#scLevels .sc-level:last-child', (e) => !!e.querySelector('.sc-final'));
  console.log('scale window shows levels with the last marked "final"?', lvCount === 6 && finalTag, lvCount);
  await page.click('#scCancel');
  await page.$eval('#mainTabs button[data-tab=habilidades]', (b) => b.click()); await page.waitForTimeout(200);
  const nAreas = await page.$$eval('#reg-habilidades-host tbody tr', (r) => r.length);
  console.log('8 skill areas pre-registered?', nAreas === 8, nAreas);

  // Plano novo para Bruno Verde (tratamento com Psicologia e Fonoaudiologia).
  await page.$eval('#mainTabs button[data-tab=planos]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#planAdd'); await page.waitForSelector('#ovPlanPick');
  await setv('#ppPat', 'bruno-verde');
  await page.click('#ppOk'); await page.waitForSelector('#ovPlan');
  const specs = await page.$$eval('#plSecs .pl-spec', (r) => r.map((x) => x.getAttribute('data-spec')));
  console.log('quadros come from the treatment (psico, fono)?', specs.join(',') === 'psico,fono', specs.join(','));
  const rev = await page.$eval('#plReview', (e) => e.value);
  const exp = await ev('trAddMonths(trTodayIso(), 6)');
  console.log('review date = plan date + 6 months?', rev === exp, rev);
  // 3 objetivos em Fonoaudiologia
  for (let k = 0; k < 3; k++){
    await page.click('#plSecs [data-spec="fono"] [data-add-obj]');
    const row = '#plSecs [data-spec="fono"] tbody tr:last-child';
    await page.fill(row + ' textarea[data-f="objetivo"]', 'Objetivo ' + (k + 1));
    await setv(row + ' select[data-f="areaId"]', 'comunicacao');
  }
  const nums = await page.$$eval('#plSecs [data-spec="fono"] .pl-num b', (r) => r.map((x) => x.textContent).join(','));
  console.log('Nº is automatic (1,2,3)?', nums === '1,2,3', nums);
  // ▼ no 1º: troca de lugar com o 2º, número continua pela posição
  await page.click('#plSecs [data-spec="fono"] tbody tr:nth-child(1) [data-mv="1"]');
  const order = await page.$$eval('#plSecs [data-spec="fono"] textarea[data-f="objetivo"]', (r) => r.map((x) => x.value).join('|'));
  console.log('▼ moves the row and renumbers?', order === 'Objetivo 2|Objetivo 1|Objetivo 3', order);
  // último nível da escala = Atingido
  await setv('#plSecs [data-spec="fono"] tbody tr:nth-child(1) select[data-f="levelId"]', '5');
  const st1 = await page.$eval('#plSecs [data-spec="fono"] tbody tr:nth-child(1) select[data-f="status"]', (e) => e.value);
  console.log('last level of the scale sets status Atingido?', st1 === 'atingido', st1);
  // escala ABA no 2º: níveis trocam; "Adquirida" = atingido
  await setv('#plSecs [data-spec="fono"] tbody tr:nth-child(2) select[data-f="scaleId"]', 'aba');
  const abaOpts = await page.$$eval('#plSecs [data-spec="fono"] tbody tr:nth-child(2) select[data-f="levelId"] option', (r) => r.map((x) => x.value).join(','));
  console.log('Situação follows the chosen scale (ABA levels)?', abaOpts === 'nao-adquirida,parcial,adquirida', abaOpts);
  await page.fill('#plSummary', 'Resumo fictício do quadro clínico.');
  await page.click('#plSave'); await page.waitForTimeout(300);
  const saved = await ev('JSON.stringify(planVigente("bruno-verde"))');
  const sp = JSON.parse(saved);
  console.log('plan saved with only the sections that have objectives?', sp && sp.sections.length === 1 && sp.sections[0].specId === 'fono' && sp.sections[0].objectives.length === 3 && sp.summary.indexOf('fictício') !== -1);
  const listRow = await page.$$eval('#planListHost tbody tr', (r) => r.map((x) => x.cells[0].textContent + '|' + x.cells[4].textContent));
  console.log('list shows the plan with objective counts?', listRow.length === 1 && listRow[0].indexOf('Bruno Verde|2 ativos · 1 atingido') === 0, JSON.stringify(listRow));

  // Revisão vencida aparece na coluna Revisão.
  await ev('(function(){ var r = planVigente("bruno-verde"); r.review_date = "2020-01-01"; renderPlansTab(); })()');
  const due = await page.$eval('#planListHost tbody tr td:nth-child(4)', (e) => e.textContent);
  console.log('Revisão column warns when the review is overdue?', /Vencida em 01\/01\/2020/.test(due), due);

  // Revisar: nova versão; a anterior fica encerrada.
  await page.click('#planListHost tbody tr'); await page.waitForSelector('#ovPlan');
  await page.click('#plRevise'); await page.waitForSelector('#cfOk');
  await page.click('#cfOk'); await page.waitForTimeout(400);
  const vers = await ev('JSON.stringify(planVersions("bruno-verde").map(function(r){ return r.version + ":" + r.status; }))');
  console.log('Revisar creates v2 vigente and keeps v1 encerrado?', vers === '["2:vigente","1:encerrado"]', vers);
  const verBtn = await page.$$eval('#ovPlan [data-ver]', (r) => r.length);
  console.log('previous version listed in the window?', verBtn === 1);
  await page.click('#plCancel');

  // Modo do profissional: Bia (Fonoaudiologia, complementar Psicologia).
  await ev('(function(){ state.professionals = state.professionals.map(function(p){ return p.id === "bia-terapeuta" ? Object.assign({}, p, {complementares: ["psico"]}) : p; }); window.__planProfId = "bia-terapeuta"; })()');
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#ovPlan');
  const profUi = await page.evaluate(() => {
    const f = document.querySelector('#plSecs [data-spec="fono"] tbody tr');
    return {
      objDisabled: f.querySelector('textarea[data-f="objetivo"]').disabled,
      levelEnabled: !f.querySelector('select[data-f="levelId"]').disabled,
      noMove: !document.querySelector('#plSecs [data-mv]'),
      addFono: !!document.querySelector('#plSecs [data-spec="fono"] [data-add-obj]'),
      addPsico: !!document.querySelector('#plSecs [data-spec="psico"] [data-add-obj]'),
      summaryDisabled: document.getElementById('plSummary').disabled
    };
  });
  console.log('professional: only Situação/Status editable, no ▲▼, add only in the main specialty?',
    profUi.objDisabled && profUi.levelEnabled && profUi.noMove && profUi.addFono && !profUi.addPsico && profUi.summaryDisabled, JSON.stringify(profUi));
  await page.click('#plCancel');
  await ev('window.__planProfId = null');

  // Colaborador: áreas complementares gravadas no profissional.
  await ev('(function(){ state.professionals = state.professionals.map(function(p){ return p.id === "ana-terapeuta" ? Object.assign({}, p, {complementares: []}) : p; }); })()');
  await ev('openProfessionalModal(state.professionals.filter(function(p){ return p.id === "ana-terapeuta"; })[0])'); await page.waitForSelector('#ovProf');
  await page.click('#sfComplAdd');
  await setv('#sfCompl select[data-compl="0"]', 'fono');
  await page.click('#profSave'); await page.waitForTimeout(400);
  const compl = await ev('JSON.stringify((state.professionals.filter(function(p){ return p.id === "ana-terapeuta"; })[0] || {}).complementares)');
  console.log('Áreas complementares saved on the professional?', compl === '["fono"]', compl);

  // Aviso de área: profissional fora das especialidades do tratamento (Bruno: psico + fono).
  await ev('(function(){ state.professionals = state.professionals.concat([{id: "tito", name: "Tito", specialtyId: "to"}]); })()');
  const m1 = await ev('areaMismatchMsg("Bruno Verde", "tito", "sessao")');
  const m2 = await ev('areaMismatchMsg("Bruno Verde", "bia-terapeuta", "sessao")');
  const m3 = await ev('areaMismatchMsg("Bruno Verde", "tito", "avaliacao")');
  await ev('(function(){ state.professionals = state.professionals.map(function(p){ return p.id === "tito" ? Object.assign({}, p, {complementares: ["fono"]}) : p; }); })()');
  const m4 = await ev('areaMismatchMsg("Bruno Verde", "tito", "sessao")');
  console.log('area warning: other specialty warns; main, other service or complementary area do not?', !!m1 && !m2 && !m3 && !m4, m1);
  await ev('(function(){ state.professionals = state.professionals.map(function(p){ return p.id === "tito" ? Object.assign({}, p, {complementares: []}) : p; }); state.rooms = state.rooms.map(function(r){ return r.id !== "r1" ? r : Object.assign({}, r, {therapists: r.therapists.map(function(t){ return t.id === "r1-t1" ? Object.assign({}, t, {professionalId: "tito"}) : t; })}); }); applyBookingChanges({"seg-1": {"09:20|r1|r1-t1": {patient: "Bruno Verde", note: ""}}}); })()');
  await page.waitForSelector('#cfTitle');
  const cfT = await page.$eval('#cfTitle', (e) => e.textContent);
  console.log('Planner asks before booking outside the treatment specialties?', /fora das especialidades/.test(cfT), cfT);
  await page.click('#cfCancel'); await page.waitForTimeout(200);
  const notSaved = await ev('!((state.scheduleDocs["seg-1"] || {}).bookings || {})["09:20|r1|r1-t1"]');
  console.log('cancel keeps the slot empty?', notSaved);

  // Banco de objetivos: cadastro, sugestão no campo Objetivo e "+ Salvar no Banco".
  await page.$eval('#mainTabs button[data-tab=objetivos]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#reg-objetivos-add'); await page.waitForSelector('#ovGoal');
  await page.fill('#glName', 'Nomear 10 objetos do cotidiano');
  await setv('#glArea', 'comunicacao'); await setv('#glSpec', 'fono');
  await page.fill('#glCrit', '8 de 10 tentativas');
  await setv('#glScale', 'aba');
  await page.click('#glSave'); await page.waitForTimeout(300);
  const bankRows = await page.$$eval('#reg-objetivos-host tbody tr', (r) => r.map((x) => x.cells[0].textContent.trim()));
  console.log('goal saved in the bank?', bankRows.join() === 'Nomear 10 objetos do cotidiano', JSON.stringify(bankRows));
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#ovPlan');
  await page.click('#plSecs [data-spec="fono"] [data-add-obj]');
  const lastFono = '#plSecs [data-spec="fono"] tbody tr:last-child';
  await page.type(lastFono + ' textarea[data-f="objetivo"]', 'nomear obj');
  await page.waitForSelector('.pl-goal-pop:not([hidden]) [data-goal]');
  const sugg = await page.$$eval('.pl-goal-pop [data-goal]', (r) => r.map((x) => x.textContent));
  console.log('typing suggests the bank goal (no accents/case)?', sugg.length === 1 && /Nomear 10 objetos/.test(sugg[0]), JSON.stringify(sugg));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const applied = await page.evaluate((sel) => { const tr = document.querySelector(sel); return {o: tr.querySelector('[data-f=objetivo]').value, a: tr.querySelector('select[data-f=areaId]').value, c: tr.querySelector('[data-f=criterio]').value, s: tr.querySelector('select[data-f=scaleId]').value}; }, lastFono);
  console.log('choosing fills objective, area, criterion and scale?', applied.o === 'Nomear 10 objetos do cotidiano' && applied.a === 'comunicacao' && applied.c === '8 de 10 tentativas' && applied.s === 'aba', JSON.stringify(applied));
  const psicoSugg = await ev('goalMatches("nomear", "psico").length');
  console.log('goal of Fonoaudiologia is not suggested in Psicologia?', psicoSugg === 0, psicoSugg);
  await page.click('#plSecs [data-spec="fono"] [data-add-obj]');
  await page.type(lastFono + ' textarea[data-f="objetivo"]', 'Imitar sons de animais');
  await page.waitForSelector('.pl-goal-pop:not([hidden]) [data-goal-new]');
  await page.click('.pl-goal-pop [data-goal-new]'); await page.waitForSelector('#ovGoal');
  const pre = await page.$eval('#glName', (e) => e.value);
  const preSpec = await page.$eval('#glSpec', (e) => e.value);
  await setv('#glArea', 'comunicacao');
  await page.click('#glSave'); await page.waitForTimeout(300);
  const stillPlan = await page.$('#ovPlan');
  const bankN = await ev('goalBankList().length');
  const rowArea = await page.$eval(lastFono + ' select[data-f=areaId]', (e) => e.value);
  console.log('"+ Salvar no Banco" opens prefilled over the plan, saves and keeps the plan open?', pre === 'Imitar sons de animais' && preSpec === 'fono' && !!stillPlan && bankN === 2 && rowArea === 'comunicacao', JSON.stringify({pre, preSpec, bankN, rowArea}));
  await page.click('#plCancel');

  // Parte 2: objetivos trabalhados na evolução + gráfico no plano.
  await ev('prOpenEditor({patient: findPatientByName("Bruno Verde"), appointment: {id: "ap1", date: "2026-10-10", time: "08:00", professional_id: null}})');
  await page.waitForSelector('#prGoalsBody [data-goal-obj]');
  const evoRows = await page.$$eval('#prGoalsBody [data-goal-obj]', (r) => r.map((x) => x.getAttribute('data-goal-spec')));
  const allActive = await ev('(function(){ var p = planVigente("bruno-verde"); var n = 0; p.sections.forEach(function(s){ s.objectives.forEach(function(o){ if ((o.status || "ativo") === "ativo") n++; }); }); return n; })()');
  console.log('evolution lists the active objectives of the plan?', evoRows.length === allActive && allActive > 0, evoRows.length, allActive);
  const firstObj = await page.$eval('#prGoalsBody [data-goal-obj]', (e) => e.getAttribute('data-goal-obj'));
  const lvOpts = await page.$eval('#prGoalsBody [data-goal-obj] select[data-goal-level]', (e) => Array.prototype.map.call(e.options, (x) => x.value));
  await page.$eval('#prGoalsBody [data-goal-obj] select[data-goal-level]', (e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, lvOpts[lvOpts.length - 1]);
  const read = await ev('JSON.stringify(planEvoGoalsRead(document.getElementById("prGoalsBody"), planEvoGoalsFor("bruno-verde", null, [])))');
  const rd = JSON.parse(read);
  console.log('choosing a level marks the objective as worked and reads planId/objId/level?', rd.length === 1 && rd[0].objId === firstObj && rd[0].levelId === lvOpts[lvOpts.length - 1] && !!rd[0].planId, read);
  const tito = await ev('(function(){ var d = planEvoGoalsFor("bruno-verde", "tito", []); return d ? d.secs.length : -1; })()');
  console.log('professional outside the plan specialties sees no objectives?', tito === 0, tito);
  await ev('document.getElementById("modalHost").innerHTML = ""');
  // gráfico: duas evoluções com níveis do primeiro objetivo
  await ev(`(function(){ var p = planVigente("bruno-verde"); var s = p.sections.filter(function(x){ return x.objectives.length; })[0]; var o = s.objectives[0]; var sc = scaleById(o.scaleId);
    PLAN.evoMem = [{patient_id: "bruno-verde", appointment_date: "2026-10-01", plan_goals: [{planId: p.id, specId: s.specId, objId: o.id, scaleId: o.scaleId, levelId: sc.levels[0].id}]},
                   {patient_id: "bruno-verde", appointment_date: "2026-10-15", plan_goals: [{planId: p.id, specId: s.specId, objId: o.id, scaleId: o.scaleId, levelId: sc.levels[2].id}]}]; })()`);
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#plCharts .pv-fig');
  const fig = await page.$eval('#plCharts', (h) => ({figs: h.querySelectorAll('.pv-fig').length, lines: h.querySelectorAll('.pv-line').length, dots: h.querySelectorAll('.pv-dot').length, legend: h.querySelectorAll('.pv-key').length, cols: h.querySelectorAll('.pv-table thead th').length}));
  console.log('plan shows one chart with one line of 2 points, legend and table?', fig.figs === 1 && fig.lines === 1 && fig.dots === 2 && fig.legend === 1 && fig.cols === 3, JSON.stringify(fig));
  await page.click('#plCancel');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
