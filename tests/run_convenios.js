// Convênios: especialidades cobertas + valor por sessão; Especialidades: "Libera
// atender também"; tratamento avisa especialidade coberta via outra / não coberta.
// Usa um "eval" injetado numa cópia da página para ler o estado interno.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cv.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/services').set({ list: [{ id: 'sessao', name: 'Sessão' }, { id: 'triagem', name: 'Triagem' }, { id: 'avaliacao', name: 'Avaliação' }] });
    await db.doc('config/specialties').set({ list: [{ id: 'fono', name: 'Fonoaudiologia', sigla: 'FN' }, { id: 'psico', name: 'Psicologia' }, { id: 'musico', name: 'Musicoterapia' }] });
  });
  await page.waitForTimeout(300);

  // Especialidades: Psicologia libera Musicoterapia.
  await page.$eval('#mainTabs button[data-tab=especialidades]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#reg-especialidades-host tr:has-text("Psicologia")'); await page.waitForTimeout(300);
  await page.click('#regLib input[value="musico"]');
  await page.click('#regSave'); await page.waitForTimeout(300);
  console.log('specialty saves what it releases?', (await ev(`JSON.stringify(state.specialties.filter(function(s){ return s.id === "psico"; })[0].libera)`)) === '["musico"]');
  console.log('list shows the "Libera atender também" column?', /Musicoterapia/.test(await page.textContent('#reg-especialidades-host tr:has-text("Psicologia")')));

  // Convênio Unimed: cobre Psicologia a R$ 120,50 por sessão.
  await page.$eval('#mainTabs button[data-tab=convenios]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#reg-convenios-host tr:has-text("Unimed")'); await page.waitForTimeout(300);
  await page.click('#cvAdd'); await page.waitForTimeout(200);
  await page.$eval('#cvRows .cv-spec', (s) => { s.value = 'psico'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(200);
  console.log('row shows what the specialty releases?', /Musicoterapia/.test(await page.getAttribute('#cvRows .cv-row', 'data-cover') || ''));
  await page.fill('#cvRows .cv-val', '120,50');
  await page.click('#regSave'); await page.waitForTimeout(300);
  console.log('convênio saves covered specialties?', (await ev(`JSON.stringify(state.convenios.filter(function(c){ return c.id === "unimed"; })[0].especialidades)`)) === '["psico"]');
  console.log('value per session: direct, released (same value) and not covered?', (await ev(`[convValor("unimed","psico"), convValor("unimed","musico"), convValor("unimed","fono")].join("/")`)) === '120.5/120.5/');
  console.log('coverage: direct / via / none / convênio without list = no check?',
    (await ev(`JSON.stringify([convCoverage("unimed","psico"), convCoverage("unimed","musico"), convCoverage("unimed","fono"), convCoverage("bradesco-saude","fono")])`)) === '[{"direct":true},{"via":"psico"},{"none":true},null]');
  console.log('list shows covered specialties?', /Psicologia/.test(await page.textContent('#reg-convenios-host tr:has-text("Unimed")')));

  // Reabrir mostra o valor salvo.
  await page.click('#reg-convenios-host tr:has-text("Unimed")'); await page.waitForTimeout(300);
  console.log('reopening shows the saved value?', (await page.inputValue('#cvRows .cv-val')) === '120,50');
  // "Inserir todos": todas as especialidades e serviços (menos Sessão) que faltam.
  const expected = await ev(`state.specialties.filter(isActive).length + servicesList().filter(function(x){ return x.id !== DEFAULT_SERVICE_ID && isActive(x); }).length`);
  await page.click('#cvAll'); await page.waitForTimeout(200);
  const rows = await page.$$eval('#cvRows .cv-row', (a) => a.length);
  console.log('"Inserir todos" adds every specialty and service once (value kept)?', rows === expected && (await page.inputValue('#cvRows .cv-val')) === '120,50', rows, expected);
  const svcOpt = await page.$$eval('#cvRows .cv-spec option', (a) => a.some((o) => o.value.indexOf('svc:') === 0));
  console.log('services are offered as options?', svcOpt);
  await page.click('#regCancel');
  console.log('service coverage: only checked when the convênio lists a service?',
    (await ev(`(function(){ var c = state.convenios.filter(function(x){ return x.id === "unimed"; })[0];
      var a = convCoverage("unimed", "svc:triagem");
      c.especialidades = ["psico", "svc:avaliacao"]; var b = convCoverage("unimed", "svc:triagem"), d = convCoverage("unimed", "svc:avaliacao");
      c.especialidades = ["psico"]; return JSON.stringify([a, b, d]); })()`)) === '[null,{"none":true},{"direct":true}]');

  // Tratamento com Unimed: Fonoaudiologia (não coberta) e Musicoterapia (via Psicologia).
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#trAdd'); await page.waitForTimeout(400);
  await page.fill('#pConv', 'Unimed'); await page.dispatchEvent('#pConv', 'input'); await page.waitForTimeout(200);
  await page.click('#pConvSuggest button[data-id="unimed"]'); await page.waitForTimeout(200);
  const TL = require('./tl-helper');
  await TL.addLine(page, {spec: 'Fonoaudiologia', hours: 2});
  await TL.addLine(page, {spec: 'Musicoterapia', hours: 2});
  const covers = (await TL.lines(page)).map((r) => r.cover);
  console.log('treatment cards warn "not covered" and "covered via Psicologia"?', covers[0] === 'Especialidade não coberta pelo convênio' && covers[1] === 'Coberta pelo convênio via Psicologia', JSON.stringify(covers));
  await page.click('#trCancel');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
