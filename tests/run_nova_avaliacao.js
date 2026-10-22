// Nova Avaliação: cria o tratamento de serviço (Ativo, vencimento por sessões, um quadro) com o valor padrão do convênio (editável).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_na.html');
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

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/services').set({ list: [{ id: 'sessao', name: 'Sessão' }, { id: 'triagem', name: 'Triagem' }, { id: 'avaliacao', name: 'Avaliação' }, { id: 'avaliacao-neuropsicologica', name: 'Avaliação Neuropsicológica' }] });
    await db.doc('config/convenios').set({ list: [{ id: 'unimed', name: 'Unimed', especialidades: ['svc:avaliacao'], valores: { 'svc:avaliacao': '150,00' } }, { id: 'bradesco-saude', name: 'Bradesco Saúde' }] });
  });
  await page.waitForTimeout(300);
  const pid = await ev('state.patientsRaw[0].id');
  await ev('(function(){ var p = state.patientsRaw[0]; p.convenioPadrao = "unimed"; })()');
  const before = await ev('state.treatments.length');

  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(300);
  check('barra de Tratamentos tem + Incluir Avaliação e + Incluir Tratamento?', (await page.isVisible('#trAddAval')) && /Incluir Tratamento/.test(await page.textContent('#trAdd')));
  await page.click('[data-io-wrap="tratamentos"] [data-io-btn]');
  check('Outras Opções não tem mais Nova Avaliação?', !(await page.$('[data-io-act="aval"]')));
  await page.keyboard.press('Escape');
  await page.click('#trAddAval'); await page.waitForSelector('#ovNovaAval');
  const svcs = await page.$$eval('#naSvc option', (o) => o.map((x) => x.textContent));
  check('lista só serviços que não são Sessão, avaliações primeiro?', svcs[0].indexOf('Avalia') === 0 && svcs.indexOf('Sessão') === -1, svcs);
  await page.evaluate((p) => { const s = document.getElementById('naPat'); s.value = p; s.dispatchEvent(new Event('change')); }, pid);
  await page.evaluate(() => { const s = document.getElementById('naSvc'); s.value = 'avaliacao'; s.dispatchEvent(new Event('change')); });
  check('convênio vem do cadastro do paciente?', (await page.inputValue('#naConv')) === 'unimed');
  check('nº de sessões padrão da Avaliação = 2?', (await page.inputValue('#naN')) === '2');
  check('valor padrão = 150 × 2 = 300?', /300,00/.test(await page.inputValue('#naVal')), await page.inputValue('#naVal'));
  await page.fill('#naN', '3');
  check('mudar sessões recalcula (450)?', /450,00/.test(await page.inputValue('#naVal')), await page.inputValue('#naVal'));
  await page.fill('#naVal', '400,00');
  await page.fill('#naN', '4');
  check('valor digitado não é trocado ao mudar sessões?', /400,00/.test(await page.inputValue('#naVal')));
  await page.click('#naSave'); await page.waitForTimeout(300);
  check('sem profissional não salva?', !!(await page.$('#ovNovaAval')));
  await page.evaluate(() => { const s = document.getElementById('naProf'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); });
  await page.click('#naSave'); await page.waitForTimeout(500);
  const t = JSON.parse(await ev('JSON.stringify(state.treatments[state.treatments.length - 1])'));
  check('cria um tratamento?', (await ev('state.treatments.length')) === before + 1);
  check('tratamento de serviço Ativo, vencimento por 4 sessões?', t.tipos.join() === 'svc:avaliacao' && t.status === 'ativo' && t.vencPor === 'sessoes' && t.totalSessoes === 4 && t.patientId === pid, [t.tipos, t.status, t.vencPor, t.totalSessoes]);
  check('quadro com o serviço e 4 sessões, convênio Unimed, valor 400?', t.specHours.length === 1 && t.specHours[0].service === 'avaliacao' && t.specHours[0].hours === 4 && t.convenioId === 'unimed' && t.valor === 400, JSON.stringify(t.specHours));
  check('janela fechou?', !(await page.$('#ovNovaAval')));

  // Segunda avaliação: a anterior (serviço ativo) passa a Finalizado
  await ev('openNovaAvaliacao({patientId: "' + pid + '"})'); await page.waitForSelector('#ovNovaAval');
  await page.evaluate(() => { const s = document.getElementById('naProf'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); });
  await page.click('#naSave'); await page.waitForSelector('#ovConfirm');
  await page.click('#cfOk'); await page.waitForTimeout(500);
  check('avaliação anterior vira Finalizado?', (await ev('state.treatments.filter(function(x){ return x.id === "' + t.id + '"; })[0].status')) === 'finalizado');

  // Filtros de Convênio e Intervenção ABA na barra de Tratamentos
  await ev('renderTreatmentsTab()');
  const setF = (id, v) => page.evaluate(([i, x]) => { const s = document.getElementById(i); s.value = x; s.dispatchEvent(new Event('change')); }, [id, v]);
  await page.check('#trShowInact');
  check('filtro de convênio tem Unimed e Sem Convênio?', await page.$eval('#trConvF', (s) => !!s.querySelector('option[value="unimed"]') && !!s.querySelector('option[value="__sem"]')));
  await setF('trConvF', 'unimed');
  const nU = await page.$$eval('#trHost tr[data-tr-id]', (r) => r.length);
  const expU = await ev('state.treatments.filter(function(x){ return x.convenioId === "unimed"; }).length');
  check('Convênio = Unimed mostra só os da Unimed?', nU === expU && nU > 0, [nU, expU]);
  await setF('trConvF', '');
  await setF('trAbaF', 'Não');
  const nN = await page.$$eval('#trHost tr[data-tr-id]', (r) => r.length);
  const expN = await ev('state.treatments.filter(function(x){ return trAbaText(x) === "Não"; }).length');
  check('Intervenção ABA = Não mostra só os sem Intervenção ABA?', nN === expN, [nN, expN]);
  await setF('trAbaF', '');
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
