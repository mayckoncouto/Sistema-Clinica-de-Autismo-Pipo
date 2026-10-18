// Modelos de anamnese prontos (supabase/2026-10-18d-modelos-de-anamnese.sql): abrem no construtor e no preenchimento,
// condições funcionam, preenchimento pelo cadastro e a tela Modelos fica em Anamneses → Outras Opções. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '2026-10-18d-modelos-de-anamnese.sql'), 'utf8');
  const models = [...sql.matchAll(/\$j\$(.*?)\$j\$/gs)].map((m) => JSON.parse(m[1]));
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_mdp.html');
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
  check('three ready models in the migration (154 / 322 / 64 items)?', models.length === 3 && models.map((m) => m.perguntas.length).join() === '154,322,64', models.map((m) => m.perguntas.length).join());
  const ids = new Set(); let idsOk = true, condOk = true, optOk = true;
  for (const m of models) {
    const set = new Set(m.perguntas.map((q) => q.id));
    if (set.size !== m.perguntas.length) idsOk = false;
    m.perguntas.forEach((q, k) => {
      if (q.cond && !(set.has(q.cond.q) && m.perguntas.findIndex((x) => x.id === q.cond.q) < k)) condOk = false;
      if ((q.tipo === 'escolha' || q.tipo === 'multipla') && (q.opcoes || []).length < 2) optOk = false;
      if (q.cond) { const src = m.perguntas.find((x) => x.id === q.cond.q); if (src.opcoes && !src.opcoes.some((o) => o.id === q.cond.v)) condOk = false; }
    });
  }
  check('unique ids, conditions point to an earlier question and a real option, 2+ options everywhere?', idsOk && condOk && optOk, {idsOk, condOk, optOk});
  await ev(`state.anamTypes = ${JSON.stringify(models)}`);
  const pat = await ev('(function(){ var p = state.patients[0]; return {id: p.id, nome: p.nome}; })()');
  // Modelos fora do menu Prontuário, dentro de Anamneses → Outras Opções
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="anamneses"]').click());
  await page.waitForTimeout(300);
  check('Prontuário menu no longer lists "Tipos de Anamnese"/Modelos?', !(await ev('PR_ITEMS.some(function(i){ return i.tab === "tiposanam"; })')));
  await page.click('#amMenuBtn'); await page.waitForTimeout(100);
  check('Anamneses → Outras Opções has "Modelos"?', /Modelos/.test(await page.textContent('#amMenu')) && !/Tipos de Anamnese/.test(await page.textContent('#amMenu')));
  await page.click('#amMenu [data-am-act="tipos"]'); await page.waitForTimeout(300);
  const hostTxt = await page.textContent('#reg-tiposanam-host'); check('Modelos screen lists the three ready models with their question counts?', await page.$$eval('#reg-tiposanam-host tbody tr', (r) => r.length) === 3 && models.every((m) => hostTxt.indexOf(String(m.perguntas.filter((q) => !['secao', 'bloco', 'separador', 'pagina'].includes(q.tipo)).length)) !== -1), hostTxt.slice(0, 120));
  // abre o construtor de cada modelo
  for (const m of models) {
    await ev(`openAnamTypeModal(anamTypeById(${JSON.stringify(m.id)}))`);
    await page.waitForSelector('#ovAnTipo');
    const n = await page.$$eval('#anBuild .an-q', (e) => e.length);
    check('builder opens "' + m.name + '" with all its questions?', n === m.perguntas.length, n);
    await page.click('#anSeg [data-an="prev"]').catch(() => {});
    await page.evaluate(() => { const b = document.getElementById('amClose') || document.querySelector('#ovAnTipo .modal-close'); b.click(); });
    await page.waitForTimeout(150);
    if (await page.$('#ovGuard')) await page.click('#gdSair');
    await page.waitForTimeout(100);
  }
  // preenchimento: Acompanhamento
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="anamneses"]').click());
  await page.waitForTimeout(300);
  await page.click('#amAdd'); await page.waitForSelector('#ovAnNew');
  await page.evaluate((id) => { for (const [s, v] of [['anwType', 'anam-acompanhamento'], ['anwPat', id]]) { const el = document.getElementById(s); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); } }, pat.id);
  await page.click('#anwGo'); await page.waitForSelector('#ovAnam');
  const qid = (t) => models[2].perguntas.find((q) => q.titulo === t).id;
  check('child name comes from the registry?', (await page.inputValue('#anq-' + qid('Nome da criança'))) === pat.nome);
  check('"Qual medicação?" hidden until "Faz uso de medicação?" = Sim?', await page.$eval(`[data-qid="${qid('Qual medicação?')}"]`, (e) => e.hidden));
  await page.click(`[data-radio="${qid('Faz uso de medicação?')}"] input[value=sim]`); await page.waitForTimeout(80);
  check('choosing Sim shows it', !(await page.$eval(`[data-qid="${qid('Qual medicação?')}"]`, (e) => e.hidden)));
  await page.click('#amCancel'); await page.waitForTimeout(100); if (await page.$('#ovGuard')) await page.click('#gdSair');
  // preenchimento: TEA e Multidisciplinar abrem inteiros
  for (const [id, n] of [['anam-tea-tgd', 322], ['anam-multidisciplinar', 154]]) {
    await ev(`(function(){ var t = anamTypeById(${JSON.stringify(id)}); anInsert({patient: ${JSON.stringify(pat.id)}, patientName: ${JSON.stringify(pat.nome)}, type: t.id, typeName: t.name, typeVersion: 1, perguntas: anamCopyQs(t.perguntas), answers: anPrefillAnswers(t.perguntas, findPatientById(${JSON.stringify(pat.id)}), {}), data: trTodayIso(), versao: 1}); })()`);
  }
  await ev('renderAnamneses()');
  for (const [name, n] of [['Anamnese Avaliação TEA/TGD', 322], ['Avaliação Multidisciplinar', 154]]) {
    const rid = await ev(`AN.mem.filter(function(r){ return r.typeName === ${JSON.stringify(name)}; })[0].id`);
    await ev(`openAnamModal(${JSON.stringify(rid)})`); await page.waitForSelector('#ovAnam');
    const c = await page.$$eval('#amForm .an-qf', (e) => e.length);
    check('"' + name + '" fills with all ' + n + ' items?', c === n, c);
    await page.click('#amCancel'); await page.waitForTimeout(100); if (await page.$('#ovGuard')) await page.click('#gdSair');
  }
  console.log('errors:', errors.length ? errors : 'none');
  console.log('no JS errors?', errors.length === 0);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
