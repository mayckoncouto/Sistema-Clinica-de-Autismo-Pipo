// CRM → Automações: tela com as 26 regras (ligar/desligar, lista de destino, responsáveis, dias), busca,
// grupos, Ligar/Desligar Todas, somente leitura e a Ajuda. Em memória (as regras rodam no banco: ver
// supabase/2026-10-12h-crm-automacoes.sql, testado à parte).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ca.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const setv = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await ev('CRM.people = [{id: "u1", full_name: "Ana Atendente"}, {id: "u2", full_name: "Beto Coordenador"}]');

  // Menu CRM ▾ → Automações
  await page.click('#crmBtn');
  const items = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('CRM menu has Automações after Listas e Status?', items[items.length - 1] === 'Automações' && items.indexOf('Listas e Status') === items.length - 2, items);
  await page.click('#crmMenu [data-nav="crm-auto"]');
  await page.waitForSelector('#reg-automacoes-host .crma-row');
  check('title Automações and 26 rules, none on?', (await page.$eval('#tab-automacoes .cad-title', (e) => e.textContent)) === 'Automações' &&
    (await page.$$('#reg-automacoes-host .crma-row')).length === 26 && /^0 de 26 ligadas/.test(await page.$eval('#crmaCount', (e) => e.textContent)));
  const heads = await page.$$eval('#reg-automacoes-host thead th', (r) => r.map((x) => x.textContent.trim()));
  check('columns: Automação, Grupo, Lista, Responsáveis, Ligada, Criou (30 Dias)?', heads.join('|') === 'Automação|Grupo|Lista|Responsáveis|Ligada|Criou (30 Dias)', heads);
  check('every rule has a description and a group (5 groups)?', await ev(`CRMA_RULES.every(function(r){ return r.desc && r.name && CRMA_GROUPS[r.group]; }) && CRMA_GROUPS.length === 5`));
  check('every rule id is unique and matches the database slugs?', await ev(`(function(){ var ids = CRMA_RULES.map(function(r){ return r.id; }); var want = ["lead_parado","link_respondido","link_segunda_cobranca","lead_perdido","contrato_assinado","rodizio_leads","trat_vencendo","trat_cancelado","abaixo_contratado","carteirinha_vencendo","sem_tratamento","falta","faltas_seguidas","pendencias_status","primeiro_atendimento","conta_vencendo","conta_vencida","saldo_baixo","mes_sem_fechar","conciliacao_pendente","rotinas_prontas","plano_vencendo","tarefa_parada","tarefa_atrasada","aniversario","encaminhamento_vencendo"]; return ids.length === 26 && want.every(function(w){ return ids.indexOf(w) !== -1; }); })()`));

  // Ligar / desligar pela etiqueta
  await page.click('[data-crma-tg="falta"]'); await page.waitForTimeout(200);
  let doc = JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"] || {})'));
  check('toggle saves rules.falta.on = true in config/crm_automations?', doc.rules && doc.rules.falta && doc.rules.falta.on === true, doc);
  check('count says 1 de 26 and the chip says Ligada?', /^1 de 26 ligadas/.test(await page.$eval('#crmaCount', (e) => e.textContent)) && /Ligada/.test(await page.$eval('[data-crma-tg="falta"]', (e) => e.textContent)));
  await page.click('[data-crma-tg="falta"]'); await page.waitForTimeout(200);
  check('toggle again turns it off?', /^0 de 26/.test(await page.$eval('#crmaCount', (e) => e.textContent)));

  // Janela da regra
  await page.click('.crma-row[data-crma="lead_parado"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('window shows name, what it does, list, days, responsáveis, últimas ocorrências?', (await page.$eval('#crmaTitle', (e) => e.textContent)) === 'Lead sem Resposta' && !!(await page.$('#crmaList')) && !!(await page.$('#crmaDias')) && !!(await page.$('#crmaWho')) && !!(await page.$('#crmaLast')));
  check('default list option names the standard list (Atendimento)?', /Atendimento/.test(await page.$eval('#crmaList option[value=""]', (e) => e.textContent)));
  await page.check('#crmaOn');
  await setv('#crmaList', 'gestao');
  await page.fill('#crmaDias', '0'); await page.click('#crmaSave'); await page.waitForTimeout(150);
  check('days 0 is refused (window stays)?', !!(await page.$('#ovCrma')));
  await page.fill('#crmaDias', '5');
  await page.click('#crmaWho'); await page.waitForSelector('#crmPop [data-pick]');
  await page.click('#crmPop [data-pick="u1"]'); await page.click('#crmPop [data-pick="u2"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check('responsáveis button lists the chosen people?', /Ana Atendente, Beto Coordenador/.test(await page.$eval('#crmaWho', (e) => e.textContent)));
  await page.click('#crmaSave'); await page.waitForTimeout(250);
  doc = JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"] || {})'));
  const r1 = doc.rules.lead_parado;
  check('saved: on, listId gestao, dias 5, two assignees?', r1 && r1.on === true && r1.listId === 'gestao' && r1.dias === 5 && r1.assignees.length === 2, r1);
  const rowTxt = await page.$eval('.crma-row[data-crma="lead_parado"]', (e) => e.textContent);
  check('row shows list Gestão, both names and Ligada?', /Gestão/.test(rowTxt) && /Ana Atendente, Beto Coordenador/.test(rowTxt) && /Ligada/.test(rowTxt), rowTxt);

  // Regra com motivo (lead perdido) e regra de lista monitorada (rodízio)
  await page.click('.crma-row[data-crma="lead_perdido"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('lead perdido has the Motivo de Perda field?', !!(await page.$('#crmaMotivo')));
  await page.fill('#crmaMotivo', 'Financeiro'); await page.check('#crmaOn'); await page.click('#crmaSave'); await page.waitForTimeout(200);
  doc = JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"] || {})'));
  check('motivo saved?', doc.rules.lead_perdido.motivo === 'Financeiro' && doc.rules.lead_perdido.on === true, doc.rules.lead_perdido);
  await page.click('.crma-row[data-crma="rodizio_leads"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('rodízio: list label is Aplicar na Lista with "Todas as listas", and the queue label?', /Aplicar na Lista/.test(await page.$eval('label[for="crmaList"]', (e) => e.textContent)) && /Todas as listas/.test(await page.$eval('#crmaList option[value=""]', (e) => e.textContent)) && /Fila do Rodízio/.test(await page.$eval('#ovCrma .modal-body', (e) => e.textContent)));
  await page.click('#crmaCancel');
  // Status da tarefa criada acompanha a lista escolhida; Status que dispara só nas regras de lead
  await page.click('.crma-row[data-crma="falta"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('falta: field Status da Tarefa Criada (padrão + status que não finalizam da lista padrão Agendas); no trigger field?', !!(await page.$('#crmaStatus')) && !(await page.$('#crmaGat')) &&
    (await page.$$eval('#crmaStatus option', (o) => o.map((x) => x.textContent))).join('|') === 'Padrão (primeiro status)|Em aberto|Em andamento');
  await setv('#crmaList', 'atendimento');
  check('changing the list refreshes the statuses (Atendimento has none that finalize beyond its own)?', (await page.$$eval('#crmaStatus option', (o) => o.map((x) => x.textContent))).join('|') === 'Padrão (primeiro status)|Triagem|Avaliação|Pós-avaliação');
  await setv('#crmaList', 'gestao'); await setv('#crmaStatus', 'andamento'); await page.check('#crmaOn'); await page.click('#crmaSave'); await page.waitForTimeout(250);
  const rf = JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"].rules.falta)'));
  check('saved: list gestao + statusId andamento?', rf.listId === 'gestao' && rf.statusId === 'andamento' && rf.on === true, rf);
  check('row shows "Gestão › Em andamento"?', /Gestão › Em andamento/.test(await page.$eval('.crma-row[data-crma="falta"]', (e) => e.textContent)));
  await page.click('.crma-row[data-crma="contrato_assinado"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('contrato assinado: Status que Dispara lists only statuses that finalize without loss (Contrato assinado)?', (await page.$$eval('#crmaGat option', (o) => o.map((x) => x.textContent))).join('|') === 'Qualquer status que finaliza|Contrato assinado');
  await setv('#crmaGat', 'contrato'); await page.click('#crmaSave'); await page.waitForTimeout(200);
  check('gatilho saved?', JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"].rules.contrato_assinado)')).gatilho === 'contrato');
  await page.click('.crma-row[data-crma="lead_perdido"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('lead perdido: Status que Dispara lists the loss status (Cancelado)?', (await page.$$eval('#crmaGat option', (o) => o.map((x) => x.textContent))).join('|') === 'Qualquer status de perda|Cancelado');
  await page.click('#crmaCancel');
  await page.click('.crma-row[data-crma="rodizio_leads"] td:first-child'); await page.waitForSelector('#ovCrma');
  check('rodízio (lista vigiada): no Status da Tarefa Criada?', !(await page.$('#crmaStatus')));
  await page.click('#crmaCancel');
  await page.click('.crma-row[data-crma="faltas_seguidas"] td:first-child'); await page.waitForSelector('#ovCrma');
  await page.fill('#crmaDias', '1'); await page.click('#crmaSave'); await page.waitForTimeout(150);
  check('faltas seguidas: minimum is 2?', !!(await page.$('#ovCrma')));
  await page.click('#crmaCancel');

  // Busca e grupo
  await page.fill('#crmaSearch', 'carteirinha'); await page.waitForTimeout(100);
  check('search narrows to the carteirinha rule?', (await page.$$('#reg-automacoes-host .crma-row')).length === 1);
  await page.fill('#crmaSearch', ''); await setv('#crmaGroup', '3'); await page.waitForTimeout(100);
  check('group Financeiro shows 5 rules?', (await page.$$('#reg-automacoes-host .crma-row')).length === 5, (await page.$$('#reg-automacoes-host .crma-row')).length);
  await setv('#crmaGroup', ''); await page.waitForTimeout(100);

  // Ligar / desligar todas
  await page.click('#crmaMenuBtn'); await page.click('#crmaMenu [data-crma-act="on"]'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(250);
  check('Ligar Todas: 26 on?', /^26 de 26/.test(await page.$eval('#crmaCount', (e) => e.textContent)));
  check('the settings of a rule survive Ligar Todas?', JSON.parse(await ev('JSON.stringify(window.__STORE__["config/crm_automations"].rules.lead_parado)')).dias === 5);
  await page.click('#crmaMenuBtn'); await page.click('#crmaMenu [data-crma-act="off"]'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(250);
  check('Desligar Todas: 0 on?', /^0 de 26/.test(await page.$eval('#crmaCount', (e) => e.textContent)));

  // Rodar agora sem sistema online
  await page.click('[data-crma-tg="falta"]'); await page.waitForTimeout(150);
  await page.click('#crmaRun'); await page.waitForTimeout(200);
  check('Rodar Agora offline warns?', /online/.test(await page.$eval('#toastHost', (e) => e.textContent)));

  // Somente leitura
  await ev('crmaCan = function(a){ return a === "view"; }; crmListsCan = function(a){ return a === "view"; }; renderAutomacoes();');
  check('read-only: chips disabled and Salvar hidden?', (await page.$$eval('.crma-tg', (r) => r.every((b) => b.disabled))) && await (async () => { await page.click('.crma-row[data-crma="falta"] td:first-child'); await page.waitForSelector('#ovCrma'); const ok = !(await page.$('#crmaSave')) && /Fechar/.test(await page.$eval('#crmaCancel', (e) => e.textContent)); await page.click('#crmaCancel'); return ok; })());

  // Ajuda
  const help = await ev('JSON.stringify((function(){ var t = HELP_TOPICS.filter(function(x){ return x.id === "crm-automacoes"; })[0]; return {ok: !!t, tab: HELP_TAB_TOPIC.automacoes}; })())');
  check('help topic crm-automacoes exists and the "?" opens it?', JSON.parse(help).ok && JSON.parse(help).tab === 'crm-automacoes');

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
