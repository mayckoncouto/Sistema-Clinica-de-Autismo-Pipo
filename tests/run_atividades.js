// Cadastro de Atividades (Prontuário ▾ → Atividades): lista, janela, objetivos ligados, busca, excluir, Inativar do objetivo. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_act.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  // dois objetivos no Banco de objetivos (direto no estado)
  await ev("state.goalBank = [{id: 'g1', name: 'Pedir ajuda', areaId: '', faixas: [], specIds: []}, {id: 'g2', name: 'Imitar gestos', areaId: '', faixas: [], specIds: []}]");
  check('no "Erro —" warning at startup?', !/Erro —/.test(await page.evaluate(() => document.body.innerText)));
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="atividades"]').click());
  await page.waitForTimeout(250);
  check('Atividades screen opens with its title?', !(await page.$eval('#tab-atividades', (e) => e.hidden)) && /Atividades/.test(await page.textContent('#tab-atividades .cad-title')));
  await page.click('#reg-atividades-add'); await page.waitForSelector('#ovAct');
  check('window title "Nova Atividade"?', /Nova Atividade/.test(await page.textContent('#ovAct h3')));
  await page.click('#acSave'); await page.waitForTimeout(100);
  check('empty name refused (window stays)?', !!(await page.$('#ovAct')));
  await page.fill('#acName', 'Caixa Surpresa');
  await page.fill('#acDesc', 'A criança tira objetos de uma caixa.');
  await page.fill('#acMat', 'caixa, brinquedos');
  await page.fill('#acDur', '15x');
  check('duration keeps only digits on save (checked below)', true);
  // ligar objetivos pelo combo
  await page.evaluate(() => { const s = document.getElementById('acGoalAdd'); s.value = 'g1'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.waitForTimeout(100);
  await page.evaluate(() => { const s = document.getElementById('acGoalAdd'); s.value = 'g2'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.waitForTimeout(100);
  check('two goals listed as linked?', (await page.$$eval('#acGoals input:checked', (c) => c.length)) === 2);
  await page.click('#acGoals input[value="g2"]'); await page.waitForTimeout(100);
  check('unchecking removes the goal?', (await page.$$eval('#acGoals input:checked', (c) => c.length)) === 1);
  await page.click('#acSave'); await page.waitForTimeout(300);
  const saved = await ev("state.activities.map(function(a){ return {n: a.name, d: a.duracao, g: a.goalIds.join(',')}; })");
  check('saved with duration number and 1 goal?', saved.length === 1 && saved[0].d === 15 && saved[0].g === 'g1', JSON.stringify(saved));
  const row = await page.textContent('#reg-atividades-host tbody tr');
  check('list row shows name, 1 goal and 15 min?', /Caixa Surpresa/.test(row) && /15 min/.test(row), row.replace(/\s+/g, ' '));
  // planilha: Outras Opções ▾ → exportar / importar
  check('Outras Opções menu has export and import?', (await page.$$eval('#tab-atividades [data-io-wrap] [data-io-act]', (b) => b.map((x) => x.getAttribute('data-io-act')))).join() === 'export,import');
  const exp = await ev("IO_KINDS.atividades.exportRows()");
  check('export row has name, 15 and the goal as "Habilidade: Objetivo"?', exp.length === 1 && exp[0].atividade === 'Caixa Surpresa' && exp[0].duracao === 15 && /Pedir ajuda/.test(exp[0].objetivos), JSON.stringify(exp));
  const pl = await ev(`(function(){ var r = ioRecords("atividades", xlParseText("Atividade\\tDuração (Min)\\tObjetivos\\nCaixa Surpresa\\t20\\tPedir ajuda; Imitar gestos\\nBolhas de Sabão\\t10\\tObjetivo Que Não Existe\\n")).recs; var p = ioActPlan(r); return p.items.map(function(i){ return i.st + ':' + (i.vals.goalIds || []).join('+') + ':' + i.warn.length; }); })()`);
  check('import plan: existing updates (2 goals), new one warns about unknown goal?', pl.join('|') === 'atualizar:g1+g2:0|novo::1', pl.join('|'));
  // duplicado
  await page.click('#reg-atividades-add'); await page.waitForSelector('#ovAct');
  await page.fill('#acName', 'caixa surpresa'); await page.click('#acSave'); await page.waitForTimeout(150);
  check('duplicate name refused?', !!(await page.$('#ovAct')) && (await ev('state.activities.length')) === 1);
  await page.click('#acCancel'); await page.waitForTimeout(100);
  // busca pelo objetivo
  await page.fill('#reg-atividades-search', 'pedir ajuda'); await page.waitForTimeout(150);
  check('search finds by linked goal?', (await page.$$eval('#reg-atividades-host tbody tr', (r) => r.length)) === 1);
  await page.fill('#reg-atividades-search', 'zzz'); await page.waitForTimeout(150);
  check('search with no match?', /Nada encontrado/.test(await page.textContent('#reg-atividades-host')));
  await page.fill('#reg-atividades-search', ''); await page.waitForTimeout(150);
  // helper: atividades de um objetivo
  check('activitiesForGoal finds it?', (await ev("activitiesForGoal('g1').length + '|' + activitiesForGoal('g2').length")) === '1|0');
  // plano: atividades sugeridas no objetivo (faixa etária e especialidades)
  check('planObjActs: matches by goal, band and specialty?', (await ev(`(function(){ var a = state.activities[0]; a.faixas = ["0-4"]; a.specIds = ["fono"];
    var o = {goalId: "g1", specIds: ["fono"]};
    return [planObjActs(o, AGE_BANDS[0]).length, planObjActs(o, AGE_BANDS[2]).length, planObjActs({goalId: "g1", specIds: ["to"]}, AGE_BANDS[0]).length, planObjActs({goalId: "g2", specIds: []}, null).length].join("|"); })()`)) === '1|0|0|0');
  await ev(`(function(){ var a = state.activities[0]; a.faixas = []; a.specIds = []; var p = state.patients[0];
    openPlanModal({id: "pp1", patient_id: p.id, version: 1, status: "vigente", plan_date: new Date().toISOString().slice(0, 10), review_date: null, summary: "", sections: [{areaId: "a1", objectives: [{id: "o1", goalId: "g1", specIds: [], prazo: 3, status: "ativo"}]}]}, {patientId: p.id}); return 1; })()`);
  await page.waitForSelector('#modalHost [data-acts]');
  check('plan objective shows "1 atividade sugerida"?', /1 atividade sugerida/.test(await page.textContent('#modalHost [data-acts]')));
  await page.click('#modalHost [data-acts]'); await page.waitForSelector('#ovPlActs');
  check('suggested activities window lists it with the duration?', /Caixa Surpresa/.test(await page.textContent('#ovPlActs')) && /15 min/.test(await page.textContent('#ovPlActs')));
  await page.click('#ovPlActs .modal-foot [data-acclose]'); await page.waitForTimeout(150);
  check('window closes and the plan stays open?', !(await page.$('#ovPlActs')) && !!(await page.$('#modalHost [data-acts]')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await ev('document.getElementById("modalHost").innerHTML = ""');
  // Detalhes do Agendamento: dica de atividades sugeridas
  check('agenda details hint "1 atividade sugerida" with a registered click target?', (await ev(`(function(){ var h = agdActsHint({goalId: "g1", specIds: []}, null, "Fulano"); return /1 atividade sugerida/.test(h) && /data-ag-acts="\\d+"/.test(h) && agdActsHint({goalId: "g2"}, null, "") === ""; })()`)) === true);
  // Evolução: atividades realizadas por objetivo
  const evo = await ev(`(function(){ var p = state.patients[0], today = new Date().toISOString().slice(0, 10), sc = scalesList()[0];
    PLAN.rows = [{id: "pp9", patient_id: p.id, version: 1, status: "vigente", plan_date: today, review_date: null, summary: "",
      sections: [{areaId: "a1", objectives: [{id: "o9", goalId: "g1", specIds: [], scaleId: sc.id, levelId: sc.levels[0].id, prazo: 3, status: "ativo"}]}]}];
    var data = planEvoGoalsFor(p.id, null, []), div = document.createElement("div"); div.id = "tmpEvo"; div.innerHTML = planEvoGoalsHtml(data); document.body.appendChild(div);
    var box = div.querySelector("[data-act-on]"); var had = !!box; if (box){ box.checked = true; div.querySelector("[data-goal-on]").checked = true; }
    var rd = planEvoGoalsRead(div, data); div.remove();
    var worked = prGoalsWorkedHtml({plan_goals: [{planId: "pp9", specId: "", objId: "o9", scaleId: sc.id, levelId: sc.levels[0].id, acts: [state.activities[0].id]}]});
    return JSON.stringify({had: had, acts: rd.length ? rd[0].acts : null, show: /Atividades: Caixa Surpresa/.test(worked)}); })()`);
  check('evolution: suggested activity box is read into plan_goals.acts and shown in the timeline?', evo === JSON.stringify({had: true, acts: [await ev('state.activities[0].id')], show: true}), evo);
  // Síntese
  const syn = await ev(`(function(){ var p = state.patients[0]; return planSynthesis(p, [{areaId: "a1", objectives: [{id: "o1", goalId: "g1", specIds: [state.specialties[0].id], status: "ativo"}, {id: "o2", goalId: "g2", specIds: [state.specialties[0].id], status: "atingido"}]}], [state.specialties[0].id]); })()`);
  check('synthesis text has the name, 1 active and 1 achieved objective?', syn.indexOf(await ev('state.patients[0].nome')) === 0 && /1 objetivo ativo, 1 atingido/.test(syn), syn);
  // objetivo com atividade: em uso
  const use = await ev("USAGE.objetivos({id: 'g1', name: 'Pedir ajuda'})");
  check('goal with activity counts as in use?', use.some((t) => /atividade/.test(t)), JSON.stringify(use));
  // editar e excluir
  await page.click('#reg-atividades-host tbody tr'); await page.waitForSelector('#ovAct');
  check('edit window opens with the linked goal?', (await page.$$eval('#acGoals input:checked', (c) => c.length)) === 1 && (await page.inputValue('#acName')) === 'Caixa Surpresa');
  await page.click('#acDel'); await page.waitForSelector('#ovConfirm'); await page.click('#cfOk'); await page.waitForTimeout(300);
  check('delete removes it?', (await ev('state.activities.length')) === 0);
  check('no "Erro —" warning shown on screen?', !/Erro —/.test(await page.evaluate(() => document.body.innerText)));
  console.log('no JS errors?', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  process.exit(fails || errors.length ? 1 : 0);
})();
