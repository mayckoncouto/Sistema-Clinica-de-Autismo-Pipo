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
  const cellsOk = await page.evaluate(() => { const r = document.querySelector('#crmHost tbody tr'), tds = [...r.children].filter((t) => getComputedStyle(t).display !== 'none');
    const due = tds[2].querySelector('.crm-prio-btn'), pr = tds[3].querySelector('svg');
    return {who: tds[1].textContent.trim(), full: tds[1].scrollWidth > tds[1].clientWidth, oneLine: tds[1].getBoundingClientRect().height < 50, dueFits: due.scrollWidth <= due.clientWidth + 1, due: due.textContent.trim(), flag: !!pr && pr.getBoundingClientRect().right <= tds[3].getBoundingClientRect().right + 1}; });
  check('task title in one line (full title, cut with …), full date and the flag visible?', /Ligar para a família para agendar avaliação/.test(cellsOk.who) && cellsOk.oneLine && cellsOk.dueFits && /\d\d\/\d\d\/\d\d/.test(cellsOk.due) && cellsOk.flag, JSON.stringify(cellsOk));
  await ev('(function(){ crmInsert({list_id: "atendimento", status: "triagem", title: "Ligar e agendar triagem com a família", priority: "normal", due_date: "2026-10-09", assignees: ["local-me", "u2"], lead: {nome: "Marcos Antônio da Silva Pereira Junior"}}); crmRender(); return 1; })()');
  await page.waitForTimeout(150);
  const rowsH = await page.$$eval('#crmHost tbody tr', (r) => r.map((x) => Math.round(x.getBoundingClientRect().height)));
  check('every list row has the height of one line (long names do not grow the row)?', rowsH.length >= 2 && Math.max.apply(null, rowsH) <= 44 && Math.max.apply(null, rowsH) - Math.min.apply(null, rowsH) <= 1, rowsH);
  check('page has no sideways scroll?', (await ev('document.documentElement.scrollWidth')) <= 390);
  // Barra: 1) Lista/Quadro/Calendário (+ Tarefa ao lado); 2) busca + Status; 3) Responsáveis, Prioridade, Vencimento; 4) título, Finalizados, Opções, ?
  const bar = await page.evaluate(() => { const t = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
    const vis = (s) => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().height > 0; };
    const pk = (id) => { const e = document.querySelector('[data-dp-for="' + id + '"]') || document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().top) : null; };
    return {seg: t('#crmViewSeg'), add: t('#crmAdd'), q: t('.crm-q'), st: pk('crmFSt'), who: pk('crmFWho'), prio: pk('crmFPrio'), due: pk('crmFDue'), title: t('#crmTitle'), fin: t('.crm-toolbar .inact-toggle'), help: t('.crm-toolbar .help-q'), addVis: vis('#crmAdd')}; });
  check('toolbar line 1 is Lista/Calendário (with + Tarefa beside it), line 2 search + Status?', bar.seg < bar.q && Math.abs(bar.q - bar.st) <= 6 && Math.abs(bar.seg - bar.add) <= 6, bar);
  check('toolbar line 3 is Responsáveis, Prioridade, Vencimento (same line), below search?', Math.abs(bar.who - bar.prio) <= 6 && Math.abs(bar.prio - bar.due) <= 6 && bar.who > bar.q + 20, bar);
  check('toolbar last line has the list title, Finalizados and ?', bar.title > bar.who && Math.abs(bar.title - bar.fin) <= 8 && Math.abs(bar.fin - bar.help) <= 8, bar);
  // Ordenar (▲▼) visível em todas as colunas que aparecem, sem ser cortado
  const sortOk = await page.evaluate(() => [...document.querySelectorAll('#crmHost thead th')].filter((x) => getComputedStyle(x).display !== 'none').map((th) => { const b = th.querySelector('.sort-btn'), r = th.getBoundingClientRect(), br = b.getBoundingClientRect(); return {t: th.textContent.trim(), ok: br.width > 8 && br.left >= r.left - 1 && br.right <= r.right + 1}; }));
  check('sort button visible and inside every visible column title (list)?', sortOk.length === 4 && sortOk.every((x) => x.ok), sortOk);
  // Menu ☰: só a tela aberta marcada, grupo dela aberto e em destaque
  await page.click('#mnavBtn');
  const mn = await page.evaluate(() => ({on: [...document.querySelectorAll('#mnavPanel button.on')].map((b) => b.textContent.trim()),
    grp: [...document.querySelectorAll('#mnavPanel .mnav-grp.has-on')].map((b) => b.textContent.trim() + ':' + b.getAttribute('aria-expanded')),
    open: [...document.querySelectorAll('#mnavPanel .mnav-items')].filter((x) => !x.hidden).length}));
  check('mobile menu: all groups collapsed, CRM title highlighted, only the open list marked?', mn.on.join() === 'Atendimento' && /^CRM( \d+)?:false$/.test(mn.grp.join()) && mn.open === 0, JSON.stringify(mn));
  await page.click('#mnavBtn');
  // filtro
  await page.click('[data-dp-for="crmFPrio"]');
  check('filter opens the bottom window with its title?', !!(await page.$('#mSheet')) && /Prioridade/.test(await page.$eval('#mSheet .msheet-head', (e) => e.textContent)));
  await page.click('#mSheet .dp-opt[data-v="urgente"]');
  check('choosing in the window filters and closes it?', (await ev('document.getElementById("crmFPrio").value')) === 'urgente' && !(await page.$('#mSheet')));
  await ev('(function(){ var e = document.getElementById("crmFPrio"); e.value = ""; e.dispatchEvent(new Event("change")); })()');
  // janela da tarefa (lista com Recorrência ligada: o Vencimento abre a janela de atalhos)
  await ev('(CRM.lists.forEach(function(l){ l.recorrencia = true; }), true)');
  await page.click('#crmHost tbody tr');
  await page.waitForSelector('#ovCrm');
  await page.click('#crmStBtn');
  check('Status opens the bottom window with search and dots?', !!(await page.$('#mSheet .crm-pop-q')) && (await page.$$('#mSheet [data-pick] .crm-dot')).length === 5);
  await page.fill('#mSheet .crm-pop-q', 'pos');
  await page.click('#mSheet [data-pick]:not([hidden])');
  check('status picked in the window?', (await ev('document.getElementById("crmSt").value')) === 'pos-avaliacao' && !(await page.$('#mSheet')));
  await page.click('#crmPrioBtn');
  await page.click('#mSheet [data-pick="alta"]');
  check('priority picked in the window?', (await ev('document.getElementById("crmPrio").value')) === 'alta');
  await page.click('#ovCrm [data-dp-for="crmDue"]');
  check('date field opens the calendar window (no keyboard: read-only text)?', !!(await page.$('#mSheet .dp-grid')) && !!(await page.$('#mSheet .crm-dq-opt')) && !!(await page.$('#mSheet [data-act="rec"]')) && (await page.$eval('#ovCrm [data-dp-for="crmDue"] .dp-in', (e) => e.readOnly)));
  if (!(await page.$('#mSheet [data-act="clear"]'))) { await page.click('#mSheet .crm-dq-opt'); await page.click('#ovCrm [data-dp-for="crmDue"]'); }
  if (process.env.SHOT){ await page.waitForTimeout(400); await page.screenshot({ path: process.env.SHOT }); }
  await page.click('#mSheet [data-act="clear"]');
  check('Limpar clears the date?', (await ev('document.getElementById("crmDue").value')) === '' && !(await page.$('#mSheet')));
  await page.click('#crmPeopleMs .ms-btn');
  await page.click('#mSheet [data-pick="u2"]');
  await page.click('#mSheet .msheet-x');
  check('Responsáveis marked in the window and kept after ✕?', (await ev('Array.prototype.some.call(document.querySelectorAll("#crmPeople input"), function(i){ return i.value === "u2" && i.checked; })')) && !(await page.$('#mSheet')));
  await page.click('[data-dp-for="crmLDiag"]');
  await page.mouse.click(195, 40);
  check('tapping outside closes the window and keeps the task open?', !(await page.$('#mSheet')) && !!(await page.$('#ovCrm')));
  check('fields with the label above (one column)?', (await page.$eval('#ovCrm .crm-prop', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length)) === 1);
  // Detalhes | Atividade
  check('Detalhes tab shows the fields and hides the activity?', await page.$eval('#crmTitleIn', (e) => e.offsetParent !== null) && await page.$eval('#crmSide', (e) => getComputedStyle(e).display === 'none'));
  // deslizar o dedo para o lado troca Detalhes ↔ Atividade
  const swipe = (dx) => page.evaluate((dx) => {
    const md = document.querySelector('#ovCrm .crm-modal'), tgt = md.querySelector(".crm-sec .tr-sec, h3") || md;
    const mk = (x) => new Touch({identifier: 1, target: tgt, clientX: x, clientY: 400});
    tgt.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, touches: [mk(250)], changedTouches: [mk(250)]}));
    tgt.dispatchEvent(new TouchEvent('touchend', {bubbles: true, touches: [], changedTouches: [mk(250 + dx)]}));
    return document.querySelector('#crmMTabs .active').getAttribute('data-mtab');
  }, dx);
  const sw1 = await swipe(-120), sw2 = await swipe(120), sw3 = await swipe(-20);
  check('swipe left = Atividade, right = Detalhes, short swipe does nothing?', sw1 === 'act' && sw2 === 'det' && sw3 === 'det', [sw1, sw2, sw3].join(','));
  await page.click('#crmMTabs [data-mtab="act"]');
  const act = await page.evaluate(() => ({fields: document.getElementById('crmTitleIn').offsetParent !== null, feed: document.getElementById('crmFeed').offsetParent !== null,
    box: document.getElementById('crmCommentIn').offsetParent !== null, bg: getComputedStyle(document.getElementById('crmSide')).backgroundColor, mbg: getComputedStyle(document.querySelector('#ovCrm .crm-modal')).backgroundColor}));
  check('Atividade tab shows updates + comment box on white, without the fields?', !act.fields && act.feed && act.box && act.bg === act.mbg, JSON.stringify(act));
  await page.click('#crmMTabs [data-mtab="det"]');
  await page.click('#crmClose');
  await page.waitForTimeout(200);
  // Quadro: um status por vez na largura da tela, barra de status em cima
  await page.click('[data-cv="quadro"]');
  await page.waitForTimeout(200);
  const q1 = await page.evaluate(() => { const bd = document.querySelector('.crm-board'), c = document.querySelector('.crm-col');
    return {w: c.getBoundingClientRect().width, bw: bd.clientWidth, t: document.querySelector('.crm-card .crm-t').offsetParent !== null, pager: (function(){ const b = document.querySelector('.crm-pager .crm-pager-btn'); return b ? {w: Math.round(b.getBoundingClientRect().width), row: Math.round(document.querySelector('.crm-pager').clientWidth), txt: b.textContent} : null; })()}; });
  check('board: one status per screen width, card titles visible, status bar on top?', q1.w >= q1.bw - 30 && q1.t && q1.pager && /Triagem/.test(q1.pager.txt) && q1.pager.w >= q1.pager.row - 30, JSON.stringify(q1));
  const top0 = await page.evaluate(() => document.querySelector('.crm-toolbar').getBoundingClientRect().left);
  await page.click('.crm-pager .crm-pager-btn');
  await page.waitForTimeout(150);
  check('status field opens the sheet with the 3 statuses?', (await page.$$eval('#mSheet [data-pick]', (r) => r.length)) === 3);
  await page.click('#mSheet [data-pick="1"]');
  await page.waitForTimeout(600);
  const q2 = await page.evaluate(() => ({sl: document.querySelector('.crm-board').scrollLeft, bw: document.querySelector('.crm-board').clientWidth, top: document.querySelector('.crm-toolbar').getBoundingClientRect().left, act: document.querySelector('.crm-pager .crm-pager-btn').textContent}));
  check('tapping a status slides only the boards (top stays)?', Math.abs(q2.sl - q2.bw) < 3 && q2.top === top0 && /Avaliação/.test(q2.act), JSON.stringify(q2));
  // calendário
  await page.click('[data-cv="calendario"]');
  const day = await ev('agdIso(agdAddDays(agdStartOfDay(new Date()), 3))');
  await page.click('[data-cal-day="' + day + '"]');
  check('tapping a calendar day opens the window with its tasks?', /Ligar para a família/.test(await page.$eval('#mSheet', (e) => e.textContent)));
  await page.click('#mSheet [data-pick]:not([data-pick="__new"])');
  check('tapping a task in the window opens it?', !!(await page.$('#ovCrm')) && (await ev('document.getElementById("crmTitleIn").value')) === 'Ligar para a família para agendar avaliação');
  await page.click('#crmClose');
  // Tarefa nova: Detalhes | Atividade e comentário enviado junto ao salvar
  await page.click('[data-cv="lista"]');
  await page.click('#crmAdd');
  await page.waitForSelector('#ovCrm');
  check('new task has Detalhes | Atividade too?', await page.$eval('#crmMTabs', (e) => getComputedStyle(e).display !== 'none'));
  await page.fill('#crmTitleIn', 'Tarefa nova com comentário');
  await page.click('#crmMTabs [data-mtab="act"]');
  await page.fill('#crmCommentIn', 'Primeiro contato feito');
  await page.press('#crmCommentIn', 'Control+Enter');
  check('comment on a new task waits in the activity (sent on save)?', /Primeiro contato feito/.test(await page.$eval('#crmFeed', (e) => e.textContent)) && !!(await page.$('#crmFeed .crm-cmt.pending')));
  await page.click('#crmSave');
  await page.waitForTimeout(300);
  const sent = await ev('JSON.stringify(CRM.mem.events.filter(function(e){ var t = CRM.tasks[e.task_id]; return e.kind === "comment" && t && t.title === "Tarefa nova com comentário"; }).map(function(e){ return e.body; }))');
  check('saving the new task sends its comment?', sent === '["Primeiro contato feito"]', sent);
  // Listas e Status
  await ev('crmOpenListsModal()');
  await page.waitForSelector('#ovCrmL');
  const rowOver = await page.$$eval('#crmLBody .crm-lrow', (l) => l.filter((r) => r.getBoundingClientRect().right > 390).length);
  check('Listas e Status rows fit the screen?', rowOver === 0, rowOver);
  await page.click('#crmLBody .crm-lrow:first-child [data-ledit]'); await page.waitForTimeout(150);
  const over = await page.$$eval('#ovCrmL .therapist-row .rm', (l) => l.filter((b) => b.getBoundingClientRect().right > 390).length);
  check('Listas e Status: nothing past the screen edge?', over === 0, over);
  // Tela CRM: um cartão por vez na largura da tela (desliza para o lado), números em duas colunas, faixa de status.
  await ev('crmGo("__home")'); await page.waitForTimeout(300);
  const hc = await page.evaluate(() => { const g = document.getElementById('crmHomeGrid'), cs = g && g.querySelectorAll('.crm-home-card'); if (!cs || cs.length < 2) return null;
    const gs = getComputedStyle(g), inner = g.clientWidth - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight), n = cs[1].querySelector('.crm-home-nums');
    const sp = Array.from(n.children).map((x) => x.getBoundingClientRect());
    return {w: Math.round(cs[0].getBoundingClientRect().width), inner: Math.round(inner), items: n.children.length, twoCols: Math.abs(sp[0].top - sp[1].top) < 2 && sp[1].left > sp[0].left,
      strip: !!cs[1].querySelector('.crm-home-strip'), extra: !!cs[1].querySelector('.crm-home-extra'), mineMent: /menç/.test(cs[0].textContent), scroll: g.scrollWidth > g.clientWidth,
      hs: Array.from(cs).map((c) => Math.round(c.getBoundingClientRect().height)), fit: Array.from(cs).every((c) => c.scrollHeight <= c.clientHeight + 1), gap: Array.from(cs).filter((c) => c.querySelector('.crm-home-strip')).map((c) => { const r = c.getBoundingClientRect(), last = c.lastElementChild.getBoundingClientRect(); return Math.round(r.bottom - last.bottom); }), over: Array.from(n.children).filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent)}; });
  check('CRM home (phone): full-width swipe cards, 5 numbers in two columns, status strip, funnel line on Atendimento, same fixed height, nothing cut?', hc && Math.abs(hc.w - hc.inner) <= 2 && hc.items === 5 && hc.twoCols && hc.strip && hc.extra && hc.mineMent && hc.scroll && !hc.over.length && new Set(hc.hs).size === 1 && hc.hs[0] < 230 && hc.fit && hc.gap.every((g) => g <= 18), JSON.stringify(hc));
  const hv = await page.$$eval('#crmHost .pat-table thead th', (r) => r.filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()));
  check('CRM home list (phone): Status, Tarefa, Venc., Prio.?', hv.length === 4 && /Status/i.test(hv[0]) && /Tarefa/i.test(hv[1]), hv);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log(fails + ' FAILED'); process.exit(1); }
})();
