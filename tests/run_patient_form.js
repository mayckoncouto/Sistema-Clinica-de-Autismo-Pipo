// Cadastro completo do paciente (janela única com grupos, filiação, rotina, contatos,
// responsável financeiro ligado, CPF obrigatório/único, busca por mãe/pai/financeiro,
// data de entrada, mesclar cadastros), Campos obrigatórios e
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
  const setv = (sel, v) => page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const raw = (id) => page.evaluate((id) => window.__STORE__['patients/all'].list.find((p) => p.id === id), id);

  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patMoreBtn');
  console.log('"Outras opções" menu has Campos obrigatórios, Mesclar (admin) and Imprimir?', await page.isVisible('#patFieldsBtn') && await page.isVisible('#patMergeBtn') && await page.isVisible('#patPrintBtn'));
  await page.keyboard.press('Escape');

  // Ana Azul: janela única com os grupos.
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForTimeout(300);
  const secs = await page.$$eval('#ovPat .pm-sec-title', (a) => a.map((x) => x.textContent));
  console.log('single window with the groups in order?', JSON.stringify(secs) === '["Identificação","Endereço","Filiação","Responsáveis pela rotina","Contato","Responsável financeiro","Escola","Saúde","Administrativo","Tratamento"]', JSON.stringify(secs));
  console.log('no tabs anymore?', !(await page.$('#ovPat .pm-tab')));
  await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('CPF required when editing (window stays, pending chip)?', await page.isVisible('#ovPat') && /1 faltando/.test(await page.textContent('[data-pend="ident"]')));
  await page.fill('#pf-cpf', '11111111111'); await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('invalid CPF refused?', await page.isVisible('#ovPat'));
  await page.fill('#pf-cpf', '529.982.247-25');
  await page.waitForTimeout(150);
  console.log('pending chip clears when filled?', await page.isHidden('[data-pend="ident"]'));
  // Filiação + Responsável ligado.
  await page.fill('#pm-mae-nome', 'Maria Azul'); await page.fill('#pm-mae-cpf', '39053344705');
  await page.fill('#pm-pai-nome', 'João Azul');
  await page.click('[data-resp="mae"]'); await page.waitForTimeout(100);
  console.log('Responsável fills financial name/CPF from the mother (read-only)?', (await page.inputValue('#fi-nome')) === 'Maria Azul' && (await page.inputValue('#fi-doc')) === '390.533.447-05' && await page.$eval('#fi-nome', (e) => e.readOnly));
  await page.fill('#pm-mae-nome', 'Maria Azul Souza'); await page.waitForTimeout(100);
  console.log('linked: correcting the mother updates the financial responsible?', (await page.inputValue('#fi-nome')) === 'Maria Azul Souza');
  const rot = await page.$$eval('#rotHost input', (a) => a.map((x) => x.value));
  console.log('rotina starts with mother and father?', rot.includes('Maria Azul Souza') && rot.includes('João Azul'), JSON.stringify(rot));
  console.log('rotina lists Mãe before Pai?', rot[0] === 'Maria Azul Souza');
  await page.click('#rotAdd'); await page.fill('#rotHost .pm-row:last-child input', 'Vó Azul');
  // Contatos.
  await page.fill('#telHost .pm-row:nth-child(1) [data-tk="numero"]', '47999998888');
  await page.fill('#telHost .pm-row:nth-child(1) [data-tk="nome"]', 'Maria');
  console.log('phone mask applied?', (await page.inputValue('#telHost [data-tk="numero"]')) === '(47) 99999-8888');
  await page.click('#telAdd'); await page.fill('#telHost .pm-row:nth-child(2) [data-tk="numero"]', '4733334444');
  await page.$eval('#telHost .pm-row:nth-child(2) select', (s) => { s.value = 'ligacao'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#mailHost [data-mk="email"]', 'maria@exemplo.com');
  await page.click('[data-copy="telefone"]'); await page.waitForTimeout(150);
  console.log('Copiar telefone with 2 phones opens a pick list?', await page.isVisible('#dpPop .dp-opt'));
  await page.click('#dpPop .dp-opt:nth-child(2)'); await page.waitForTimeout(100);
  console.log('picked phone goes to the financial field?', (await page.inputValue('#fi-telefone')) === '(47) 3333-4444');
  await page.click('[data-copy="email"]'); await page.waitForTimeout(100);
  console.log('Copiar e-mail with one e-mail copies directly?', (await page.inputValue('#fi-email')) === 'maria@exemplo.com');
  await page.fill('#pa-rua', 'Rua das Flores'); await page.fill('#pa-numero', '10'); await page.fill('#pa-uf', 'sc');
  await page.click('[data-copy="endereco"]'); await page.waitForTimeout(100);
  console.log('Copiar endereço copies the patient address?', /Rua das Flores, 10/.test(await page.inputValue('#fi-endereco')));
  // Médico pelo "+".
  await page.click('[data-regadd="medicos"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#qkName', 'Dra. Teste Neuro'); await page.fill('#regf-crm', '1234/SC');
  await page.click('#qkSave'); await page.waitForTimeout(200);
  const docId = await page.inputValue('#pf-medicoId');
  console.log('"+" registers the doctor and selects it?', !!docId && (await page.isVisible('#ovPat')) && !(await page.$('#ovQuick')));
  await page.click('#pSave'); await page.waitForTimeout(250);
  const ana = await raw('ana-azul');
  console.log('saved in the new format (no legacy keys)?', !(await page.$('#ovPat')) && ana.cpf === '52998224725' && ana.mae.nome === 'Maria Azul Souza' && ana.mae.cpf === '39053344705' &&
    ana.financeiro.link === 'mae' && ana.financeiro.doc === '39053344705' && ana.telefones.length === 2 && ana.telefones[1].via === 'ligacao' &&
    ana.rotina.length === 3 && ana.emails[0].email === 'maria@exemplo.com' && ana.medicoId === docId && ana.endereco.uf === 'SC' && !('responsaveis' in ana) && !('telefone' in ana), JSON.stringify(ana));

  // Outro paciente com o mesmo CPF: recusado; mesma mãe: só aviso.
  await page.click('#patListHost tbody tr:has-text("Bruno Verde")'); await page.waitForTimeout(300);
  await page.fill('#pf-cpf', '52998224725'); await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('duplicate patient CPF refused?', await page.isVisible('#ovPat'));
  await page.fill('#pf-cpf', '16899535009');
  await page.fill('#pm-mae-cpf', '39053344705'); await page.$eval('#pm-mae-cpf', (e) => e.blur()); await page.waitForTimeout(100);
  console.log('same mother CPF shows a notice?', await page.isVisible('[data-note="mae"]') && /Ana Azul/.test(await page.textContent('[data-note="mae"]')));
  await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('…but saves anyway?', !(await page.$('#ovPat')));

  // Busca por mãe / CPF.
  await page.$eval('#patSearchBy', (s) => { s.value = 'mae'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#patientListSearch', 'souza'); await page.waitForTimeout(150);
  console.log('search by mother name finds the patient?', (await page.$$eval('#patListHost tbody tr', (r) => r.map((x) => x.textContent))).join('|').includes('Ana Azul'));
  await page.fill('#patientListSearch', '390.533'); await page.waitForTimeout(150);
  console.log('search by mother CPF finds both siblings?', (await page.$$('#patListHost tbody tr')).length === 2);
  await page.$eval('#patSearchBy', (s) => { s.value = 'paciente'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#patientListSearch', '168995'); await page.waitForTimeout(150);
  console.log('search by patient CPF?', (await page.$$eval('#patListHost tbody tr', (r) => r.map((x) => x.textContent))).join('|').includes('Bruno Verde') && (await page.$$('#patListHost tbody tr')).length === 1);
  await page.fill('#patientListSearch', '');

  // Campos obrigatórios: RG obrigatório, Sexo escondido.
  await page.click('#patMoreBtn'); await page.click('#patFieldsBtn'); await page.waitForSelector('#ovPf');
  console.log('Nome locked; admin controls CPF and Filiação/Financeiro?', await page.$eval('tr[data-pfk="nome"] [data-pfx="req"]', (c) => c.checked && c.disabled) &&
    await page.$eval('tr[data-pfk="cpf"] [data-pfx="req"]', (c) => c.checked && !c.disabled) && await page.$eval('tr[data-pfk="mae"] [data-pfx="show"]', (c) => c.checked && !c.disabled));
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

  // Administrador: CPF opcional e Pai escondido.
  await page.click('#patMoreBtn'); await page.click('#patFieldsBtn'); await page.waitForSelector('#ovPf');
  await page.uncheck('tr[data-pfk="cpf"] [data-pfx="req"]'); await page.uncheck('tr[data-pfk="pai"] [data-pfx="show"]');
  await page.click('#pfSave'); await page.waitForTimeout(200);
  await page.click('#addPatientBtn'); await page.waitForTimeout(300);
  console.log('hidden Pai is not in the window?', !(await page.$('#pm-pai-nome')) && !!(await page.$('#pm-mae-nome')));
  await page.fill('#pNome', 'Sem Cpf Teste'); await page.fill('#pf-rg', '999');
  await page.click('#pSave'); await page.waitForTimeout(250);
  console.log('with CPF optional, a patient without CPF saves?', await page.evaluate(() => window.__STORE__['patients/all'].list.some((p) => p.nome === 'Sem Cpf Teste')));
  await page.click('#ovTreat #trClose').catch(() => {}); await page.waitForTimeout(100);
  await page.evaluate(async () => { const db = await window.claude.use('db'); await db.doc('config/patient_fields').set({fields: {rg: {show: true, req: true}}}); });
  await page.waitForTimeout(200);

  // Paciente novo: data de entrada = hoje.
  await page.click('#addPatientBtn'); await page.waitForTimeout(300);
  console.log('new patient: entry date defaults to today?', await page.$eval('#pf-entrada', (e) => e.value) === (await ev('dpIso(new Date())')));
  await page.click('#pCancel');

  // Data de entrada × início do tratamento.
  const ent = await ev(`(function(){
    state.treatments = [{id: "tz", patientId: "ana-azul", inicio: "2026-02-01", tipo: "novo", status: "ativo",
      horarios: {seg: {ativo: true, manha: {inicio: "07:20", fim: "12:00"}, tarde: {inicio: "", fim: ""}}, qua: {ativo: true, manha: {inicio: "", fim: ""}, tarde: {inicio: "13:30", fim: "17:30"}}, ter: {ativo: false}}}];
    rebuildPatients(); return trHoursText(state.treatments[0]);
  })()`);
  console.log('treatment card shows only the days/periods the patient comes?', ent === 'Seg 07:20–12:00 · Qua 13:30–17:30', ent);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForTimeout(300);
  console.log('patient window shows the schedule instead of specialty chips?', /Seg 07:20–12:00/.test(await page.textContent('#ovPat .trc')) && !(await page.$('#ovPat .trc-spec')));
  await setv('#pf-entrada', '2026-03-01'); await page.click('#pSave'); await page.waitForTimeout(200);
  console.log('entry date after the first treatment start is refused?', await page.isVisible('#ovPat'));
  await page.fill('#pf-rg', '7654321'); await setv('#pf-entrada', '2026-01-10'); await page.click('#pSave'); await page.waitForTimeout(200);
  await ev(`openTreatmentModal(state.treatments[0])`); await page.waitForTimeout(250);
  console.log('treatment shows "Cadastrado em"?', /Cadastrado em 10\/01\/2026/.test(await page.textContent('#trEntradaHint')));
  await setv('#trIni', '2026-01-05'); await page.click('#trSave'); await page.waitForTimeout(200);
  console.log('treatment start before the entry date is refused?', await page.isVisible('#ovTreat') && (await ev('state.treatments[0].inicio')) === '2026-02-01');
  await page.click('#trClose');

  // Mesclar: Bruno (2º) entra em Ana (1º).
  await ev(`(function(){
    state.treatments = state.treatments.concat([{id: "tb2", patientId: "bruno-verde", inicio: "2026-02-01", tipo: "novo", status: "ativo"}]);
    rebuildPatients();
    return writePatients(state.patients.map(function(p){ return p.id === "bruno-verde" ? Object.assign({}, p, {cns: "123"}) : p; })).then(function(){ return db.doc("schedule/ter-2").set({bookings: {"08:00|r1|r1-t1": {patient: "Bruno Verde", service: "sessao"}}}); });
  })()`);
  await page.waitForTimeout(200);
  await page.click('#patMoreBtn'); await page.click('#patMergeBtn'); await page.waitForSelector('#ovMg');
  await page.$eval('#mgKeep', (s) => { s.value = 'ana-azul'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#mgDrop', (s) => { s.value = 'bruno-verde'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(400);
  const prev = await page.textContent('#mgPreview');
  console.log('merge preview counts treatments/Planner and warns about two Active?', /1 tratamento/.test(prev) && /agendamento\(s\) no Planner/.test(prev) && /Renegociado/.test(prev), prev);
  await page.click('#mgGo'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(600);
  const mg = await ev(`(function(){
    var b = (window.__STORE__["schedule/ter-2"] || {}).bookings || {};
    var t2 = state.treatments.filter(function(t){ return t.id === "tb2"; })[0];
    return {gone: !state.patientsRaw.some(function(p){ return p.id === "bruno-verde"; }), planner: (b["08:00|r1|r1-t1"] || {}).patient,
      tp: t2.patientId, st: t2.status, hist: (t2.historico || []).length, rg: (state.patientsRaw.filter(function(p){ return p.id === "ana-azul"; })[0] || {}).rg, cns: (state.patientsRaw.filter(function(p){ return p.id === "ana-azul"; })[0] || {}).cns};
  })()`);
  console.log('merge: 2nd removed, Planner renamed, treatment moved and Renegociado, empty fields filled?', mg.gone && mg.planner === 'Ana Azul' && mg.tp === 'ana-azul' && mg.st === 'renegociado' && mg.hist === 1 && mg.rg === '7654321' && mg.cns === '123', JSON.stringify(mg));

  const ficha = await ev(`patientFichaHtml(state.patients.filter(function(p){ return p.id === "ana-azul"; })[0])`);
  console.log('ficha cadastral has the groups, doctor and schedule?', /Filiação/.test(ficha) && /Maria Azul Souza/.test(ficha) && /Dra\. Teste Neuro/.test(ficha) && /Responsáveis pela rotina/.test(ficha), ficha.slice(0, 120));

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

  await page.click('#ovQuick #qkCancel'); await page.waitForTimeout(100);
  // Conselho: lista do cadastro de Conselhos + "+".
  console.log('professional Conselho is a registry list?', !!(await page.$('[data-dp-for="profConselho"].dp-combo')));
  await page.click('[data-regadd="conselhos"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#regf-sigla', 'CRBM'); await page.fill('#qkName', 'Conselho Regional de Biomedicina'); await page.click('#qkSave'); await page.waitForTimeout(200);
  console.log('"+" adds a council and selects it (defaults kept)?', (await page.inputValue('#profConselho')) === 'CRBM' &&
    (await page.evaluate(() => { const l = (window.__STORE__['config/councils'] || {list: []}).list; return l.some((c) => c.sigla === 'CRBM') && l.some((c) => c.sigla === 'CRP'); })));
  await page.click('[data-regadd="conselhos"]'); await page.waitForSelector('#ovQuick');
  await page.fill('#regf-sigla', 'crp'); await page.fill('#qkName', 'Repetido'); await page.click('#qkSave'); await page.waitForTimeout(150);
  console.log('duplicate council sigla refused?', await page.isVisible('#ovQuick'));
  await page.click('#ovQuick #qkCancel'); await page.click('#profCancel').catch(() => {}); await page.waitForTimeout(100);
  await page.$eval('#mainTabs button[data-tab=conselhos]', (b) => b.click()); await page.waitForTimeout(250);
  console.log('Conselhos registry lists sigla and name?', /CRBM/.test(await page.textContent('#reg-conselhos-host')) && /Fonoaudiologia/.test(await page.textContent('#reg-conselhos-host')));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
