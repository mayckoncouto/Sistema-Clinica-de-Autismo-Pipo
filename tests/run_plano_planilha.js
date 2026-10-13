// Plano Terapêutico → Outras Opções → Exportar / Importar planilha. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_pip.html');
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
  await ev("state.skillAreas = [{id: 'h1', name: 'Comunicação'}, {id: 'h2', name: 'Autonomia'}]");
  await ev("state.goalBank = [{id: 'g1', name: 'Pedir ajuda', areaId: 'h1', faixas: [], specIds: []}, {id: 'g2', name: 'Escovar os dentes', areaId: 'h2', faixas: [], specIds: []}]");
  const pat = await ev("state.patientsRaw[0].nome");
  const spec = await ev("state.specialties[0].name");
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="planos"]').click());
  await page.waitForTimeout(300);
  check('Outras Opções menu in Plano Terapêutico (export, import)?', (await page.$$eval('#tab-planos [data-io-wrap] [data-io-act]', (b) => b.map((x) => x.getAttribute('data-io-act')))).join() === 'export,import');
  const tsv = (rows) => rows.map((r) => r.join('\\t')).join('\\n');
  const T1 = 'Paciente\\tData do Plano\\tResumo do Quadro Clínico\\tHabilidade\\tObjetivo\\tEspecialidades\\tPrazo (Meses)\\n' +
    pat + '\\t01/10/2026\\tResumo teste\\tComunicação\\tPedir ajuda\\t' + spec + '\\t6\\n' +
    pat + '\\t\\t\\tAutonomia\\tEscovar os dentes\\t' + spec + '\\t3\\n' +
    pat + '\\t\\t\\tAutonomia\\tObjetivo Que Não Existe\\t\\t\\n' +
    'Fulano Inexistente\\t\\t\\tComunicação\\tPedir ajuda\\t\\t\\n';
  const p1 = await ev(`(function(){ var r = ioRecords("planos", xlParseText("${T1}")).recs; var p = ioPlanPlan(r); return p.items.map(function(i){ return i.st + ':' + i.warn.length; }); })()`);
  check('plan: new plan for known patient (1 warning for unknown goal), unknown patient = problem?', p1.join('|') === 'novo:1|problema:0', p1.join('|'));
  const done = await ev(`(function(){ var r = ioRecords("planos", xlParseText("${T1}")).recs; var p = ioPlanPlan(r); return ioPlanApply(p).then(function(m){ return m + '|' + PLAN.rows.length; }); })()`);
  check('apply creates the plan?', /importados\.\|1/.test(done), done);
  const pl = await ev("(function(){ var r = PLAN.rows[0]; return JSON.stringify({d: r.plan_date, rv: r.review_date, s: r.summary, st: r.status, n: r.sections.map(function(s){ return s.areaId + ':' + s.objectives.map(function(o){ return o.goalId + '/' + o.prazo + '/' + o.specIds.length; }).join(','); })}); })()");
  const o = JSON.parse(pl);
  check('plan saved with date, review 6 months later, summary and 2 sections (prazo 6 and 3)?', o.d === '2026-10-01' && o.rv === '2027-03-31' && o.s === 'Resumo teste' && o.st === 'vigente' && o.n.join('|') === 'h1:g1/6/1|h2:g2/3/1', pl);
  // exportar
  const exp = await ev('ioPlanExportRows()');
  check('export: one row per objective, summary only on the first row?', exp.length === 2 && exp[0].resumo === 'Resumo teste' && !exp[1].resumo && exp[0].habilidade === 'Comunicação' && exp[0].objetivo === 'Pedir ajuda' && exp[0].prazo === 6, JSON.stringify(exp));
  // reimportar a própria exportação = igual; mudar prazo e status = atualizar
  const T2 = 'Paciente\\tHabilidade\\tObjetivo\\tPrazo (Meses)\\tStatus\\n' + pat + '\\tComunicação\\tPedir ajuda\\t6\\t\\n' + pat + '\\tAutonomia\\tEscovar os dentes\\t12\\tSuspenso\\n';
  const p2 = await ev(`(function(){ var p = ioPlanPlan(ioRecords("planos", xlParseText("${T2}")).recs); return p.items[0].st + ':' + p.items[0].msgs.length; })()`);
  check('existing plan: only the changed objective shows (prazo + status) = atualizar?', /^atualizar:1$/.test(p2), p2);
  await ev(`(function(){ var p = ioPlanPlan(ioRecords("planos", xlParseText("${T2}")).recs); return ioPlanApply(p); })()`);
  const o2 = await ev("JSON.stringify(PLAN.rows[0].sections[1].objectives[0])");
  const ob = JSON.parse(o2);
  check('objective updated: prazo 12, suspenso, same id, no objective removed?', ob.prazo === 12 && ob.status === 'suspenso' && ob.goalId === 'g2');
  check('plan still has 2 objectives and one vigente version?', (await ev("PLAN.rows.length")) === 1 && (await ev("PLAN.rows[0].sections.reduce(function(n, s){ return n + s.objectives.length; }, 0)")) === 2);
  const same = await ev(`(function(){ var p = ioPlanPlan(ioRecords("planos", xlParseText("${T2}")).recs); return p.items[0].st; })()`);
  check('importing the same data again = igual?', same === 'igual', same);
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close(); fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
