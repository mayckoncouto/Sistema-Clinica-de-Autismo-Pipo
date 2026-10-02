// Planner segue o horário de cada profissional (por dia da semana): fora dele a
// célula fica cinza e inativa (sem clique, sem soltar), e "bloquear período" a ignora.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('td.slotcell');

  // Ana: segunda só de manhã, terça não atende.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const cur = JSON.parse(JSON.stringify(window.__STORE__['config/professionals']));
    cur.list.forEach(p => { if (p.id === 'ana-terapeuta') p.horarios = {
      seg: {inicio: '07:20', fim: '12:00'}, ter: {inicio: '', fim: ''},
      qua: {inicio: '07:20', fim: '18:10'}, qui: {inicio: '07:20', fim: '18:10'}, sex: {inicio: '07:20', fim: '18:10'} }; });
    await db.doc('config/professionals').set(cur);
  });
  await page.waitForTimeout(300);

  const off = (doc, ther) => page.locator(`td.slotcell.slot-off[data-doc="${doc}"][data-ther="${ther}"]`).count();
  console.log('Monday afternoon of Ana (7 slots) is gray/inactive in her Sala Teste column?', (await off('seg-1', 'r1-t1')) === 7);
  // (no Coordenador a tarde tem 7 horários, um deles já agendado às 16:10 = continua visível)
  console.log('…and in her Coordenador column too (same professional)?', (await page.locator('td.slotcell.slot-off[data-doc="seg-1"][data-ther="coord-t1"]:not([data-time^="07"]):not([data-time^="08"]):not([data-time^="09"]):not([data-time^="10"]):not([data-time^="11"])').count()) === 6);
  console.log('Bia (no hours set) keeps every slot active?', (await off('seg-1', 'r1-t2')) === 0);

  await page.locator('td.slotcell[data-doc="seg-1"][data-key="13:30|r1|r1-t1"]').click();
  await page.waitForTimeout(100);
  console.log('clicking an inactive slot does not open the booking window?', (await page.locator('#ovBook').count()) === 0);

  const lock = page.locator('tr.periodrow-mid .period-btn-lock[data-doc="seg-1"][data-room="r1"][data-seat="r1-t1"]');
  await lock.click(); await lock.click();
  await page.waitForTimeout(200);
  const store = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('"bloquear tarde" does not write Bloqueado into inactive slots?', !store.bookings['13:30|r1|r1-t1']);

  await page.click('#daySeg button[data-day="ter"]');
  await page.waitForTimeout(300);
  const terCell = page.locator('td.slotcell[data-doc="ter-1"][data-key="07:20|r1|r1-t1"]');
  console.log('on Tuesday (Ana does not work) an existing booking stays visible and editable?',
    (await terCell.innerText()).includes('Bruno Verde') && !(await terCell.getAttribute('class')).includes('slot-off'));
  console.log('…while her empty Tuesday slots are inactive (13 of 14)?', (await off('ter-1', 'r1-t1')) === 13);

  const errors = await page.evaluate(() => window.__LOG__.filter(x => x.op === 'error'));
  console.log('no JS errors?', errors.length === 0);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
