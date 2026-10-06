// Fluidez: Agenda junta redesenhos do tempo real, lê a semana em páginas e troca só
// as células que mudaram; Planner Todos×Todos desenha sob demanda; tela cheia.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_fluidez.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // --- Agenda: só as células que mudaram são trocadas
  const patch = await ev(`(function(){
    agdClient = function(){ return null; };
    AD.error = ""; AD.loaded = true; AD.rows = {}; AD.view = "semana"; AD.mode = "prof"; AD.sel = "ana-terapeuta"; AD.date = new Date(2030, 0, 7);
    document.getElementById("tab-agendadia").hidden = false;
    agdRender();
    var tds = document.querySelectorAll('#agdGrid td.agd-slot'); tds.forEach(function(td){ td.__tag = 1; });
    var table = document.querySelector('#agdGrid table');
    AD.rows = {x1: {id: "x1", date: "2030-01-07", time: "08:00", professional_id: "ana-terapeuta", room_id: "r1", patient: "Paciente Um", note: "", service: "sessao"}};
    agdRender();
    var after = document.querySelectorAll('#agdGrid td.agd-slot'), kept = 0, fresh = [];
    after.forEach(function(td){ if (td.__tag) kept++; else fresh.push(td.getAttribute("data-d") + " " + td.getAttribute("data-t")); });
    return {total: after.length, kept: kept, fresh: fresh, sameTable: table === document.querySelector('#agdGrid table'), shows: /Paciente Um/.test(document.getElementById("agdGrid").textContent)};
  })()`);
  check('Agenda: only the changed cell is replaced?', patch.sameTable && patch.shows && patch.fresh.length === 1 && patch.fresh[0] === '2030-01-07 08:00' && patch.kept === patch.total - 1, JSON.stringify(patch));

  // --- Agenda: várias mudanças em tempo real = um redesenho só
  const burst = await ev(`(async function(){
    var n = 0, orig = agdRender; agdRender = function(){ n++; return orig.apply(this, arguments); };
    state.tab = "agendadia";
    for (var k = 0; k < 200; k++) agdRenderIfVisible();
    await new Promise(function(r){ setTimeout(r, 400); });
    agdRender = orig; state.tab = "agenda";
    return n;
  })()`);
  check('Agenda: 200 realtime changes = 1 redraw?', burst === 1, burst);

  // --- Agenda: semana com mais de 1000 atendimentos chega inteira (páginas)
  const pages = await ev(`(async function(){
    var rows = []; for (var k = 0; k < 2345; k++) rows.push({id: "a" + String(k).padStart(5, "0"), date: "2030-01-08", time: "08:00", professional_id: "ana-terapeuta", patient: "Paciente Um"});
    var calls = 0;
    function q(){ var o = {}, from = 0, to = 0;
      ["select","gte","lte","order","eq"].forEach(function(m){ o[m] = function(){ return o; }; });
      o.range = function(a, b){ from = a; to = b; calls++; return Promise.resolve({data: rows.slice(a, b + 1)}); };
      return o; }
    var fake = {from: q, channel: function(){ var ch = {on: function(){ return ch; }, subscribe: function(){ return ch; }}; return ch; }};
    agdClient = function(){ return fake; };
    AD.channel = null; AD.loaded = false; AD._loadedRange = null;
    await agdLoadWeek();
    var n = Object.keys(AD.rows).length;
    agdClient = function(){ return null; }; AD.channel = null;
    return {n: n, calls: calls};
  })()`);
  check('Agenda: week with 2345 bookings loads them all (3 pages)?', pages.n === 2345 && pages.calls === 3, JSON.stringify(pages));

  // --- Planner Todos×Todos: cada tabela só é desenhada quando chega perto da tela
  await page.evaluate(() => { location.hash = '#planner'; });
  await ev(`(function(){ var b = document.querySelector('#mainTabs button[data-tab="agenda"]'); b.click(); })()`);
  await page.waitForTimeout(400);
  await page.click('#daySeg button[data-day="todos"]'); await page.click('#weekSeg button[data-week="todos"]');
  await page.waitForTimeout(600);
  const cv = await ev(`(function(){ var p = document.querySelectorAll('#gridHost .week-panel.cv-lazy');
    return {n: p.length, cv: p.length ? getComputedStyle(p[0]).contentVisibility : "", size: p.length ? p[0].style.containIntrinsicSize : "", tables: document.querySelectorAll('table.sched').length}; })()`);
  check('Todos×Todos: 20 tables, each drawn on demand (content-visibility)?', cv.n === 20 && cv.tables === 20 && cv.cv === 'auto' && /auto/.test(cv.size), JSON.stringify(cv));
  await page.click('#daySeg button[data-day="seg"]'); await page.click('#weekSeg button[data-week="1"]');
  await page.waitForTimeout(400);
  const single = await ev(`document.querySelectorAll('#gridHost .cv-lazy').length`);
  check('one day × one week: no lazy wrapper?', single === 0, single);

  // --- Tela cheia
  await page.click('#tab-agenda [data-full-toggle]');
  await page.waitForTimeout(200);
  const fs1 = await ev(`(function(){ var vis = function(sel){ var e = document.querySelector(sel); return !!(e && e.offsetParent !== null); };
    return {full: document.body.classList.contains("grid-full"), top: vis(".topbar"), bar: vis("#tab-agenda .controls"), legend: vis("#tab-agenda .color-legend"), grid: vis("#gridHost table.sched"), exit: document.getElementById("fullExit").getBoundingClientRect().width > 0}; })()`);
  check('full screen: only the grid + exit button?', fs1.full && !fs1.top && !fs1.bar && !fs1.legend && fs1.grid && fs1.exit, JSON.stringify(fs1));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const fs2 = await ev(`({full: document.body.classList.contains("grid-full"), top: document.querySelector(".topbar").offsetParent !== null})`);
  check('Esc leaves full screen?', !fs2.full && fs2.top, JSON.stringify(fs2));

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
