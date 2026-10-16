// Planner ▾ Outras Opções → Auto Planner: propõe as sessões que faltam a partir dos quadros do tratamento.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ap.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);

  const check0 = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);
  // Planner de verdade antes de abrir o Auto Planner (precisa ficar igual no fim)
  const plannerBefore = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).sort().map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);
  // O Auto Planner começa sem registros: quem tiver dados próprios é simulado copiando para autoplan/*
  check0('Auto Planner starts with no records of its own?', (await ev(`Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).length`)) === 0);
  check0('Planner shows no Auto Planner controls (Montar Proposta hidden, no title)?', await page.$eval('#autoPlannerBtn', (b) => b.hidden) && await page.$eval('#plAutoTitle', (b) => b.hidden));
  await ev(`(function(){ Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).forEach(function(k){ window.__STORE__[k.replace("schedule/", "autoplan/")] = JSON.parse(JSON.stringify(window.__STORE__[k])); }); })()`);
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForSelector('#gridHost .book');
  check0('Auto Planner open: title shown, Montar Proposta visible, Trocar Profissional hidden?', !(await page.$eval('#plAutoTitle', (b) => b.hidden)) && !(await page.$eval('#autoPlannerBtn', (b) => b.hidden)) && (await page.$eval('#swapProfBtn', (b) => b.hidden)));
  check0('hash is #autoplanner?', (await page.evaluate(() => location.hash)) === '#autoplanner');
  check0('the grid reads the autoplan/* documents?', (await ev(`PLA.on && schedPath("seg-1") === "autoplan/seg-1" && Object.keys(state.scheduleSubs).length > 0`)));
  await ev(`(function(){
    var pat = state.patientsRaw.filter(function(p){ return p.id === "carla-laranja"; })[0];
    state.treatments = [{id: "ap1", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", vencPor: "sem",
      specHours: [{id: "f", specId: "fono", hours: 4, profId: "bia-terapeuta", service: "sessao", aba: "Sim"}]}];
    rebuildPatients();
  })()`);
  const before = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);

  await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn');
  await page.waitForSelector('#apRun');
  await page.$eval('#apPat', (s) => { s.value = 'carla-laranja'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun');
  await page.waitForSelector('#apOut details');
  const n = await page.locator('#apOut .fr-day > div').count();
  check('proposes only the 3 missing sessions (one already exists in 2nd week, counted via the quadro)?', n === 3, n);
  const weeks = await page.locator('#apOut .fr-day .mono').evaluateAll((els) => els.map((e) => e.textContent.replace(/^.*?·\s*/, '')));
  check('same day and time every week (family routine)?', new Set(weeks).size === 1, weeks.join(' | '));
  check('nothing written before applying?', (await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`)) === before);
  check('Apply shows the count?', (await page.innerText('#apApply')).includes('(3)'));

  await page.click('#apApply');
  await page.waitForFunction(() => !document.getElementById('ovAp'));
  await page.waitForTimeout(300);
  const mine = await ev(`(function(){ var out = []; Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).forEach(function(k){
    var b = window.__STORE__[k].bookings; Object.keys(b).forEach(function(key){ if (b[key] && b[key].patient === "Carla Laranja") out.push(k + "#" + key); }); }); return out; })()`);
  check('4 bookings now (1 old + 3 new in Bia\'s column)?', mine.length === 4 && mine.filter((x) => /\|r1\|r1-t2$/.test(x)).length === 3, mine.join(','));
  const weeksSaved = new Set(mine.map((x) => x.split('#')[0].split('-')[1]));
  check('one per week?', weeksSaved.size === 4);
  const after = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("autoplan/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);
  const was = JSON.parse(before), now = JSON.parse(after);
  let untouched = true;
  was.forEach(([k, b]) => { const nb = now.find((x) => x[0] === k)[1]; Object.keys(b).forEach((key) => { if (JSON.stringify(nb[key]) !== JSON.stringify(b[key])) untouched = false; }); });
  check('nothing that was already booked changed?', untouched);

  // de novo: nada a completar
  await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn');
  await page.$eval('#apPat', (s) => { s.value = 'carla-laranja'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun');
  await page.waitForFunction(() => /Nada a completar/.test(document.getElementById('apOut').innerText));
  check('second run: nothing left to complete?', true);

  // sem profissional da especialidade: vai para "Não couberam"
  await ev(`(function(){ state.treatments = [{id: "ap2", patientId: "carla-laranja", inicio: "2026-01-01", status: "ativo", tipo: "novo", vencPor: "sem",
      specHours: [{id: "x", specId: "nao-existe", hours: 2, service: "sessao", aba: "Sim"}]}]; rebuildPatients(); })()`);
  await page.click('#apCancel'); await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn');
  await page.$eval('#apPat', (s) => { s.value = 'carla-laranja'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun');
  await page.waitForFunction(() => /Não Couberam/i.test(document.getElementById('apOut').innerText));
  check('unplaceable quadro is listed with the reason?', /Nenhuma coluna/.test(await page.innerText('#apOut')));


  // ---- grupo ABA: dois pacientes da mesma faixa etária (10+) com Fono dividem a sala no mesmo horário; faixa diferente não ----
  await page.click('#apCancel');
  await ev(`(async function(){
    var db = await window.claude.use('db');
    var cur = JSON.parse(JSON.stringify(window.__STORE__['config/rooms']));
    var r1 = cur.list.filter(function(r){ return r.id === 'r1'; })[0];
    r1.therapists.push({id: 'r1-t3', name: 'Bia 2', professionalId: 'bia-terapeuta'});
    await db.doc('config/rooms').set(cur);
    var pr = JSON.parse(JSON.stringify(window.__STORE__['patients/all']));
    pr.list.forEach(function(x){ if (x.id === 'bruno-verde' || x.id === 'duda-vermelho') x.idade = 12; if (x.id === 'ana-azul') x.idade = 3; });
    await db.doc('patients/all').set(pr);
  })()`);
  await page.waitForTimeout(400);
  await ev(`(function(){
    state.treatments = ['duda-vermelho', 'bruno-verde', 'ana-azul'].map(function(id, i){ return {id: 'g' + i, patientId: id, inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem',
      specHours: [{id: 'f' + i, specId: 'fono', hours: 4, profId: 'bia-terapeuta', service: 'sessao', aba: 'Sim', dia: id === 'ana-azul' ? 'qui' : 'ter', hora: '07:20'}]}; });
    rebuildPatients();
  })()`);
  const grp = await ev(`(function(){
    var pats = state.patients.filter(function(p){ return ['duda-vermelho', 'bruno-verde', 'ana-azul'].indexOf(p.id) !== -1; });
    var plan = apBuild(pats), by = {};
    plan.items.forEach(function(it){ var k = it.w + '|' + it.day + '|' + it.time + '|' + it.room.id; (by[k] = by[k] || []).push(it.p.id + ':' + it.group); });
    return JSON.stringify(by) + ' GAPS ' + JSON.stringify(plan.gaps.map(function(x){ return [x.p.id, x.falta, x.why.slice(0,30)]; }));
  })()`);
  const g = JSON.parse(grp.split(' GAPS ')[0]);
  const sameSlot = Object.values(g).some((l) => l.some((x) => x.startsWith('duda')) && l.some((x) => x.startsWith('bruno')));
  check('same age band + same specialty share the room at the same time?', sameSlot, grp);
  check('different age band (Ana, 3 anos) is never put with them?', !Object.values(g).some((l) => l.some((x) => x.startsWith('ana')) && l.length > 1), grp);

  // ---- marca e remoção; irmãos; terapeutas compatíveis ----
  const aplic = await ev(`(function(){
    state.specialties = state.specialties.concat([{id: 'aplic', name: 'Aplicador ABA'}]);
    var a = {id: 'x1', specialtyId: 'fono'}, b = {id: 'x2', specialtyId: 'psico'}, c = {id: 'x3', specialtyId: 'aplic'}, d = {id: 'x4', specialtyId: 'psico', complementares: ['aplic']};
    return [apProfCompat(a, b), apProfCompat(a, c), apProfCompat(a, d), apProfCompat(b, {id: 'x5', specialtyId: 'psico'})].join(',');
  })()`);
  check('therapists compatible only with same specialty or Aplicador ABA (principal or complementar)?', aplic === 'false,true,true,true', aplic);
  await ev(`(function(){
    var m = {nome: 'Maria Souza Lima', cpf: ''};
    state.patients.forEach(function(p){ if (p.id === 'bruno-verde' || p.id === 'duda-vermelho') p.mae = m; });
  })()`);
  const sib = await ev(`JSON.stringify([apSibIds(state.patients.filter(function(p){ return p.id === 'bruno-verde'; })[0]), apSibIds(state.patients.filter(function(p){ return p.id === 'ana-azul'; })[0])])`);
  check('siblings found by the mother\'s name?', sib === '[["duda-vermelho"],[]]', sib);
  const marked = await ev(`(function(){
    state.treatments = [{id: 'm1', patientId: 'paciente-um', inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem', specHours: [{id: 'q', specId: 'fono', hours: 2, profId: 'bia-terapeuta', service: 'sessao', aba: 'Não'}]}];
    rebuildPatients();
    var plan = apBuild(state.patients.filter(function(p){ return p.id === 'paciente-um'; }));
    return JSON.stringify({n: plan.items.length, auto: plan.items.every(function(i){ return i.rec.auto === true; })});
  })()`);
  check('everything the Auto Planner proposes is marked auto:true?', /"auto":true/.test(marked) && !/"n":0/.test(marked), marked);


  // ---- separação: o Planner de verdade não mudou nada; enviar / remover ----
  const plannerAfter = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).sort().map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);
  check0('Planner records untouched by everything done in the Auto Planner?', plannerAfter === plannerBefore);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
