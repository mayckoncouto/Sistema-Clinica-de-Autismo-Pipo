// Convênio padrão no cadastro do paciente (convênio, plano, carteirinha e validade):
// tratamento novo já vem com ele, aviso de validade, pergunta ao mudar com tratamento ativo,
// histórico do tratamento, planilha e link de cadastro. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  const setv = (sel, v) => page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const raw = (id) => page.evaluate((id) => window.__STORE__['patients/all'].list.find((p) => p.id === id), id);
  const trs = () => page.evaluate(() => (window.__STORE__['treatments/all'] || { list: [] }).list);

  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  const secs = await page.$$eval('#ovPat .pm-sec-head .tr-sec', (a) => a.map((x) => x.textContent));
  check('janela do paciente tem o grupo Convênio (depois da Medida Protetiva)?', secs.indexOf('Convênio') === secs.indexOf('Medida Protetiva') + 1, secs);
  check('campos do grupo: convênio, plano, carteirinha e validade?', await page.$('#pf-convenioPadrao') && await page.$('#pf-carteirinha') && await page.$('#pf-carteirinhaValidade') ? true : false);
  await setv('#pf-cpf', '52998224725'); await setv('#pf-convenioPadrao', 'unimed'); await setv('#pf-carteirinha', '0001-FICT');
  await setv('#pf-carteirinhaValidade', '2026-09-01');
  await page.click('#pSave'); await page.waitForTimeout(500);
  let p = await raw('ana-azul');
  check('cadastro grava convênio, plano, carteirinha e validade?', p.convenioPadrao === 'unimed' && p.carteirinha === '0001-FICT' && p.carteirinhaValidade === '2026-09-01', p);
  check('sem tratamento ativo não pergunta nada?', !(await page.$('#ovConfirm')) && !(await page.$('#ovPat')));
  check('lista mostra a etiqueta de carteirinha vencida ao lado do nome?', /Cart\. vencida/.test(await page.textContent('#patListHost tbody tr:has-text("Ana Azul")')));

  // Tratamento novo já vem com o convênio e o plano do cadastro, e a dica mostra a carteirinha.
  await ev('openTreatmentModal(null, {patientId: "ana-azul"})'); await page.waitForSelector('#ovTreat');
  check('tratamento novo vem com o convênio do cadastro?', (await page.inputValue('#pConv')) === 'Unimed', await page.inputValue('#pConv'));
  check('o tratamento não tem mais o campo Plano?', (await page.$('#pPlano')) === null);
  const hint = await page.textContent('#trConvHint');
  check('dica mostra o cadastro, a carteirinha e o aviso de vencida?', /Cadastro do Paciente: Unimed/.test(hint) && /0001-FICT/.test(hint) && /carteirinha vencida/.test(hint), hint);
  await page.fill('#pConv', 'Bradesco Saúde'); await page.dispatchEvent('#pConv', 'input'); await page.waitForTimeout(300);
  check('dica avisa quando o tratamento usa outro convênio?', /usa outro convênio/.test(await page.textContent('#trConvHint')));
  await page.click('#trCancel'); await page.waitForTimeout(150);

  // Tratamento ativo com outro convênio; trocar o convênio no cadastro pergunta se aplica.
  await ev('writeTreatments([{id:"tr-cp", patientId:"ana-azul", status:"ativo", statusEm:"2026-01-01", inicio:"2026-01-01", tipo:"novo", convenioId:"unimed", convenio:"Unimed", sessoesMes:"", specHours:[], vencPor:"sem", criadoEm:"2026-01-01T00:00:00Z", atualizadoEm:"2026-01-01T00:00:00Z"}])');
  await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await setv('#pf-carteirinha', '0002-NOVA');
  await page.click('#pSave'); await page.waitForTimeout(400);
  check('mudar só o plano do cadastro não pergunta nada?', !(await page.$('#ovConfirm')));
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await setv('#pf-convenioPadrao', 'bradesco-saude');
  await page.click('#pSave'); await page.waitForSelector('#ovConfirm');
  check('com tratamento ativo diferente, pergunta se aplica?', /Convênio do Tratamento Ativo/.test(await page.textContent('#ovConfirm')) && /Bradesco Saúde/.test(await page.textContent('#ovConfirm')));
  await page.click('#cfCancel'); await page.waitForTimeout(400);
  let t = (await trs()).find((x) => x.id === 'tr-cp');
  check('"Só no cadastro" não mexe no tratamento?', t.convenioId === 'unimed' && t.convenio === 'Unimed', [t.convenioId]);
  p = await raw('ana-azul');
  check('e o cadastro foi gravado?', p.convenioPadrao === 'bradesco-saude');

  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await setv('#pf-convenioPadrao', 'unimed'); await page.click('#pSave'); await page.waitForTimeout(400);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await setv('#pf-convenioPadrao', 'bradesco-saude');
  await page.click('#pSave'); await page.waitForSelector('#ovConfirm');
  check('troca de convênio no cadastro pergunta com o convênio novo?', /Bradesco Saúde/.test(await page.textContent('#ovConfirm')));
  await page.click('#cfOk'); await page.waitForTimeout(500);
  t = (await trs()).find((x) => x.id === 'tr-cp');
  check('"Aplicar ao Tratamento" muda o convênio do tratamento ativo?', t.convenioId === 'bradesco-saude', [t.convenioId]);
  const h = (t.historico || []).slice(-1)[0] || {};
  check('histórico do tratamento registra a troca?', h.acao === 'convenio' && /Bradesco/.test(h.para) && /Unimed/.test(h.de), h);
  // Convênio igual ao do tratamento: não pergunta.
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await setv('#pf-carteirinha', '0001-FICT'); await page.click('#pSave'); await page.waitForTimeout(400);
  check('sem mudança de convênio não pergunta?', !(await page.$('#ovConfirm')));

  // Link de Cadastro: o convênio cadastrado vira o convênio do paciente; plano/carteirinha/validade vêm junto.
  const m = await ev('intakeToPatient({nome:"Lia", convenio:"Unimed", plano:"P1", carteirinha:"99", carteirinhaValidade:"2027-02-01"})');
  check('revisão do link: convênio cadastrado, plano, carteirinha e validade vão para o cadastro?', m.patch.convenioPadrao === 'unimed' && m.patch.carteirinha === '99' && m.patch.carteirinhaValidade === '2027-02-01', m.patch);
  const m2 = await ev('intakeToPatient({nome:"Lia", convenio:"Outro", convenioOutro:"Plano X"})');
  check('"Outro" não vira convênio padrão (fica na observação)?', !m2.patch.convenioPadrao && m2.notes.some((n) => /Outro — Plano X/.test(n)), m2);
  const pre = await ev('intakePrefillFrom(rawPatient("ana-azul"))');
  check('Pedir Atualização leva convênio, plano e carteirinha?', pre.convenio === 'Bradesco Saúde' && pre.carteirinha === '0001-FICT', pre);

  // Campos Obrigatórios: o convênio do cadastro e o do link são a mesma linha.
  await ev('openPatientFieldsModal()'); await page.waitForSelector('#ovPf');
  check('Campos Obrigatórios: Convênio, Carteirinha e Validade com colunas de link?', await page.$$eval('#ovPf tr[data-pfk="convenioPadrao"][data-lfk="convenio"], #ovPf tr[data-pfk="carteirinha"][data-lfk="carteirinha"], #ovPf tr[data-pfk="carteirinhaValidade"][data-lfk="carteirinhaValidade"]', (a) => a.length === 3));
  check('sem grupo "Só no link de cadastro" (Possui diagnóstico? saiu)?', await page.$$eval('#ovPf tr[data-lonly]', (a) => a.length === 0));
  await page.click('#pfCancel');

  // Planilha de pacientes: colunas e importação.
  const cols = await ev('IO_KINDS.pacientes.cols.map(function(c){ return c.k; })');
  check('planilha de pacientes tem Convênio, Plano, Carteirinha e Validade?', ['convenio', 'carteirinha', 'carteirinhaValidade'].every((k) => cols.indexOf(k) !== -1));
  const plan = await ev('(function(){ var r = ioPatPlan([{_line: 2, nome: "Ana Azul", convenio: "Unimed Inexistente", plano: "Z"}, {_line: 3, nome: "Paciente Novo Fictício", convenio: "Unimed", carteirinha: "7", carteirinhaValidade: "01/12/2027"}]); return r.items.map(function(x){ return {st: x.st, warn: x.warn, vals: x.vals}; }); })()');
  check('importação: convênio não cadastrado avisa; cadastrado e validade entram?', plan[0].warn.some((w) => /Convênio não cadastrado/.test(w)) && plan[1].vals.convenioPadrao === 'unimed' && plan[1].vals.carteirinhaValidade === '2027-12-01', plan);

  check('no JS errors?', errors.length === 0, errors);
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
