// Tipos de Tratamento: cadastro (próprios + especialidades + serviços), caixa "Tratamento" nas especialidades/serviços,
// campo Tipo de Tratamento (vários) no tratamento, padrão Multidisciplinar e Plano fora do tratamento.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_tt.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // Cadastro: tipo próprio padrão + todas as especialidades e serviços
  const all = JSON.parse(await ev('JSON.stringify(treatTypesAll().map(function(x){ return [x.id, x._src]; }))'));
  const nSpec = await ev('state.specialties.length'), nSvc = await ev('servicesList().length');
  check('lista tem o Multidisciplinar (padrão), as especialidades e os serviços?', all.filter((x) => x[1] === 'Tipo de Tratamento').length === 1 && all.filter((x) => x[1] === 'Especialidade').length === nSpec && all.filter((x) => x[1] === 'Serviço').length === nSvc, [nSpec, nSvc, all.length]);
  check('Multidisciplinar vem como padrão do tratamento novo?', (await ev('trTypeDefaults()')).join() === 'multidisciplinar');
  await page.$eval('#mainTabs button[data-tab=tipostrat]', (b) => b.click()); await page.waitForTimeout(300);
  const rows = await page.$$eval('#reg-tipostrat-host tbody tr', (r) => r.map((x) => x.textContent));
  check('tela mostra tudo, com a origem de cada um?', rows.length === all.length && /Multidisciplinar.*padrão.*Tipo de Tratamento/.test(rows[0]) && rows.some((r) => /Especialidade/.test(r)) && rows.some((r) => /Serviço/.test(r)), rows.length);

  // Especialidade sem "Tratamento" some da lista
  const specId = await ev('state.specialties[0].id');
  await page.click('#reg-tipostrat-host tbody tr:has-text("Especialidade")'); await page.waitForSelector('#ovReg');
  check('clicar numa especialidade abre o cadastro dela com a caixa Tratamento ligada?', (await page.isChecked('#regTratamento')) === true && /Editar Especialidade/.test(await page.textContent('#ovReg h3')));
  await page.uncheck('#regTratamento'); await page.click('#regSave'); await page.waitForTimeout(400);
  check('desligar Tratamento tira a especialidade dos tipos?', (await ev('treatTypesAll().filter(function(x){ return x.id === "spec:' + specId + '"; }).length')) === 0 && (await ev('state.specialties[0].tratamento')) === false);
  await ev('openRegistryItem("especialidades", state.specialties[0])'); await page.waitForSelector('#ovReg');
  await page.check('#regTratamento'); await page.click('#regSave'); await page.waitForTimeout(400);
  check('ligar de novo traz de volta?', (await ev('treatTypesAll().filter(function(x){ return x.id === "spec:' + specId + '"; }).length')) === 1);
  // Especialidade nova já vem com Tratamento ligado
  await ev('openRegistryItem("especialidades", null)'); await page.waitForSelector('#ovReg');
  check('especialidade nova vem com Tratamento ligado?', await page.isChecked('#regTratamento'));
  await page.fill('#regName', 'Especialidade Nova TT'); await page.click('#regSave'); await page.waitForTimeout(400);
  check('e aparece como tipo?', (await ev('treatTypesAll().filter(function(x){ return x.name === "Especialidade Nova TT"; }).length')) === 1);
  // Serviço
  await ev('openRegistryItem("servicos", servicesList().filter(function(x){ return x.id !== DEFAULT_SERVICE_ID; })[0])'); await page.waitForSelector('#ovReg');
  check('serviço também tem a caixa Tratamento?', await page.$('#regTratamento') !== null);
  await page.click('#regCancel');
  // Tipo próprio novo
  await page.$eval('#mainTabs button[data-tab=tipostrat]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#reg-tipostrat-add'); await page.waitForSelector('#ovReg');
  await page.fill('#regName', 'Intensivo'); await page.check('#regPadrao'); await page.click('#regSave'); await page.waitForTimeout(400);
  const doc = await page.evaluate(() => window.__STORE__['config/treatment_types']);
  check('tipo próprio grava só ele (sem especialidades e serviços)?', doc && doc.list.some((x) => x.name === 'Intensivo' && x.padrao) && doc.list.every((x) => !x._ref && !x._src && !/^(spec|svc):/.test(x.id)), doc && doc.list.map((x) => x.name));
  check('dois padrões vêm marcados no tratamento novo?', (await ev('trTypeDefaults()')).length === 2);

  // Tratamento: campo logo depois do paciente, vários, padrão marcado
  const pid = await ev('state.patientsRaw[0].id');
  await ev('openTreatmentModal(null, {patientId: "' + pid + '"})'); await page.waitForSelector('#ovTreat');
  const order = await page.$$eval('#ovTreat .modal-body .field > label, #ovTreat .modal-body .field > select', (a) => a.slice(0, 3).map((x) => x.id || x.textContent));
  check('Tipo de Tratamento vem depois do paciente?', order[0] === 'trPat' || /Paciente/.test(order[0]) ? order.join('|').indexOf('trTiposLabel') !== -1 : false, order);
  check('não tem mais o campo Plano?', (await page.$('#pPlano')) === null);
  check('padrões já vêm escolhidos?', (await page.textContent('#trTiposMs .ms-sum')).indexOf('Multidisciplinar') !== -1 && (await page.textContent('#trTiposMs .ms-sum')).indexOf('Intensivo') !== -1, await page.textContent('#trTiposMs .ms-sum'));
  await page.click('#trTiposMs .ms-btn');
  await page.uncheck('#trTipos input[value="intensivo"]').catch(async () => { await page.$eval('#trTipos input[value="' + (doc.list.filter((x) => x.name === 'Intensivo')[0].id) + '"]', (c) => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
  await page.check('#trTipos input[value="spec:' + specId + '"]');
  await page.click('#trSave'); await page.waitForTimeout(500);
  const saved = await ev('state.treatments.filter(function(t){ return t.patientId === "' + pid + '"; }).slice(-1)[0].tipos');
  check('tratamento guarda os tipos escolhidos (vários)?', saved.indexOf('multidisciplinar') !== -1 && saved.indexOf('spec:' + specId) !== -1 && saved.length === 2, saved);
  check('tipo em uso aparece na contagem?', (await ev('ttUseCount("multidisciplinar")')) >= 1);

  // Serviço Sessão (travado): só a caixa Tratamento pode mudar
  await ev('openRegistryItem("servicos", servicesList().filter(function(s){ return s.id === DEFAULT_SERVICE_ID; })[0])'); await page.waitForSelector('#ovReg');
  check('Sessão: nome travado, caixa Tratamento e Salvar liberados?', (await page.$eval('#regName', (e) => e.disabled)) && !(await page.$eval('#regTratamento', (e) => e.disabled)) && (await page.$('#regSave')) !== null);
  await page.uncheck('#regTratamento'); await page.click('#regSave'); await page.waitForTimeout(500);
  check('Sessão sai dos Tipos de Tratamento e continua Sessão?', (await ev('treatTypesAll().filter(function(x){ return x.id === "svc:sessao"; }).length')) === 0 && (await ev('servicesList()[0].name')) === 'Sessão');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close(); fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
