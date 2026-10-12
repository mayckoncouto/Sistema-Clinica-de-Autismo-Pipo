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

  await ev(`(function(){
    var pat = state.patientsRaw.filter(function(p){ return p.id === "carla-laranja"; })[0];
    state.treatments = [{id: "ap1", patientId: pat.id, inicio: "2026-01-01", status: "ativo", tipo: "novo", vencPor: "sem",
      specHours: [{id: "f", specId: "fono", hours: 4, profId: "bia-terapeuta", service: "sessao", aba: "Sim"}]}];
    rebuildPatients();
  })()`);
  const before = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);

  await page.click('#plToolsBtn'); await page.click('#autoPlannerBtn');
  await page.waitForSelector('#apRun');
  await page.$eval('#apPat', (s) => { s.value = 'carla-laranja'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#apRun');
  await page.waitForSelector('#apOut details');
  const n = await page.locator('#apOut .fr-day > div').count();
  check('proposes only the 3 missing sessions (one already exists in 2nd week, counted via the quadro)?', n === 3, n);
  const weeks = await page.locator('#apOut .fr-day .mono').evaluateAll((els) => els.map((e) => e.textContent.replace(/^.*?·\s*/, '')));
  check('same day and time every week (family routine)?', new Set(weeks).size === 1, weeks.join(' | '));
  check('nothing written before applying?', (await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`)) === before);
  check('Apply shows the count?', (await page.innerText('#apApply')).includes('(3)'));

  await page.click('#apApply');
  await page.waitForFunction(() => !document.getElementById('ovAp'));
  await page.waitForTimeout(300);
  const mine = await ev(`(function(){ var out = []; Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).forEach(function(k){
    var b = window.__STORE__[k].bookings; Object.keys(b).forEach(function(key){ if (b[key] && b[key].patient === "Carla Laranja") out.push(k + "#" + key); }); }); return out; })()`);
  check('4 bookings now (1 old + 3 new in Bia\'s column)?', mine.length === 4 && mine.filter((x) => /\|r1\|r1-t2$/.test(x)).length === 3, mine.join(','));
  const weeksSaved = new Set(mine.map((x) => x.split('#')[0].split('-')[1]));
  check('one per week?', weeksSaved.size === 4);
  const after = await ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("schedule/") === 0; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);
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

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
