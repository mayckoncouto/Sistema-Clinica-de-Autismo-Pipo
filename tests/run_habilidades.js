// Cadastro de Habilidades: Habilidade, Escopo, Faixas etárias (as mesmas da cor do
// paciente) e Especialidades sugeridas; no plano, as da idade do paciente primeiro.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_hab.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  const leg = await page.$$eval('.color-legend span', (s) => s.map((x) => x.textContent.trim()));
  console.log('legends come from the age bands?', ['0–4 anos', '5–9 anos', '10+ anos'].every((t) => leg.filter((x) => x === t).length === 2), leg.join('|'));
  const col = await ev(`[patientColor({nome: "x", idade: 3}), patientColor({nome: "x", idade: 7}), patientColor({nome: "x", idade: 12}), patientColor({nome: "x"})].join(",")`);
  console.log('patient color still by the same bands?', col === '#AECCE5,#C4DCA9,#F4CC99,', col);

  // Janela: campos na ordem pedida; gravar.
  await page.$eval('#mainTabs button[data-tab=habilidades]', (b) => b.click());
  await page.click('#reg-habilidades-add'); await page.waitForSelector('#regHabEscopo');
  const labels = await page.$$eval('#ovReg .modal-body > .field > label', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log('fields: Habilidade, Escopo, Faixas etárias, Especialidades sugeridas?', /^Habilidade/.test(labels[0]) && labels[1] === 'Escopo' && /^Faixas etárias/.test(labels[2]) && /^Especialidades sugeridas/.test(labels[3]), labels);
  await page.fill('#regName', 'Brincar simbólico');
  await page.fill('#regHabEscopo', 'Faz de conta, uso de objetos.');
  await page.check('#regHabAges input[value="0-4"]');
  await page.click('#regSave'); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => (window.__STORE__['config/skill_areas'].list || []).filter((a) => a.name === 'Brincar simbólico')[0]);
  console.log('saves scope and age bands?', !!saved && saved.escopo === 'Faz de conta, uso de objetos.' && JSON.stringify(saved.faixas) === '["0-4"]', JSON.stringify(saved));
  const row = await page.textContent('#reg-habilidades-host');
  console.log('list shows the bands and "Todas as idades"?', /0–4 anos/.test(row) && /Todas as idades/.test(row));

  // Plano: paciente de 7 anos → a habilidade só de 0–4 vem depois, "fora da faixa".
  const order = await ev(`(function(){
    state.patientsRaw = state.patientsRaw.map(function(p){ return p.id === "ana-azul" ? Object.assign({}, p, {idade: 7, nascimento: ""}) : p; }); rebuildPatients();
    openPlanModal(null, {patientId: "ana-azul"});
    var o = Array.from(document.querySelectorAll("#plAddArea option")).map(function(x){ return x.textContent; });
    document.getElementById("modalHost").innerHTML = "";
    return o;
  })()`);
  const last = order[order.length - 1];
  console.log('plan lists the patient age first, others "(fora da faixa)" at the end?', last === 'Brincar simbólico (fora da faixa)' && order.filter((x) => /fora da faixa/.test(x)).length === 1, order.join('|'));

  // Planilha: faixas e escopo.
  const imp = await ev(`(function(){
    var w = []; var a = ioAgeBands("0–4 anos, 10+", w), b = ioAgeBands("3 a 8", w);
    var pl = ioHabPlan([{_line: 2, nome: "Brincar simbólico", escopo: "", faixas: "5-9", specs: ""}]);
    return {a: a, b: b, w: w.length, st: pl.items[0].st, msg: pl.items[0].msgs.join(" ")};
  })()`);
  console.log('import reads bands, warns unknown, empty scope keeps the old one?', JSON.stringify(imp.a) === '["0-4","10+"]' && imp.b.length === 0 && imp.w === 1 && imp.st === 'atualizar' && /Faixas etárias/.test(imp.msg) && !/Escopo/.test(imp.msg), JSON.stringify(imp));

  const exp = await ev(`(function(){
    var k = IO_KINDS.habilidades, rows = k.exportRows(), b = rows.filter(function(r){ return r.nome === "Brincar simbólico"; })[0];
    var c = rows.filter(function(r){ return r.nome === "Comunicação"; })[0];
    var pl = ioHabPlan([{_line: 2, nome: "Brincar simbólico", escopo: "", faixas: "Todas as idades", specs: ""}]);
    return {cols: k.cols.map(function(x){ return x.h; }).join("|"), b: b, c: c.faixas, st: pl.items[0].st, msg: pl.items[0].msgs.join(" ")};
  })()`);
  console.log('export has Escopo and Faixas etárias (empty = "Todas as idades")?', exp.cols === 'Habilidade|Escopo|Faixas etárias|Especialidades sugeridas' &&
    exp.b.escopo === 'Faz de conta, uso de objetos.' && exp.c === 'Todas as idades', JSON.stringify(exp));
  console.log('importing "Todas as idades" clears the bands?', exp.st === 'atualizar' && /Todas as idades/.test(exp.msg));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
