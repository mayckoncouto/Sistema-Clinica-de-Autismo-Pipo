// Anamneses (Prontuário ▾ → Anamneses): lista, + Incluir, preenchimento com dados do cadastro, rascunho, concluir, travar, reavaliar, validade, filtros. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_anms.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const pat = await ev('(function(){ var p = state.patients[0]; return {id: p.id, nome: p.nome}; })()');
  await ev(`state.anamTypes = [{id: "t1", name: "Anamnese Inicial", validadeMeses: 12, versao: 1, perguntas: [
    {id: "q1", tipo: "texto", titulo: "Nome", obrigatoria: true, campo: "nome"},
    {id: "q2", tipo: "simnao", titulo: "Toma medicação?", obrigatoria: true},
    {id: "q3", tipo: "texto", titulo: "Qual?", obrigatoria: true, cond: {q: "q2", op: "igual", v: "sim"}},
    {id: "q4", tipo: "escolha", titulo: "Sono", opcoes: [{id: "o1", label: "Bom"}, {id: "o2", label: "Ruim"}]},
    {id: "q5", tipo: "multipla", titulo: "Marque", opcoes: [{id: "m1", label: "A"}, {id: "m2", label: "B"}]}]},
    {id: "t2", name: "Outra", perguntas: [{id: "z1", tipo: "texto", titulo: "X"}]}]`);
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="anamneses"]').click());
  await page.waitForTimeout(300);
  check('Anamneses screen opens with its title?', !(await page.$eval('#tab-anamneses', (e) => e.hidden)) && /Anamneses/.test(await page.textContent('#tab-anamneses .cad-title')));
  check('empty list message?', /Nenhuma anamnese preenchida/.test(await page.textContent('#reg-anamneses-host')));
  await page.click('#amAdd'); await page.waitForSelector('#ovAnNew');
  await page.click('#anwGo'); await page.waitForTimeout(80);
  check('start without choices refused?', !!(await page.$('#ovAnNew')));
  await page.evaluate((id) => { for (const [s, v] of [['anwType', 't1'], ['anwPat', id]]) { const el = document.getElementById(s); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); } }, pat.id);
  await page.click('#anwGo'); await page.waitForSelector('#ovAnam');
  check('form opens with the name prefilled from the registry?', (await page.inputValue('#anq-q1')) === pat.nome, await page.inputValue('#anq-q1'));
  check('conditional question hidden at first?', await page.$eval('[data-qid="q3"]', (e) => e.hidden));
  // concluir sem responder o obrigatório
  await page.click('#amDone'); await page.waitForTimeout(150);
  check('conclude blocked while required answers are missing?', !!(await page.$('#ovAnam')) && (await ev('AN.mem[0].status')) === 'rascunho');
  await page.click('[data-radio="q2"] input[value=sim]'); await page.waitForTimeout(80);
  check('answering Sim shows the conditional question?', !(await page.$eval('[data-qid="q3"]', (e) => e.hidden)));
  await page.fill('#anq-q3', 'Risperidona');
  await page.evaluate(() => { const s = document.getElementById('anq-q4'); s.value = 'o2'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.click('[data-multi="q5"] input[value=m2]');
  await page.click('#amDraft'); await page.waitForTimeout(250);
  const d = await ev('JSON.stringify(AN.mem[0].answers)');
  check('draft saved with the answers?', /Risperidona/.test(d) && /"q2":"sim"/.test(d) && /"q4":"o2"/.test(d) && /"q5":\["m2"\]/.test(d), d);
  check('list row shows patient, type, v1 and Rascunho?', await page.$eval('#reg-anamneses-host tbody tr:first-child', (r) => /v1/.test(r.textContent) && /Rascunho/.test(r.textContent) && /Anamnese Inicial/.test(r.textContent)));
  // reabrir, concluir
  await page.click('#reg-anamneses-host tbody tr'); await page.waitForSelector('#ovAnam');
  check('draft reopens with saved answers and conditional shown?', (await page.inputValue('#anq-q3')) === 'Risperidona' && !(await page.$eval('[data-qid="q3"]', (e) => e.hidden)));
  await page.click('[data-radio="q2"] input[value=nao]'); await page.waitForTimeout(60);
  check('answering Não hides the conditional and concluding no longer needs it?', await page.$eval('[data-qid="q3"]', (e) => e.hidden));
  await page.click('#amDone'); await page.waitForSelector('#cfOk', {timeout: 3000});
  await page.click('#cfOk'); await page.waitForTimeout(300);
  const st = await ev('AN.mem[0].status + "|" + JSON.stringify(AN.mem[0].answers)');
  check('concluded; the hidden answer was dropped?', /^concluida\|/.test(st) && !/Risperidona/.test(st), st);
  check('list shows Concluída and the validity "Até"?', await page.$eval('#reg-anamneses-host tbody tr:first-child', (r) => /Concluída/.test(r.textContent) && /Até/.test(r.textContent)));
  // concluída é só leitura
  await page.click('#reg-anamneses-host tbody tr'); await page.waitForSelector('#ovAnam');
  check('concluded is read-only (no save buttons, no input fields, shows the answers as a document)?', !(await page.$('#amDone')) && !(await page.$('#amDraft')) && !(await page.$('#ovAnam .an-view input, #ovAnam .an-view select, #ovAnam .an-view textarea')) && /Concluída/.test(await page.textContent('#ovAnam .an-vmeta')) && !!(await page.$('#ovAnam .an-va .an-vv')));
  check('concluded offers Reavaliar and Imprimir?', !!(await page.$('#amRe')) && !!(await page.$('#amPrint')));
  // reavaliar
  await page.click('#amRe'); await page.waitForSelector('#ovAnam .modal-sub');
  await page.waitForTimeout(250);
  check('Reavaliar creates v2 draft linked to the previous one with the old answers?', await ev('AN.mem.length') === 2 && (await ev('AN.mem[1].versao')) === 2 && (await ev('AN.mem[1].prev')) === (await ev('AN.mem[0].id')) && /"q2":"nao"/.test(await ev('JSON.stringify(AN.mem[1].answers)')));
  await page.click('#amCancel'); await page.waitForTimeout(100);
  // validade vencida
  await ev('AN.mem[0].data = "2020-01-10"; AN.mem[1].status = "concluida"; AN.mem[1].data = "2020-01-10"; AN.mem[0].status = "concluida"; 1');
  await ev('renderAnamneses()');
  const vals = await page.$$eval('#reg-anamneses-host tbody tr', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ')));
  check('older version shows "Substituída" and latest shows "Vencida"?', vals.some((t) => /Substituída/.test(t)) && vals.some((t) => /Vencida/.test(t)), JSON.stringify(vals));
  await page.evaluate(() => { const s = document.getElementById('amValid'); s.value = 'vencida'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.waitForTimeout(120);
  check('filter Vencidas keeps only the latest?', (await page.$$('#reg-anamneses-host tbody tr')).length === 1);
  await ev("AN.f.valid = ''; 1"); await page.evaluate(() => { const s = document.getElementById('amSt'); s.value = 'rascunho'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.waitForTimeout(120);
  check('filter Rascunho shows none now?', /Nenhuma anamnese com esses filtros/.test(await page.textContent('#reg-anamneses-host')));
  await ev("AN.f.st = ''; renderAnamneses(); 1");
  // Tipos: em uso vira Inativar
  const use = await ev('USAGE.tiposanam({id: "t1"})');
  check('type in use is reported (will Inativar)?', use.length === 1 && /2 anamneses/.test(use[0]), JSON.stringify(use));
  // excluir o rascunho
  await ev('AN.mem[1].status = "rascunho"; 1');
  await ev('renderAnamneses()');
  await page.click('#reg-anamneses-host tbody tr:first-child'); await page.waitForSelector('#ovAnam');
  await page.click('#amDel'); await page.waitForSelector('#cfOk');
  await page.click('#cfOk'); await page.waitForTimeout(250);
  check('draft deleted?', (await ev('AN.mem.length')) === 1);
  // permissões por tipo para a tela de níveis
  check('permission rows: one per type?', (await ev('window.pipoAnamModules().map(function(m){ return m.key; }).join()')) === 'anm_t1,anm_t2');
  const errs = errors.filter((e) => !/ResizeObserver/.test(e));
  check('no JS errors?', errs.length === 0, JSON.stringify(errs));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
