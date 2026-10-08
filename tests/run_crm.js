// CRM: menu CRM ▾, lista no padrão de Tratamentos (Status, Tarefa, Paciente ou Lead, Convênio,
// Vencimento; "Finalizados"), Quadro com arrastar, janela da tarefa (Responsáveis em lista de marcar,
// Paciente ou Lead, Cadastrar paciente, barra lateral com resumo e comentários, layout), finalizada
// não exclui, @menção não lida, contador, Minhas tarefas, Listas e status. Em memória. Dados fictícios.
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
  await ev('(function(){ try { localStorage.removeItem("agendaPipo:crmLayout"); localStorage.removeItem("agendaPipo:crmSide"); } catch(e){} CRM.people = [{id: "local-me", full_name: "Você Teste"}, {id: "u2", full_name: "Bia Sec"}]; return true; })()');

  // Menu CRM ▾
  await page.click('#crmBtn');
  const items = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('CRM menu: Minhas tarefas, the 4 lists and Listas e status?', items.join('|') === 'Minhas tarefas|Atendimento|Agendas|Fature|Gestão|Listas e status', items);
  await page.click('#crmMenu [data-nav="crm-atendimento"]');
  await page.waitForTimeout(200);

  // Nova tarefa com lead
  await page.click('#crmAdd');
  await page.waitForSelector('#ovCrm');
  const labels = await page.$$eval('#ovCrm .crm-main label', (r) => r.map((x) => x.textContent.trim()));
  check('fields: Tarefa, Status, Responsáveis, Vencimento, Prioridade, Paciente ou Lead; no Etiquetas / Nome da criança?', ['Tarefa', 'Status', 'Responsáveis', 'Vencimento', 'Prioridade', 'Paciente ou Lead'].every((l) => labels.indexOf(l) !== -1) && !labels.some((l) => /Etiquetas|Nome da criança/.test(l)), labels);
  await page.fill('#crmTitleIn', 'Ligar para a família');
  await page.fill('#crmWho', 'Criança Teste');
  await page.dispatchEvent('#crmWho', 'input');
  check('a name without registration is a lead: tag + "Cadastrar paciente" + lead data?', /Lead/.test(await page.$eval('#crmWhoTag', (e) => e.textContent)) && !(await page.$eval('#crmRegPat', (e) => e.hidden)) && !(await page.$eval('#crmLeadBox', (e) => e.hidden)));
  await page.fill('#crmLResp', 'Mãe Teste');
  await page.fill('#crmLTel', '47999990000');
  await setv('#crmLConv', 'Unimed');
  await setv('#crmLOrig', 'Escola');
  const yesterday = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), -1))');
  await setv('#crmDue', yesterday);
  await setv('#crmPrio', 'urgente');
  await page.click('#crmPeopleMs .ms-btn');
  await page.check('#crmPeople input[value="local-me"]');
  check('Responsáveis: dropdown with checkboxes shows the chosen names?', /Você Teste/.test(await page.$eval('#crmPeopleMs .ms-sum', (e) => e.textContent)));
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const tid = await ev('Object.keys(CRM.tasks)[0]');
  const head = await page.$$eval('#crmHost .pat-table thead th .th-label', (r) => r.map((x) => x.textContent));
  check('list in the Tratamentos table style: Status, Tarefa, Paciente ou Lead, Convênio, Vencimento?', head.join('|') === 'Status|Tarefa|Paciente ou Lead|Convênio|Vencimento', head);
  const row = await page.$eval(`#crmHost tr[data-crm-id="${tid}"]`, (e) => ({t: e.textContent, late: !!e.querySelector('.crm-due.late'), lead: !!e.querySelector('.crm-lead-tag')}));
  check('row: Triagem, task, lead name with "lead", Unimed, red overdue date?', /Triagem/.test(row.t) && /Ligar para a família/.test(row.t) && /Criança Teste/.test(row.t) && row.lead && /Unimed/.test(row.t) && row.late, JSON.stringify(row));
  check('counter on CRM: 1 (my overdue open task)?', (await page.$eval('#crmBadge', (e) => !e.hidden && e.textContent)) === '1');

  // Quadro + arrastar
  await page.click('#crmViewSeg [data-cv="quadro"]');
  await page.waitForSelector('.crm-board');
  await page.dragAndDrop(`.crm-card[data-crm-id="${tid}"]`, '.crm-col[data-crm-drop="avaliacao"]');
  await page.waitForTimeout(250);
  check('Quadro: dragging the card to Avaliação changes the status?', (await ev(`CRM.tasks["${tid}"].status`)) === 'avaliacao');
  check('Quadro hides the finalized columns until "Finalizados"?', !(await page.$('.crm-col[data-crm-drop="contrato"]')));
  await page.click('#crmViewSeg [data-cv="lista"]');

  // Janela: barra lateral com resumo + comentários; Atividade recolhida no corpo; layout
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`);
  await page.waitForSelector('#crmSide .crm-sum-list li');
  const sum = await page.$eval('#crmSideSum', (e) => e.textContent);
  check('side panel: text summary of the changes (created, status)?', /criou a tarefa/.test(sum) && /mudou o status de Triagem para Avaliação/.test(sum), sum.slice(0, 160));
  check('"Atividade" in the body starts collapsed?', await page.$eval('#crmActivity', (e) => e.hidden));
  await page.click('#crmActTog');
  check('Atividade arrow opens the full history?', !(await page.$eval('#crmActivity', (e) => e.hidden)) && /criou a tarefa/.test(await page.$eval('#crmActivity', (e) => e.textContent)));
  await page.fill('#crmCommentIn', 'Ligar amanhã @Bi');
  await page.dispatchEvent('#crmCommentIn', 'input');
  await page.waitForSelector('#crmMentionPop button');
  await page.dispatchEvent('#crmMentionPop [data-mention="Bia Sec"]', 'mousedown');
  await page.click('#crmCommentSend'); await page.waitForTimeout(250);
  check('comment in the side panel with the @mention?', /Ligar amanhã/.test(await page.$eval('#crmSideCom', (e) => e.textContent)) && (await ev('CRM.mem.events.filter(function(e){ return e.kind === "comment"; })[0].mentions.join()')) === 'u2');
  await page.click('#crmSideClose');
  check('side panel collapses (and the open button appears)?', (await page.$eval('#crmSide', (e) => e.hidden)) && !(await page.$eval('#crmSideOpen', (e) => e.hidden)));
  await page.click('#crmSideOpen');
  await page.click('#crmLayBtn');
  await page.click('#crmLayMenu [data-lay="lateral"]');
  check('layout switch: Barra lateral?', await page.$eval('#ovCrm .crm-modal', (e) => e.classList.contains('lay-lateral')));
  await page.click('#crmLayBtn'); await page.click('#crmLayMenu [data-lay="modal"]');
  // Cancelado pede o motivo; finalizada some da lista e não pode ser excluída
  await setv('#crmSt', 'cancelado');
  await page.click('#crmSave'); await page.waitForTimeout(200);
  check('Cancelado without loss reason is refused?', !!(await page.$('#ovCrm')));
  await page.fill('#crmLPerda', 'Financeiro');
  await page.click('#crmSave'); await page.waitForTimeout(250);
  check('finalized task leaves the list (shown with "Finalizados")?', !(await page.$(`#crmHost tr[data-crm-id="${tid}"]`)) && /0 de 1 tarefa/.test(await page.$eval('#crmCount', (e) => e.textContent)));
  await page.check('#crmShowDone'); await page.waitForTimeout(150);
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`);
  await page.waitForSelector('#ovCrm');
  check('finalized task cannot be deleted (Excluir disabled)?', await page.$eval('#crmDel', (e) => e.disabled));
  await page.click('#crmCancel');

  // Lead → Cadastrar paciente: abre o cadastro preenchido e liga a tarefa ao paciente
  await page.click('#crmAdd'); await page.waitForSelector('#ovCrm');
  await page.fill('#crmTitleIn', 'Agendar avaliação');
  await page.fill('#crmWho', 'Novo Lead Teste'); await page.dispatchEvent('#crmWho', 'input');
  await setv('#crmLNasc', '2020-05-10');
  await page.fill('#crmLResp', 'Pai Teste');
  await page.click('#crmRegPat');
  await page.waitForSelector('#ovPat');
  const pre = await page.evaluate(() => ({nome: document.getElementById('pNome').value, nasc: document.getElementById('pNasc').value}));
  check('"Cadastrar paciente" opens the patient form with the lead data?', pre.nome === 'Novo Lead Teste' && pre.nasc === '2020-05-10', JSON.stringify(pre));
  await page.fill('#pf-cpf', '52998224725');
  await page.click('#pSave'); await page.waitForTimeout(400);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(300); }
  await page.waitForSelector('#ovCrm');
  check('after saving, the task points to the new patient?', /Paciente cadastrado/.test(await page.$eval('#crmWhoTag', (e) => e.textContent)) && (await page.$eval('#crmTitleIn', (e) => e.value)) === 'Agendar avaliação');
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const pt = await ev('(function(){ var x = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k]; }).filter(function(y){ return y.title === "Agendar avaliação"; })[0]; return x && x.patient_id ? (findPatientById(x.patient_id) || {}).nome : null; })()');
  check('task saved with the patient (not a lead)?', pt === 'Novo Lead Teste', pt);

  // Menção para mim: contador + selo; abrir limpa
  await ev(`(function(){ CRM.mem.events.push({id: "ex", task_id: "${tid}", kind: "comment", body: "@Você Teste veja", mentions: ["local-me"], author_id: "u2", author_name: "Bia Sec", created_at: new Date(Date.now() + 1000).toISOString()}); crmLoadUnread(); return true; })()`);
  await page.waitForTimeout(150);
  check('unread mention: counter 1 and @1 on the row?', (await page.$eval('#crmBadge', (e) => e.textContent)) === '1' && !!(await page.$(`#crmHost tr[data-crm-id="${tid}"] .crm-unread`)));
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`); await page.waitForTimeout(150);
  await page.click('#crmCancel');
  check('opening the task marks it read?', await page.$eval('#crmBadge', (e) => e.hidden));

  // Minhas tarefas
  await ev(`(function(){ crmInsert({list_id: "agendas", status: "aberto", title: "Alterar agenda do João", assignees: ["local-me"], priority: "alta"}); crmInsert({list_id: "agendas", status: "aberto", title: "Da Bia", assignees: ["u2"]}); return true; })()`);
  await page.uncheck('#crmShowDone');
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-mine"]');
  await page.waitForTimeout(200);
  const mine = await page.$$eval('#crmHost tr[data-crm-id]', (r) => r.map((x) => x.textContent));
  check('Minhas tarefas: only open tasks assigned to me (with the Lista column)?', mine.length === 1 && /Alterar agenda do João/.test(mine[0]) && /Agendas/.test(mine[0]), mine);

  // Filtro de prioridade
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-agendas"]'); await page.waitForTimeout(150);
  await setv('#crmFPrio', 'alta'); await page.waitForTimeout(100);
  check('priority filter?', (await page.$$('#crmHost tr[data-crm-id]')).length === 1);
  await setv('#crmFPrio', '');

  // Listas e status: "Finalizado" e nova lista
  await ev('crmOpenListsModal()');
  await page.waitForSelector('#ovCrmL');
  check('status option is called "Finalizado"?', /Finalizado/.test(await page.$eval('#ovCrmL', (e) => e.textContent)) && !/Encerra/.test(await page.$eval('#ovCrmL', (e) => e.textContent)));
  await page.click('#crmLAdd');
  const last = await page.$$('#crmLBody .crm-lcard');
  await last[last.length - 1].$eval('input[data-lf="name"]', (e) => { e.value = 'Compras'; e.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.click('#crmLSave'); await page.waitForTimeout(250);
  await page.click('#crmBtn');
  const items2 = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('new list "Compras" in the menu?', items2.indexOf('Compras') !== -1 && !!(await ev('crmListById("compras")')), items2);
  await page.keyboard.press('Escape');
  const mods = await ev('window.pipoCrmModules().map(function(m){ return m.key; })');
  check('permission modules per list?', mods.indexOf('crm_atendimento') === 0 && mods.indexOf('crm_compras') !== -1, mods);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
