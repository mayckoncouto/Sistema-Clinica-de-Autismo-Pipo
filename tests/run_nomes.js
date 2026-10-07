// Revisão de nomes (2026-10-07): nomes antigos continuam sendo lidos como os novos
// (permissões dos níveis, campos do tratamento, nome do profissional, endereços).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  // Permissões: formato antigo ↔ novo (js/pipo-supabase.js).
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipo-supabase.js'), 'utf8');
  const a = js.indexOf('  var PERM_OLD'), b = js.indexOf('  window.pipoPerms');
  const P = new Function(js.slice(a, b) + '; return {up: permsUpgrade, down: permsDowngrade, isNew: permsIsNew};')();
  const old = {agenda: {view: true, edit: true}, agendamentos: {view: true, create: true}, rh_funcionarios: {view: true}, rh_remuneracao: {view: false}, pacientes: {view: true}};
  const up = P.up(old);
  console.log('old role read in the new names?', up.planner.edit === true && up.agenda.create === true && up.agenda.edit === undefined && up.colaboradores.view === true &&
    up.colaboradores_valores.view === false && up.pacientes.view === true && !('agendamentos' in up) && !('rh_funcionarios' in up), JSON.stringify(up));
  const nw = {planner: {view: true}, agenda: {view: true, create: true}, colaboradores: {view: true}};
  console.log('new role stays as it is?', JSON.stringify(P.up(nw)) === JSON.stringify(nw));
  const down = P.down(up);
  console.log('saving to an old database converts back?', down.agenda.edit === true && down.agendamentos.create === true && down.rh_funcionarios.view === true && !('planner' in down), JSON.stringify(down));

  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_nomes.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  const tr = await ev(`JSON.stringify(trNormLegacy({id: "t", pacoteHoras: 8, despesas: 50}))`);
  console.log('old treatment fields read as Sessão/Mês and Descontos?', tr === '{"id":"t","sessoesMes":8,"descontos":50}', tr);
  const pr = await ev(`(function(){ var p = profNorm({id: "x", name: "Fulana"}); return [p.nome, p.name, JSON.stringify(p), profNome({name: "Antiga"})]; })()`);
  console.log('professional "name" becomes "nome" (".name" still reads it, not saved)?', JSON.stringify(pr) === JSON.stringify(['Fulana', 'Fulana', '{"id":"x","nome":"Fulana"}', 'Antiga']), JSON.stringify(pr));
  const loaded = await ev(`state.professionals.every(function(p){ return p.nome && p.name === p.nome; })`);
  console.log('professionals loaded from the old format have "nome"?', loaded);
  const hashes = await ev(`["agendadia", "relatorio", "funcionarios", "tiposfunc", "planner"].map(navOldHash).join(",")`);
  console.log('old addresses open the renamed screens?', hashes === 'agenda,resumo,colaboradores,tiposcolab,planner', hashes);
  const tabs = await page.$$eval('#mainTabs button[data-tab]', (bs) => bs.map((b) => b.getAttribute('data-tab')));
  console.log('screens use the new names (planner, agenda, resumo, colaboradores)?', ['planner', 'agenda', 'resumo', 'colaboradores', 'tiposcolab'].every((t) => tabs.includes(t)) &&
    !['agendadia', 'relatorio', 'funcionarios', 'tiposfunc'].some((t) => tabs.includes(t)), tabs.join(','));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
