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
  const esc1 = await page.locator('#reg-habilidades-host tbody tr', { hasText: 'Brincar simbólico' }).evaluate((r) => {
    const d = r.cells[1].querySelector('.reg-oneline'); const cs = d && getComputedStyle(d);
    return {head: r.closest('table').querySelectorAll('thead th')[1].textContent.trim(), txt: d && d.textContent, title: d && d.title, nowrap: cs && cs.whiteSpace === 'nowrap' && cs.textOverflow === 'ellipsis', h: d && d.getBoundingClientRect().height};
  });
  console.log('Escopo column shows one line (full text on hover)?', esc1.head === 'Escopo' && esc1.txt === 'Faz de conta, uso de objetos.' && esc1.title === esc1.txt && esc1.nowrap && esc1.h < 24, JSON.stringify(esc1));
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
  // Janela do objetivo: ordem e tipo dos campos.
  const gl = await ev(`(function(){
    openGoalModal(null, {});
    var labs = Array.from(document.querySelectorAll("#ovGoal .modal-body > .field > label")).map(function(l){ return l.textContent.trim(); });
    var r = {labs: labs, name: document.getElementById("glName").tagName + ":" + document.getElementById("glName").type, crit: document.getElementById("glCrit").tagName + ":" + document.getElementById("glCrit").type};
    return r;
  })()`);
  console.log('goal window: Habilidade, Faixas etárias, Objetivo, Critério, Escala, Especialidades; texts on one line?',
    JSON.stringify(gl.labs) === JSON.stringify(['Habilidade', 'Faixas etárias', 'Objetivo', 'Critério de sucesso (sugerido)', 'Escala (sugerida)', 'Especialidades (nenhuma marcada = todas)']) &&
    gl.name === 'INPUT:text' && gl.crit === 'INPUT:text', JSON.stringify(gl));
  await page.waitForTimeout(80);
  console.log('goal window starts on Habilidade?', await page.evaluate(() => !!document.activeElement.closest('.dp-combo') && document.getElementById('glArea').parentNode.contains(document.activeElement)));
  // "[0–4]" digitado no começo do nome vira faixa ao salvar; a lista mostra a coluna Faixas etárias.
  await page.fill('#glName', '[0–4] Apontar para pedir');
  await page.$eval('#glArea', (e) => { e.value = 'comunicacao'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#glSave'); await page.waitForTimeout(250);
  const g1 = JSON.parse(await ev('JSON.stringify(goalBankList().filter(function(g){ return /Apontar/.test(g.name); })[0])'));
  console.log('typed "[0–4] Name" saves name without prefix and band 0–4; label = "[0–4] Name"?', g1.name === 'Apontar para pedir' && JSON.stringify(g1.faixas) === '["0-4"]' && (await ev('goalLabel(goalBankList().filter(function(g){ return /Apontar/.test(g.name); })[0])')) === '[0–4] Apontar para pedir', JSON.stringify(g1));
  const reg = await ev(`(function(){ renderRegistryTab("objetivos"); return Array.from(document.querySelectorAll("#reg-objetivos-host thead th")).map(function(t){ return t.textContent.trim(); }).slice(0, 3).join("|"); })()`);
  console.log('Objetivos list has the Faixas etárias column after Habilidade?', /^Objetivo.*\|Habilidade.*\|Faixas etárias/.test(reg), reg);
  // Planilha de Objetivos: coluna Faixas etárias; "[5–9] Nome" na planilha atualiza o mesmo objetivo.
  const io = await ev(`(function(){
    var k = IO_KINDS.objetivos, row = k.exportRows().filter(function(r){ return /Apontar/.test(r.objetivo); })[0];
    var pl = ioGoalPlan([{_line: 2, objetivo: "[5–9] Apontar para pedir", habilidade: "Comunicação", faixas: "", criterio: "", escala: "", specs: ""},
                         {_line: 3, objetivo: "Novo da planilha", habilidade: "Comunicação", faixas: "0–4 anos, 10+", criterio: "", escala: "", specs: ""}]);
    return {cols: k.cols.map(function(x){ return x.h; }).join("|"), fx: row.faixas, name: row.objetivo, st: pl.items.map(function(i){ return i.st; }).join(), v0: pl.items[0].vals.faixas, v1: pl.items[1].vals.faixas, n1: pl.items[1].vals.name};
  })()`);
  console.log('Objetivos spreadsheet: Faixas etárias column; prefix in the name updates the same goal; band text read?',
    io.cols === 'Objetivo|Habilidade|Faixas etárias|Critério de sucesso|Escala|Especialidades' && io.fx === '0–4 anos' && io.name === 'Apontar para pedir' &&
    io.st === 'atualizar,novo' && JSON.stringify(io.v0) === '["5-9"]' && JSON.stringify(io.v1) === '["0-4","10+"]' && io.n1 === 'Novo da planilha', JSON.stringify(io));
  await ev('document.getElementById("modalHost").innerHTML = ""');
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
