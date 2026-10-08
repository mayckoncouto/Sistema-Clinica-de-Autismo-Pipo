// Planner ▾ → Disponibilidade: por dia × horário, atendidos / livres por especialidade, total
// atendido, bloqueios, total disponível e "não ABA"; semana 1ª–4ª ou Todas. Profissional com
// colunas em duas salas conta uma sala só. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_disp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // Menu Planner ▾ tem Disponibilidade abaixo de Resumo; abre a aba.
  const items = await ev('PL_ITEMS.map(function(x){ return x.key; })');
  check('Planner menu: Disponibilidade right after Resumo?', items.indexOf('disponibilidade') === items.indexOf('resumo') + 1, JSON.stringify(items));
  await ev('(function(){ state.tab = "disponibilidade"; document.querySelector(\'[data-tab="disponibilidade"]\').click(); return true; })()');
  await page.waitForSelector('#dispHost table.disp-table');
  const head = await page.$$eval('#dispHost thead tr.disp-h1 th', (r) => r.map((x) => x.textContent));
  const head2 = await page.$$eval('#dispHost thead tr.disp-h2 th', (r) => r.map((x) => x.textContent));
  check('1st title row: Dia, Horário, specialties (atend. / livres), totals?', /^(Recolher|Estender)$/.test(head[0]) && head[1] === 'Horário' && head.some((h) => /atend\. \/ livres/.test(h)) &&
    head.slice(-4).join('|') === 'Reunião|Disponível|Atendido|Individual (não ABA)', JSON.stringify(head));
  const specOrder = await ev('(function(){ return Array.prototype.map.call(document.querySelectorAll("#dispHost thead tr.disp-h1 th.disp-spec"), function(th){ return dispOrderIdx(DISP_SPEC_ORDER.concat(DISP_GROUP_ORDER.map(function(g){ return g; })), th.getAttribute("title")); }).filter(function(x){ return x !== -1; }); })()');
  check('columns in the requested order (Fono, TO, Psicomotricidade, …, Coordenador, Aplicador ABA)?', specOrder.length >= 2 && specOrder.every((x, i) => !i || x > specOrder[i - 1]), JSON.stringify(specOrder));
  check('2nd title row is TOTAL of the week?', head2[0] === 'Total' && head2[1] === '1ª semana' && head2.length === head.length, JSON.stringify(head2));
  const subs = await page.$$eval('#dispHost tr.disp-sub .disp-time', (r) => r.map((x) => x.textContent));
  const dayTots = await page.$$eval('#dispHost tr.disp-daytot .disp-time', (r) => r.map((x) => x.textContent));
  check('Manhã, Tarde and "Total do dia" rows?', subs.includes('Manhã') && subs.includes('Tarde') && dayTots.length >= 1 && dayTots.every((x) => x === 'Total do dia'));
  const look = await page.evaluate(() => {
    const bg = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : ''; };
    return {white: bg('#dispHost tbody tr:not(.disp-alt):not(.disp-sub):not(.disp-daytot) td.disp-n'), gray: bg('#dispHost tbody tr.disp-alt td.disp-n'),
      sub: bg('#dispHost tbody tr.disp-sub td.disp-n'), day: bg('#dispHost tbody tr.disp-daytot td.disp-n'),
      noDrag: !document.querySelector('#dispHost th[draggable]') && !document.getElementById('dispResetCols') && !document.querySelector('#dispHost .pat-col-resizer'),
      fill: document.querySelector('#dispHost table').getBoundingClientRect().width >= document.querySelector('#dispHost .disp-wrap').clientWidth - 2};
  });
  check('time rows alternate white/gray; Manhã/Tarde gray; Total do dia darker; no drag; table fills the window?', look.white !== look.gray && look.sub !== look.day && look.noDrag && look.fill, JSON.stringify(look));

  // Números pelo cálculo (semana 1, segunda).
  const T = await ev('findDayObj("seg").morning[2]');   // horário de teste
  const row = (r, day, time) => r.rows.filter((x) => !x.sub && x.day.key === day && x.time === time)[0].d;
  const specA = await ev('professionalSpecialtyId("ana-terapeuta") || ""');
  const specB = await ev('professionalSpecialtyId("bia-terapeuta") || ""');
  const setBk = (doc, key, val) => ev(`(function(){ var d = state.scheduleDocs["${doc}"] = state.scheduleDocs["${doc}"] || {bookings: {}}; if (${JSON.stringify(val)} === null) delete d.bookings["${key}"]; else d.bookings["${key}"] = ${JSON.stringify(val)}; if (state.reportDocs["${doc}"]) state.reportDocs["${doc}"] = d; return true; })()`);
  // limpa o horário de teste na segunda/1ª
  const keys = await ev(`Object.keys((state.scheduleDocs["seg-1"] || {bookings: {}}).bookings).filter(function(k){ return k.indexOf("${T}|") === 0; })`);
  for (const k of keys) await setBk('seg-1', k, null);
  const freeOf = async (spec) => { const r = await ev('dispCompute([1])'); return row(r, 'seg', T).free[spec] || 0; };
  // Ana também numa segunda sala (duas colunas livres nela).
  await ev('(function(){ state.rooms = state.rooms.concat([{id: "rz", name: "Sala Dois", color: "teal", therapists: [{id: "rz-1", name: "Ana", professionalId: "ana-terapeuta"}, {id: "rz-2", name: "Ana", professionalId: "ana-terapeuta"}]}]); return true; })()');
  const r0 = await ev('dispCompute([1])');
  const d0 = row(r0, 'seg', T);
  // Ana tem coluna em duas salas (Sala Teste e Coordenador): conta uma.
  const anaCols = await ev(`physicalRooms().filter(function(r){ return (r.therapists || []).some(function(t){ return t.professionalId === "ana-terapeuta"; }); }).length`);
  check('professional in two rooms counts ONE room (the one with most free columns)?', anaCols >= 2 && (d0.free[specA] || 0) === 2, JSON.stringify({anaCols, d0}));

  // Grupo de suporte também tem vagas livres, sem contar o mesmo profissional duas vezes.
  const grpHead = await page.$eval('#dispHost thead tr.disp-h1', (e) => /Coordenador\s*atend\. \/ livres/.test(e.textContent));
  check('group column counts free slots too, one place per professional (no double count)?', ((d0.free[specA] || 0) + (d0.free['grp:coord'] || 0)) === 2 && grpHead, JSON.stringify(d0));
  const onlyGrp = await ev(`(function(){ var keep = state.rooms; state.rooms = keep.filter(function(r){ return r.id !== "r1" && r.id !== "rz"; });
    var r = dispCompute([1]); state.rooms = keep; return r.rows.filter(function(x){ return !x.sub && x.day.key === "seg" && x.time === "${T}"; })[0].d.free["grp:coord"] || 0; })()`);
  check('professional only in the group: free counted in the group column?', onlyGrp === 1, onlyGrp);

  // Paciente na coluna da Ana: atendidos +1; livres dela (nas duas salas) somem.
  await setBk('seg-1', `${T}|r1|r1-t1`, {patient: 'Paciente Um', note: '', service: 'sessao'});
  const d1 = row(await ev('dispCompute([1])'), 'seg', T);
  check('booking Ana: atendidos +1 and her free slots drop?', (d1.at[specA] || 0) === (d0.at[specA] || 0) + 1 && (d1.free[specA] || 0) < (d0.free[specA] || 0), JSON.stringify({d0, d1}));

  // Bloqueio de horário na coluna da Bia: livres −1 e NÃO entra em Bloqueios (fica fora da conta).
  const bBefore = d1.free[specB] || 0;
  await setBk('seg-1', `${T}|r1|r1-t2`, {patient: '', lock: true});
  const d2 = row(await ev('dispCompute([1])'), 'seg', T);
  check('time block on Bia: free −1 and NOT counted in Bloqueios?', (d2.free[specB] || 0) === bBefore - 1 && d2.blk === d1.blk, JSON.stringify({d1, d2}));

  // Reunião Clínica / Treinamento: 1 por profissional no horário (mesmo em duas colunas) e as colunas
  // vazias dele deixam de ser vagas (a reunião ocupa o profissional em qualquer sala).
  await setBk('seg-1', `${T}|r1|r1-t1`, null);
  await setBk('seg-1', `${T}|rz|rz-1`, {patient: 'Reunião Clínica', note: ''});
  await setBk('seg-1', `${T}|rz|rz-2`, {patient: 'Treinamento', note: '', training: true});
  const d3 = row(await ev('dispCompute([1])'), 'seg', T);
  check('Reunião + Treinamento of Ana in 2 columns: Bloqueios +1 (once) and Ana has no free slot?', d3.blk === d2.blk + 1 && (d3.free[specA] || 0) === 0, JSON.stringify({d2, d3}));
  await setBk('seg-1', `${T}|rz|rz-1`, null); await setBk('seg-1', `${T}|rz|rz-2`, null);

  // Grupo de Suporte: coluna própria, conta como atendido (entra no Total atendido).
  const gid = await ev('(supportGroups()[0] || {}).id');
  const gseat = await ev('(supportGroups()[0].therapists[0] || {}).id');
  await setBk('seg-1', `${T}|${gid}|${gseat}`, {patient: 'Sala Teste', note: ''});
  const rg = await ev('dispCompute([1])');
  const dg = row(rg, 'seg', T);
  check('group booking counted as attended in the group column?', rg.groups.indexOf(gid) !== -1 && dg.at['grp:' + gid] === 1, JSON.stringify({groups: rg.groups, dg}));
  await setBk('seg-1', `${T}|${gid}|${gseat}`, null);

  // Todas = soma das 4 semanas.
  const tot = await ev(`(function(){ function s(o){ return Object.keys(o).reduce(function(a, k){ return a + o[k]; }, 0); }
    function T(ws){ var r = dispCompute(ws), at = 0, fr = 0; r.rows.forEach(function(x){ if (x.sub){ at += s(x.d.at); fr += s(x.d.free); } }); return [at, fr]; }
    var all = T([1,2,3,4]), sum = [0, 0]; [1,2,3,4].forEach(function(w){ var x = T([w]); sum[0] += x[0]; sum[1] += x[1]; }); return [all, sum]; })()`);
  check('"Todas" = sum of the 4 weeks?', tot[0][0] === tot[1][0] && tot[0][1] === tot[1][1], JSON.stringify(tot));

  // Seletor de semana redesenha; grupos de suporte ficam de fora.
  await page.click('#dispWeekSeg [data-dw="todas"]');
  check('week selector "Todas" is active and total row says "4 semanas"?', (await page.$eval('#dispWeekSeg [data-dw="todas"]', (b) => b.classList.contains('active'))) &&
    /4 semanas/.test(await page.$eval('#dispHost thead tr.disp-h2', (e) => e.textContent)));

  // Nome do dia em todas as linhas.
  const days = await page.$$eval('#dispHost tbody tr td.disp-day', (r) => r.map((x) => x.textContent));
  check('day name on every row of the day?', days.length > 10 && days.every((d) => d), JSON.stringify(days.slice(0, 10)));

  // Recolher (seta no Dia): só os resumos de Manhã/Tarde, com aquecimento entre os resumos.
  check('expanded: toggle says Recolher', (await page.$eval('#dispCollapse', (b) => b.textContent)) === 'Recolher');
  await page.click('#dispCollapse');
  const col = await page.evaluate(() => ({rows: document.querySelectorAll('#dispHost tbody tr:not(.disp-sub):not(.disp-daytot)').length, dayTot: document.querySelectorAll('#dispHost tbody tr.disp-daytot').length, subs: document.querySelectorAll('#dispHost tbody tr.disp-sub').length,
    heat: Array.prototype.some.call(document.querySelectorAll('#dispHost tbody tr.disp-sub td.disp-tot'), (td) => /color-mix/.test(td.getAttribute('style') || ''))}));
  check('collapse shows only Manhã/Tarde and "Total do dia", with heat colors?', col.rows === 0 && col.subs >= 2 && col.dayTot >= 1 && col.heat, JSON.stringify(col));
  check('collapsed: toggle says Estender', (await page.$eval('#dispCollapse', (b) => b.textContent)) === 'Estender');
  await page.click('#dispCollapse');
  check('expanding shows the times again?', (await page.$$('#dispHost tbody tr:not(.disp-sub):not(.disp-daytot)')).length > 0);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
