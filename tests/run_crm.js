// CRM: menu CRM ▾, lista no padrão de Tratamentos (Status, Tarefa, Paciente ou Lead, Convênio,
// Vencimento; "Finalizados"), Quadro com arrastar, janela da tarefa (Responsáveis em lista de marcar,
// Paciente ou Lead, Cadastrar Paciente, barra lateral com resumo e comentários, layout), finalizada
// não exclui, @menção não lida, contador, Minhas Tarefas, Listas e Status. Em memória. Dados fictícios.
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
  check('CRM menu: Minhas Tarefas, the 4 lists and Listas e Status?', items.join('|') === 'CRM|Minhas Tarefas|Atendimento|Agendas|Fature|Gestão|Listas e Status|Automações', items);
  await page.click('#crmMenu [data-nav="crm-atendimento"]');
  await page.waitForTimeout(200);

  // Nova Tarefa com lead
  await page.click('#crmAdd');
  await page.waitForSelector('#ovCrm');
  const labels = await page.$$eval('#ovCrm .crm-main label', (r) => r.map((x) => x.textContent.trim()));
  check('fields: Tarefa, Status, Responsáveis, Vencimento, Prioridade, Paciente ou Lead; no Etiquetas / Nome da criança?', ['Tarefa', 'Status', 'Responsáveis', 'Vencimento', 'Prioridade', 'Paciente ou Lead'].every((l) => labels.indexOf(l) !== -1) && !labels.some((l) => /Etiquetas|Nome da criança/.test(l)), labels);
  await page.fill('#crmTitleIn', 'Ligar para a família');
  await page.fill('#crmWho', 'Criança Teste');
  await page.dispatchEvent('#crmWho', 'input');
  await page.waitForFunction(() => /Lead/.test((document.getElementById('crmWhoTag') || {}).textContent || '') && !document.getElementById('crmRegPat').hidden, null, {timeout: 3000}).catch(() => {});
  check('a name without registration is a lead: tag + "Cadastrar Paciente" + lead data?', /Lead/.test(await page.$eval('#crmWhoTag', (e) => e.textContent)) && !(await page.$eval('#crmRegPat', (e) => e.hidden)) && !(await page.$eval('#crmLeadBox', (e) => e.hidden)), await page.evaluate(() => JSON.stringify({tag: (document.getElementById('crmWhoTag') || {}).textContent, rp: document.getElementById('crmRegPat') && document.getElementById('crmRegPat').hidden, who: document.getElementById('crmWho').value, n: document.querySelectorAll('#ovCrm').length})));
  const leadOrder = await page.$$eval('#crmLeadBox .crm-prop > label', (r) => r.map((x) => x.textContent.trim()));
  check('Dados do Paciente/Lead: Paciente ou Lead, Telefone, Diagnóstico, Convênio (only two lines)?', leadOrder.join('|') === 'Paciente ou Lead|Telefone|Diagnóstico|Convênio', leadOrder);
  // Paciente cadastrado: Telefone, Diagnóstico e Convênio vêm do cadastro (só leitura) e continuam visíveis
  const pInfo = JSON.parse(await ev(`(function(){ var p = state.patients.filter(function(x){ return isActive(x); })[0]; return JSON.stringify({nome: p.nome, tel: patFirstPhone(p), cid: String(p.cid || ""), conv: String(p.convenio || "")}); })()`));
  await page.fill('#crmWho', pInfo.nome.slice(0, 6));
  await page.dispatchEvent('#crmWho', 'input');
  await page.waitForSelector('#crmWhoSug [data-pid]');
  await page.dispatchEvent('#crmWhoSug [data-pid]', 'mousedown');
  const patF = await page.evaluate(() => { const g = (id) => document.getElementById(id);
    return {tel: g('crmLTel').value, telDis: g('crmLTel').disabled, diag: g('crmLDiag').value, diagDis: g('crmLDiag').disabled, conv: g('crmLConv').value, convDis: g('crmLConv').disabled,
      shown: [...document.querySelectorAll('#crmLeadBox .crm-prop')].every((x) => !x.hidden && x.offsetParent), note: !g('crmPatNote').hidden && g('crmLeadNote').hidden,
      title: document.querySelector('#crmLeadBox .crm-sec-t').textContent}; });
  check('registered patient: fields show the patient data (read-only) and stay visible; title "Dados do Paciente/Lead"?', patF.tel === pInfo.tel && patF.diag === pInfo.cid && patF.conv === pInfo.conv && patF.telDis && patF.diagDis && patF.convDis && patF.shown && patF.note && patF.title === 'Dados do Paciente/Lead', JSON.stringify({patF, pInfo}));
  await page.fill('#crmWho', 'Criança Teste');
  await page.dispatchEvent('#crmWho', 'input');
  const backF = await page.evaluate(() => ({tel: document.getElementById('crmLTel').value, dis: document.getElementById('crmLTel').disabled || document.getElementById('crmLDiag').disabled}));
  check('back to a lead: fields editable again and empty (lead data)?', !backF.dis && backF.tel === '', JSON.stringify(backF));
  const leadRows = await page.$$eval('#crmLeadBox .crm-prop', (r) => new Set(r.filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().top))).size);
  check('Dados do lead in two lines?', leadRows === 2, leadRows);
  check('Descrição with 8 lines?', (await page.$eval('#crmDesc', (e) => e.rows)) === 8);
  await page.fill('#crmLTel', '47999990000');
  await setv('#crmLConv', 'Unimed');
  const yesterday = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), -1))');
  await setv('#crmDue', yesterday);
  check('new task already shows the side panel (activity after saving)?', !(await page.$eval('#crmSide', (e) => e.hidden)) && /depois de salvar/.test(await page.$eval('#crmFeed', (e) => e.textContent)));
  check('no layout switch (only the window view)?', !(await page.$('#crmLayBtn')));
  await page.click('#crmPrioBtn');
  check('Prioridade opens the flag picker (Urgente, Alta, Normal)?', (await page.$$eval('#crmPop [data-pick]', (l) => l.map((b) => b.textContent.replace(/\d|✓/g, '').trim()))).join() === 'Urgente,Alta,Normal');
  await page.keyboard.press('1');
  check('key 1 picks Urgente?', (await page.$eval('#crmPrio', (e) => e.value)) === 'urgente' && /Urgente/.test(await page.$eval('#crmPrioBtn', (e) => e.textContent)));
  await page.click('#crmStBtn');
  check('Status picker: system dropdown, every status with a colored dot, current one highlighted?', (await page.$$eval('#crmPop [data-pick]', (l) => l.every((b) => !!b.querySelector('.crm-dot')) && !document.querySelector('#crmPop svg'))) && !!(await page.$('#crmPop [data-pick].sel')));
  check('Status picker has a search field, already focused?', await page.$eval('#crmPop .crm-pop-q', (q) => document.activeElement === q));
  const stOrig = await page.$eval('#crmPop [data-pick].sel', (b) => b.getAttribute('data-pick'));
  const stNames = await page.$$eval('#crmPop [data-pick]', (l) => l.map((b) => b.textContent.trim()));
  await page.keyboard.type(stNames[1].slice(0, 4).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
  const stVis = await page.$$eval('#crmPop [data-pick]:not([hidden])', (l) => l.map((b) => b.textContent.trim()));
  check('typing filters the statuses (no accent/case)?', stVis.length >= 1 && stVis.length < stNames.length && stVis.indexOf(stNames[1]) !== -1, stVis);
  await page.fill('#crmPop .crm-pop-q', 'zzzz');
  check('no match shows "Nenhum status encontrado"?', await page.isVisible('#crmPop .crm-pop-none'));
  await page.fill('#crmPop .crm-pop-q', stNames[1]); await page.keyboard.press('Enter');
  check('Enter picks the first match?', (await page.$eval('#crmStBtn', (e) => e.textContent)).indexOf(stNames[1]) !== -1);
  await page.click('#crmStBtn');
  await page.click('#crmPop [data-pick="' + stOrig + '"]');   // volta ao status de antes
  await page.click('#crmPeopleMs .ms-btn');
  await page.fill('#crmPop .dp-filter', 'eu');
  check('Responsáveis picker: search, "Eu" first, names only (no initials)?', (await page.$$eval('#crmPop [data-pick]:not([hidden])', (l) => l.map((b) => b.textContent.trim()))).join() === 'Eu' && !(await page.$('#crmPop .crm-av')));
  await page.click('#crmPop [data-pick="local-me"]');
  await page.keyboard.press('Escape');
  check('Responsáveis: chosen names shown?', /Você Teste/.test(await page.$eval('#crmPeopleMs .ms-sum', (e) => e.textContent)));
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const tid = await ev('Object.keys(CRM.tasks)[0]');
  const head = await page.$$eval('#crmHost .pat-table thead th .th-label', (r) => r.map((x) => x.textContent));
  check('list in the Tratamentos table style: Status, Tarefa, Paciente ou Lead, Convênio, Responsáveis, Vencimento, Prioridade?', head.join('|') === 'Status|Tarefa|Paciente ou Lead|Convênio|Responsáveis|Vencimento|Prioridade', head);
  const row = await page.$eval(`#crmHost tr[data-crm-id="${tid}"]`, (e) => ({t: e.textContent, late: !!e.querySelector('.crm-due.late'), lead: !!e.querySelector('.crm-lead-tag')}));
  check('row: Triagem, task, lead name with "lead", Unimed, red overdue date?', /Triagem/.test(row.t) && /Ligar para a família/.test(row.t) && /Criança Teste/.test(row.t) && row.lead && /Unimed/.test(row.t) && row.late, JSON.stringify(row));
  await page.click(`#crmHost [data-crm-prio="${tid}"]`);
  await page.keyboard.press('2'); await page.waitForTimeout(150);
  check('list: priority flag picker changes the task (Alta)?', (await ev(`CRM.tasks["${tid}"].priority`)) === 'alta' && !(await page.$('#ovCrm')));
  await page.click(`#crmHost [data-crm-st="${tid}"]`);
  await page.click('#crmPop [data-pick="avaliacao"]'); await page.waitForTimeout(150);
  check('list: status picker changes the status (dot + text in the cell)?', (await ev(`CRM.tasks["${tid}"].status`)) === 'avaliacao' && /Avaliação/.test(await page.$eval(`#crmHost [data-crm-st="${tid}"] .crm-st-dot`, (e) => e.textContent)));
  await ev(`(CRM.tasks["${tid}"].status = "triagem", crmRender(), true)`);
  // Célula inteira = botão: clicar no espaço vazio da célula de Prioridade abre o menu (não a tarefa)
  const prioTd = await page.$(`#crmHost tr[data-crm-id="${tid}"] td:has([data-crm-prio])`);
  const pbx = await prioTd.boundingBox();
  await page.mouse.click(pbx.x + pbx.width - 4, pbx.y + 3); await page.waitForTimeout(150);
  check('list: clicking anywhere in the Prioridade cell opens its menu, not the task?', !!(await page.$('#crmPop [data-pick]')) && !(await page.$('#ovCrm')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  // Vencimento na lista: abre o calendário e grava
  const prevDue = await ev(`CRM.tasks["${tid}"].due_date || null`);
  const rowH0 = await page.$eval(`#crmHost tr[data-crm-id="${tid}"]`, (e) => Math.round(e.getBoundingClientRect().height));
  await page.click(`#crmHost [data-crm-due="${tid}"]`); await page.waitForTimeout(150);
  const rowH1 = await page.$eval(`#crmHost tr[data-crm-id="${tid}"]`, (e) => { const b = e.querySelector('.crm-due-edit .dp-btn'); const cs = b ? getComputedStyle(b) : {}; return {h: Math.round(e.getBoundingClientRect().height), bh: b ? Math.round(b.getBoundingClientRect().height) : 0, pad: cs.padding, mh: cs.minHeight, fs: cs.fontSize}; });
  check('list: editing Vencimento does not make the row taller?', rowH1.h <= rowH0, JSON.stringify({rowH0, rowH1}));
  const dueIso = await ev('(function(){ var d = new Date(); d.setDate(15); return dpIso(d); })()');
  const calOk = !!(await page.$('#dpPop .dp-day')) && !(await page.$('#crmDuePop'));
  await page.click(`#dpPop .dp-day[data-iso="${dueIso}"]`); await page.waitForTimeout(200);
  check('list without Recorrência: Vencimento cell opens the normal calendar and saves the chosen date?', calOk && (await ev(`CRM.tasks["${tid}"].due_date`)) === dueIso && !(await page.$('#ovCrm')), await ev(`CRM.tasks["${tid}"].due_date`));
  await ev(`(crmSetDue(CRM.tasks["${tid}"], ${JSON.stringify(prevDue)}), true)`); await page.waitForTimeout(150);
  await ev(`(crmListById(CRM.tasks["${tid}"].list_id).recorrencia = true, crmRender(), true)`);
  // Vencimento: atalhos (Hoje, Amanhã, fins de semana, 2 e 4 semanas) + recorrência que gera a próxima ao finalizar
  await page.click(`#crmHost [data-crm-due="${tid}"]`); await page.waitForTimeout(150);
  const qk = await page.evaluate(() => [...document.querySelectorAll('#crmDuePop .crm-dq-opt span')].map((e) => e.textContent));
  const tomorrow = await ev('crmAddDays(crmToday(), 1)');
  await page.click(`#crmDuePop [data-q="${tomorrow}"]`); await page.waitForTimeout(200);
  check('due picker: quick options and "Amanhã" sets tomorrow?', qk.join('|') === 'Hoje|Amanhã|Próxima Segunda|Semana que vem|2 semanas|4 semanas' && (await ev(`CRM.tasks["${tid}"].due_date`)) === tomorrow, JSON.stringify(qk));
  await page.click(`#crmHost [data-crm-due="${tid}"]`); await page.waitForTimeout(150);
  await page.click('#crmDuePop [data-act="rec"]'); await page.waitForTimeout(100);
  const recUi = await page.evaluate(() => ({ freq: [...document.querySelectorAll('#crmDuePop [data-freq]')].map((b) => b.textContent), wdOn: document.querySelectorAll('#crmDuePop [data-wd].on').length,
    prev: document.querySelectorAll('#crmDuePop .dp-day.rec').length, sts: document.querySelectorAll('#crmDuePop [data-st]').length }));
  check('recurrence form: frequencies, weekday of the due date marked, next dates painted, statuses to go back to?', recUi.freq.join('|') === 'Diariamente|Semanalmente|Mensalmente|Anualmente' && recUi.wdOn === 1 && recUi.prev >= 3 && recUi.sts >= 1, JSON.stringify(recUi));
  const stBack = await ev(`(crmListById(CRM.tasks["${tid}"].list_id).statuses.filter(function(s){ return !s.done; })[0] || {}).id`);
  const stDone = await ev(`(crmListById(CRM.tasks["${tid}"].list_id).statuses.filter(function(s){ return s.done; })[0] || {}).id`);
  await page.click(`#crmDuePop [data-st="${stBack}"]`); await page.click('#crmDuePop [data-act="rec-save"]'); await page.waitForTimeout(200);
  const r1 = await ev(`JSON.stringify(CRM.tasks["${tid}"].recurrence)`);
  check('recurrence saved on the task and the ↻ shows next to the date?', /"freq":"semanal"/.test(r1) && !!(await page.$(`#crmHost tr[data-crm-id="${tid}"] .crm-rec-mini`)), r1);
  await ev(`(crmUpdate("${tid}", {status: "${stDone}"}), true)`); await page.waitForTimeout(150);
  const re = await ev(`JSON.stringify({st: CRM.tasks["${tid}"].status, due: CRM.tasks["${tid}"].due_date, want: crmRecNext("${tomorrow}", CRM.tasks["${tid}"].recurrence), ev: CRM.mem.events.filter(function(e){ return e.task_id === "${tid}" && e.data && e.data.campo === "recorrencia"; }).length})`);
  const rej = JSON.parse(re);
  check('finishing a recurring task (Criar nova tarefa off): same task goes back to the chosen status with the next date + history line?', rej.st === stBack && rej.due === rej.want && rej.due > tomorrow && rej.ev === 1, re);
  const nv = await ev(`(function(){ var x = CRM.tasks["${tid}"], n0 = Object.keys(CRM.tasks).length; var r = Object.assign({}, x.recurrence, {nova: true, freq: "mensal"}); delete r.dias;
    crmUpdate("${tid}", {recurrence: r}); var d0 = x.due_date; crmUpdate("${tid}", {status: "${stDone}"});
    var news = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k]; }).filter(function(y){ return y.id !== "${tid}" && y.title === x.title && y.due_date === crmAddMonths(d0, 1); });
    return JSON.stringify({n: Object.keys(CRM.tasks).length - n0, oldDone: crmIsDone(CRM.tasks["${tid}"]), oldRec: CRM.tasks["${tid}"].recurrence || null, newSt: news[0] && news[0].status, newRec: !!(news[0] && news[0].recurrence), newId: news[0] && news[0].id}); })()`);
  const nvj = JSON.parse(nv);
  check('finishing with "Criar nova tarefa": old stays finished (history), a new task one month later carries the recurrence?', nvj.n === 1 && nvj.oldDone && !nvj.oldRec && nvj.newSt === stBack && nvj.newRec, nv);
  await ev(`(CRM.mem.tasks = CRM.mem.tasks.filter(function(y){ return y.id !== "${nvj.newId}"; }), delete CRM.tasks["${nvj.newId}"], crmUpdate("${tid}", {status: "${stBack}", recurrence: null, closed_at: null}), crmSetDue(CRM.tasks["${tid}"], ${JSON.stringify(prevDue)}), true)`); await page.waitForTimeout(150);
  // Janela da tarefa: o campo Vencimento abre a mesma janela; a recorrência fica marcada (↻) e é gravada ao Salvar
  await ev(`(crmOpenTask(CRM.tasks["${tid}"]), true)`); await page.waitForTimeout(300);
  await page.click('#crmDueBox [data-dp-open]'); await page.waitForTimeout(150);
  const mOpen = !!(await page.$('#crmDuePop .crm-dq-opt'));
  await page.click('#crmDuePop [data-act="rec"]'); await page.click('#crmDuePop [data-freq="diaria"]'); await page.click('#crmDuePop [data-act="rec-save"]'); await page.waitForTimeout(100);
  const tagOn = await page.evaluate(() => { const t = document.getElementById('crmRecTag'); return !!t && !t.hidden && /Diariamente/.test(t.title); });
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const mRec = await ev(`(CRM.tasks["${tid}"].recurrence || {}).freq || ""`);
  check('task window: Vencimento opens the picker, recurrence shows ↻ and is saved with the task?', mOpen && tagOn && mRec === 'diaria', JSON.stringify({mOpen, tagOn, mRec}));
  await ev(`(crmUpdate("${tid}", {recurrence: null}), crmRender(), true)`); await page.waitForTimeout(100);
  await ev(`(CRM.mem.events.push({id: "cx", task_id: "${tid}", kind: "comment", body: "oi", author_name: "Bia Sec", created_at: new Date().toISOString()}), crmLoadComCount(), true)`);
  check('list: comment counter on the task?', /1/.test(await page.$eval(`#crmHost tr[data-crm-id="${tid}"] .crm-com-n`, (e) => e.textContent)));
  await ev(`(CRM.mem.events = CRM.mem.events.filter(function(e){ return e.id !== "cx"; }), crmLoadComCount(), true)`);
  check('counter on CRM: 1 (my overdue open task)?', (await page.$eval('#crmBadge', (e) => !e.hidden && e.textContent)) === '1');

  // Quadro + arrastar
  await page.click('#crmViewSeg [data-cv="quadro"]');
  await page.waitForSelector('.crm-board');
  await page.dragAndDrop(`.crm-card[data-crm-id="${tid}"]`, '.crm-col[data-crm-drop="avaliacao"]');
  await page.waitForTimeout(250);
  check('Quadro: dragging the card to Avaliação changes the status?', (await ev(`CRM.tasks["${tid}"].status`)) === 'avaliacao');
  check('Quadro hides the finalized columns until "Finalizados"?', !(await page.$('.crm-col[data-crm-drop="contrato"]')));
  await page.click('#crmViewSeg [data-cv="lista"]');

  // Calendário: tarefa no dia do vencimento; arrastar muda o vencimento; + do dia cria com o vencimento
  await page.click('#crmViewSeg [data-cv="calendario"]');
  await page.waitForSelector('.crm-cal-grid');
  const yIso = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), -1))'), tIso = await ev('crmToday()');
  check('Calendário: task on its due day (red, overdue) and "em atraso" counter?', !!(await page.$(`.crm-cal-day[data-cal-day="${yIso}"] .crm-cal-task.late[data-crm-id="${tid}"]`)) && /1 em atraso/.test(await page.$eval('.crm-cal-bar', (e) => e.textContent)));
  check('today highlighted?', !!(await page.$(`.crm-cal-day.today[data-cal-day="${tIso}"]`)));
  await page.dragAndDrop(`.crm-cal-task[data-crm-id="${tid}"]`, `.crm-cal-day[data-cal-day="${tIso}"]`);
  await page.waitForTimeout(250);
  check('dragging the task to another day changes the due date?', (await ev(`CRM.tasks["${tid}"].due_date`)) === tIso);
  await ev(`(function(){ crmUpdate("${tid}", {due_date: "${yIso}"}); crmRender(); return true; })()`);
  await page.hover(`.crm-cal-day[data-cal-day="${tIso}"]`);
  await page.click(`[data-cal-new="${tIso}"]`);
  await page.waitForSelector('#ovCrm');
  check('+ on the day opens a new task with that due date?', (await page.$eval('#crmDue', (e) => e.value)) === tIso);
  await page.click('#crmCancel');
  const fill = await page.evaluate(() => { const h = document.getElementById('crmHost').getBoundingClientRect(); return h.bottom > window.innerHeight - 40; });
  check('CRM uses the whole window height?', fill);
  await page.click('#crmViewSeg [data-cv="lista"]');

  // Janela: barra lateral com resumo + comentários; Atividade recolhida no corpo; layout
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`);
  await page.waitForSelector('#crmFeed .crm-feed-h');
  const sum = await page.$eval('#crmFeed', (e) => e.textContent);
  check('side panel: changes as lines (created, status with dot + text)?', /criou a tarefa/.test(sum) && /mudou o status de Triagem para Avaliação/.test(sum) && !!(await page.$('#crmFeed .crm-st-dot')), sum.slice(0, 160));
  const grp = await page.evaluate(() => { const b = document.querySelector('#crmFeed [data-feed-more]'); if (!b) return null;
    const g = b.nextElementSibling, before = { txt: b.textContent, hidden: g.hidden, n: g.querySelectorAll('.crm-feed-h').length };
    b.click(); return { before, after: { txt: b.textContent, hidden: g.hidden } }; });
  check('2+ changes in a row collapse into "Visualizar alterações" that opens/closes?', grp && /^Visualizar alterações/.test(grp.before.txt) && grp.before.hidden && grp.before.n >= 2 && /^Ocultar alterações/.test(grp.after.txt) && !grp.after.hidden, JSON.stringify(grp));
  const below = await page.evaluate(() => { const c = document.querySelector('#crmSide .crm-comment').getBoundingClientRect(), b = document.querySelector('#crmSide .crm-side-body').getBoundingClientRect(); return c.top >= b.bottom - 1; });
  check('comment box at the bottom of the side panel (below the activity)?', below);
  check('no "Atividade" section at the end of the window?', !(await page.$('#crmActTog')) && !(await page.$('#crmActivity')));
  await page.fill('#crmCommentIn', 'Ligar amanhã @Bi');
  await page.dispatchEvent('#crmCommentIn', 'input');
  await page.waitForSelector('#crmMentionPop button');
  await page.dispatchEvent('#crmMentionPop [data-mention="Bia Sec"]', 'mousedown');
  await page.click('#crmCommentSend'); await page.waitForTimeout(250);
  check('comment in the side panel, after the changes (time order), with the @mention?', /Ligar amanhã/.test(await page.$eval('#crmFeed > :last-child', (e) => e.textContent)) && (await ev('CRM.mem.events.filter(function(e){ return e.kind === "comment"; })[0].mentions.join()')) === 'u2');
  await page.fill('#crmCommentIn', 'Mãe');
  await page.press('#crmCommentIn', 'Enter');
  const nl = await page.$eval('#crmCommentIn', (e) => e.value);
  check('Enter only breaks the line (does not send)?', nl === 'Mãe\n', JSON.stringify(nl));
  await page.fill('#crmCommentIn', 'Mãe confirmou');
  await page.press('#crmCommentIn', 'Control+Enter'); await page.waitForTimeout(250);
  check('Ctrl+Enter sends the comment (card with name and time)?', /Mãe confirmou/.test(await page.$eval('#crmFeed > :last-child', (e) => e.textContent)) && !!(await page.$('#crmFeed .crm-cmt .crm-cmt-when')) && (await page.$eval('#crmCommentIn', (e) => e.value)) === '' && (await page.$eval('#crmCommentSend', (b) => b.disabled)));
  // Editar e excluir o próprio comentário
  await page.hover('#crmFeed .crm-cmt:last-child');
  await page.click('#crmFeed .crm-cmt:last-child [data-cmt-act="edit"]');
  check('edit opens the "Editar Mensagem" window with the text?', (await page.$eval('#ceTitle', (e) => e.textContent)) === 'Editar Mensagem' && (await page.$eval('#ceText', (e) => e.value)) === 'Mãe confirmou');
  await page.fill('#ceText', 'Mãe confirmou @'); await page.press('#ceText', 'End'); await page.dispatchEvent('#ceText', 'input');
  check('editar mensagem: @ abre a lista de pessoas?', !(await page.$eval('#ceMentionPop', (e) => e.hidden)) && (await page.$$('#ceMentionPop [data-mention]')).length > 0);
  await page.keyboard.press('Escape');
  check('editar mensagem: Esc fecha só a lista, não a janela?', (await page.$eval('#ceMentionPop', (e) => e.hidden)) && !!(await page.$('#ovCmtEdit')));
  await page.fill('#ceText', 'Mãe confirmou às 10h');
  await page.press('#ceText', 'Control+Enter'); await page.waitForTimeout(250);
  check('edit window closed, task window still open?', !(await page.$('#ovCmtEdit')) && !!(await page.$('#ovCrm')));
  const edited = await page.$eval('#crmFeed .crm-cmt:last-child', (e) => e.textContent);
  check('edit own comment: new text and "(editado)"?', /Mãe confirmou às 10h/.test(edited) && /\(editado\)/.test(edited), edited);
  const nC = await page.$$eval('#crmFeed .crm-cmt', (r) => r.length);
  await page.hover('#crmFeed .crm-cmt:last-child');
  await page.click('#crmFeed .crm-cmt:last-child [data-cmt-act="del"]');
  await page.click('#cfOk'); await page.waitForTimeout(250);
  check('delete own comment (with confirmation)?', (await page.$$eval('#crmFeed .crm-cmt', (r) => r.length)) === nC - 1 && !/Mãe confirmou/.test(await page.$eval('#crmFeed', (e) => e.textContent)));
  await page.fill('#crmCommentIn', 'Mãe confirmou');
  await page.press('#crmCommentIn', 'Control+Enter'); await page.waitForTimeout(250);
  check('side panel always visible, no collapse/open buttons, no Detalhes/Atividade tabs on desktop?', !(await page.$eval('#crmSide', (e) => e.hidden)) && !(await page.$('#crmSideClose')) && !(await page.$('#crmSideOpen')) && (await page.$eval('#crmMTabs', (e) => getComputedStyle(e).display)) === 'none');
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
  await page.waitForSelector('#ovCrm', {state: 'detached'});

  // Lead → Cadastrar Paciente: abre o cadastro preenchido e liga a tarefa ao paciente
  await page.click('#crmAdd'); await page.waitForSelector('#ovCrm'); await page.waitForTimeout(400);
  await page.fill('#crmTitleIn', 'Agendar avaliação');
  await page.fill('#crmWho', 'Novo Lead Teste'); await page.dispatchEvent('#crmWho', 'input');
  await page.fill('#crmLTel', '47988887777');
  const convName = await ev('(state.convenios || [])[0] ? state.convenios[0].name : ""');
  await page.$eval('#crmLConv', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, convName);
  await page.dispatchEvent('#crmWho', 'input');
  await page.waitForSelector('#crmRegPat:not([hidden])', {timeout: 10000}).catch(() => {});
  const rpPos = await page.evaluate(() => { const b = document.getElementById('crmRegPat'), mb = document.getElementById('crmMoreBtn'); return {inMenu: !!b && !!b.closest('#crmMoreMenu'), inHead: !!mb && !!mb.closest('#crmLeadBox .crm-sec-h') && (function(){ const t = document.querySelector('#crmLeadBox .crm-sec-t').getBoundingClientRect(), r = mb.getBoundingClientRect(), bx = document.getElementById('crmLeadBox').getBoundingClientRect(); return Math.abs((t.top + t.bottom) / 2 - (r.top + r.bottom) / 2) < 8 && Math.abs(r.right - bx.right) < 4; })(), shown: !!mb && !mb.parentNode.hidden, menuClosed: document.getElementById('crmMoreMenu').hidden, link: !!document.querySelector('#crmMoreMenu #crmSendLink'), notInBox: true}; });
  check('"Cadastrar Paciente" and "Enviar Link de Cadastro" inside Outras Opções, on the Dados do Paciente/Lead title line at the right?', rpPos.inMenu && rpPos.inHead && rpPos.shown && rpPos.menuClosed && rpPos.link && rpPos.notInBox, JSON.stringify(rpPos));
  await page.click('#crmMoreBtn');
  check('Outras Opções opens the menu with Cadastrar Paciente visible?', await page.evaluate(() => !document.getElementById('crmMoreMenu').hidden && !!document.getElementById('crmRegPat').offsetParent));
  await page.click('#crmRegPat');
  await page.waitForSelector('#ovPat');
  const pre = await page.evaluate(() => ({nome: document.getElementById('pNome').value, tel: [...document.querySelectorAll('#telHost input')].map(i => i.value).join(' ')}));
  check('"Cadastrar Paciente" opens the patient form with the lead data?', pre.nome === 'Novo Lead Teste' && /88887777|8888-7777/.test(pre.tel), JSON.stringify(pre));
  await page.fill('#pf-cpf', '52998224725');
  await page.click('#pSave'); await page.waitForTimeout(400);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(300); }
  await page.waitForSelector('#ovCrm');
  check('after saving, the task points to the new patient?', /Paciente cadastrado/.test(await page.$eval('#crmWhoTag', (e) => e.textContent)) && (await page.$eval('#crmTitleIn', (e) => e.value)) === 'Agendar avaliação');
  await page.click('#crmSave'); await page.waitForTimeout(250);
  const pt = await ev('(function(){ var x = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k]; }).filter(function(y){ return y.title === "Agendar avaliação"; })[0]; return x && x.patient_id ? (findPatientById(x.patient_id) || {}).nome : null; })()');
  check('task saved with the patient (not a lead)?', pt === 'Novo Lead Teste', pt);
  const lt = await ev('(function(){ var x = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k]; }).filter(function(y){ return y.title === "Agendar avaliação"; })[0]; var p = findPatientById(x.patient_id); var trs = state.treatments.filter(function(t){ return t.patientId === p.id; }); return {lead: x.lead, n: trs.length, st: trs[0] && trs[0].status, conv: trs[0] && trs[0].convenio, conv2: trs[0] && trs[0].convenioId, spec: trs[0] && trs[0].specHours.length, ses: trs[0] && trs[0].sessoesMes}; })()');
  check('lead data removed from the task and an active treatment created with only the convênio?', Object.keys(lt.lead || {}).length === 0 && lt.n === 1 && lt.st === 'ativo' && lt.conv === convName && !!convName && !!lt.conv2 && lt.spec === 0 && lt.ses === '', JSON.stringify(lt));
  check('activity text for the patient link?', /cadastrou o lead “Lead X” como paciente/.test(await ev('crmEventText({author_name: "Ana", kind: "field", data: {campo: "paciente", de: "Lead X", para: "p"}}, {})')));

  // Menção para mim: contador + selo; abrir limpa
  await ev(`(function(){ CRM.mem.events.push({id: "ex", task_id: "${tid}", kind: "comment", body: "@Você Teste veja", mentions: ["local-me"], author_id: "u2", author_name: "Bia Sec", created_at: new Date(Date.now() + 1000).toISOString()}); crmLoadUnread(); return true; })()`);
  await page.waitForTimeout(150);
  check('unread mention: counter 1 and @1 on the row?', (await page.$eval('#crmBadge', (e) => e.textContent)) === '1' && !!(await page.$(`#crmHost tr[data-crm-id="${tid}"] .crm-unread`)));
  await page.click(`#crmHost tr[data-crm-id="${tid}"]`); await page.waitForTimeout(150);
  await page.click('#crmCancel');
  check('opening the task marks it read?', await page.$eval('#crmBadge', (e) => e.hidden));

  // Minhas Tarefas
  await ev(`(function(){ crmInsert({list_id: "agendas", status: "aberto", title: "Alterar agenda do João", assignees: ["local-me"], priority: "alta"}); crmInsert({list_id: "agendas", status: "aberto", title: "Da Bia", assignees: ["u2"]}); return true; })()`);
  await page.uncheck('#crmShowDone');
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-mine"]');
  await page.waitForTimeout(200);
  const mine = await page.$$eval('#crmHost tr[data-crm-id]', (r) => r.map((x) => x.textContent));
  check('Minhas Tarefas: only open tasks assigned to me (with the Lista column)?', mine.length === 1 && /Alterar agenda do João/.test(mine[0]) && /Agendas/.test(mine[0]), mine);

  // Filtro de prioridade
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-agendas"]'); await page.waitForTimeout(150);
  check('in a list the Responsável filter is back?', await page.evaluate(() => getComputedStyle(document.querySelector('#tab-crm [data-dp-for="crmFWho"]')).display !== 'none'));
  await setv('#crmFPrio', 'alta'); await page.waitForTimeout(100);
  check('priority filter?', (await page.$$('#crmHost tr[data-crm-id]')).length === 1);
  await setv('#crmFPrio', '');

  // Filtro de Status: opções da lista aberta; em Minhas Tarefas, de todas as listas
  const stOpts = await page.$$eval('#crmFSt option', (o) => o.map((x) => x.textContent));
  const agSt = await ev('crmListById("agendas").statuses.map(function(s){ return s.name; })');
  check('status filter lists the statuses of the open list?', stOpts[0] === 'Status' && JSON.stringify(stOpts.slice(1)) === JSON.stringify(agSt), stOpts);
  const st0 = await ev('normText(crmListById("agendas").statuses[0].name)');
  await setv('#crmFSt', st0); await page.waitForTimeout(100);
  const stRows = await ev(`Array.prototype.map.call(document.querySelectorAll('#crmHost tr[data-crm-id]'), function(r){ return crmStKey(CRM.tasks[r.getAttribute('data-crm-id')]); })`);
  check('status filter shows only tasks in that status?', stRows.length >= 1 && stRows.every((k) => k === st0), stRows);
  await setv('#crmFSt', '');
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-mine"]'); await page.waitForTimeout(150);
  const mineSt = await page.$$eval('#crmFSt option', (o) => o.length);
  const allSt = await ev('(function(){ var s = {}; crmVisibleLists().forEach(function(l){ l.statuses.forEach(function(x){ s[normText(x.name)] = 1; }); }); return Object.keys(s).length; })()');
  check('Minhas Tarefas: status filter joins the statuses of all lists?', mineSt === allSt + 1, {mineSt, allSt});
  const whoVis = await page.evaluate(() => { const b = document.querySelector('#tab-crm [data-dp-for="crmFWho"]'); return !!b && getComputedStyle(b).display !== 'none'; });
  const stVis2 = await page.evaluate(() => { const b = document.querySelector('#tab-crm [data-dp-for="crmFSt"]'); return !!b && getComputedStyle(b).display !== 'none'; });
  check('Minhas Tarefas: no Responsável filter, Status in its place?', !whoVis && stVis2, {whoVis, stVis2});
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-agendas"]'); await page.waitForTimeout(150);

  const mods = await ev('window.pipoCrmModules().map(function(m){ return m.key + "|" + (m.group || ""); }).join(",")');
  check('Níveis de Permissão: CRM group starts with Listas e Status, then one row per list?', /^crm_listas\|CRM,crm_atendimento\|,crm_agendas\|/.test(mods), mods);
  // Listas e Status: visual de Cadastros → Grupos (linhas com setas, bolinha, resumo e Editar; janela própria por lista)
  await ev('crmOpenListsModal()');
  await page.waitForSelector('#ovCrmL');
  const lrows = await page.evaluate(() => [...document.querySelectorAll('#crmLBody .crm-lrow')].map((r) => ({n: r.querySelector('.rn').textContent, s: r.querySelector('.rs').textContent, ed: !!r.querySelector('[data-ledit]'), mv: !!r.querySelector('.move-col')})));
  check('Listas e Status: one row per list (name, summary of statuses, arrows, Editar)?', lrows.length === (await ev('CRM.lists.length')) && lrows.every((r) => r.ed && r.mv) && /status ·/.test(lrows[0].s), JSON.stringify(lrows.slice(0, 2)));
  const firstId = await ev('CRM.lists[0].id');
  await page.click('#crmLBody .crm-lrow:first-child [data-lmv="1"]'); await page.waitForTimeout(200);
  check('arrow ▼ moves the list down (saved right away)?', (await ev('CRM.lists[1].id')) === firstId && (await page.$eval('#crmLBody .crm-lrow:nth-child(2)', (e) => e.getAttribute('data-lid'))) === firstId);
  await page.click('#crmLBody .crm-lrow:nth-child(2) [data-lmv="-1"]'); await page.waitForTimeout(200);
  await page.click('#crmLBody .crm-lrow:first-child [data-ledit]'); await page.waitForTimeout(150);
  const ed = await page.evaluate(() => ({t: document.querySelector('#ovCrmL h3').textContent, name: document.getElementById('crmLName').value, color: !!document.getElementById('crmLColor'),
    sts: document.querySelectorAll('#crmLSts .therapist-row').length, txt: document.getElementById('ovCrmL').textContent, del: !!document.getElementById('crmLDel')}));
  check('Editar opens the list window (name, color, options, statuses with "Finalizado", Excluir)?', ed.t === 'Editar Lista' && ed.name && ed.color && ed.sts >= 2 && /Finalizado/.test(ed.txt) && !/Encerra/.test(ed.txt) && /Recorrência/.test(ed.txt) && ed.del, JSON.stringify({t: ed.t, name: ed.name, sts: ed.sts}));
  await page.click('#crmLCancel'); await page.waitForTimeout(100);
  check('Cancelar goes back to Listas e Status?', !!(await page.$('#crmLBody .crm-lrow')));
  await page.click('#crmLAdd'); await page.waitForTimeout(150);
  await page.fill('#crmLName', 'Compras');
  const recBox = await page.$('#ovCrmL input[data-lf="recorrencia"]');
  if (recBox) await recBox.click();
  await page.click('#crmLSave'); await page.waitForTimeout(250);
  check('Listas e Status: new list saved with "Recorrência" (on for Compras, off for Agendas) and back to the rows?', !!recBox && (await ev('!!crmListById("compras") && crmListById("compras").recorrencia === true && !("recorrencia" in crmListById("agendas"))')) && !!(await page.$('#crmLBody .crm-lrow[data-lid="compras"]')));
  await page.click('#crmLCancel');
  await page.click('#crmBtn');
  const items2 = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('new list "Compras" in the menu?', items2.indexOf('Compras') !== -1 && !!(await ev('crmListById("compras")')), items2);
  await page.keyboard.press('Escape');
  const mods2 = await ev('window.pipoCrmModules().map(function(m){ return m.key; })');
  check('permission modules: Listas e Status first, then one per list (new list included)?', mods2[0] === 'crm_listas' && mods2[1] === 'crm_atendimento' && mods2.indexOf('crm_compras') !== -1, mods2);

  // Velocidade: com o tempo real conectado, abrir o CRM de novo não relê tudo do banco
  const cache = await ev(`(async function(){
    var calls = 0, subCb = null;
    function q(t){ var o = {}; ["select","order","eq","contains","limit","in"].forEach(function(m){ o[m] = function(){ return o; }; });
      o.range = function(){ if (t === "tasks") calls++; return Promise.resolve({data: []}); };
      o.then = function(a, b){ return Promise.resolve({data: []}).then(a, b); }; return o; }
    var fake = {from: q, rpc: function(){ return Promise.resolve({data: []}); }, channel: function(){ var ch = {on: function(){ return ch; }, subscribe: function(cb){ subCb = cb; return ch; }}; return ch; }};
    var old = crmClient; crmClient = function(){ return fake; };
    CRM.loaded = false; CRM.loading = null; CRM.channel = null; CRM.live = false; CRM.wasLive = undefined;
    await crmLoad(); subCb("SUBSCRIBED");
    crmOnShow(); crmOnShow();
    var afterOpens = calls;
    subCb("CLOSED"); subCb("SUBSCRIBED"); await new Promise(function(r){ setTimeout(r, 50); });
    var afterReconnect = calls;
    crmClient = old; CRM.channel = null; CRM.live = false;
    return {afterOpens: afterOpens, afterReconnect: afterReconnect};
  })()`);
  check('CRM: opening again uses the live data (1 read); reconnecting reads once more?', cache.afterOpens === 1 && cache.afterReconnect === 2, JSON.stringify(cache));
  // CRM ▾ → CRM: cartões das listas; clicar abre a lista.
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-home"]'); await page.waitForTimeout(150);
  const home = await page.evaluate(() => { const CRM = window.__ev("CRM"), crmCan = window.__ev("crmCan"), crmIsDone = window.__ev("crmIsDone"); const top = document.getElementById('crmHomeTop'), tb = document.querySelector('#tab-crm .crm-toolbar');
    const rows = [...document.querySelectorAll('#crmHost tbody tr[data-crm-id]')];
    const want = Object.keys(CRM.tasks).map((k) => CRM.tasks[k]).filter((x) => crmCan(x.list_id, 'view') && !crmIsDone(x)).length;
    const hiddenList = Object.keys(CRM.tasks).map((k) => CRM.tasks[k]).some((x) => !crmCan(x.list_id, 'view'));
    return { cards: [...document.querySelectorAll('#crmHomeGrid [data-crm-home]')].map((b) => b.querySelector('b').textContent),
      cardsAbove: !!top && !top.hidden && top.getBoundingClientRect().bottom <= tb.getBoundingClientRect().top + 1,
      seg: getComputedStyle(document.getElementById('crmViewSeg')).display, quadro: getComputedStyle(document.querySelector('#crmViewSeg [data-cv="quadro"]')).display,
      add: getComputedStyle(document.getElementById('crmAdd')).display, listaCol: [...document.querySelectorAll('#crmHost thead th')].some((t) => /Lista/i.test(t.textContent)),
      rows: rows.length, want, allVisible: rows.every((r) => crmCan(CRM.tasks[r.getAttribute('data-crm-id')].list_id, 'view')), hiddenList }; });
  check('CRM home: list cards on top (Minhas Tarefas first), then the bar and ALL open tasks of the lists I can see (Lista column, no Quadro/+ Tarefa)?', home.cards.join('|').indexOf('Minhas Tarefas|Atendimento|Agendas|Fature|Gestão') === 0 && home.cardsAbove && home.seg !== 'none' && home.quadro === 'none' && home.add === 'none' && home.listaCol && home.rows === home.want && home.rows > 0 && home.allVisible, JSON.stringify(home));
  const homeHead = await page.$$eval('#crmHost .pat-table thead th .th-label', (r) => r.map((x) => x.textContent));
  check('CRM home columns: Status, Tarefa, Lista, Paciente ou Lead, Convênio, Responsáveis, Vencimento, Prioridade?', homeHead.join('|') === 'Status|Tarefa|Lista|Paciente ou Lead|Convênio|Responsáveis|Vencimento|Prioridade', JSON.stringify(homeHead));
  const perm = await ev(`(function(){ var orig = crmCan, lid = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k].list_id; })[0];
    crmCan = function(l, a){ return l === lid ? false : orig(l, a); }; crmRender();
    var r = {lid: lid, cards: [].map.call(document.querySelectorAll('#crmHomeGrid [data-crm-home]'), function(b){ return b.getAttribute('data-crm-home'); }),
      rows: [].map.call(document.querySelectorAll('#crmHost tbody tr[data-crm-id]'), function(t){ return CRM.tasks[t.getAttribute('data-crm-id')].list_id; })};
    crmCan = orig; crmRender(); return JSON.stringify(r); })()`);
  const pjH = JSON.parse(perm);
  check('CRM home: a list without permission shows no card and none of its tasks?', pjH.cards.indexOf(pjH.lid) === -1 && pjH.rows.indexOf(pjH.lid) === -1, perm);
  await page.click('#crmHomeGrid [data-crm-home="agendas"]'); await page.waitForTimeout(100);
  const opened = await page.evaluate(() => ({ title: document.getElementById('crmTitle').textContent, seg: getComputedStyle(document.getElementById('crmViewSeg')).display }));
  check('clicking a card opens that list?', opened.title === 'Agendas' && opened.seg !== 'none', opened);
  // Tela aberta (#crm, F5) antes de as permissões chegarem: quando chegam, abre Minhas Tarefas.
  await ev('(function(){ window.__vis = crmVisibleLists; crmVisibleLists = function(){ return []; }; CRM.list = ""; crmOnShow(); return true; })()');
  const before = await page.$eval('#crmHost', (e) => e.textContent);
  await ev('(function(){ crmVisibleLists = window.__vis; crmRender(); return true; })()');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({ title: document.getElementById('crmTitle').textContent, host: document.getElementById('crmHost').textContent, who: (document.querySelector('[data-dp-for="crmFWho"] .dp-txt') || {}).textContent }));
  check('permissions arriving later: "Nenhuma lista" turns into Minhas Tarefas, responsável filter labelled?', /Nenhuma lista/.test(before) && after.title === 'Minhas Tarefas' && !/Nenhuma lista/.test(after.host) && after.who === 'Responsável', after);
  // Responsáveis: só quem tem acesso ao CRM e à lista; quem já estava sem acesso aparece com "(sem acesso)"
  const ppl = await ev(`(function(){ var old = CRM.people;
    CRM.people = [{id:'local-me',full_name:'Você',admin:true,crm:true,lists:[]},{id:'b',full_name:'Bia',admin:false,crm:true,lists:['atendimento']},
      {id:'c',full_name:'Caio',admin:false,crm:false,lists:['atendimento']},{id:'d',full_name:'Duda',admin:false,crm:true,lists:['agendas']}];
    var a = document.createElement('button'); document.body.appendChild(a);
    crmPeopleMenu(a, ['d'], {listId: 'atendimento'});
    var names = Array.prototype.map.call(document.querySelectorAll('#crmPop [data-pick]'), function(x){ return x.textContent.trim(); });
    var d = document.querySelector('#crmPop [data-pick="d"]'); d.click(); d.click();
    var dOn = d.getAttribute('aria-checked');
    var pop = document.getElementById('crmPop'); if (pop) pop.remove(); a.remove(); CRM.people = old;
    return JSON.stringify({names: names, dOn: dOn}); })()`);
  const pj = JSON.parse(ppl);
  check('responsáveis: only people with access to CRM and the list (+ current without access marked)?', pj.names.join('|') === 'Eu|Bia|Duda (sem acesso)' && pj.dOn === 'false', ppl);
  // Comentário: negrito / itálico / sublinhado (botões na barra da caixa e formatação no feed)
  const fmt = JSON.parse(await ev(`(function(){
    var box = document.createElement('div'); box.className = 'crm-compose'; box.innerHTML = '<textarea>oi mundo</textarea><div class="crm-compose-bar"><div class="crm-compose-tools">' + CRM_FMT_TOOLS + '</div></div>';
    document.body.appendChild(box); var ta = box.querySelector('textarea');
    ta.setSelectionRange(3, 8); box.querySelector('[data-fmt="b"]').click(); var v1 = ta.value;
    ta.value = 'a b'; ta.setSelectionRange(2, 3); box.querySelector('[data-fmt="u"]').click(); var v2 = ta.value;
    var n = box.querySelectorAll('.crm-fmt').length; box.remove();
    var h = crmCommentHtml({author_name: 'X', body: '*forte* _leve_ __linha__ nome_sobrenome 2*3*4', created_at: new Date().toISOString()});
    return JSON.stringify({n: n, v1: v1, v2: v2, h: h.split('crm-cmt-b">')[1]}); })()`));
  check('comment B/I/U: 3 buttons wrap selection and the feed shows bold/italic/underline?', fmt.n === 3 && fmt.v1 === 'oi *mundo*' && fmt.v2 === 'a __b__' &&
    fmt.h.indexOf('<b>forte</b>') !== -1 && fmt.h.indexOf('<i>leve</i>') !== -1 && fmt.h.indexOf('<u>linha</u>') !== -1 && fmt.h.indexOf('nome_sobrenome') !== -1 && fmt.h.indexOf('2*3*4') !== -1, JSON.stringify(fmt));
  const agSec = JSON.parse(await ev('(function(){ var host = document.getElementById("modalHost"); crmOpenTask(null, {listId: "agendas"}); var r = {box: !!document.getElementById("crmLeadBox"), who: !!document.querySelector("#crmLeadBox #crmWho"), tel: !!document.getElementById("crmLTel"), loss: !!document.getElementById("crmLossBox")}; host.innerHTML = ""; return JSON.stringify(r); })()'));
  check('any list (Agendas) also has Dados do Paciente/Lead (no Motivo de Perda)?', agSec.box && agSec.who && agSec.tel && !agSec.loss, JSON.stringify(agSec));
  // Mover Tarefa (Outras Opções no canto superior direito da janela)
  const mvId = await ev('crmInsert({list_id: "atendimento", status: "triagem", title: "Tarefa para mover", priority: "normal", assignees: [], lead: {nome: "Lead Fictício"}}).then(function(t){ return t.id; })');
  await ev(`(crmOpenTask(CRM.tasks["${mvId}"]), true)`); await page.waitForTimeout(300);
  const topPos = await page.evaluate(() => { const b = document.getElementById('crmTopBtn'), h = document.querySelector('#ovCrm .modal-head'), c = document.getElementById('crmClose');
    const rb = b && b.getBoundingClientRect(), rh = h.getBoundingClientRect(), rc = c.getBoundingClientRect(); return {has: !!b, text: b && b.textContent.trim(), firstLine: !!b && rb.top < rh.top + 40, rightOfTitle: !!b && rb.left > rh.left + rh.width / 2, besideClose: !!b && rb.right <= rc.left + 2}; });
  check('"Outras Opções" sits on the first line, top right, next to the close button?', topPos.has && topPos.firstLine && topPos.rightOfTitle && topPos.besideClose && /Outras Opções/.test(topPos.text), topPos);
  await page.click('#crmTopBtn'); await page.waitForTimeout(100);
  check('menu has "Mover Tarefa"?', /Mover Tarefa/.test(await page.textContent('#crmTopMenu')));
  check('menu has "Gerar Tarefa a Partir Desta"?', /Gerar Tarefa a Partir Desta/.test(await page.textContent('#crmTopMenu')));
  check('no registered patient: no "Cadastro do Paciente" in the menu?', !(await page.$('#crmPatBtn')));
  await page.click('#crmGenBtn'); await page.waitForSelector('#ovGen');
  await page.$eval('#gnList', (e) => { e.value = 'agendas'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.$eval('#gnTitleIn', (e) => { e.value = 'Tarefa gerada'; });
  await page.$eval('#gnDue', (e) => { e.value = '2030-05-20'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  const gnBox = await page.$('#gnPpl input'); if (gnBox) await gnBox.check();
  await page.click('#gnOk'); await page.waitForTimeout(400);
  const gen = await ev('(function(){ var t = Object.values(CRM.tasks).filter(function(x){ return x.title === "Tarefa gerada"; })[0]; return t ? {list: t.list_id, n: (t.assignees||[]).length, lead: t.lead && t.lead.nome, due: t.due_date} : null; })()');
  check('generated task is in Agendas with the chosen responsible, due date and the original lead?', gen && gen.list === 'agendas' && gen.n === 1 && gen.lead === 'Lead Fictício' && gen.due === '2030-05-20', gen);
  await page.click('#crmTopBtn'); await page.waitForTimeout(100);
  await page.click('#crmMoveBtn'); await page.waitForSelector('#ovMove');
  const dv = await page.$$eval('#mvList option', (a) => a.map((o) => o.value));
  check('destination lists exclude the current one?', dv.indexOf('atendimento') === -1 && dv.indexOf('agendas') !== -1 && dv.indexOf('fature') !== -1, dv);
  const note1 = await page.textContent('#mvNote');
  check('status missing in the destination list says so and suggests an equivalent (Em aberto)?', /não tem o status/.test(note1) && /Triagem/.test(note1) && /Em aberto/.test(note1) && (await page.$eval('#mvSt', (e) => e.value)) === 'aberto', note1);
  await page.$eval('#mvSt', (e) => { e.value = 'andamento'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.click('#mvOk'); await page.waitForTimeout(400);
  const moved = await ev(`(function(){ var t = CRM.tasks["${mvId}"]; return {list: t.list_id, st: t.status}; })()`);
  check('task moved to Agendas with the chosen status (Em andamento)?', moved.list === 'agendas' && moved.st === 'andamento', moved);
  check('window closed and the move is in the activity?', !(await page.$('#ovCrm')) && await ev(`CRM.mem.events.some(function(e){ return e.task_id === "${mvId}" && e.kind === "field" && e.data.campo === "lista" && e.data.para === "agendas"; })`));
  check('new task has no top "Outras Opções" (only saved ones)?', await ev('(function(){ crmOpenTask(null, {listId: "atendimento"}); var r = !document.getElementById("crmTopBtn"); document.getElementById("modalHost").innerHTML = ""; return r; })()'));
  // Status que existe (mesmo nome) nas duas listas: mantém sem aviso; encerra → encerra
  const mv2 = await ev('crmInsert({list_id: "agendas", status: "aberto", title: "Mover igual", priority: "normal", assignees: [], lead: {}}).then(function(t){ return t.id; })');
  const stSame = await ev('(function(){ return crmMoveStatusFor(crmListById("agendas"), "aberto", crmListById("fature")); })()');
  const stFinMv = await ev('(function(){ return crmMoveStatusFor(crmListById("atendimento"), "contrato", crmListById("agendas")); })()');
  const stLost = await ev('(function(){ return crmMoveStatusFor(crmListById("agendas"), "concluido", crmListById("atendimento")); })()');
  check('same status id keeps it; a finishing status maps to the finishing one of the other list?', stSame.exact && stSame.id === 'aberto' && !stFinMv.exact && stFinMv.id === 'concluido' && !stLost.exact && stLost.id === 'contrato', [stSame, stFinMv, stLost]);
  // Ordenar visível em todas as colunas (computador)
  await ev('crmGo("agendas")'); await page.waitForTimeout(300);
  const sortAll = await page.evaluate(() => [...document.querySelectorAll('#crmHost thead th')].map((th) => { const b = th.querySelector('.sort-btn'), r = th.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width > 8 && br.right <= r.right + 1; }));
  check('sort button visible in every column of the CRM list (desktop)?', sortAll.length >= 7 && sortAll.every(Boolean), sortAll);
  // Duplicar, Seguir e Resumo do Dia
  const dpId = await ev('crmInsert({list_id: "atendimento", status: "triagem", title: "Tarefa para duplicar", priority: "alta", due_date: "2000-01-01", assignees: [], lead: {nome: "Lead Dup"}}).then(function(t){ return t.id; })');
  await ev(`(crmOpenTask(CRM.tasks["${dpId}"]), true)`); await page.waitForTimeout(300);
  await page.click('#crmTopBtn'); await page.waitForTimeout(100);
  check('menu has Seguir and Duplicar?', /Seguir Tarefa/.test(await page.textContent('#crmTopMenu')) && /Duplicar Tarefa/.test(await page.textContent('#crmTopMenu')));
  await page.click('#crmFolBtn'); await page.waitForTimeout(300);
  check('follow: I am in followers and the button says Deixar de Seguir?', await ev(`(CRM.tasks["${dpId}"].followers || []).indexOf(crmMe()) !== -1`) && /Deixar de Seguir/.test(await page.textContent('#crmFolBtn')));
  await page.click('#crmTopBtn'); await page.click('#crmFolBtn'); await page.waitForTimeout(300);
  check('unfollow removes me?', await ev(`(CRM.tasks["${dpId}"].followers || []).indexOf(crmMe()) === -1`));
  await page.click('#crmTopBtn'); await page.click('#crmDupBtn'); await page.waitForTimeout(500);
  const dups = await ev('Object.values(CRM.tasks).filter(function(x){ return x.title === "Tarefa para duplicar"; }).map(function(x){ return {id: x.id, list: x.list_id, st: x.status, pr: x.priority, due: x.due_date, lead: x.lead && x.lead.nome}; })');
  check('duplicate: 2 identical tasks in the same list, new one opened?', dups.length === 2 && dups.every((d) => d.list === 'atendimento' && d.st === 'triagem' && d.pr === 'alta' && d.due === '2000-01-01' && d.lead === 'Lead Dup') && !!(await page.$('#ovCrm')), dups);
  await page.evaluate(() => document.getElementById('modalHost').innerHTML = '');
  await ev('(CRM.list = "__home", crmRender(), true)'); await page.waitForTimeout(300);
  const day = await page.$$eval('.crm-home-day .crm-day-row', (a) => a.map((r) => r.textContent));
  check('Resumo do Dia lists the person with overdue tasks (sem responsável: the 2 overdue copies)?', day.some((t) => /Sem responsável/.test(t) && /\d+ vencidas/.test(t)), day);
  await page.click('.crm-day-row[data-crm-day="__none"]'); await page.waitForSelector('#ovDay');
  check('Resumo do Dia detail lists the overdue tasks and opens a task on click?', (await page.$$('#ovDay [data-day-task]')).length >= 2);
  await page.click('#ovDay [data-day-task]'); await page.waitForTimeout(300);
  check('click opens the task window?', !!(await page.$('#ovCrm')) && !(await page.$('#ovDay')));
  await page.evaluate(() => document.getElementById('modalHost').innerHTML = '');
  // Anexos no Drive (sem sistema online: simulação em memória, mesmas regras de nome)
  const apat = await ev('(function(){ var p = (state.patients || []).filter(function(p){ return isActive(p); })[0]; return {id: p.id, nome: p.nome}; })()');
  const apId = await ev(`crmInsert({list_id: "atendimento", status: "triagem", title: "Tarefa com anexo", priority: "normal", assignees: [], lead: {}, patient_id: "${apat.id}"}).then(function(t){ return t.id; })`);
  const alId = await ev(`crmInsert({list_id: "atendimento", status: "triagem", title: "Tarefa sem paciente", priority: "normal", assignees: [], lead: {nome: "Alguém"}}).then(function(t){ return t.id; })`);
  await ev(`(crmOpenTask(CRM.tasks["${alId}"]), true)`); await page.waitForTimeout(300);
  check('anexos: tarefa sem paciente cadastrado não mostra + Anexar e explica?', (await page.$eval('#crmAttAdd', (b) => b.hidden)) && /paciente cadastrado/.test(await page.textContent('#crmAttList')));
  await page.evaluate(() => document.getElementById('modalHost').innerHTML = '');
  await ev(`(crmOpenTask(CRM.tasks["${apId}"]), true)`); await page.waitForTimeout(300);
  check('anexos: tarefa com paciente mostra + Anexar e "Nenhum anexo"?', !(await page.$eval('#crmAttAdd', (b) => b.hidden)) && /Nenhum anexo/.test(await page.textContent('#crmAttList')));
  await page.click('#crmAttAdd'); await page.waitForSelector('#ovAtt');
  check('anexos: janela de enviar tem Pasta com Documentos e Relatórios?', (await page.$$eval('#atKind option', (o) => o.map((x) => x.textContent))).join('|') === 'Relatórios|Documentos');
  check('anexos: Enviar começa desativado?', await page.$eval('#atOk', (b) => b.disabled));
  await page.setInputFiles('#atFile', {name: 'foto.PDF', mimeType: 'application/pdf', buffer: Buffer.from('abc')});
  await page.fill('#atName', 'Carteirinha');
  const first = apat.nome.split(' ')[0];
  check('anexos: prévia mostra "Carteirinha <primeiro nome>.pdf"?', (await page.textContent('#atPrev')).indexOf('Carteirinha ' + first + '.pdf') !== -1, await page.textContent('#atPrev'));
  await page.evaluate(() => { var s = document.getElementById('atKind'); s.value = 'documentos'; s.dispatchEvent(new Event('change')); });
  await page.click('#atOk'); await page.waitForTimeout(400);
  check('anexos: enviado, janela fechou e a lista mostra o nome final e a pasta?', !(await page.$('#ovAtt')) && (await page.textContent('#crmAttList')).indexOf('Carteirinha ' + first + '.pdf') !== -1 && /Documentos/.test(await page.textContent('#crmAttList')), await page.textContent('#crmAttList'));
  await page.click('#crmAttAdd'); await page.waitForSelector('#ovAtt');
  await page.setInputFiles('#atFile', {name: 'outra.pdf', mimeType: 'application/pdf', buffer: Buffer.from('abc')});
  await page.fill('#atName', 'Carteirinha');
  await page.evaluate(() => { var s = document.getElementById('atKind'); s.value = 'documentos'; s.dispatchEvent(new Event('change')); });
  await page.click('#atOk'); await page.waitForTimeout(300);
  check('anexos: nome repetido na mesma pasta é recusado e a janela continua aberta?', !!(await page.$('#ovAtt')) && !(await page.$eval('#atErr', (e) => e.hidden)) && /Já existe/.test(await page.textContent('#atErr')));
  await page.evaluate(() => { var s = document.getElementById('atKind'); s.value = 'relatorios'; s.dispatchEvent(new Event('change')); });
  await page.click('#atOk'); await page.waitForTimeout(300);
  check('anexos: mesmo nome em outra pasta é aceito?', !(await page.$('#ovAtt')) && (await page.$$('#crmAttList .crm-att')).length === 2);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(20)], 'Laudo teste.pdf', {type: 'application/pdf'})); document.querySelector('#ovCrm .crm-modal').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true})); });
  await page.waitForSelector('#ovAtt');
  check('anexos: soltar arquivo na tarefa abre a janela já com o arquivo?', /Laudo teste\.pdf/.test(await page.textContent('#atFileName')) && (await page.$eval('#atName', (e) => e.value)) === 'Laudo teste' && !(await page.$eval('#atOk', (b) => b.disabled)));
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(5)], 'Outro.pdf', {type: 'application/pdf'})); document.querySelector('#atDrop').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true})); });
  check('anexos: soltar na área da janela troca o arquivo?', /Outro\.pdf/.test(await page.textContent('#atFileName')));
  await page.click('#atCancel'); await page.waitForTimeout(150);
  check('anexos: grupo começa recolhido e mostra a contagem?', await page.$eval('#crmAttList', (b) => b.hidden) && /\(2\)/.test(await page.textContent('#crmAttTog')));
  await page.click('#crmAttTog');
  check('anexos: seta abre a lista e cada anexo tem 2 linhas (link+botões / descrição)?', !(await page.$eval('#crmAttList', (b) => b.hidden)) && !!(await page.$('#crmAttList .crm-att .crm-att-l1 [data-att-ren]')) && !!(await page.$('#crmAttList .crm-att > .crm-att-meta')));
  await page.click('#crmAttList .crm-att [data-att-ren]'); await page.waitForSelector('#ovAtt');
  check('anexos: renomear mostra o nome sem a extensão e sem o primeiro nome do paciente?', (await page.inputValue('#atName')) === 'Carteirinha');
  await page.fill('#atName', 'RG'); await page.click('#atOk'); await page.waitForTimeout(300);
  check('anexos: renomeado para "RG <primeiro nome>.pdf"?', (await page.textContent('#crmAttList')).indexOf('RG ' + first + '.pdf') !== -1);
  await page.click('#crmAttList .crm-att [data-att-del]'); await page.waitForSelector('#ovAttDel');
  check('anexos: excluir pergunta Cancelar / Manter no Drive / Excluir no Drive?', !!(await page.$('#adCancel')) && !!(await page.$('#adKeep')) && !!(await page.$('#adDrive')));
  await page.click('#adCancel'); await page.waitForTimeout(150);
  check('anexos: cancelar não exclui?', (await page.$$('#crmAttList .crm-att')).length === 2);
  await page.click('#crmAttList .crm-att [data-att-del]'); await page.waitForSelector('#ovAttDel');
  await page.click('#adKeep'); await page.waitForTimeout(300);
  check('anexos: excluir remove da lista?', (await page.$$('#crmAttList .crm-att')).length === 1);
  const feed = await page.textContent('#crmFeed');
  check('anexos: o histórico da tarefa não precisa do banco, mas a janela segue aberta?', !!(await page.$('#ovCrm')));
  await page.evaluate(() => document.getElementById('modalHost').innerHTML = '');
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
