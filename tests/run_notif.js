// Acesso → Notificações: janela, ligar/desligar neste aparelho (push simulado), escolha dos
// avisos gravada, teste, iPhone sem instalar, abrir a tarefa pela notificação (?tarefa=).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForTimeout(600);

  // Sem sistema online: a janela abre e diz que está indisponível.
  await page.evaluate(() => window.pipoOpenNotif());
  console.log('without the online system the window says unavailable?', /Indisponível/.test(await page.textContent('#ovNotif')));
  await page.click('#nfClose');

  // Push simulado + cliente do Supabase simulado.
  await page.evaluate(() => {
    const rows = []; window.__nf = { rows, invokes: [] };
    let sub = null, perm = 'default';
    const mkSub = (n) => ({ endpoint: 'https://push.example/' + n, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'P', auth: 'A' } }; },
      unsubscribe() { sub = null; return Promise.resolve(true); } });
    let n = 0;
    const reg = { pushManager: { getSubscription: () => Promise.resolve(sub), subscribe: (o) => { window.__nf.key = o.applicationServerKey.length; sub = mkSub(++n); return Promise.resolve(sub); } } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { getRegistration: () => Promise.resolve(reg), register: () => Promise.resolve(reg), ready: Promise.resolve(reg) }, configurable: true });
    window.PushManager = function () {};
    window.Notification = { get permission() { return perm; }, requestPermission: () => { perm = 'granted'; return Promise.resolve('granted'); } };
    const q = (filter) => ({ _f: filter });
    const from = () => ({
      select: () => ({ eq: (k, v) => ({ maybeSingle: () => Promise.resolve({ data: rows.find((r) => r.endpoint === v) || null }) }) }),
      upsert: (r) => { const i = rows.findIndex((x) => x.endpoint === r.endpoint); if (i >= 0) rows[i] = Object.assign(rows[i], r); else rows.push(Object.assign({ id: 'r' + rows.length }, r)); return Promise.resolve({}); },
      update: (u) => ({ eq: (k, v) => { const r = rows.find((x) => x.endpoint === v); Object.assign(r, u); return Promise.resolve({}); } }),
      delete: () => ({ eq: (k, v) => { const i = rows.findIndex((x) => x.endpoint === v); if (i >= 0) rows.splice(i, 1); return Promise.resolve({}); } })
    });
    const client = { from, functions: { invoke: (name, o) => { window.__nf.invokes.push(o.body.acao);
      return Promise.resolve(o.body.acao === 'chave' ? { data: { publicKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } } : { data: { enviados: 1 } }); } } };
    window.pipoAuth = { client, profile: () => ({ id: 'u1' }), can: () => true, canDefault: () => true, isAdmin: () => true };
  });
  await page.evaluate(() => window.pipoOpenNotif());
  await page.waitForTimeout(200);
  console.log('starts off with the "Ligar Neste Aparelho" button?', /Desligadas/.test(await page.textContent('#nfState')) && await page.isVisible('#nfOn'));
  await page.uncheck('[data-nf="vencidas"]');
  await page.click('#nfOn'); await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => window.__nf);
  console.log('turning on asks the key, subscribes and saves this device with the choice?', r1.invokes.includes('chave') && r1.key === 65 && r1.rows.length === 1 && r1.rows[0].prefs.vencidas === false && r1.rows[0].prefs.mencoes === true && r1.rows[0].p256dh === 'P');
  console.log('then shows on, Test and Turn off?', /Ligadas/.test(await page.textContent('#nfState')) && await page.isVisible('#nfTest') && await page.isVisible('#nfOff') && !(await page.isVisible('#nfOn')));
  await page.check('[data-nf="vencidas"]'); await page.waitForTimeout(200);
  console.log('changing a checkbox saves the choice?', (await page.evaluate(() => window.__nf.rows[0].prefs.vencidas)) === true);
  await page.click('#nfTest'); await page.waitForTimeout(200);
  console.log('test sends and confirms?', (await page.evaluate(() => window.__nf.invokes.includes('teste'))) && /Teste enviado/.test(await page.textContent('#nfStatus')));
  // Reabrir: lembra que está ligado.
  await page.click('#nfClose'); await page.evaluate(() => window.pipoOpenNotif()); await page.waitForTimeout(200);
  console.log('reopening shows it is on?', /Ligadas/.test(await page.textContent('#nfState')));
  await page.click('#nfOff'); await page.waitForTimeout(200);
  console.log('turning off removes the device?', (await page.evaluate(() => window.__nf.rows.length)) === 0 && /Desligadas/.test(await page.textContent('#nfState')));
  await page.click('#nfClose');
  // Sair desliga as notificações do aparelho.
  await page.evaluate(() => window.pipoOpenNotif()); await page.waitForTimeout(150); await page.click('#nfOn'); await page.waitForTimeout(250); await page.click('#nfClose');
  await page.evaluate(() => window.pipoNotifSignOut()); await page.waitForTimeout(100);
  console.log('signing out turns off this device?', (await page.evaluate(() => window.__nf.rows.length)) === 0);

  // Ajuda.
  await page.evaluate(() => window.pipoOpenHelpTopic('notificacoes')); await page.waitForTimeout(200);
  const hb = await page.textContent('#helpBody');
  console.log('help topic explains 8h summary, mentions and iPhone?', /8h/.test(hb) && /mencionado/.test(hb) && /iPhone/.test(hb));
  console.log('no JS errors?', errors.length === 0, errors.join(' | '));

  // Tocar na notificação de menção abre /?tarefa=<id>#crm → abre a tarefa.
  const p3 = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const e3 = []; p3.on('pageerror', (e) => e3.push(e.message));
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const si = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_nf.html');
  fs.writeFileSync(evPage, src.slice(0, si + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(si + 13));
  await p3.goto('file://' + evPage); await p3.waitForTimeout(600);
  await p3.evaluate(() => window.__ev(`(function(){
    CRM.mem.tasks.push({ id: 'tk-notif', list_id: 'atendimento', status: crmListById('atendimento').statuses[0].id, title: 'Tarefa da menção', priority: 'normal', assignees: [], created_at: new Date().toISOString() });
    CRM.loaded = false;
    window.pipoAuth = { client: null, profile: () => ({ id: 'local-me' }), can: () => true, canDefault: () => true, isAdmin: () => true };
    history.replaceState(null, '', location.pathname + '?tarefa=tk-notif#crm');
    notifUrlDone = false; notifOpenFromUrl();
  })()`));
  await p3.waitForTimeout(500);
  console.log('?tarefa= opens the CRM task and cleans the address?', await p3.isVisible('#ovCrm') && /Tarefa da menção/.test(await p3.inputValue('#ovCrm input').catch(() => '') + await p3.textContent('#ovCrm')) && !(await p3.evaluate(() => location.search)));
  console.log('no JS errors (task link)?', e3.length === 0, e3.join(' | '));
  fs.unlinkSync(evPage);

  // iPhone sem instalar: pede para instalar.
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 800 } });
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { delete window.PushManager; });
  await p2.goto('file://' + path.join(__dirname, 'page.html')); await p2.waitForTimeout(600);
  const avail = await p2.evaluate(() => window.pipoNotifAvailable());
  await p2.evaluate(() => window.pipoOpenNotif()); await p2.waitForTimeout(150);
  console.log('iPhone without the app installed: item shown and window asks to install first?', avail && /Instale o app primeiro/.test(await p2.textContent('#ovNotif')));
  await browser.close();
})();
