// Plano terapêutico: menu Prontuário ▾, cadastros de Escalas e Habilidades,
// quadros por habilidade com as especialidades de cada objetivo, objetivos com ▲▼, último nível
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
  // Objetivo do plano = lista do cadastro de Objetivos: abre a lista da linha (se não estiver aberta) e escolhe pelo texto.
  const pickGoal = async (rowSel, name) => {
    if (!(await page.$('.pl-goal-pop:not([hidden])'))) await page.click(rowSel + ' [data-goal-pick]');
    await page.waitForSelector('.pl-goal-pop:not([hidden])');
    const ok = await page.evaluate((n) => { const b = Array.prototype.filter.call(document.querySelectorAll('.pl-goal-pop [data-goal]'), (x) => x.querySelector('.autolist-name').textContent.indexOf(n) !== -1)[0]; if (b) b.click(); return !!b; }, name);
    if (!ok) throw new Error('goal not in the list: ' + name);
    await page.waitForTimeout(50);
  };
  const goalTxt = (sel) => page.$$eval(sel + ' [data-goal-pick]', (r) => r.map((x) => x.textContent.replace('▾', '').trim()));
  // Cadastro de Objetivos fictício (Comunicação, sem especialidade = todas).
  await ev(`writeSimpleList("objetivos", ["Objetivo 1", "Objetivo 2", "Objetivo 3", "Sem especialidade"].map(function(n, i){ return {id: "g" + (i + 1), name: n, areaId: "comunicacao", criterio: "Crit " + (i + 1), scaleId: "", specIds: []}; }))`);
  await page.waitForTimeout(100);

  // Menus: Prontuário ▾ com Prontuário, Plano terapêutico e os cadastros do plano.
  const menus = await ev(`(function(){ renderNavMenus(); return {
    pr: Array.prototype.map.call(document.querySelectorAll("#prMenu [data-nav]"), function(b){ return b.textContent; }),
    cad: Array.prototype.map.call(document.querySelectorAll("#cadMenu [data-nav]"), function(b){ return b.getAttribute("data-nav"); }) }; })()`);
  console.log('Prontuário menu has Prontuário, Plano terapêutico and its registries?', JSON.stringify(menus.pr) === '["Prontuário","Plano Terapêutico","Objetivos","Escalas","Habilidades"]', JSON.stringify(menus.pr));
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

  // Habilidades: "Especialidades sugeridas" (Comunicação → Fonoaudiologia).
  await page.locator('#reg-habilidades-host tbody tr', { hasText: 'Comunicação' }).click(); await page.waitForSelector('#ovReg');
  const habName = await page.$eval('#regName', (e) => e.value);
  await page.$eval('#regHabSpecs input[value="fono"]', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#regSave'); await page.waitForTimeout(300);
  const habSaved = await ev('JSON.stringify(skillAreasList().filter(function(a){ return a.id === "comunicacao"; })[0].specIds)');
  const habCol = await page.locator('#reg-habilidades-host tbody tr', { hasText: 'Comunicação' }).evaluate((r) => r.cells[3].textContent);
  console.log('skill saves the suggested specialties and shows them in the list?', habName === 'Comunicação' && habSaved === '["fono"]' && /Fonoaudiologia/.test(habCol), habSaved, habCol);

  // Plano novo para Bruno Verde (tratamento com Psicologia e Fonoaudiologia): quadros por habilidade.
  await page.$eval('#mainTabs button[data-tab=planos]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#planAdd'); await page.waitForSelector('#ovPlanPick');
  await setv('#ppPat', 'bruno-verde');
  await page.click('#ppOk'); await page.waitForSelector('#ovPlan');
  const empty0 = await page.$$eval('#plSecs .pl-area', (r) => r.length);
  const rev = await page.$eval('#plReview', (e) => e.value);
  const exp = await ev('trAddMonths(trTodayIso(), 6)');
  console.log('new plan starts without skills and review = plan date + 6 months?', empty0 === 0 && rev === exp, empty0, rev);
  // Incluir habilidade: o quadro aparece com o 1º objetivo; Fonoaudiologia vem marcada (sugerida).
  await setv('#plAddArea', 'comunicacao'); await page.waitForTimeout(100);
  const Q = '#plSecs [data-area="comunicacao"]';
  for (let k = 0; k < 3; k++){
    if (k) await page.click(Q + ' [data-add-obj]');
    await pickGoal(Q + ' tbody tr:last-child', 'Objetivo ' + (k + 1));
  }
  const specT = await page.$$eval(Q + ' [data-specs]', (r) => r.map((x) => x.title));
  console.log('new objectives come with the suggested specialty (Fonoaudiologia)?', specT.length === 3 && specT.every((t) => t === 'Fonoaudiologia'), JSON.stringify(specT));
  const head = await page.$eval('#plSecs .pl-tbl thead', (e) => e.textContent);
  console.log('table has Especialidades and no Habilidade column?', /Especialidades/.test(head) && !/Habilidade/.test(head), head);
  const cover1 = await page.$eval('#plCover', (e) => e.textContent);
  console.log('coverage warns that Psicologia (in the treatment) has no active objective?', /sem objetivo ativo:\s*Psicologia/.test(cover1), cover1);
  const nums = await page.$$eval(Q + ' .pl-num b', (r) => r.map((x) => x.textContent).join(','));
  console.log('Nº is automatic inside the skill (1,2,3)?', nums === '1,2,3', nums);
  await page.click(Q + ' tbody tr:nth-child(1) [data-mv="1"]');
  const order = (await goalTxt(Q)).join('|');
  console.log('▼ moves the row and renumbers?', order === 'Objetivo 2|Objetivo 1|Objetivo 3', order);
  // Especialidades do 2º objetivo: marca também Psicologia.
  await page.click(Q + ' tbody tr:nth-child(2) [data-specs]'); await page.waitForSelector('.pl-specs-pop:not([hidden])');
  const popTxt = await page.$eval('.pl-specs-pop', (e) => e.textContent);
  await page.$eval('.pl-specs-pop input[value="psico"]', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.keyboard.press('Escape');
  const t2 = await page.$eval(Q + ' tbody tr:nth-child(2) [data-specs]', (e) => e.title);
  const cover2 = await page.$eval('#plCover', (e) => e.textContent);
  console.log('specialties picker (treatment first) adds Psicologia; coverage becomes ok?', /Do tratamento/.test(popTxt) && t2 === 'Fonoaudiologia, Psicologia' && /Todas as especialidades do tratamento/.test(cover2), t2, cover2);
  // último nível da escala = Atingido; escala ABA troca os níveis
  await setv(Q + ' tbody tr:nth-child(1) select[data-f="levelId"]', '5');
  const st1 = await page.$eval(Q + ' tbody tr:nth-child(1) select[data-f="status"]', (e) => e.value);
  console.log('last level of the scale sets status Atingido?', st1 === 'atingido', st1);
  await setv(Q + ' tbody tr:nth-child(2) select[data-f="scaleId"]', 'aba');
  const abaOpts = await page.$$eval(Q + ' tbody tr:nth-child(2) select[data-f="levelId"] option', (r) => r.map((x) => x.value).join(','));
  console.log('Situação follows the chosen scale (ABA levels)?', abaOpts === 'nao-adquirida,parcial,adquirida', abaOpts);
  // Sem especialidade não salva.
  await page.click(Q + ' [data-add-obj]');
  await pickGoal(Q + ' tbody tr:last-child', 'Sem especialidade');
  await page.click(Q + ' tbody tr:last-child [data-specs]'); await page.waitForSelector('.pl-specs-pop:not([hidden])');
  await page.$eval('.pl-specs-pop input[value="fono"]', (e) => { e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await page.click('#plSave'); await page.waitForTimeout(200);
  const tNoSpec = await page.innerText('#toastHost');
  console.log('objective without specialties is refused?', /Escolha as especialidades do objetivo nº 4 de Comunicação/.test(tNoSpec) && !!(await page.$('#ovPlan')), tNoSpec);
  await page.click(Q + ' tbody tr:last-child [data-rm-obj]'); await page.waitForTimeout(100);
  if (await page.$('#cfOk')) await page.click('#cfOk');
  await page.fill('#plSummary', 'Resumo fictício do quadro clínico.');
  await page.click('#plSave'); await page.waitForTimeout(300);
  const sp = JSON.parse(await ev('JSON.stringify(planVigente("bruno-verde"))'));
  const s0 = sp && sp.sections[0];
  console.log('plan saved by skill with the specialties of each objective?', sp && sp.sections.length === 1 && s0.areaId === 'comunicacao' && s0.objectives.length === 3 &&
    JSON.stringify(s0.objectives[1].specIds) === '["fono","psico"]' && !('specId' in s0) && sp.summary.indexOf('fictício') !== -1, JSON.stringify(s0 && s0.objectives.map((o) => o.specIds)));
  const listRow = await page.$$eval('#planListHost tbody tr', (r) => r.map((x) => x.cells[0].textContent + '|' + x.cells[4].textContent + '|' + x.cells[5].textContent));
  console.log('list shows objective counts and the specialties used?', listRow.length === 1 && listRow[0].indexOf('Bruno Verde|2 ativos · 1 atingido|Fonoaudiologia, Psicologia') === 0, JSON.stringify(listRow));

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
  // Quadro recolhível.
  await page.click('#plSecs [data-area="comunicacao"] [data-area-toggle]');
  const colRows = await page.$$eval('#plSecs [data-area="comunicacao"] tr[data-obj]', (r) => r.length);
  const colCount = await page.$eval('#plSecs [data-area="comunicacao"] .pl-spec-count', (e) => e.textContent);
  console.log('skill box collapses and keeps the counter?', colRows === 0 && /3 objetivos · 2 ativos · 1 atingido/.test(colCount), colRows, colCount);
  await page.click('#plCancel');

  // Modo do profissional: Bia (Fonoaudiologia, complementar Psicologia).
  await ev(`(function(){ var r = planVigente("bruno-verde"), o = r.sections[0].objectives;
    o.push({id: "psonly", objetivo: "Só psicologia", criterio: "", specIds: ["psico"], prazo: 3, scaleId: "likert", levelId: "0", status: "ativo"});
    o.push({id: "toonly", objetivo: "Só TO", criterio: "", specIds: ["to"], prazo: 3, scaleId: "likert", levelId: "0", status: "ativo"});
    state.professionals = state.professionals.map(function(p){ return p.id === "bia-terapeuta" ? Object.assign({}, p, {complementares: ["psico"]}) : p; }); window.__planProfId = "bia-terapeuta"; })()`);
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#ovPlan');
  const profUi = await page.evaluate(() => {
    const row = (id) => document.querySelector('#plSecs tr[data-obj="' + id + '"]');
    const fonoRow = document.querySelector('#plSecs [data-area="comunicacao"] tbody tr');
    return {
      fonoEditable: !fonoRow.querySelector('[data-goal-pick]').disabled,
      psOnlyLocked: row('psonly').querySelector('[data-goal-pick]').disabled && !row('psonly').querySelector('select[data-f="levelId"]').disabled,
      toLocked: row('toonly').querySelector('select[data-f="levelId"]').disabled,
      noMove: !document.querySelector('#plSecs [data-mv]'),
      noRmSaved: !fonoRow.querySelector('[data-rm-obj]'),
      add: !!document.querySelector('#plSecs [data-add-obj]'),
      summaryDisabled: document.getElementById('plSummary').disabled
    };
  });
  console.log('professional: edits objectives of the main specialty, only Situação/Status in complementary ones, nothing in others, no ▲▼, can add?',
    profUi.fonoEditable && profUi.psOnlyLocked && profUi.toLocked && profUi.noMove && profUi.noRmSaved && profUi.add && profUi.summaryDisabled, JSON.stringify(profUi));
  await page.click('#plSecs [data-area="comunicacao"] [data-add-obj]');
  await page.click('#plSecs [data-area="comunicacao"] tbody tr:last-child [data-specs]'); await page.waitForSelector('.pl-specs-pop:not([hidden])');
  const lockFono = await page.$eval('.pl-specs-pop input[value="fono"]', (e) => e.checked && e.disabled);
  await page.$eval('.pl-specs-pop input[value="psico"]', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.keyboard.press('Escape');
  const newT = await page.$eval('#plSecs [data-area="comunicacao"] tbody tr:last-child [data-specs]', (e) => e.title);
  console.log('new objective by the professional: main specialty locked, support specialties can be added?', lockFono && newT === 'Fonoaudiologia, Psicologia', newT);
  await page.$eval('#plOnlyMine', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const mineRows = await page.$$eval('#plSecs tr[data-obj]', (r) => r.map((x) => x.getAttribute('data-obj')));
  console.log('"Só as minhas especialidades" hides objectives she does not work (Só TO)?', mineRows.indexOf('toonly') === -1 && mineRows.indexOf('psonly') !== -1, JSON.stringify(mineRows));
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

  // Banco de objetivos: várias especialidades, sugestão no campo Objetivo e "+ Salvar no Banco".
  await page.$eval('#mainTabs button[data-tab=objetivos]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#reg-objetivos-add'); await page.waitForSelector('#ovGoal'); await page.waitForTimeout(120);
  await page.fill('#glName', 'Nomear 10 objetos do cotidiano');
  await setv('#glArea', 'comunicacao');
  await page.$eval('#glSpecs input[value="fono"]', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#glCrit', '8 de 10 tentativas');
  await setv('#glScale', 'aba');
  await page.click('#glSave'); await page.waitForTimeout(300);
  const bankRows = await page.$$eval('#reg-objetivos-host tbody tr', (r) => r.map((x) => x.cells[0].textContent.trim() + '|' + x.cells[3].textContent.trim()));
  const bankRec = await ev('JSON.stringify(goalBankList().filter(function(g){ return g.name === "Nomear 10 objetos do cotidiano"; })[0].specIds)');
  console.log('goal saved in the bank with its specialties?', bankRows.indexOf('Nomear 10 objetos do cotidiano|Fonoaudiologia') !== -1 && bankRec === '["fono"]', JSON.stringify(bankRows), bankRec);
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#ovPlan');
  const Q2 = '#plSecs [data-area="comunicacao"]';
  await page.click(Q2 + ' [data-add-obj]');
  const lastRow = Q2 + ' tbody tr:last-child';
  await page.waitForSelector('.pl-goal-pop:not([hidden]) .dp-filter');
  const used = await page.$$eval('.pl-goal-pop [data-goal][disabled]', (r) => r.length);
  console.log('objectives already in the box are disabled in the list?', used === 3, used);
  await page.type('.pl-goal-pop .dp-filter', 'nomear obj');
  const sugg = await page.$$eval('.pl-goal-pop [data-goal]', (r) => r.map((x) => x.textContent));
  console.log('typing filters the bank goals of the skill (no accents/case)?', sugg.length === 1 && /Nomear 10 objetos/.test(sugg[0]), JSON.stringify(sugg));
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const applied = await page.evaluate((sel) => { const tr = document.querySelector(sel); return {o: tr.querySelector('[data-goal-pick]').title, c: tr.querySelector('.pl-crit').textContent, s: tr.querySelector('select[data-f=scaleId]').value, sp: tr.querySelector('[data-specs]').title, noTa: !tr.querySelector('textarea')}; }, lastRow);
  console.log('choosing fills objective, read-only criterion, scale and specialties?', applied.o === 'Nomear 10 objetos do cotidiano' && applied.c === '8 de 10 tentativas' && applied.s === 'aba' && applied.sp === 'Fonoaudiologia' && applied.noTa, JSON.stringify(applied));
  const otherArea = await ev('goalMatches("nomear", "autonomia", []).length');
  console.log('bank goal of Comunicação is not offered in another skill?', otherArea === 0, otherArea);
  // Faixa etária: [0–4] antes do nome; Bruno tem 7 anos → fica em "Outras faixas etárias".
  await ev(`writeSimpleList("objetivos", goalBankList().concat([{id: "g04", name: "Apontar para pedir", areaId: "comunicacao", faixas: ["0-4"], criterio: "", specIds: []}, {id: "g59", name: "Contar o fim de semana", areaId: "comunicacao", faixas: ["5-9"], criterio: "", specIds: []}]))`);
  await page.click(Q2 + ' [data-add-obj]');
  await page.waitForSelector('.pl-goal-pop:not([hidden])');
  const lst = await page.evaluate(() => { const l = document.querySelector('.pl-goal-pop .pl-goal-list'); const kids = Array.prototype.map.call(l.children, (x) => x.classList.contains('pl-goal-grp') ? '#' + x.textContent : (x.querySelector('.autolist-name') || x).textContent); return kids; });
  const iGrp = lst.indexOf('#Outras faixas etárias');
  console.log('age band shown as [0–4] before the name; other bands after "Outras faixas etárias"; "+ Incluir objetivo" last?',
    iGrp > lst.indexOf('[5–9] Contar o fim de semana') && lst.indexOf('[0–4] Apontar para pedir') > iGrp && /Incluir objetivo/.test(lst[lst.length - 1]), JSON.stringify(lst));
  await page.click('.pl-goal-pop [data-goal-new]'); await page.waitForSelector('#ovGoal');
  const preArea = await page.$eval('#glArea', (e) => e.value);
  const preAge = await page.$$eval('#glAges input:checked', (r) => r.map((x) => x.value).join());
  await page.fill('#glName', 'Imitar sons de animais');
  await page.click('#glSave'); await page.waitForTimeout(300);
  const stillPlan = await page.$('#ovPlan');
  const newRow = await page.$eval(lastRow + ' [data-goal-pick]', (e) => e.title);
  console.log('"+ Incluir objetivo" opens the goal window over the plan (skill and patient band filled), saves and picks it in the row?', preArea === 'comunicacao' && preAge === '5-9' && !!stillPlan && newRow === '[5–9] Imitar sons de animais', JSON.stringify({preArea, preAge, newRow}));
  await page.click('#plCancel');

  // Evolução: objetivos ativos por habilidade, conforme as especialidades do profissional.
  await ev('prOpenEditor({patient: findPatientByName("Bruno Verde"), appointment: {id: "ap1", date: "2026-10-10", time: "08:00", professional_id: null}})');
  await page.waitForSelector('#prGoalsBody [data-goal-obj]');
  const evoRows = await page.$$eval('#prGoalsBody [data-goal-obj]', (r) => r.length);
  const evoHead = await page.$eval('#prGoalsBody .pr-goal-spec', (e) => e.textContent);
  const allActive = await ev('(function(){ var p = planVigente("bruno-verde"); var n = 0; p.sections.forEach(function(s){ s.objectives.forEach(function(o){ if ((o.status || "ativo") === "ativo") n++; }); }); return n; })()');
  console.log('evolution lists the active objectives grouped by skill?', evoRows === allActive && allActive > 0 && evoHead === 'Comunicação', evoRows, allActive, evoHead);
  const firstObj = await page.$eval('#prGoalsBody [data-goal-obj]', (e) => e.getAttribute('data-goal-obj'));
  const lvOpts = await page.$eval('#prGoalsBody [data-goal-obj] select[data-goal-level]', (e) => Array.prototype.map.call(e.options, (x) => x.value));
  await page.$eval('#prGoalsBody [data-goal-obj] select[data-goal-level]', (e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, lvOpts[lvOpts.length - 1]);
  const read = await ev('JSON.stringify(planEvoGoalsRead(document.getElementById("prGoalsBody"), planEvoGoalsFor("bruno-verde", null, [])))');
  const rd = JSON.parse(read);
  console.log('choosing a level marks the objective as worked and reads planId/objId/level?', rd.length === 1 && rd[0].objId === firstObj && rd[0].levelId === lvOpts[lvOpts.length - 1] && !!rd[0].planId, read);
  const bia = await ev('(function(){ var d = planEvoGoalsFor("bruno-verde", "bia-terapeuta", []); var ids = []; d.secs.forEach(function(s){ s.items.forEach(function(x){ ids.push(x.o.id + ":" + x.spec); }); }); return ids.join(","); })()');
  console.log('Bia (fono + psico) does not see the TO-only objective; works with fono when marked, psico otherwise?', bia.indexOf('toonly') === -1 && /psonly:psico/.test(bia) && /:fono/.test(bia), bia);
  const tito = await ev('(function(){ var d = planEvoGoalsFor("bruno-verde", "tito", []); var ids = []; d.secs.forEach(function(s){ s.items.forEach(function(x){ ids.push(x.o.id); }); }); return ids.join(","); })()');
  console.log('professional of another specialty sees only the objectives marked for it?', tito === 'toonly', tito);
  await ev('document.getElementById("modalHost").innerHTML = ""');
  // gráfico: duas evoluções (Fono e Psicologia) com níveis do primeiro objetivo
  await ev(`(function(){ var p = planVigente("bruno-verde"); var o = p.sections[0].objectives[0]; var sc = scaleById(o.scaleId);
    PLAN.evoMem = [{patient_id: "bruno-verde", appointment_date: "2026-10-01", plan_goals: [{planId: p.id, specId: "fono", objId: o.id, scaleId: o.scaleId, levelId: sc.levels[0].id}]},
                   {patient_id: "bruno-verde", appointment_date: "2026-10-15", plan_goals: [{planId: p.id, specId: "psico", objId: o.id, scaleId: o.scaleId, levelId: sc.levels[2].id}]}]; })()`);
  await ev('openPlanFor("bruno-verde")'); await page.waitForSelector('#plCharts .pv-fig');
  const fig = await page.$eval('#plCharts', (h) => ({figs: h.querySelectorAll('.pv-fig').length, lines: h.querySelectorAll('.pv-line').length, dots: h.querySelectorAll('.pv-dot').length, cap: h.querySelector('figcaption').textContent,
    tips: Array.prototype.map.call(h.querySelectorAll('.pv-hit'), (x) => x.getAttribute('data-tip')).join(' | ')}));
  console.log('chart by skill, one line of 2 points; tooltip shows the specialty that evaluated?', fig.figs === 1 && fig.lines === 1 && fig.dots === 2 && /^Comunicação/.test(fig.cap) && /\(FN\)/.test(fig.tips) && /\(PS/.test(fig.tips), JSON.stringify(fig));
  await page.click('#plCancel');

  // Agenda: Detalhes do agendamento com "Objetivos do atendimento" e botão Editar.
  await ev(`(function(){
    var mk = function(id, t, spec){ return {id: id, specIds: [spec || "fono"], objetivo: t, criterio: "80%", prazo: 3, scaleId: "likert", levelId: "1", status: "ativo"}; };
    planMemPut({id: "pa", patient_id: "ana-azul", patient_name: "Ana Azul", version: 1, status: "vigente", plan_date: "2026-10-01", review_date: "2027-04-01", summary: "Resumo da Ana", sections: [
      {areaId: "comunicacao", objectives: [mk("a1", "Esperar a vez"), mk("a2", "Nomear cores")]}, {areaId: "desenvolvimento-motor", objectives: [mk("a3", "Recortar com tesoura", "to")]}]});
    planMemPut({id: "pc", patient_id: "carla-laranja", patient_name: "Carla Laranja", version: 1, status: "vigente", plan_date: "2026-10-01", review_date: "2027-04-01", summary: "", sections: [
      {areaId: "comunicacao", objectives: [mk("c1", "esperar a VEZ")]}]});
    AD.rows = {r1: {id: "r1", date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Ana Azul", service: "sessao", status: ""},
               r2: {id: "r2", date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Carla Laranja", service: "sessao", status: ""}};
    agdOpenDetails(AD.rows.r1);
  })()`);
  await page.waitForSelector('#agdDetGoals .ag-obj-line', {state: 'attached'});
  const box0 = await page.$eval('#agdDetGoals', (h) => ({visible: Array.prototype.filter.call(h.querySelectorAll('.ag-obj-line'), (l) => !l.closest('[hidden]')).length,
    sum: h.querySelector('.ag-obj-sum').textContent, boxes: Array.prototype.map.call(h.querySelectorAll('[data-ag-box]'), (b) => b.getAttribute('data-ag-box')).join(),
    ownSum: !!h.querySelector('[data-ag-box="own"] .ag-obj-sum')}));
  await page.click('[data-ag-box="common"] [data-ag-toggle]');
  const box = await page.$eval('[data-ag-box="common"]', (h) => ({
    lines: Array.prototype.map.call(h.querySelectorAll('.ag-obj-line'), (l) => l.querySelector('.ag-obj-txt').textContent),
    area: (h.querySelector('.ag-obj-area') || {}).textContent,
    meta: Array.prototype.map.call(h.querySelectorAll('.ag-obj-meta'), (m) => m.textContent).join(' | ')}));
  console.log('Objetivos starts collapsed with the summary; arrow shows the common objective under its skill (number, text | criterion, scale | status, situation | specialties); own objectives in a separate collapsed box without summary; TO left out?',
    box0.visible === 0 && /Carla Laranja/.test(box0.sum) && box0.boxes === 'common,own' && !box0.ownSum &&
    box.lines.length === 1 && /1\.\s*Esperar a vez/.test(box.lines[0]) && box.area === 'Comunicação' && /Especialidades: Fonoaudiologia/.test(box.meta) && /Critério: 80% · Escala: Likert/.test(box.meta) && /Status: Ativo · Situação:/.test(box.meta), JSON.stringify({box0, box}));
  // Seletor Agendamento | Saúde | Tratamento ao lado do nome; Objetivos antes do Status.
  const tabs = await page.$$eval('#agdDetSeg [data-det]', (r) => r.map((x) => x.textContent));
  const agPane = await page.$eval('[data-det-pane="ag"]', (e) => Array.prototype.map.call(e.querySelectorAll('.k'), (k) => k.textContent).join('|'));
  await page.click('#agdDetSeg [data-det="sa"]');
  const saPane = await page.$eval('[data-det-pane="sa"]', (e) => ({vis: !e.hidden, keys: Array.prototype.map.call(e.querySelectorAll('.k'), (k) => k.textContent).join('|')}));
  const agHidden = await page.$eval('[data-det-pane="ag"]', (e) => e.hidden);
  await page.click('#agdDetSeg [data-det="tr"]');
  const trKeys = await page.$eval('[data-det-pane="tr"]', (e) => Array.prototype.map.call(e.querySelectorAll('.k'), (k) => k.textContent).join('|'));
  const goalsFirst = await page.$eval('#ovAgdDet .modal-body', (b) => { var g = b.querySelector('#agdDetGoals'), st = b.querySelector('#agdDetStatus'); return !st || !!(g.compareDocumentPosition(st) & Node.DOCUMENT_POSITION_FOLLOWING); });
  const objTitle = await page.$eval('#agdDetGoals .ag-obj-title', (e) => e.textContent);
  console.log('details: Agendamento/Saúde/Tratamento selector, panes with the asked fields, Objetivos before Status?',
    tabs.join() === 'Agendamento,Saúde,Tratamento' && agPane === 'Serviço|Sala|Data/Hora|Observação' && saPane.vis && agHidden && saPane.keys === 'Diagnóstico (CID)|Alergias|Medicações em uso|Restrições alimentares' && trKeys === 'Plano|ABA|Horários'&& goalsFirst && objTitle === 'Objetivos',
    JSON.stringify({tabs, agPane, saPane, trKeys, goalsFirst, objTitle}));
  await page.click('[data-ag-box="own"] [data-ag-toggle]');
  const nOpen = await page.$$eval('#agdDetGoals .ag-obj-line', (r) => r.filter((l) => !l.closest('[hidden]')).length);
  console.log('"Objetivos do paciente" reveals the specific ones?', nOpen === 2, nOpen);
  const editBtn = await page.$('#agdDetEdit');
  console.log('details has "Editar agendamento" for who can edit?', !!editBtn);
  await editBtn.click(); await page.waitForSelector('#ovAgd');
  console.log('"Editar agendamento" opens the edit window?', !!(await page.$('#ovAgd')));
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = ""; delete AD.rows.r2; agdOpenDetails(AD.rows.r1); })()`);
  await page.waitForSelector('#agdDetGoals .ag-obj-line', {state: 'attached'});
  const alone = await page.$eval('#agdDetGoals', (h) => ({n: h.querySelectorAll('.ag-obj-line').length, more: !!h.querySelector('[data-ag-box="own"]')}));
  console.log('alone in the slot: all objectives open, no button?', alone.n === 2 && !alone.more, JSON.stringify(alone));
  // Finalizado travado para o terapeuta.
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = ""; window.__planProfId = "bia-terapeuta"; state.statuses = [{id: "finalizado", name: "Finalizado", color: "#2E9E5B"}, {id: "nao-compareceu", name: "Não compareceu", color: "#999"}];
    AD.rows.r1.status = "finalizado"; agdOpenDetails(AD.rows.r1); })()`);
  const locked = await page.$eval('#agdDetStatus', (e) => e.disabled);
  const lockMsg = await page.$eval('#ovAgdDet', (e) => /não pode ser alterado pelo terapeuta/.test(e.textContent));
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = ""; AD.rows.r1.status = ""; agdOpenDetails(AD.rows.r1); })()`);
  const open = await page.$eval('#agdDetStatus', (e) => !e.disabled);
  console.log('therapist cannot change a finalized status (others still can)?', locked && lockMsg && open, JSON.stringify({locked, lockMsg, open}));
  // Podem retirar acima do nome; Medida protetiva em quadro vermelho só quando há medida ativa.
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = "";
    state.patientsRaw = state.patientsRaw.map(function(p){ return p.id !== "ana-azul" ? p : Object.assign({}, p, {rotina: [{nome: "Mara Azul", src: "mae"}], protetiva: [{nome: "Jorge", rel: "Pai"}]}); });
    rebuildPatients(); agdOpenDetails(AD.rows.r1); })()`);
  const pk = await page.$eval('#ovAgdDet .modal-body', (b) => {
    var ret = b.querySelector('.pickup-box:not(.pickup-alert)'), prot = b.querySelector('.pickup-box.pickup-alert'), name = b.querySelector('.agd-det-top');
    return {retFirst: !!ret && !!(ret.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING), ret: ret ? ret.textContent : '', prot: prot ? prot.textContent : '',
      protAfterInfo: !!prot && !!(b.querySelector('[data-det-pane="ag"]').compareDocumentPosition(prot) & Node.DOCUMENT_POSITION_FOLLOWING)};
  });
  console.log('"Podem retirar" above the name and the red "Não pode retirar" box below the info?', pk.retFirst && /Podem retirar: Mara Azul \(Mãe\)/.test(pk.ret) && /Não pode retirar: Jorge \(Pai\)/.test(pk.prot) && pk.protAfterInfo, JSON.stringify(pk));
  await ev(`(function(){ document.getElementById("modalHost").innerHTML = "";
    state.patientsRaw = state.patientsRaw.map(function(p){ return p.id !== "ana-azul" ? p : Object.assign({}, p, {protetiva: []}); }); rebuildPatients(); agdOpenDetails(AD.rows.r1); })()`);
  const noProt = await page.$$eval('#ovAgdDet .pickup-alert', (r) => r.length);
  console.log('no protective measure: no red box?', noProt === 0, noProt);
  // Paciente sem plano no horário é ignorado; sem objetivos em comum avisa ao agendar.
  await ev(`(function(){ delete window.__planProfId; document.getElementById("modalHost").innerHTML = ""; AD.rows.r1.status = "";
    AD.rows.r3 = {id: "r3", date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Eva Sem Idade", service: "sessao", status: ""};
    agdOpenDetails(AD.rows.r1); })()`);
  await page.waitForSelector('#agdDetGoals .ag-obj-line', {state: 'attached'});
  const noPlan = await page.$eval('#agdDetGoals', (h) => ({n: h.querySelectorAll('.ag-obj-line').length, more: !!h.querySelector('[data-ag-box="own"]'), sum: h.querySelector('.ag-obj-sum').textContent}));
  console.log('other patient without a plan is ignored in the details (all open, not in the summary)?', noPlan.n === 2 && !noPlan.more && !/Eva/.test(noPlan.sum), JSON.stringify(noPlan));
  await ev('document.getElementById("modalHost").innerHTML = ""');
  const evaOk = await ev('agdGoalsCheck([{rec: {date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Eva Sem Idade", service: "sessao"}, old: null}])');
  const carlaOk = await ev('agdGoalsCheck([{rec: {date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Carla Laranja", service: "sessao"}, old: null}])');
  console.log('booking a patient without a plan, or with an objective in common, does not ask?', evaOk === true && carlaOk === true, evaOk, carlaOk);
  await ev(`(function(){ planMemPut({id: "pd", patient_id: "duda-vermelho", patient_name: "Duda Vermelho", version: 1, status: "vigente", plan_date: "2026-10-01", review_date: "2027-04-01", summary: "", sections: [
      {areaId: "comunicacao", objectives: [{id: "d1", specIds: ["fono"], objetivo: "Imitar sons", criterio: "", prazo: 3, scaleId: "likert", levelId: "0", status: "ativo"}]}]});
    window.__gc = agdGoalsCheck([{rec: {date: "2026-10-12", time: "08:00", professional_id: "bia-terapeuta", patient: "Duda Vermelho", service: "sessao"}, old: null}]); })()`);
  await page.waitForSelector('#cfTitle');
  const gcTitle = await page.$eval('#cfTitle', (e) => e.textContent);
  const gcMsg = await page.$eval('#confirmHost', (e) => e.textContent);
  await page.click('#cfCancel');
  const gcRes = await page.evaluate(() => window.__gc);
  console.log('booking a patient with a plan and no objective in common asks first?', gcTitle === 'Sem objetivos em comum' && /Duda Vermelho/.test(gcMsg) && /Ana Azul/.test(gcMsg) && gcRes === false, gcTitle, gcRes);
  await ev('(function(){ delete window.__planProfId; document.getElementById("modalHost").innerHTML = ""; AD.rows = {}; })()');

  // Relatório "Evolução por habilidade" (planos vigentes).
  const rep = JSON.parse(await ev('JSON.stringify(RP_BUILDERS["evolucao-habilidade"]([], {from: "2000-01-01", to: "2100-01-01", pac: "", prof: ""}))'));
  const bruno = rep.sections[1].rows.filter((r) => r[0] === 'Bruno Verde')[0];
  const repTito = JSON.parse(await ev('JSON.stringify(RP_BUILDERS["evolucao-habilidade"]([], {from: "2000-01-01", to: "2100-01-01", pac: "", prof: "tito"}))'));
  console.log('report by skill: Bruno/Comunicação with objectives, achieved and %; filtered by professional shows only what he works?',
    !!bruno && bruno[1] === 'Comunicação' && bruno[2] === 5 && bruno[4] === 1 && bruno[6] === '20%' && rep.sections[0].rows.some((r) => r[0] === 'Comunicação') &&
    repTito.sections[1].rows.every((r) => r[2] === 1), JSON.stringify(bruno), JSON.stringify(repTito.sections[1].rows));

  // Linha do tempo do Prontuário: quadro "Objetivos trabalhados" da evolução.
  const worked = await ev(`(function(){ var p = planVigente("bruno-verde"), s = p.sections[0], o = s.objectives[0], sc = scaleById(o.scaleId);
    var h = prGoalsWorkedHtml({plan_goals: [{planId: p.id, specId: "fono", objId: o.id, scaleId: o.scaleId, levelId: sc.levels[0].id}]});
    var d = document.createElement("div"); d.innerHTML = h; return {t: d.textContent, n: d.querySelectorAll("li").length, lv: sc.levels[0].name, obj: planObjLabel(o)}; })()`);
  console.log('evolution card lists the worked objectives (skill, objective, level, specialty)?', worked.n === 1 && /Objetivos trabalhados/.test(worked.t) && worked.t.indexOf(worked.obj) !== -1 && worked.t.indexOf(worked.lv) !== -1 && /FN/.test(worked.t), JSON.stringify(worked));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
