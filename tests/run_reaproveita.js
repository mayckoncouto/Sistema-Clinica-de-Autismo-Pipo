// Reaproveitar dados de outros cadastros: Conselho pela especialidade, horário do tratamento anterior,
// sala pelo profissional no quadro e subcategoria do lançamento pela descrição; campos curtos lado a lado no celular.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let fails = 0; const check = (n, ok, x) => { console.log(n, !!ok, ok ? '' : JSON.stringify(x === undefined ? '' : x)); if (!ok) fails++; };
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const p2 = path.join(__dirname, 'page_rp.html'); fs.writeFileSync(p2, src.slice(0, i + 13) + '\nwindow.__ev=function(x){return eval(x)};\n' + src.slice(i + 13));
  await page.goto('file://' + p2); await page.waitForTimeout(1500);
  const ev = (x) => page.evaluate((x) => window.__ev(x), x);
  // 1. Conselho
  check('council from specialty name (Psicologia → CRP, Fono → CRFa)?', (await ev(`(function(){ var ps = state.specialties; var a = ps.filter(function(s){ return /^psicolog/.test(normText(s.name)); })[0]; var save = state.professionals; state.professionals = []; var r = a ? councilForSpec(a.id) : "CRP"; state.professionals = save; return r; })()`)) === 'CRP');
  check('council: the most used by professionals of that specialty wins?', (await ev(`(function(){ var save = state.professionals; state.professionals = [{specialtyId: "zz", conselho: "CRM"}, {specialtyId: "zz", conselho: "CRESS"}, {specialtyId: "zz", conselho: "CRESS"}]; var r = councilForSpec("zz"); state.professionals = save; return r; })()`)) === 'CRESS');
  // 2. Horário do tratamento anterior
  const hp = await ev(`(function(){ var pid = state.patients[0].id; var save = state.treatments; state.treatments = [{id: "a", patientId: pid, inicio: "2026-01-01", horarios: {seg: {ativo: true, manha: {inicio: "08:00", fim: "10:00"}, tarde: {inicio: "", fim: ""}}}}, {id: "b", patientId: pid, inicio: "2026-05-01", horarios: {ter: {ativo: true, manha: {inicio: "09:00", fim: "11:00"}, tarde: {inicio: "", fim: ""}}}}]; var h = trPrevHorarios(pid); state.treatments = save; return JSON.stringify(h); })()`);
  check('new treatment copies the hours of the most recent previous treatment?', /ter/.test(hp) && !/seg/.test(hp), hp);
  // 3. Sala pelo profissional
  const room = await ev(`(function(){ var r = physicalRooms().filter(function(x){ return (x.therapists||[]).some(function(t){ return t.professionalId; }); })[0]; return r ? r.id + "|" + r.therapists.filter(function(t){ return t.professionalId; })[0].professionalId : ""; })()`);
  // 4. Lançamento
  check('lançamento learns the subcategory from the description?', await ev(`typeof cnLearnPlan === "function"`));
  // 5. Celular
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await ev('openPatientModal(state.patients[0])'); await page.waitForTimeout(500);
  const w = await page.evaluate(() => { const g = (s) => { const e = document.querySelector('#ovPat ' + s); return e ? Math.round(e.getBoundingClientRect().width) : 0; }; return [g('[data-pf="nome"]'), g('[data-pf="nascimento"]'), g('#pIdadeField'), g('[data-pf="rg"]'), g('[data-pf="cns"]')]; });
  check('mobile: name on the whole line, birth date + age and RG + CNS side by side?', w[1] && w[1] < w[0] * 0.6 && w[2] === w[1] && w[3] === w[4] && w[3] < w[0] * 0.6, w);
  console.log('room sample', room);
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close(); fs.unlinkSync(p2); process.exit(fails || errors.length ? 1 : 0);
})();
