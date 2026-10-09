// Planner: zoom na barra; Agenda: trocar de semana mostra a grade apagada com "Carregando…".
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const f = path.join(__dirname, 'page_loading.html'); fs.writeFileSync(f, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const b = await chromium.launch(require('./launch-opts'));
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; let fails = 0; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + f); await p.waitForTimeout(1200);
  // Planner: zoom na barra (não flutua mais por cima da legenda) e sem o texto longo no rodapé
  const pl = await p.evaluate(() => ({inBar: !!document.querySelector('#tab-planner .controls #zoomCtrl'), pos: getComputedStyle(document.getElementById('zoomCtrl')).position, note: !!document.querySelector('#tab-planner .foot-note')}));
  console.log('Planner: zoom in the toolbar, no long footnote?', pl.inBar && pl.pos !== 'fixed' && !pl.note, JSON.stringify(pl));
  if (!(pl.inBar && pl.pos !== 'fixed' && !pl.note)) fails++;
  // Agenda: simula troca de semana com leitura lenta
  const r = await p.evaluate(() => window.__ev(`(async function(){
    var resolveIt; var rows = [{id:"x1", date:"2030-01-14", time:"08:00", professional_id:"ana-terapeuta", room_id:"r1", patient:"Paciente Um", service:"sessao"}];
    function q(){ var o = {}; ["select","gte","lte","order","eq","limit"].forEach(function(m){ o[m] = function(){ return o; }; });
      o.range = function(){ return new Promise(function(res){ resolveIt = function(){ res({data: rows}); }; }); };
      o.then = function(a, b){ return Promise.resolve({data: []}).then(a, b); }; return o; }
    var fake = {from: q, channel: function(){ var ch = {on: function(){ return ch; }, subscribe: function(){ return ch; }}; return ch; }};
    agdClient = function(){ return fake; };
    document.querySelector('#mainTabs button[data-tab="agenda"]').click();
    AD.error = ""; AD.loaded = true; AD._loadedRange = "2030-01-07|2030-01-13"; AD.rows = {}; AD.view = "semana"; AD.mode = "prof"; AD.sel = "ana-terapeuta";
    AD.date = new Date(2030, 0, 7); agdRender();
    AD.date = new Date(2030, 0, 14); var p = agdLoadWeek();
    await new Promise(function(r){ setTimeout(r, 50); });
    var g = document.getElementById("agdGrid");
    var during = {table: !!g.querySelector("table"), cls: g.classList.contains("agd-loading"), tag: !!document.querySelector("#agdTitle .agd-loading-tag")};
    resolveIt(); await p;
    var after = {cls: g.classList.contains("agd-loading"), tag: !!document.querySelector("#agdTitle .agd-loading-tag"), shows: /Paciente Um/.test(g.textContent)};
    return {during: during, after: after};
  })()`));
  const ok = r.during.table && r.during.cls && r.during.tag && !r.after.cls && !r.after.tag && r.after.shows;
  console.log('Agenda: changing week keeps the grid dimmed with "Carregando…", then shows the bookings?', ok, JSON.stringify(r));
  if (!ok) fails++;
  console.log('no page errors?', !errs.length, errs.join(' | ')); if (errs.length) fails++;
  await b.close(); fs.unlinkSync(f);
  console.log(fails ? 'FAIL (' + fails + ')' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
