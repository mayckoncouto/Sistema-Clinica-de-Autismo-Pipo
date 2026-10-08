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
  const head = await page.$$eval('#dispHost thead th', (r) => r.map((x) => x.textContent));
  check('columns: Dia, Horário, specialties (atend. / livres), totals?', head[0] === 'Dia' && head[1] === 'Horário' && head.some((h) => /atend\. \/ livres/.test(h)) &&
    head.slice(-4).join('|') === 'Total atendido|Bloqueios / reuniões|Total disponível|Não ABA', JSON.stringify(head));
  const subs = await page.$$eval('#dispHost tr.disp-sub .disp-time', (r) => r.map((x) => x.textContent));
  check('subtotal per period (Manhã/Tarde) and a final total?', subs.includes('Manhã') && subs.includes('Tarde') && (await page.$('#dispHost tr.disp-total')) !== null);

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

  // Todas = soma das 4 semanas.
  const tot = await ev(`(function(){ function s(o){ return Object.keys(o).reduce(function(a, k){ return a + o[k]; }, 0); }
    function T(ws){ var r = dispCompute(ws), at = 0, fr = 0; r.rows.forEach(function(x){ if (x.sub){ at += s(x.d.at); fr += s(x.d.free); } }); return [at, fr]; }
    var all = T([1,2,3,4]), sum = [0, 0]; [1,2,3,4].forEach(function(w){ var x = T([w]); sum[0] += x[0]; sum[1] += x[1]; }); return [all, sum]; })()`);
  check('"Todas" = sum of the 4 weeks?', tot[0][0] === tot[1][0] && tot[0][1] === tot[1][1], JSON.stringify(tot));

  // Seletor de semana redesenha; grupos de suporte ficam de fora.
  await page.click('#dispWeekSeg [data-dw="todas"]');
  check('week selector "Todas" is active and total row says "4 semanas"?', (await page.$eval('#dispWeekSeg [data-dw="todas"]', (b) => b.classList.contains('active'))) &&
    /4 semanas/.test(await page.$eval('#dispHost tr.disp-total', (e) => e.textContent)));

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
