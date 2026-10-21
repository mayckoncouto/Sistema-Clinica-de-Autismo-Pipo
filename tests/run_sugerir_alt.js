// Sugerir Agendamento: o motivo descreve a regra do Sistema que barrou e, quando a especialidade que falta não cabe,
// sugere a sessão em outra especialidade do tratamento (mesmo serviço), respeitando as regras dela.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_sgalt.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (l, ok, x) => { console.log(l, !!ok, x === undefined ? '' : x); if (!ok) fails++; };
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('config/specialties').set({list: [{id: 'fono', name: 'Fonoaudiologia', sigla: 'FN'}, {id: 'fisio', name: 'Fisioterapia', sigla: 'FT'}]});
    await db.doc('config/professionals').set({list: [{id: 'f1', nome: 'Fono Um', name: 'Fono Um', specialtyId: 'fono'}, {id: 'f2', nome: 'Fisio Dois', name: 'Fisio Dois', specialtyId: 'fisio'}]});
    await db.doc('config/rooms').set({list: [
      {id: 'rA', name: 'Fonoaudiologia', aba: false, color: 'teal', therapists: [{id: 'a1', name: 'Fono Um', professionalId: 'f1'}]},
      {id: 'rB', name: 'Fisioterapia', aba: false, color: 'teal', therapists: [{id: 'b1', name: 'Fisio Dois', professionalId: 'f2'}]},
      {id: 'rC', name: 'Sala C', aba: false, color: 'teal', therapists: [{id: 'c1', name: 'Fisio Dois', professionalId: 'f2'}]}]});
    await db.doc('patients/all').set({list: [{id: 'pa', nome: 'Paciente A', idade: 8}, {id: 'pb', nome: 'Paciente B', idade: 8}]});
    var ids = []; ['seg','ter','qua','qui','sex'].forEach(function(d){ for (var w = 1; w <= 4; w++) ids.push(d + '-' + w); });
    for (var k = 0; k < ids.length; k++) await db.doc('schedule/' + ids[k]).set({bookings: {}});
    // Fisio Dois ocupado na Sala C em toda a manhã de segunda (janela do paciente A) nas 4 semanas
    var segM = DAYS.filter(function(d){ return d.key === 'seg'; })[0].morning;
    for (var w2 = 1; w2 <= 4; w2++){ var bk = {}; segM.forEach(function(t){ bk[t + '|rC|c1'] = {patient: 'Paciente B', note: ''}; }); if (w2 === 1) bk[segM[0] + '|rA|a1'] = {patient: 'Paciente A', note: ''}; await db.doc('schedule/seg-' + w2).set({bookings: bk}); }
  })()`);
  await page.waitForTimeout(600);
  await ev(`(function(){ var h = {}; ['seg','ter','qua','qui','sex'].forEach(function(d){ h[d] = {ativo: d === 'seg', manha: {inicio: '07:20', fim: '12:00'}, tarde: {inicio: '', fim: ''}}; });
    state.treatments = [{id: 'ta', patientId: 'pa', inicio: '2026-01-01', status: 'ativo', tipo: 'novo', vencPor: 'sem', horarios: h, specHours: [
      {id: 'la', specId: 'fono', hours: 1, service: 'sessao', profId: 'f1', semanas: ''},
      {id: 'lb', specId: 'fisio', hours: 1, service: 'sessao', profId: 'f2', semanas: ''}]}]; rebuildPatients(); })()`);
  await page.waitForTimeout(400);
  await page.click('#plToolsBtn'); await page.waitForTimeout(150);
  await page.$eval('#plSugBtn', (b) => b.click());
  await page.waitForSelector('#ovPlSg'); await page.waitForTimeout(400);
  await page.$eval('#sgPat', (s) => { s.value = 'pa'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => /não coube|Sugestão em outra/.test(document.getElementById('sgOut').innerText), null, {timeout: 5000}).catch(() => {});
  const txt = await page.$eval('#sgOut', (e) => e.innerText.replace(/\s+/g, ' '));
  check('Motivo descreve a regra (“Profissional em Dois Lugares”) com exemplo?', /Regra “Profissional em Dois Lugares”: \d+/.test(txt) && /ex\.:/.test(txt), txt.slice(0, 400));
  check('Não diz só "Conflito de regra"?', !/Conflito de regra/.test(txt), '');
  check('Sugere em outra especialidade do tratamento (Fonoaudiologia)?', /Não coube em Fisioterapia.*Sugestão em outra especialidade do tratamento: Fonoaudiologia/.test(txt), txt.slice(0, 500));
  const alt = await page.$$eval('[data-sg-on]', (a) => a.map((c) => c.checked));
  check('Sugestão em outra especialidade vem desmarcada?', alt.length === 1 && alt[0] === false, JSON.stringify(alt));
  const opt = await page.$eval('[data-sg-sel]', (s) => s.options[s.selectedIndex].text);
  check('Opção com a Fono Um na sala de Fonoaudiologia?', /Fonoaudiologia/.test(opt) && /Fono/.test(opt), opt);
  await page.$eval('[data-sg-on]', (c) => c.click());
  await page.click('#sgApply');
  await page.waitForSelector('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForTimeout(700);
  const all = await ev(`JSON.stringify([1,2,3,4].map(function(w){ return (window.__STORE__['schedule/seg-' + w] || {}).bookings || {}; }))`);
  check('Gravada na coluna da Fono (rA|a1)?', (all.match(/rA\|a1":\{"patient":"Paciente A"/g) || []).length === 2, all.slice(0, 200));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
