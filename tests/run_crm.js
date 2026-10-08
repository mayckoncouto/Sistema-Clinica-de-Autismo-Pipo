// CRM (Fase 1): menu CRM ▾, listas e status, tarefa com dados do contato, Lista/Quadro,
// arrastar muda status, histórico, @menção não lida, contador, Minhas tarefas, Listas e status.
// Sem sistema online: tudo em memória (CRM.mem). Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_crm.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack).split(/\n/).slice(1, 3).join(' | ')));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setv = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await ev('(function(){ CRM.people = [{id: "local-me", full_name: "Você Teste"}, {id: "u2", full_name: "Bia Sec"}]; return true; })()');

  // Menu CRM ▾
  await page.click('#crmBtn');
  const items = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('CRM menu: Minhas tarefas, the 4 lists and Listas e status?', items.join('|') === 'Minhas tarefas|Atendimento|Agendas|Fature|Gestão|Listas e status', items);
  await page.click('#crmMenu [data-nav="crm-atendimento"]');
  await page.waitForSelector('#crmHost .crm-grp');
  const groups = await page.$$eval('#crmHost .crm-grp-head .crm-chip', (r) => r.map((x) => x.textContent));
  check('Lista view: one group per status of Atendimento?', groups.join('|') === 'Triagem|Avaliação|Pós-avaliação|Contrato assinado|Cancelado', groups);

  // Nova tarefa com dados do contato, vencida, urgente, com responsável
  await page.click('#crmAdd');
  await page.waitForSelector('#ovCrm');
  await page.fill('#crmLNome', 'Criança Teste');
  await page.fill('#crmLResp', 'Mãe Teste');
  await page.fill('#crmLTel', '47999990000');
  await setv('#crmLConv', 'Unimed');
  await page.fill('#crmLPlano', 'fesp');
  const yesterday = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), -1))');
  await setv('#crmDue', yesterday);
  await setv('#crmPrio', 'urgente');
  await page.click('#crmPeople [data-pid="local-me"]');
  check('loss reason hidden while status is Triagem?', await page.$eval('#crmLossBox', (e) => e.hidden));
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const row = await page.$eval('#crmHost tr[data-crm-id]', (e) => ({t: e.textContent, late: !!e.querySelector('.crm-due.late'), av: e.querySelectorAll('.crm-av').length, tag: (e.querySelector('.crm-tag') || {}).textContent}));
  check('saved: title from the child name, convênio tag, red overdue date, assignee avatar?', /Criança Teste/.test(row.t) && /Unimed fesp/.test(row.tag || '') && row.late && row.av === 1, JSON.stringify(row));
  check('counter on CRM: 1 (my overdue open task)?', (await page.$eval('#crmBadge', (e) => !e.hidden && e.textContent)) === '1');
  const tid = await ev('Object.keys(CRM.tasks)[0]');

  // Quadro + arrastar para Avaliação
  await page.click('#crmViewSeg [data-cv="quadro"]');
  await page.waitForSelector('.crm-board');
  await page.dragAndDrop(`.crm-card[data-crm-id="${tid}"]`, '.crm-col[data-crm-drop="avaliacao"]');
  await page.waitForTimeout(250);
  check('Quadro: dragging the card to Avaliação changes the status?', (await ev(`CRM.tasks["${tid}"].status`)) === 'avaliacao');
  // Cancelado pede o motivo de perda
  await ev(`(function(){ crmSetStatus(CRM.tasks["${tid}"], "cancelado"); return true; })()`);
  await page.waitForSelector('#ovCrm');
  check('moving to Cancelado opens the task asking the loss reason?', !(await page.$eval('#crmLossBox', (e) => e.hidden)) && (await page.$eval('#crmSt', (e) => e.value)) === 'cancelado');
  await page.click('#crmSave'); await page.waitForTimeout(200);
  check('saving without loss reason is refused?', !!(await page.$('#ovCrm')) && (await ev(`CRM.tasks["${tid}"].status`)) === 'avaliacao');
  await page.fill('#crmLPerda', 'Financeiro');
  await page.click('#crmSave'); await page.waitForTimeout(250);
  check('with the reason it saves (Cancelado = closed, counter back to 0)?', (await ev(`CRM.tasks["${tid}"].status`)) === 'cancelado' && (await page.$eval('#crmBadge', (e) => e.hidden)));

  // Histórico e comentário com @menção
  await page.click('#crmViewSeg [data-cv="lista"]');
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`);
  await page.waitForSelector('#crmActivity .crm-ev');
  const hist = await page.$eval('#crmActivity', (e) => e.textContent);
  check('activity shows creation and the status changes?', /criou a tarefa/.test(hist) && /mudou o status de Triagem para Avaliação/.test(hist) && /para Cancelado/.test(hist), hist.slice(0, 200));
  await page.fill('#crmCommentIn', 'Ligar amanhã @Bi');
  await page.dispatchEvent('#crmCommentIn', 'input');
  await page.waitForSelector('#crmMentionPop button');
  await page.dispatchEvent('#crmMentionPop [data-mention="Bia Sec"]', 'mousedown');
  check('@ shows people and picking writes "@Bia Sec"?', /@Bia Sec $/.test(await page.$eval('#crmCommentIn', (e) => e.value)));
  await page.click('#crmCommentSend'); await page.waitForTimeout(250);
  const ev1 = await ev(`CRM.mem.events.filter(function(e){ return e.kind === "comment"; })[0]`);
  check('comment saved with the mention (Bia)?', ev1 && ev1.mentions.join() === 'u2' && /crm-mention/.test(await page.$eval('#crmActivity', (e) => e.innerHTML)));
  await page.click('#crmCancel');

  // Menção de outra pessoa para mim: contador + selo na linha; abrir a tarefa limpa
  await ev(`(function(){ CRM.mem.events.push({id: "ex", task_id: "${tid}", kind: "comment", body: "@Você Teste veja", mentions: ["local-me"], author_id: "u2", author_name: "Bia Sec", created_at: new Date(Date.now() + 1000).toISOString()}); crmLoadUnread(); return true; })()`);
  await page.waitForTimeout(150);
  check('unread mention: counter 1 and @1 on the row?', (await page.$eval('#crmBadge', (e) => e.textContent)) === '1' && !!(await page.$(`#crmHost tr[data-crm-id="${tid}"] .crm-unread`)));
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`); await page.waitForTimeout(150);
  await page.click('#crmCancel');
  check('opening the task marks it read (counter gone)?', await page.$eval('#crmBadge', (e) => e.hidden));

  // Minhas tarefas: só abertas e comigo
  await ev(`(function(){ crmInsert({list_id: "agendas", status: "aberto", title: "Alterar agenda do João", assignees: ["local-me"], priority: "alta"}); crmInsert({list_id: "agendas", status: "aberto", title: "Da Bia", assignees: ["u2"]}); return true; })()`);
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-mine"]');
  await page.waitForTimeout(200);
  const mine = await page.$$eval('#crmHost tr[data-crm-id]', (r) => r.map((x) => x.textContent));
  check('Minhas tarefas: only open tasks assigned to me?', mine.length === 1 && /Alterar agenda do João/.test(mine[0]), mine);

  // Filtro de prioridade na lista Agendas
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-agendas"]'); await page.waitForTimeout(150);
  await setv('#crmFPrio', 'alta'); await page.waitForTimeout(100);
  check('priority filter?', (await page.$$('#crmHost tr[data-crm-id]')).length === 1);
  await setv('#crmFPrio', '');

  // Listas e status: nova lista entra no menu
  await ev('crmOpenListsModal()');
  await page.waitForSelector('#ovCrmL');
  await page.click('#crmLAdd');
  const last = await page.$$('#crmLBody .crm-lcard');
  await last[last.length - 1].$eval('input[data-lf="name"]', (e) => { e.value = 'Compras'; e.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.click('#crmLSave'); await page.waitForTimeout(250);
  await page.click('#crmBtn');
  const items2 = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('Listas e status: new list "Compras" in the menu (id compras)?', items2.indexOf('Compras') !== -1 && !!(await ev('crmListById("compras")')), items2);
  await page.keyboard.press('Escape');

  // Permissão por lista na tela de Níveis (módulos crm_<lista>)
  const mods = await ev('window.pipoCrmModules().map(function(m){ return m.key; })');
  check('permission modules per list (crm_atendimento … crm_compras)?', mods.indexOf('crm_atendimento') === 0 && mods.indexOf('crm_compras') !== -1, mods);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
