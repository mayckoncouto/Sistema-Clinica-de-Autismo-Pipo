// Cadastro completo do paciente (abas, responsáveis, responsável financeiro,
// endereço, médico/escola com "+"), botão "Campos" (aparece/obrigatório) e
// cadastros de Médicos, Escolas e CBO. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_pf.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  const raw = (id) => page.evaluate((id) => window.__STORE__['patients/all'].list.find((p) => p.id === id), id);

  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  console.log('"Campos" button in the Pacientes toolbar?', await page.isVisible('#patFieldsBtn'));

  // Abre Ana Azul: abas do cadastro.
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForTimeout(300);
  const tabs = await page.$$eval('#ovPat .pm-tab', (a) => a.map((x) => x.textContent));
  console.log('patient window has the section tabs?', JSON.stringify(tabs) === '["Paciente","Responsáveis","Contato e endereço","Clínico","Médico e escola","Administrativo"]', JSON.stringify(tabs));
  await page.fill('#pf-cpf', '11111111111');
  await page.click('[data-pmtab=responsaveis]'); await page.click('#respAdd'); await page.waitForTimeout(100);
  await page.fill('.resp-card [data-rk="nome"]', 'Maria Azul');
  await page.fill('.resp-card [data-rk="telefone"]', '47999998888');
  console.log('phone mask applied?', (await page.inputValue('.resp-card [data-rk="telefone"]')) === '(47) 99999-8888');
  console.log('first guardian is marked as financial responsible?', await page.isChecked('.resp-card input[name="respFin"]'));
  await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('invalid CPF refused (window stays open)?', await page.isVisible('#ovPat'));
  await page.click('[data-pmtab=paciente]'); await page.fill('#pf-cpf', '529.982.247-25');
  // Médico pelo "+": janela pequena por cima, já fica escolhido.
  await page.click('[data-pmtab=medesc]');
  await page.click('[data-regadd="medicos"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#qkName', 'Dra. Teste Neuro'); await page.fill('#regf-crm', '1234/SC');
  await page.click('#qkSave'); await page.waitForTimeout(200);
  const docId = await page.inputValue('#pf-medicoId');
  console.log('"+" registers the doctor and selects it in the patient window?', !!docId && (await page.isVisible('#ovPat')) && !(await page.$('#ovQuick')));
  await page.click('[data-pmtab=contato]'); await page.fill('#pa-rua', 'Rua das Flores'); await page.fill('#pa-uf', 'sc');
  await page.click('#pSave'); await page.waitForTimeout(250);
  const ana = await raw('ana-azul');
  console.log('saved: CPF digits, guardian with financial flag, doctor, address?',
    !(await page.$('#ovPat')) && ana.cpf === '52998224725' && ana.responsaveis.length === 1 && ana.responsaveis[0].financeiro === true &&
    ana.responsaveis[0].telefone === '47999998888' && ana.medicoId === docId && ana.endereco.rua === 'Rua das Flores' && ana.endereco.uf === 'SC', JSON.stringify(ana));

  // Campos: CPF obrigatório, Sexo escondido.
  await page.click('#patFieldsBtn'); await page.waitForSelector('#ovPf');
  console.log('Nome is locked as shown + required?', await page.$eval('tr[data-pfk="nome"] [data-pfx="req"]', (c) => c.checked && c.disabled));
  await page.check('tr[data-pfk="rg"] [data-pfx="req"]');
  console.log('marking required also marks "Aparece"?', await page.isChecked('tr[data-pfk="rg"] [data-pfx="show"]'));
  await page.uncheck('tr[data-pfk="sexo"] [data-pfx="show"]');
  await page.click('#pfSave'); await page.waitForTimeout(200);
  console.log('field settings saved to config/patient_fields?', await page.evaluate(() => { const f = (window.__STORE__['config/patient_fields'] || {}).fields || {}; return f.rg.req === true && f.sexo.show === false; }));
  await page.click('#patListHost tbody tr:has-text("Bruno Verde")'); await page.waitForTimeout(300);
  console.log('hidden field is not shown; required field has the * mark?', !(await page.$('#pf-sexo')) && (await page.$('[data-pf="rg"] .pm-req')) !== null);
  await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('saving without a required field is refused?', await page.isVisible('#ovPat'));
  await page.fill('#pf-rg', '1234567'); await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('after filling it, saves?', !(await page.$('#ovPat')) && (await raw('bruno-verde')).rg === '1234567');

  // Paciente novo: data de entrada = hoje.
  await page.click('#addPatientBtn'); await page.waitForTimeout(300);
  await page.click('[data-pmtab=admin]');
  console.log('new patient: entry date defaults to today?', await page.$eval('#pf-entrada', (e) => e.value) === (await ev('dpIso(new Date())')));
  await page.click('#pCancel');

  // Cadastros: Médicos (lista), CBO (sugestões + profissional com lista e "+").
  await page.$eval('#mainTabs button[data-tab=medicos]', (b) => b.click()); await page.waitForTimeout(250);
  console.log('Médicos registry lists the doctor with CRM and patient count?', /Dra\. Teste Neuro/.test(await page.textContent('#reg-medicos-host')) && /1234\/SC/.test(await page.textContent('#reg-medicos-host')));
  await page.$eval('#mainTabs button[data-tab=cbo]', (b) => b.click()); await page.waitForTimeout(250);
  console.log('CBO registry starts with the suggested codes?', /2515-10/.test(await page.textContent('#reg-cbo-host')) && /Fonoaudiólogo/.test(await page.textContent('#reg-cbo-host')));
  await ev('openProfessionalModal(state.professionals[0])'); await page.waitForTimeout(300);
  console.log('professional CBO is a registry list (typeable)?', !!(await page.$('[data-dp-for="profCbos"].dp-combo')));
  await page.click('[data-regadd="cbo"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#regf-code', '2235-05'); await page.fill('#qkName', 'Enfermeiro'); await page.click('#qkSave'); await page.waitForTimeout(200);
  console.log('"+" adds a CBO and selects it for the professional?', (await page.inputValue('#profCbos')) === '2235-05' &&
    (await page.evaluate(() => (window.__STORE__['config/cbo'] || {list: []}).list.some((c) => c.code === '2235-05') && window.__STORE__['config/cbo'].list.some((c) => c.code === '2515-10'))));
  await page.click('[data-regadd="cbo"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#regf-code', '223505'); await page.fill('#qkName', 'Repetido'); await page.click('#qkSave'); await page.waitForTimeout(150);
  console.log('duplicate CBO code refused?', await page.isVisible('#ovQuick'));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
