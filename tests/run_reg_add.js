// "+ Incluir" no fim das listas que consultam um cadastro (Diagnóstico, Médico, Escola, Origem, Convênio,
// Especialidade, Motivo, Tipo de colaborador, CBO, Conselho, Habilidade, Escala): aparece só para quem pode
// incluir no cadastro do campo; o item novo entra na lista e já fica escolhido. Computador e celular.
// Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_regadd.html');
  const body = src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13);
  fs.writeFileSync(evPage, body);
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(900);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const openList = async (id) => { await page.click('[data-dp-for="' + id + '"]'); await page.waitForSelector('#dpPop'); };
  const closePop = () => page.evaluate(() => { const p = document.getElementById('dpPop'); if (p) p.remove(); });
  const hasAdd = () => page.evaluate(() => { const a = document.querySelector('#dpPop .dp-add'); return !!a && a === a.parentNode.lastElementChild; });

  // 1. Paciente: Diagnóstico e Como conheceu = listas dos cadastros com "+ Incluir" no fim
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await ev('openPatientModal(null)'); await page.waitForTimeout(400);
  check('patient: Diagnóstico is a list of the Diagnósticos registry?', await page.$eval('#pf-cid', (s) => s.tagName === 'SELECT' && [...s.options].some((o) => o.value === 'F84.0 Autismo infantil')));
  await page.click('[data-dp-for="pf-cid"] .dp-in'); await page.waitForSelector('#dpPop .dp-add');
  check('patient: "+ Incluir" is the last item of the Diagnóstico list?', await hasAdd());
  await page.click('#dpPop .dp-add'); await page.waitForSelector('#ovQuick');
  await page.fill('#regf-code', 'Q90'); await page.fill('#qkName', 'Síndrome de Down'); await page.click('#qkSave'); await page.waitForTimeout(250);
  check('patient: new diagnosis saved in the registry and chosen in the field?', (await page.inputValue('#pf-cid')) === 'Q90 Síndrome de Down' &&
    await page.evaluate(() => (window.__STORE__['config/diagnoses'] || {list: []}).list.some((d) => d.code === 'Q90' && d.name === 'Síndrome de Down')) && !(await page.$('#ovQuick')) && await page.isVisible('#ovPat'));
  await page.click('[data-dp-for="pf-comoConheceu"] .dp-in'); await page.waitForSelector('#dpPop .dp-add');
  await page.fill('[data-dp-for="pf-comoConheceu"] .dp-in', 'Panfleto');
  await page.click('#dpPop .dp-add'); await page.waitForSelector('#ovQuick');
  check('typed text goes to the name of the new item?', (await page.inputValue('#qkName')) === 'Panfleto');
  await page.click('#qkSave'); await page.waitForTimeout(250);
  check('patient: new origin chosen in "Como conheceu"?', (await page.inputValue('#pf-comoConheceu')) === 'Panfleto');
  await page.click('[data-dp-for="pf-medicoId"] .dp-in'); await page.waitForSelector('#dpPop');
  check('patient: Médico list has "+ Incluir" at the end (no side "+" button)?', await hasAdd() && !(await page.$('#ovPat [data-regadd="medicos"]')));
  await closePop();
  await page.click('[data-dp-for="pf-escolaId"] .dp-in'); await page.waitForSelector('#dpPop');
  check('patient: Escola list has "+ Incluir" at the end?', await hasAdd());
  await closePop();
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // 2. Sem permissão de incluir no cadastro do campo: a opção não aparece
  await ev('window.pipoAuth = {can: function(m, a){ return !(m === "diagnosticos" && a === "create"); }, canDefault: function(){ return true; }, isAdmin: function(){ return false; }, profile: function(){ return null; }}');
  await ev('openPatientModal(null)'); await page.waitForTimeout(400);
  await page.click('[data-dp-for="pf-cid"] .dp-in'); await page.waitForSelector('#dpPop');
  const noAdd = await page.evaluate(() => !document.querySelector('#dpPop .dp-add'));
  await closePop();
  await page.click('[data-dp-for="pf-comoConheceu"] .dp-in'); await page.waitForSelector('#dpPop');
  check('without "incluir" in Diagnósticos the option is hidden (other lists keep it)?', noAdd && await hasAdd());
  await closePop();
  await ev('delete window.pipoAuth; document.getElementById("modalHost").innerHTML = ""');

  // 3. Tratamento: motivo do cancelamento, convênio e especialidade
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#trAdd'); await page.waitForSelector('#ovTreat');
  await page.$eval('#trSt', (s) => { s.value = 'cancelado'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.waitForTimeout(150);
  await openList('trMot');
  check('treatment: Motivo do cancelamento list has "+ Incluir"?', await hasAdd());
  await page.click('#dpPop .dp-add'); await page.waitForSelector('#ovQuick');
  await page.fill('#qkName', 'Fim do convênio'); await page.click('#qkSave'); await page.waitForTimeout(250);
  check('treatment: new reason chosen?', await page.$eval('#trMot', (s) => s.options[s.selectedIndex].textContent === 'Fim do convênio'));
  await page.click('#pConv'); await page.waitForTimeout(150);
  check('treatment: Convênio suggestions end with "+ Incluir"?', await page.evaluate(() => { const b = document.querySelector('#pConvSuggest .autolist-new'); return !!b && /\+ Incluir/.test(b.textContent) && b === b.parentNode.lastElementChild; }));
  if (await page.$('#specRowAdd')){ await page.click('#specRowAdd'); await page.waitForTimeout(150); }
  const specIn = await page.$('#ovTreat .spec-name');
  if (specIn){
    await specIn.click(); await page.waitForTimeout(150);
    check('treatment: Especialidade suggestions end with "+ Incluir"?', await page.evaluate(() => [...document.querySelectorAll('#ovTreat .autolist')].some((a) => !a.hidden && /\+ Incluir/.test((a.lastElementChild || {}).textContent || ''))));
  } else console.log('no specialty row');
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // 4. Colaborador: Especialidade principal, Tipos (painel de várias opções), CBO, Conselho
  await ev('openProfessionalModal(state.professionals[0])'); await page.waitForTimeout(400);
  await openList('profSpecialty');
  check('collaborator: Especialidade principal has "+ Incluir"?', await hasAdd());
  await closePop();
  await page.click('#sfTypesMs .ms-btn'); await page.waitForTimeout(100);
  check('collaborator: Tipos panel ends with "+ Incluir" (no side "+")?', await page.evaluate(() => { const p = document.getElementById('sfTypes'); const a = p.querySelector('.ms-add'); return !!a && a === p.lastElementChild && !document.querySelector('.sf-types-pick > .reg-pick-add'); }));
  await page.click('#sfTypes .ms-add'); await page.waitForSelector('#ovQuick');
  await page.fill('#qkName', 'Estagiário'); await page.click('#qkSave'); await page.waitForTimeout(250);
  check('collaborator: new type enters checked, before "+ Incluir"?', await page.evaluate(() => { const p = document.getElementById('sfTypes'); const c = [...p.querySelectorAll('.ms-opt')].find((l) => /Estagiário/.test(l.textContent)); return !!c && c.querySelector('input').checked && p.lastElementChild.classList.contains('ms-add'); }));
  await page.click('#sfTypesMs .ms-btn'); await page.waitForTimeout(100);   // fecha o painel dos tipos
  for (const id of ['profCbos', 'profConselho']){
    await openList(id); const ok = await hasAdd(); await closePop();
    check('collaborator: ' + id + ' has "+ Incluir"?', ok);
  }
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // 5. Banco de objetivos: Habilidade e Escala (a escala abre a janela completa por cima)
  await ev('openGoalModal(null)'); await page.waitForTimeout(300);
  await openList('glArea'); const ha = await hasAdd(); await closePop();
  check('goal: Habilidade has "+ Incluir"?', ha);
  await openList('glScale');
  check('goal: Escala has "+ Incluir"?', await hasAdd());
  await page.click('#dpPop .dp-add'); await page.waitForSelector('#ovScale');
  check('scale opens the full window on top (levels) without closing the goal?', await page.isVisible('#ovScale #scLevels') && !!(await page.$('#glScale')));
  await page.fill('#scName', 'Frequência');
  await page.$$eval('#scLevels input[type=text]', (ins) => ins.forEach((x, k) => { x.value = 'N' + k; x.dispatchEvent(new Event('input', {bubbles: true})); }));
  await page.click('#scSave'); await page.waitForTimeout(250);
  check('goal: new scale chosen?', await page.$eval('#glScale', (s) => s.options[s.selectedIndex].textContent === 'Frequência') && !(await page.$('#ovScale')));
  await ev('document.getElementById("modalHost").innerHTML = ""; document.getElementById("confirmHost") && (document.getElementById("confirmHost").innerHTML = "")');

  // 5b. Convênio: especialidades cobertas; CRM: Diagnóstico, Origem e Convênio do lead
  await ev('openRegistryItem("convenios", state.convenios[0])'); await page.waitForTimeout(300);
  if (await page.$('#cvAdd')){ await page.click('#cvAdd'); await page.waitForTimeout(150); }
  await page.evaluate(() => { const s = [...document.querySelectorAll('#ovReg select.cv-spec')].pop(); s.previousElementSibling.click(); });
  await page.waitForSelector('#dpPop');
  check('convênio: especialidade coberta list has "+ Incluir"?', await hasAdd());
  await closePop(); await ev('document.getElementById("modalHost").innerHTML = ""');
  await ev('crmGo("atendimento")'); await page.waitForTimeout(300);
  await ev('crmOpenTask(null, {listId: "atendimento"})'); await page.waitForTimeout(400);
  await page.fill('#crmWho', 'Lead Fictício'); await page.dispatchEvent('#crmWho', 'input'); await page.waitForTimeout(150);
  for (const id of ['crmLDiag', 'crmLOrig', 'crmLConv']){
    await page.evaluate((id) => { const b = document.querySelector('[data-dp-for="' + id + '"]'); b.scrollIntoView({block: 'center'}); (b.querySelector('.dp-in') || b).click(); }, id);
    await page.waitForSelector('#dpPop'); const ok = await hasAdd(); await closePop();
    check('CRM lead: ' + id + ' has "+ Incluir"?', ok);
  }
  await ev('document.getElementById("modalHost").innerHTML = ""');

  // 6. Cadastros novos na tela
  await page.$eval('#mainTabs button[data-tab=diagnosticos]', (b) => b.click()); await page.waitForTimeout(250);
  check('Cadastros → Diagnósticos lists code and description?', /F84\.0/.test(await page.textContent('#reg-diagnosticos-host')) && /Síndrome de Down/.test(await page.textContent('#reg-diagnosticos-host')));
  await page.$eval('#mainTabs button[data-tab=origens]', (b) => b.click()); await page.waitForTimeout(250);
  check('Cadastros → Origens lists the origins?', /Indicação médica/.test(await page.textContent('#reg-origens-host')) && /Panfleto/.test(await page.textContent('#reg-origens-host')));

  // 7. Celular: a lista abre na janela de baixo com "+ Incluir" no fim
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mPage = path.join(__dirname, 'page_regadd_m.html');
  fs.writeFileSync(mPage, body.replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">'));
  mp.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  await mp.goto('file://' + mPage); await mp.waitForTimeout(900);
  await mp.evaluate(() => window.__ev('openPatientModal(null)')); await mp.waitForTimeout(400);
  await mp.evaluate(() => { const b = document.querySelector('[data-dp-for="pf-cid"]'); b.scrollIntoView({block: 'center'}); b.click(); });
  await mp.waitForTimeout(200);
  check('mobile: Diagnóstico opens the bottom window with "+ Incluir" at the end?', await mp.evaluate(() => !!document.querySelector('#mSheet #dpPop .dp-add')));

  check('no JS errors?', errors.length === 0, errors);
  fs.unlinkSync(evPage); fs.unlinkSync(mPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
