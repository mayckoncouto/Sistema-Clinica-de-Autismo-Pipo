// CRM → Caixa de Entrada: abas, resumo por tarefa, Limpar / Desfazer / Lidas, volta com movimentação nova, Adiar, Não lida,
// pesquisa, filtros, Preferências, atalhos, contador do topo e permissão. Em memória. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cx.html');
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
  await ev('(function(){ try { localStorage.removeItem("agendaPipo:cxPrefs"); } catch(e){} CRM.people = [{id: "local-me", full_name: "Você Teste"}, {id: "u2", full_name: "Bia Sec"}]; return true; })()');
  const iso = (min) => new Date(Date.now() - min * 60000).toISOString();
  await ev(`(function(){
    var base = {list_id: "atendimento", status: "novo", description: "", priority: "normal", tags: [], lead: {nome: "Lead Um"}, assignees: [], followers: []};
    CRM.mem.tasks = [
      Object.assign({}, base, {id: "t1", title: "Agenda nova Davi", assignees: ["local-me"], created_by: "u2", created_at: "${iso(600)}"}),
      Object.assign({}, base, {id: "t2", title: "Cobrar contrato", created_by: "local-me", created_at: "${iso(500)}", lead: {nome: "Lead Dois"}}),
      Object.assign({}, base, {id: "t3", title: "Tarefa de outra pessoa", created_by: "u2", created_at: "${iso(400)}"})];
    CRM.mem.events = [
      {id: "e1", task_id: "t1", kind: "comment", body: "pode confirmar o horário?", mentions: ["local-me"], author_id: "u2", author_name: "Bia Sec", created_at: "${iso(60)}"},
      {id: "e2", task_id: "t1", kind: "status", data: {de: "novo", para: "andamento"}, author_id: "u2", author_name: "Bia Sec", created_at: "${iso(30)}"},
      {id: "e3", task_id: "t2", kind: "create", data: {status: "novo"}, author_id: "local-me", author_name: "Você Teste", created_at: "${iso(500)}"},
      {id: "e4", task_id: "t2", kind: "comment", body: "contrato enviado", mentions: [], author_id: "u2", author_name: "Bia Sec", created_at: "${iso(20)}"},
      {id: "e5", task_id: "t3", kind: "comment", body: "não é comigo", mentions: [], author_id: "u2", author_name: "Bia Sec", created_at: "${iso(10)}"}];
    CRM.loaded = false; CX.rows = null; CX.mem = {}; return true; })()`);
  const nums = () => page.evaluate(() => ['principal', 'historico', 'lidas'].map((k) => (document.getElementById('cxN-' + k).textContent || '0')).join('/'));
  const rowsIn = () => page.$$eval('#cxHost tr[data-cx-id]', (r) => r.map((x) => x.getAttribute('data-cx-id')));
  // menu CRM e permissão
  await page.click('#crmBtn');
  const items = await page.$$eval('#crmMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('CRM menu: Caixa de Entrada right after Minhas Tarefas?', items.slice(0, 3).join('|') === 'CRM|Minhas Tarefas|Caixa de Entrada', items.slice(0, 3));
  await page.click('#crmMenu [data-nav="crm-caixa"]');
  await page.waitForSelector('#tab-caixa:not([hidden])'); await page.waitForTimeout(400);
  check('screen has its title and the 3 tabs?', /Caixa de Entrada/.test(await page.textContent('#tab-caixa .cad-title')) && (await page.$$eval('#cxTabs button', (b) => b.length)) === 3);
  check('Principal 2 (t1 and t2; t3 is not mine) / Histórico 2 / Lidas 0?', (await nums()) === '2/2/0', await nums());
  const r1 = await page.textContent('#cxHost tr[data-cx-id="t1"]');
  check('t1 row: title, lead, @menção tag and the comment text?', /Agenda nova Davi/.test(r1) && /Lead Um/.test(r1) && /@menção/.test(r1) && /mencionou você/.test(r1) && /pode confirmar/.test(r1), r1.replace(/\s+/g, ' ').slice(0, 200));
  check('rows grouped by date (Hoje)?', /Hoje/.test(await page.textContent('#cxHost .cx-grp')));
  check('top CRM counter = 2 (principal)?', (await ev('crmBadgeCount()')) === 2, await ev('crmBadgeCount()'));
  // limpar
  await page.click('#cxHost tr[data-cx-id="t1"] [data-cx-act="clear"]');
  await page.waitForTimeout(150);
  check('Limpar: t1 leaves Principal, goes to Lidas, Histórico keeps it?', (await nums()) === '1/2/1' && (await rowsIn()).join() === 't2', await nums());
  check('undo bar shown?', !!(await page.$('#cxHost [data-cx-undo]')));
  await page.click('#cxHost [data-cx-undo]'); await page.waitForTimeout(100);
  check('Desfazer brings t1 back?', (await nums()) === '2/2/0', await nums());
    await page.click('#cxHost tr[data-cx-id="t1"] [data-cx-act="clear"]'); await page.waitForTimeout(100);
  await page.click('#cxTabs [data-cx="lidas"]');
  check('Lidas lists t1 with "Voltar à Principal"?', (await rowsIn()).join() === 't1' && /Voltar à Principal/.test(await page.textContent('#cxHost')));
  // movimentação nova depois de limpar volta para a Principal
  await ev(`CRM.mem.events.push({id: "e6", task_id: "t1", kind: "comment", body: "novidade", mentions: [], author_id: "u2", author_name: "Bia Sec", created_at: new Date().toISOString()}); cxLoad(true)`);
  await page.waitForTimeout(250);
  check('new movement after clearing returns t1 to Principal (Lidas empty)?', (await nums()) === '2/2/' + '0', await nums());
  await page.click('#cxTabs [data-cx="principal"]');
  check('t1 shows only the news after the clear ("novidade", not the old comment)?', /novidade/.test(await page.textContent('#cxHost tr[data-cx-id="t1"]')) && !/pode confirmar/.test(await page.textContent('#cxHost tr[data-cx-id="t1"]')));
  // pesquisa e filtros
  await page.fill('#cxSearch', 'contrato');
  check('search by text finds t2 only?', (await rowsIn()).join() === 't2', (await rowsIn()).join());
  await page.fill('#cxSearch', '');
  await page.$eval('#cxType', (e) => { e.value = 'status'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  check('type filter Status keeps only t1?', (await rowsIn()).join() === 't1', (await rowsIn()).join());
  await page.$eval('#cxType', (e) => { e.value = ''; e.dispatchEvent(new Event('change', {bubbles: true})); });
  // adiar
  await page.hover('#cxHost tr[data-cx-id="t2"]');
  await page.click('#cxHost tr[data-cx-id="t2"] [data-cx-act="snooze"]');
  await page.click('#crmPop [data-pick="1h"]'); await page.waitForTimeout(150);
  check('Adiar hides t2 from Principal and counts it as adiada?', (await rowsIn()).join() === 't1' && /1 adiada/.test(await page.textContent('#cxCount')), await page.textContent('#cxCount'));
  await page.click('#cxTabs [data-cx="historico"]');
  check('Histórico still lists both?', (await rowsIn()).length === 2);
  await page.click('#cxTabs [data-cx="principal"]');
  // marcar como não lida / lidas
  await ev('cxUnread(["t2"])'); await page.waitForTimeout(100);
  check('Não lida brings the snoozed t2 back?', (await rowsIn()).sort().join() === 't1,t2', (await rowsIn()).join());
  // preferências: comentários desligados tiram t2 (só tem comentário) da Principal
  await ev('cxPrefsSave({off: ["comentario"], days: 30}); CRM.mem.events.filter(function(e){ return e.id === "e6"; }).forEach(function(e){ e.kind = "status"; e.data = {de: "novo", para: "andamento"}; }); CX.mem = {}; cxLoad(true)');
  await page.waitForTimeout(250);
  check('Preferências: comment-only task (t2) leaves Principal; status/mention ones stay?', (await rowsIn()).join() === 't1', (await rowsIn()).join());
  await ev('cxPrefsSave({off: [], days: 30}); cxLoad(true)'); await page.waitForTimeout(250);
  // abrir Preferências pela janela
  await page.click('#cxMenuBtn'); await page.click('#crmPop [data-pick="prefs"]');
  await page.waitForSelector('#ovCx');
  check('Preferências window has 8 types and the period?', (await page.$$eval('#ovCx [data-cx-type]', (c) => c.length)) === 8 && !!(await page.$('#cxDays')));
  await page.click('#ovCx [data-tclose]');
  // atalhos
  await page.click('#cxHost tr[data-cx-id="t2"] .cx-t'); await page.waitForSelector('#ovCrm');
  await page.click('#ovCrm .modal-close'); await page.waitForTimeout(200);
  check('opening a row opens the task and marks it read?', (await ev('cxRow("t2").unseen')) === 0);
  await ev('CX.sel = "t2"; cxRender()');
  await page.keyboard.press('e'); await page.waitForTimeout(150);
  check('key E clears the selected row?', (await rowsIn()).indexOf('t2') === -1, (await rowsIn()).join());
  // limpar tudo
  await page.keyboard.press('Shift+E'); await page.waitForSelector('#ovConfirm'); await page.click('#cfOk'); await page.waitForTimeout(200);
  check('Shift+E (Limpar Tudo) empties the Principal?', (await nums()).split('/')[0] === '0', await nums());
  check('empty state text?', /Caixa de Entrada vazia/.test(await page.textContent('#cxHost')));
  // permissão
  const can = await ev('(function(){ var a = window.pipoAuth; window.pipoAuth = {isAdmin: function(){ return false; }, canDefault: function(m){ return m === "crm_listas"; }, can: function(){ return false; }, profile: function(){ return {id: "local-me"}; }}; var r = cxCan(); window.pipoAuth = a; return r; })()');
  check('level without crmcaixa.view cannot use it (CRM view alone is not enough)?', can === false || can === undefined, can);
  // vencimento: tarefa minha vencida entra na Principal; finalizada ou de outra pessoa não
  await ev(`(function(){
    var y = new Date(Date.now() - 864e5), iso = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
    var base = {list_id: "atendimento", status: "novo", description: "", priority: "normal", tags: [], lead: {nome: "Lead Venc"}, followers: [], created_by: "u2", created_at: "${iso(900)}"};
    CRM.mem.tasks.push(Object.assign({}, base, {id: "t4", title: "Vence ontem", assignees: ["local-me"], due_date: iso}),
      Object.assign({}, base, {id: "t5", title: "Vence ontem de outra pessoa", assignees: ["u2"], due_date: iso}));
    cxPrefsSave({off: [], days: 30}); return true; })()`);
  await ev('cxLoad(true)'); await page.waitForTimeout(250);
  const ids = await ev('CX.rows.map(function(r){ return r.task_id; }).join()');
  check('overdue task of mine shows up in the Caixa; someone else\'s does not?', /t4/.test(ids) && !/t5/.test(ids), ids);
  check('its type is Vencimento and the line says it expired?', (await ev('cxType(cxRow("t4").events[0])')) === 'vencimento' && /Venceu/.test(await ev('cxEventLine(cxRow("t4").events[0])')));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close(); fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
