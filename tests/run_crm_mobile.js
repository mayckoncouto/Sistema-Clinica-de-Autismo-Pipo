// CRM no celular (390px): campos de escolha abrem a janela que sobe de baixo (#mSheet),
// lista com Status/Tarefa curta/Vencimento/Prioridade, calendário abre as tarefas do dia.
// Em memória. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  let src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  src = src.replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_crm_m.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(1200);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  await ev('crmGo("atendimento")');
  await page.waitForTimeout(400);
  await ev(`(function(){ CRM.people = [{id: "local-me", full_name: "Você Teste"}, {id: "u2", full_name: "Bia Sec"}];
    var d = function(n){ return agdIso(agdAddDays(agdStartOfDay(new Date()), n)); };
    crmInsert({list_id: "atendimento", status: "triagem", title: "Ligar para a família para agendar avaliação", priority: "urgente", due_date: d(3), assignees: ["local-me"], lead: {nome: "Criança Teste"}});
    crmInsert({list_id: "atendimento", status: "avaliacao", title: "Enviar contrato", priority: "alta", due_date: d(5), assignees: [], lead: {}});
    crmRender(); return 1; })()`);
  await page.waitForTimeout(200);
  const vis = await page.$$eval('#crmHost .pat-table thead th', (r) => r.filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()));
  check('list shows only Status, Tarefa, Vencimento, Prioridade?', vis.length === 4 && /Status/i.test(vis[0]) && /Tarefa/i.test(vis[1]), vis);
  const short = await page.$eval('#crmHost .crm-t-sm', (e) => [e.textContent, getComputedStyle(e).display]);
  check('task title cut to 4 words on the phone?', short[0] === 'Ligar para a família…' && short[1] !== 'none', short);
  check('page has no sideways scroll?', (await ev('document.documentElement.scrollWidth')) <= 390);
  // Menu ☰: só a tela aberta marcada, grupo dela aberto e em destaque
  await page.click('#mnavBtn');
  const mn = await page.evaluate(() => ({on: [...document.querySelectorAll('#mnavPanel button.on')].map((b) => b.textContent.trim()),
    grp: [...document.querySelectorAll('#mnavPanel .mnav-grp.has-on')].map((b) => b.textContent.trim() + ':' + b.getAttribute('aria-expanded'))}));
  check('mobile menu marks only the open list (CRM group open)?', mn.on.join() === 'Atendimento' && mn.grp.join() === 'CRM:true', JSON.stringify(mn));
  await page.click('#mnavBtn');
  // filtro
  await page.click('[data-dp-for="crmFPrio"]');
  check('filter opens the bottom window with its title?', !!(await page.$('#mSheet')) && /Prioridade/.test(await page.$eval('#mSheet .msheet-head', (e) => e.textContent)));
  await page.click('#mSheet .dp-opt[data-v="urgente"]');
  check('choosing in the window filters and closes it?', (await ev('document.getElementById("crmFPrio").value')) === 'urgente' && !(await page.$('#mSheet')));
  await ev('(function(){ var e = document.getElementById("crmFPrio"); e.value = ""; e.dispatchEvent(new Event("change")); })()');
  // janela da tarefa
  await page.click('#crmHost tbody tr');
  await page.waitForSelector('#ovCrm');
  await page.click('#crmStBtn');
  check('Status opens the bottom window with search and dots?', !!(await page.$('#mSheet .crm-pop-q')) && (await page.$$('#mSheet [data-pick] .crm-dot')).length === 5);
  await page.fill('#mSheet .crm-pop-q', 'pos');
  await page.click('#mSheet [data-pick]:not([hidden])');
  check('status picked in the window?', (await ev('document.getElementById("crmSt").value')) === 'pos-avaliacao' && !(await page.$('#mSheet')));
  await page.click('#crmPrioBtn');
  await page.click('#mSheet [data-pick="baixa"]');
  check('priority picked in the window?', (await ev('document.getElementById("crmPrio").value')) === 'baixa');
  await page.click('#ovCrm [data-dp-for="crmDue"]');
  check('date field opens the calendar window (no keyboard: read-only text)?', !!(await page.$('#mSheet .dp-grid')) && (await page.$eval('#ovCrm [data-dp-for="crmDue"] .dp-in', (e) => e.readOnly)));
  await page.click('#mSheet .dp-clear');
  check('Limpar clears the date?', (await ev('document.getElementById("crmDue").value')) === '' && !(await page.$('#mSheet')));
  await page.click('#crmPeopleMs .ms-btn');
  await page.click('#mSheet [data-pick="u2"]');
  await page.click('#mSheet .msheet-x');
  check('Responsáveis marked in the window and kept after ✕?', (await ev('Array.prototype.some.call(document.querySelectorAll("#crmPeople input"), function(i){ return i.value === "u2" && i.checked; })')) && !(await page.$('#mSheet')));
  await page.click('[data-dp-for="crmLOrig"]');
  await page.mouse.click(195, 40);
  check('tapping outside closes the window and keeps the task open?', !(await page.$('#mSheet')) && !!(await page.$('#ovCrm')));
  check('fields with the label above (one column)?', (await page.$eval('#ovCrm .crm-prop', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)) === 1);
  // Detalhes | Atividade
  check('Detalhes tab shows the fields and hides the activity?', await page.$eval('#crmTitleIn', (e) => e.offsetParent !== null) && await page.$eval('#crmSide', (e) => getComputedStyle(e).display === 'none'));
  await page.click('#crmMTabs [data-mtab="act"]');
  const act = await page.evaluate(() => ({fields: document.getElementById('crmTitleIn').offsetParent !== null, feed: document.getElementById('crmFeed').offsetParent !== null,
    box: document.getElementById('crmCommentIn').offsetParent !== null, bg: getComputedStyle(document.getElementById('crmSide')).backgroundColor, mbg: getComputedStyle(document.querySelector('#ovCrm .crm-modal')).backgroundColor}));
  check('Atividade tab shows updates + comment box on white, without the fields?', !act.fields && act.feed && act.box && act.bg === act.mbg, JSON.stringify(act));
  await page.click('#crmMTabs [data-mtab="det"]');
  await page.click('#crmClose');
  await page.waitForTimeout(200);
  // calendário
  await page.click('[data-cv="calendario"]');
  const day = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), 3))');
  await page.click('[data-cal-day="' + day + '"]');
  check('tapping a calendar day opens the window with its tasks?', /Ligar para a família/.test(await page.$eval('#mSheet', (e) => e.textContent)));
  await page.click('#mSheet [data-pick]:not([data-pick="__new"])');
  check('tapping a task in the window opens it?', !!(await page.$('#ovCrm')) && (await ev('document.getElementById("crmTitleIn").value')) === 'Ligar para a família para agendar avaliação');
  await page.click('#crmClose');
  // Listas e status
  await ev('crmOpenListsModal()');
  await page.waitForSelector('#ovCrmL');
  const over = await page.$$eval('#ovCrmL .therapist-row .rm', (l) => l.filter((b) => b.getBoundingClientRect().right > 390).length);
  check('Listas e status: nothing past the screen edge?', over === 0, over);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log(fails + ' FAILED'); process.exit(1); }
})();
