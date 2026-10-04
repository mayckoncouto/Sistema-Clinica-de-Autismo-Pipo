// Botões das janelas conforme a permissão (só ver = leitura; sem excluir = sem
// Excluir), confirmação padrão "Confirmar exclusão" e Inativar/Reativar de
// cadastro em uso, com "Mostrar inativos" e inativos fora das sugestões.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_perm.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const setPerm = (perms) => page.evaluate((p) => { window.pipoAuth = { can: (m, a) => !!(p[m] && p[m].indexOf(a) !== -1), isAdmin: () => false, onProfile(){}, profile: () => null }; }, perms);
  const patId = await ev('state.patientsRaw[0].id');

  // Só ver: janela de leitura.
  await setPerm({ pacientes: ['view'] });
  await ev(`openPatientModal(state.patients[0])`); await page.waitForSelector('#ovPat'); await page.waitForTimeout(100);
  console.log('view-only: no Excluir/Salvar, Cancelar becomes Fechar, fields locked?',
    !(await page.isVisible('#pDelete')) && !(await page.isVisible('#pSave')) && (await page.textContent('#pCancel')) === 'Fechar' && await page.$eval('#pNome', (x) => x.disabled));
  await page.click('#pCancel');
  // Ver + editar, sem excluir.
  await setPerm({ pacientes: ['view', 'edit'] });
  await ev(`openPatientModal(state.patients[0])`); await page.waitForSelector('#ovPat'); await page.waitForTimeout(100);
  console.log('edit without delete: Salvar shown, Excluir hidden?', await page.isVisible('#pSave') && !(await page.isVisible('#pDelete')) && !(await page.$eval('#pNome', (x) => x.disabled)));
  await page.click('#pCancel');

  // Grades: sem incluir no Planner, o "+" das células some.
  await setPerm({ agenda: ['view'], agendamentos: ['view', 'create'] });
  await ev('permToolClasses()');
  console.log('Planner without create hides the "+" of empty cells?', await page.$eval('#tab-agenda', (s) => s.classList.contains('perm-no-create')) &&
    !(await page.$eval('#tab-agenda .empty-plus', (x) => x.offsetParent !== null)));
  console.log('Agenda without delete gets the no-delete class?', await page.$eval('#tab-agendadia', (s) => s.classList.contains('perm-no-delete') && !s.classList.contains('perm-no-create')));

  // Acesso total: paciente em uso (tem tratamento) → Inativar.
  await page.evaluate(() => { delete window.pipoAuth; });
  await ev('permToolClasses()');
  await ev(`state.treatments = [{id: "tx", patientId: "${patId}", inicio: "2026-01-01", status: "ativo", tipo: "novo"}]; rebuildPatients();`);
  await ev(`openPatientModal(state.patients.filter(function(p){ return p.id === "${patId}"; })[0])`);
  await page.waitForSelector('#ovPat');
  await page.waitForFunction(() => document.getElementById('pDelete') && document.getElementById('pDelete').textContent !== 'Verificando…');
  console.log('patient in use: delete button becomes "Inativar"?', (await page.textContent('#pDelete')) === 'Inativar');
  await page.click('#pDelete'); await page.waitForSelector('#cfOk');
  console.log('inactivate dialog explains where it is used?', /em uso/.test(await page.textContent('#ovConfirm')) && /tratamento/.test(await page.textContent('#ovConfirm')));
  await page.click('#cfOk'); await page.waitForTimeout(300);
  const raw = await ev(`state.patientsRaw.filter(function(p){ return p.id === "${patId}"; })[0]`);
  console.log('patient saved as inactive (not deleted)?', raw && raw.inativo === true);
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(200);
  const nm = raw.nome;
  console.log('inactive patient hidden from the list by default?', !(await page.textContent('#patListHost')).includes(nm));
  await page.click('#tab-pacientes .inact-toggle input'); await page.waitForTimeout(150);
  console.log('"Mostrar inativos" shows it with the Inativo tag?', (await page.textContent('#patListHost')).includes(nm) && !!(await page.$('#patListHost .inact-tag')));
  const sugg = await ev(`activeOnly(state.patients).some(function(p){ return p.id === "${patId}"; })`);
  console.log('inactive patient left out of booking suggestions?', sugg === false);
  await ev(`openPatientModal(state.patients.filter(function(p){ return p.id === "${patId}"; })[0])`);
  await page.waitForSelector('#ovPat'); await page.waitForTimeout(200);
  console.log('inactive patient window offers "Reativar"?', await page.isVisible('#pDeleteReactivate'));
  await page.click('#pDeleteReactivate'); await page.waitForTimeout(300);
  console.log('reactivated?', (await ev(`state.patientsRaw.filter(function(p){ return p.id === "${patId}"; })[0].inativo`)) === false);

  // Convênio sem uso: Excluir com a janela "Confirmar exclusão".
  await ev(`state.convenios = [{id: "cv-livre", name: "Convênio Livre"}]; renderRegistryTab("convenios");`);
  await ev(`openRegistryItem("convenios", state.convenios[0])`);
  await page.waitForFunction(() => document.getElementById('regDel') && document.getElementById('regDel').textContent === 'Excluir');
  await page.click('#regDel'); await page.waitForSelector('#cfOk');
  console.log('unused item: standard "Confirmar exclusão" dialog?', (await page.textContent('#cfTitle')) === 'Confirmar exclusão' && (await page.textContent('#cfOk')) === 'Confirmar exclusão');
  await page.click('#cfOk'); await page.waitForTimeout(200);
  console.log('deleted after confirming?', (await ev('state.convenios.length')) === 0);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
