// Auto Planner com uma clínica fictícia do tamanho da real (ver bench-clinic.js): mede quantas sessões o motor consegue colocar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const makeClinic = require('./bench-clinic');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_apb.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);
  const scen = process.argv[2] || 'real';   // real | fora (permite horário fora da janela) | wide | nowin
  const C = makeClinic(scen === 'wide' ? { windowFactor: 2.5 } : scen === 'nowin' ? { noWindow: true } : {});
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('config/specialties').set({list: ${JSON.stringify(C.specs)}});
    await db.doc('config/professionals').set({list: ${JSON.stringify(C.profs)}});
    await db.doc('config/rooms').set({list: ${JSON.stringify(C.rooms)}});
    await db.doc('patients/all').set({list: ${JSON.stringify(C.patients)}});
  })()`);
  await page.waitForTimeout(600);
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForTimeout(400);
  await ev(`(function(){ state.treatments = ${JSON.stringify(C.treatments)}.map(function(t){ return Object.assign({inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem'}, t); }); rebuildPatients(); state.scheduleDocs = {}; })()`);
  const t0 = Date.now();
  const seeds = (process.env.SEEDS || '0').split(',').map(Number);
  for (const sd of seeds) {
  const r = await ev(`(function(){ var t0 = Date.now(); var plan = apBuild(state.patients.slice(), ${JSON.stringify({ seed: sd, order: process.env.ORD, budget: +(process.env.BUDGET || 6000), foraJanela: scen === 'fora' })});
    var need = 0; plan.diag.forEach(function(d){ need += d.hours; });
    var miss = plan.gaps.reduce(function(a, g){ return a + g.falta; }, 0);
    var grp = plan.goal.filter(function(g){ return g.ok; }).length;
    var unav = 0; plan.viab.forEach(function(v){ unav += Math.max(0, Math.ceil(v.sem * 4) - v.slots * 4); });
    var gs = {}; plan.gaps.forEach(function(g){ var k = g.line.specId + (g.tk.cls === 2 ? '/ABAsim' : '/outros') + '/' + apBandId(g.p); gs[k] = (gs[k] || 0) + g.falta; });
    var rej = {}; plan.gaps.forEach(function(g){ var r = g.rej || {}; Object.keys(r).forEach(function(k){ rej[k] = (rej[k] || 0) + r[k]; }); });
    var hist = {}; plan.items.forEach(function(it){ if (it.abaSim) hist[it.group || 0] = (hist[it.group || 0] || 0) + 1; });
    var bySp = {}; plan.items.forEach(function(it){ if (!it.abaSim) return; var k = it.line.specId + (it.room.aba ? '/aba' : '/n'); bySp[k] = bySp[k] || [0, 0]; bySp[k][(it.group || 0) >= 2 ? 1 : 0]++; });
    var avgPct = 0; plan.goal.forEach(function(g){ avgPct += g.pct; }); avgPct = plan.goal.length ? Math.round(avgPct / plan.goal.length) : 0;
    return JSON.stringify({soloGrupo: bySp, fora: plan.fora, gapsPor: gs, minimoInevitavel: unav, hist: hist, pctMedio: avgPct, pacientes: state.patients.length, quadros: plan.diag.length, sessoes: need, colocadas: plan.items.length, faltam: miss, gaps: plan.gaps.length, abaSimPac: plan.goal.length, metaOk: grp, ejected: plan.ejected, ms: Date.now() - t0, rej: rej}); })()`).then(JSON.parse);
  console.log(scen, 'seed', sd, JSON.stringify(r));
  if (!process.env.NOCHECK) {
    const base = 1972;
    if (scen === 'real') check('real-size clinic: at least 97% of the sessions placed inside the patients windows (was 96,5% before the swap chain)?', r.colocadas >= base * 0.97 && r.sessoes === base, r.colocadas + '/' + r.sessoes);
    if (scen === 'fora') check('with "fora do horário" allowed every session is placed and the ones outside are flagged?', r.faltam === 0 && r.fora > 0 && r.fora <= 80, r.fora);
    if (scen === 'nowin') check('without windows every session is placed?', r.faltam === 0);
    check('ABA Sim sessions end up in groups at least 65% of the time (mean per patient)?', r.pctMedio >= 65, r.pctMedio);
    check('gaps explain why (rejection counters filled)?', r.faltam === 0 || Object.keys(r.rej).length > 0, JSON.stringify(r.rej));
    check('finishes in under 30 s?', r.ms < 30000, r.ms);
  }
  }
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
})();
