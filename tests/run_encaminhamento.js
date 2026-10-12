// Encaminhamento no cadastro do paciente (grupo Saúde): data, validade (3 meses, 6 meses, 1 ano),
// vencimento calculado e especialidades com quantidade semanal (quadros como no tratamento).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_enc.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setv = (sel, v) => page.$eval(sel, (e, val) => { e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  // Contas puras
  const pure = await ev(`({v6: encVenc({data: "2026-01-01", validade: "6m"}), v3: encVenc({data: "2026-01-31", validade: "3m"}), v1: encVenc({data: "2026-03-10", validade: "1a"}),
    none: encVenc({data: "2026-01-01"}), st: encState({data: "2026-01-01", validade: "6m"}).state})`);
  check('6 months from 01/01 is valid until 30/06?', pure.v6 === '2026-06-30', pure.v6);
  check('3 months from 31/01 clamps to the last day (29/04)?', pure.v3 === '2026-04-29', pure.v3);
  check('1 year from 10/03/2026 is valid until 09/03/2027?', pure.v1 === '2027-03-09', pure.v1);
  check('no validity = no due date; expired state?', pure.none === '' && pure.st === 'vencido');

  // Janela do paciente
  const pid = await ev('state.patients[0].id');
  await ev('openPatientModal(state.patients[0])');
  await page.waitForTimeout(250);
  check('window shows the Encaminhamento block inside Saúde?', !!(await page.$('#ovPat [data-pmsec="saude"] #enc-data')) && !!(await page.$('#encAdd')));
  check('due date field is read-only?', await page.$eval('#enc-venc', (e) => e.readOnly));
  await setv('#enc-data', '2026-01-01'); await setv('#enc-val', '6m'); await page.waitForTimeout(100);
  check('due date is calculated on screen (30/06/2026)?', (await page.$eval('#enc-venc', (e) => e.value)) === '30/06/2026');
  check('expired note appears?', await page.$eval('#encNote', (e) => !e.hidden && /vencido/.test(e.textContent)));

  // Incluir especialidade
  await page.click('#encAdd'); await page.waitForTimeout(150);
  check('add window opens with Especialidade and Quantidade Semanal?', !!(await page.$('#ovEncLine #elSpec')) && !!(await page.$('#ovEncLine #elQtd')));
  await page.click('#elSave'); await page.waitForTimeout(80);
  check('saving without specialty is refused (window stays)?', !!(await page.$('#ovEncLine')));
  await setv('#elSpec', 'fono'); await page.fill('#elQtd', '0'); await page.click('#elSave'); await page.waitForTimeout(80);
  check('quantity 0 is refused?', !!(await page.$('#ovEncLine')));
  await page.fill('#elQtd', '3'); await page.click('#elSave'); await page.waitForTimeout(150);
  check('card shows the specialty and 3 sessions per week?', await page.$eval('#encRows', (e) => /Fonoaudiologia/.test(e.textContent) && /3 sessões por semana/.test(e.textContent)));
  await page.click('#encAdd'); await page.waitForTimeout(150);
  await setv('#elSpec', 'fono'); await page.fill('#elQtd', '1'); await page.click('#elSave'); await page.waitForTimeout(80);
  check('same specialty twice is refused?', !!(await page.$('#ovEncLine')));
  await setv('#elSpec', 'psico'); await page.fill('#elQtd', '1'); await page.click('#elSave'); await page.waitForTimeout(150);
  check('second specialty added (1 sessão por semana)?', await page.$eval('#encRows', (e) => e.querySelectorAll('.tl-row').length === 2 && /1 sessão por semana/.test(e.textContent)));
  // editar
  await page.click('[data-enc-edit="1"]'); await page.waitForTimeout(150);
  await page.fill('#elQtd', '2'); await page.click('#elSave'); await page.waitForTimeout(150);
  check('edit updates the quantity?', await page.$eval('#encRows', (e) => /2 sessões por semana/.test(e.textContent)));
  // excluir
  await page.click('[data-enc-edit="1"]'); await page.waitForTimeout(150);
  await page.click('#elDel'); await page.waitForTimeout(150);
  await page.click('#cfOk'); await page.waitForTimeout(150);
  check('delete (with confirmation) removes the card?', await page.$eval('#encRows', (e) => e.querySelectorAll('.tl-row').length === 1));

  // salvar o paciente
  await page.fill('#pf-cpf', '529.982.247-25');
  await page.click('#pSave'); await page.waitForTimeout(300);
  const saved = await ev(`JSON.stringify(rawPatient(${JSON.stringify(pid)}).encaminhamento || null)`);
  const e = JSON.parse(saved);
  check('saved: data, validity, due date and one specialty', e && e.data === '2026-01-01' && e.validade === '6m' && e.venc === '2026-06-30' && e.esp.length === 1 && e.esp[0].specId === 'fono' && e.esp[0].semanal === '3', saved);

  // chip e ficha
  const chip = await ev(`encChip(state.patients.filter(function(x){ return x.id === ${JSON.stringify(pid)}; })[0])`);
  check('list chip says Enc. vencido?', /Enc\. vencido/.test(chip));
  const ficha = await ev(`patientFichaHtml(state.patients.filter(function(x){ return x.id === ${JSON.stringify(pid)}; })[0])`);
  check('printed sheet has the Encaminhamento row?', /Encaminhamento/.test(ficha) && /Fonoaudiologia 3x\/semana/.test(ficha));

  // reabrir mostra o que foi salvo
  await ev(`openPatientModal(state.patients.filter(function(x){ return x.id === ${JSON.stringify(pid)}; })[0])`); await page.waitForTimeout(250);
  check('reopened window shows the saved values?', (await page.$eval('#enc-venc', (x) => x.value)) === '30/06/2026' && (await page.$$('#encRows .tl-row')).length === 1);
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // sem permissão de saúde: nada aparece
  const no = await ev(`(function(){ healthCanSee = function(){ return false; }; openPatientModal(state.patients[0]); var o = !document.getElementById("enc-data"); document.getElementById("modalHost").innerHTML = ""; return o; })()`);
  check('without Pacientes – Saúde the block is hidden?', no === true);

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
