// Planner ▾ → Planner List: lista dos atendimentos de pacientes do Planner, filtros, alerta, Ver no Planner e Ctrl+clique.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_pll.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // Dois atendimentos de pacientes em colunas de sala (e um bloqueado, que não entra).
  const setup = await ev(`(function(){
    var rooms = state.rooms.filter(function(r){ return !r.group && r.therapists && r.therapists.length; });
    var r1 = rooms[0], t1 = r1.therapists[0];
    var pats = state.patients.slice(0, 2);
    state.reportDocs = {"seg-1": {bookings: {}}, "qua-3": {bookings: {}}};
    state.reportDocs["seg-1"].bookings["08:00|" + r1.id + "|" + t1.id] = {patient: pats[0].nome, service: "sessao", note: "obs um"};
    state.reportDocs["qua-3"].bookings["09:20|" + r1.id + "|" + t1.id] = {patient: pats[1].nome, service: "sessao"};
    state.reportDocs["qua-3"].bookings["10:00|" + r1.id + "|" + t1.id] = {patient: "", blocked: true};
    return {n1: pats[0].nome, n2: pats[1].nome};
  })()`);
  await ev(`document.querySelector('#mainTabs button[data-tab="plannerlist"]').click()`);
  await page.waitForTimeout(500);
  check('abre a tela Planner List', (await ev(`state.tab`)) === 'plannerlist');
  check('título da tela', /Planner List/.test(await page.textContent('#tab-plannerlist .cad-title')));
  const rows = await page.$$eval('#reg-plannerlist-host tr[data-pll-id]', (t) => t.length);
  check('2 atendimentos (bloqueado fora)', rows === 2, rows);
  check('cartão Pacientes = 2', /2/.test(await page.textContent('#pllSum .fl-card:first-child b')));
  await page.fill('#pllQ', setup.n1.slice(0, 4));
  await page.waitForTimeout(400);
  check('busca por paciente', (await page.$$eval('#reg-plannerlist-host tr[data-pll-id]', (t) => t.length)) === 1);
  check('com um paciente o cartão mostra Por Semana', /1ª: 1/.test(await page.textContent('#pllSum')));
  await page.fill('#pllQ', '');
  await page.waitForTimeout(400);
  await ev(`(function(){ var e = document.getElementById("pllSem"); e.value = "3"; e.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(300);
  check('filtro de semana', (await page.$$eval('#reg-plannerlist-host tr[data-pll-id]', (t) => t.length)) === 1);
  await ev(`(function(){ var e = document.getElementById("pllSem"); e.value = ""; e.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(300);
  // Ctrl+clique em Ver no Planner abre outra aba e mantém a tela.
  await ev(`window.__opened = []; window.open = function(u){ window.__opened.push(u); return null; }; document.querySelector('[data-pll-go]').dispatchEvent(new MouseEvent("click", {bubbles: true, ctrlKey: true}))`);
  const op = await ev(`window.__opened`);
  const spec = op.length ? JSON.parse(decodeURIComponent(new URL(op[0]).searchParams.get('ir'))) : {};
  check('Ctrl+clique abre o Planner em outra aba', op.length === 1 && spec.a === 'planner' && /^(seg|qua)$/.test(spec.day) && !!spec.q, JSON.stringify(spec));
  check('Ctrl+clique mantém a tela', (await ev(`state.tab`)) === 'plannerlist');
  // Clique normal vai ao Planner naquele dia e semana, buscando o paciente.
  await page.click('#reg-plannerlist-host tr[data-pll-id] [data-pll-go]');
  await page.waitForTimeout(500);
  check('clique normal abre o Planner', (await ev(`state.tab`)) === 'planner' && (await page.inputValue('#patientSearch')).length > 0);
  // Exportar.
  await ev(`document.querySelector('#mainTabs button[data-tab="plannerlist"]').click()`);
  await page.waitForTimeout(400);
  await page.click('#pllMenuBtn');
  const dl = page.waitForEvent('download');
  await page.click('[data-pll-act="csv"]');
  const d = await dl;
  check('exporta CSV', /planner-list\.csv/.test(d.suggestedFilename()));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
