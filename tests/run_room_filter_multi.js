// Filtro de salas do Planner: várias salas ao mesmo tempo (grupos de suporte continuam visíveis).
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('#gridHost .book');
  const heads = () => page.evaluate(() => Array.prototype.map.call(document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead .ghtext, th.grouphead'), (e) => e.textContent.trim()).filter(Boolean).length);
  const ids = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#roomChips .rf-opt'), (o) => o.getAttribute('data-room')).filter(Boolean));
  const total = await page.evaluate(() => document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead').length);
  const a = ids[ids.length - 1], b = ids[ids.length - 2];
  await page.click('#roomChips .rf-btn');
  await page.click('#roomChips .rf-opt[data-room="' + a + '"]');
  await page.waitForTimeout(150);
  const n1 = await page.evaluate(() => document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead').length);
  console.log('list stays open after choosing a room?', await page.evaluate(() => !document.querySelector('#roomChips .rf-panel').hidden));
  await page.click('#roomChips .rf-opt[data-room="' + b + '"]');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({n: document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead').length, label: document.querySelector('#roomChips .rf-btn .rf-name').textContent, on: document.querySelectorAll('#roomChips .rf-opt.on').length}));
  console.log('second room adds one more column group?', r.n === n1 + 1 && n1 < total, JSON.stringify({total, n1, r}));
  console.log('button says "2 salas" and both options marked?', r.label === '2 salas' && r.on === 2);
  await page.click('#roomChips .rf-opt[data-room="' + a + '"]');
  await page.waitForTimeout(150);
  const one = await page.evaluate(() => ({n: document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead').length, on: document.querySelectorAll('#roomChips .rf-opt.on').length}));
  console.log('clicking again unmarks (one room left)?', one.n === n1 && one.on === 1, JSON.stringify(one));
  await page.click('#roomChips .rf-opt[data-room=""]');
  await page.waitForTimeout(150);
  const all = await page.evaluate(() => ({n: document.querySelector('#gridHost table.sched').querySelectorAll('th.grouphead').length, open: !document.querySelector('#roomChips .rf-panel').hidden}));
  console.log('"Todas as salas" clears and closes?', all.n === total && !all.open, JSON.stringify(all));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
