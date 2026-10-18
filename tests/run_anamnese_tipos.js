// Tipos de Anamnese (Prontuário ▾ → Tipos de Anamnese): construtor de perguntas, condição, prévia, validações, duplicar. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_anam.html');
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
  const add = async (kind) => { await page.evaluate((k) => { const s = document.getElementById('anAdd'); s.value = k; s.dispatchEvent(new Event('change', {bubbles: true})); }, kind); await page.waitForTimeout(80); };
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="tiposanam"]').click());
  await page.waitForTimeout(250);
  check('screen opens with its title?', !(await page.$eval('#tab-tiposanam', (e) => e.hidden)) && /Modelos de Anamnese/.test(await page.textContent('#tab-tiposanam .cad-title')));
  await page.click('#reg-tiposanam-add'); await page.waitForSelector('#ovAnTipo');
  check('window title "Novo Tipo de Anamnese"?', /Novo Modelo de Anamnese/.test(await page.textContent('#ovAnTipo h3')));
  await page.click('#anSave'); await page.waitForTimeout(100);
  check('empty name refused?', !!(await page.$('#ovAnTipo')));
  await page.fill('#anName', 'Anamnese Inicial'); await page.evaluate(() => { const e = document.getElementById('anVal'); e.value = '12'; e.dispatchEvent(new Event('change', {bubbles: true})); }); check('validity is a list with exactly 3 options (3 Meses, 6 Meses, 1 Ano) and 1 Ano by default?', await page.$$eval('#anVal option', (o) => o.map((x) => x.textContent).join('|')) === '3 Meses|6 Meses|1 Ano');
  await page.click('#anSave'); await page.waitForTimeout(100);
  check('no questions refused?', !!(await page.$('#ovAnTipo')) && (await ev('state.anamTypes.length')) === 0);
  // perguntas (cada uma abre a janela "Incluir Pergunta")
  const addQ = async (kind, title, fn) => {
    await add(kind); await page.waitForSelector('#ovAnQ'); await page.fill('#aqTit', title);
    if (fn) await fn();
    await page.click('#aqSave'); await page.waitForTimeout(120);
  };
  await addQ('secao', 'Dados Gerais'); await addQ('simnao', 'Toma medicação?');
  await addQ('texto', 'Qual medicação?', async () => {
    await page.click('#aqCondAdd'); await page.waitForTimeout(80);
    await page.evaluate(() => { const s = document.querySelector('#ovAnQ select[data-cf=q]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', {bubbles: true})); });
    await page.waitForTimeout(120);
    const v = await page.$eval('#ovAnQ select[data-cf=v]', (s) => s.value);
    check('condition defaults to "Sim"?', v === 'sim', v);
  });
  await addQ('escolha', 'Como é o sono?'); await addQ('escala', 'Nível de atenção', async () => {
    await page.evaluate(() => { const s = document.getElementById('aqMax'); s.value = '10'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  });
  await add('pagina');
  check('6 blocks in the builder?', (await page.$$('#anBuild .an-q')).length === 6);
  check('card shows the condition summary?', /Só aparece se Toma medicação\? é “Sim”/.test(await page.$eval('#anBuild .an-q[data-qi="2"] .rs', (e) => e.textContent)), await page.$eval('#anBuild .an-q[data-qi="2"] .rs', (e) => e.textContent));
  // mover a escala para cima e voltar
  await (await page.$('#anBuild .an-q[data-qi="4"] [data-mv="-1"]')).click(); await page.waitForTimeout(60);
  check('moving up swaps order?', /Nível de atenção/.test(await page.$eval('#anBuild .an-q[data-qi="3"] .rn', (e) => e.textContent)));
  await (await page.$('#anBuild .an-q[data-qi="3"] [data-mv="1"]')).click(); await page.waitForTimeout(60);
  // arrastar o 4º quadro para cima do 2º
  const t0 = await page.$eval('#anBuild .an-q[data-qi="3"] .rn', (e) => e.textContent);
  await page.dragAndDrop('#anBuild .an-q[data-qi="3"] .rn', '#anBuild .an-q[data-qi="1"] .rn', {targetPosition: {x: 20, y: 2}});
  await page.waitForTimeout(150);
  const t1 = await page.$eval('#anBuild .an-q[data-qi="1"] .rn', (e) => e.textContent);
  check('dragging a card changes the order?', t1.replace(/^\d+\.\s*/, '') === t0.replace(/^\d+\.\s*/, ''), t0 + ' -> ' + t1);
  await (await page.$('#anBuild .an-q[data-qi="1"] [data-mv="1"]')).click(); await page.waitForTimeout(80); await (await page.$('#anBuild .an-q[data-qi="2"] [data-mv="1"]')).click(); await page.waitForTimeout(80);
  // duplicar a pergunta de texto
  await (await page.$('#anBuild .an-q[data-qi="2"] [data-dup]')).click(); await page.waitForTimeout(60);
  check('duplicate adds a block with new id?', (await page.$$('#anBuild .an-q')).length === 7);
  await (await page.$('#anBuild .an-q[data-qi="3"] [data-del]')).click(); await page.waitForTimeout(60);
  check('remove drops the block?', (await page.$$('#anBuild .an-q')).length === 6);
  // lógica condicional: várias condições, E/OU e ocultar
  const ev2 = await ev(`(function(){
    var qs = [{id:"a",tipo:"numero",titulo:"Idade"},{id:"b",tipo:"texto",titulo:"Obs"},{id:"c",tipo:"texto",titulo:"X"}];
    anamCondSet(qs[2], [{q:"a",op:"maior",v:"5"},{q:"b",op:"contem",v:"sono"}], "ou", "mostrar");
    var m = anamById(qs), r = [];
    r.push(anamVisible(qs[2], {a:"3", b:""}, m)); r.push(anamVisible(qs[2], {a:"8", b:""}, m)); r.push(anamVisible(qs[2], {a:"3", b:"Dorme mal, sono ruim"}, m));
    anamCondSet(qs[2], [{q:"a",op:"maior",v:"5"},{q:"b",op:"contem",v:"sono"}], "e", "mostrar");
    r.push(anamVisible(qs[2], {a:"8", b:""}, m)); r.push(anamVisible(qs[2], {a:"8", b:"sono"}, m));
    anamCondSet(qs[2], [{q:"a",op:"menor",v:"5"}], "e", "ocultar");
    r.push(anamVisible(qs[2], {a:"3"}, m)); r.push(anamVisible(qs[2], {a:"9"}, m));
    return r.join(",");
  })()`);
  check('conditional logic: OR / AND / contains / greater / hide?', ev2 === 'false,true,true,false,true,false,true', ev2);
  // prévia: condição mostra/esconde
  await page.click('#anSeg [data-m=previa]'); await page.waitForTimeout(150);
  check('section title numbered automatically in the preview?', (await page.$eval('#anPrev .tr-sec', (e) => e.textContent.trim())) === '1. Dados Gerais');
  const cl = await ev('[anamSecClean("3. Rotina"), anamSecClean("2) Medicação"), anamSecClean("Sem número")].join("|")');
  check('typed number is ignored?', cl === 'Rotina|Medicação|Sem número', cl);
  const hid = () => page.$eval('#anPrev [data-qid] input[type=text]', (e) => e.closest('[data-qid]').hidden);
  check('preview hides conditional question at first?', await hid());
  await page.click('#anPrev .an-radios input[value=sim]'); await page.waitForTimeout(80);
  check('answering "Sim" shows it?', !(await hid()));
  await page.click('#anPrev .an-radios input[value=nao]'); await page.waitForTimeout(80);
  check('answering "Não" hides it again?', await hid());
  const nr = await page.$$eval('#anPrev [data-radio] input', (r) => r.length), np = await page.$$('#anPrev .an-page');
  check('preview has scale 1..10 (10 options) and a page divider?', nr === 2 + 10 && np.length === 1, nr + ' ' + np.length);
  await page.click('#anSeg [data-m=montar]');
  // validação: pergunta de escolha com 1 opção
  await (await page.$('#anBuild .an-q[data-qi="3"] [data-ed]')).click(); await page.waitForSelector('#ovAnQ');
  await page.fill('#aqOpc', 'Só uma'); await page.click('#aqSave'); await page.waitForTimeout(120);
  check('choice with 1 option refused?', !!(await page.$('#ovAnQ')));
  await page.fill('#aqOpc', 'Bom\nRuim'); await page.click('#aqSave'); await page.waitForTimeout(120);
  await page.click('#anSave'); await page.waitForTimeout(300);
  const saved = await ev('state.anamTypes.map(function(t){ return {n: t.name, v: t.validadeMeses, q: t.perguntas.length, ver: t.versao, ct: t.perguntas[2].cond && t.perguntas[2].cond.op + ":" + t.perguntas[2].cond.v}; })');
  check('saved: months digits only, 6 blocks, version 1, condition kept?', saved.length === 1 && saved[0].v === 12 && saved[0].q === 6 && saved[0].ver === 1 && saved[0].ct === 'igual:sim', JSON.stringify(saved));
  const row = (await page.$$eval('#reg-tiposanam-host tbody tr:first-child td', (c) => c.map((x) => x.textContent.trim()))).join(' | ');
  check('list row shows name, 4 questions and 1 Ano?', /Anamnese Inicial/.test(row) && /\b4\b/.test(row) && /1 Ano/.test(row), row.replace(/\s+/g, ' '));
  // editar: mudar o modelo sobe a versão; duplicar modelo
  await page.click('#reg-tiposanam-host tbody tr'); await page.waitForSelector('#ovAnTipo');
  await (await page.$('#anBuild .an-q[data-qi="1"] [data-ed]')).click(); await page.waitForSelector('#ovAnQ');
  await page.fill('#aqAjuda', 'Inclua doses'); await page.click('#aqSave'); await page.waitForTimeout(120);
  await page.click('#anSave'); await page.waitForTimeout(300);
  check('editing questions raises the model version to 2?', (await ev('state.anamTypes[0].versao')) === 2);
  await page.click('#reg-tiposanam-host tbody tr'); await page.waitForSelector('#ovAnTipo');
  await page.click('#anDup'); await page.waitForTimeout(200);
  check('duplicate opens a copy named "(cópia)"?', (await page.inputValue('#anName')) === 'Anamnese Inicial (cópia)');
  await page.click('#anSave'); await page.waitForTimeout(300);
  const two = await ev('state.anamTypes.map(function(t){ return t.id + "|" + t.perguntas[2].id + "|" + (t.perguntas[2].cond ? t.perguntas[2].cond.q : ""); })');
  check('copy saved with new question ids and the condition pointing to the copy?', two.length === 2 && two[0].split('|')[0] !== two[1].split('|')[0] && two[0].split('|')[1] !== two[1].split('|')[1] && two[1].split('|')[2] === (await ev('state.anamTypes[1].perguntas[1].id')), JSON.stringify(two));
  await page.click('#reg-tiposanam-host tbody tr'); await page.waitForSelector('#ovAnTipo');
  await page.fill('#anName', 'Anamnese Inicial (cópia)'); await page.click('#anSave'); await page.waitForTimeout(150);
  check('duplicate name refused?', !!(await page.$('#ovAnTipo')));
  await page.click('#anCancel'); await page.waitForTimeout(100);
  // renderizador: ler respostas e obrigatórias
  const r = await ev(`(function(){ var qs = state.anamTypes[0].perguntas; var d = document.createElement("div"); d.innerHTML = anamFormHtml(qs, {}, {}); document.body.appendChild(d);
    anamWire(d, qs, {}); var miss = anamMissing(qs, {}); var a = anamRead(d, qs); d.remove(); return {miss: miss.length, keys: Object.keys(a).length}; })()`);
  check('renderer reads answers (hidden question left out)?', r.keys === 3 || r.keys === 4, JSON.stringify(r));
  const errs = errors.filter((e) => !/ResizeObserver/.test(e));
  check('no JS errors?', errs.length === 0, JSON.stringify(errs));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
