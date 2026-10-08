// Planner: botão Limpar ao lado de cada horário (embaixo do horário, junto de liberar/bloquear): apaga os agendamentos daquele horário; Ctrl+Z volta.
const { chromium } = require('playwright'); const path=require('path');
(async()=>{ const b=await chromium.launch(require('./launch-opts')); const page=await b.newPage({viewport:{width:1366,height:768}});
await page.goto('file://'+path.join(__dirname,'page.html')); await page.waitForSelector('td.slotcell');
await page.locator('tr:has(td.slotcell[data-key="07:20|r1|r1-t1"])').first().hover();
const before = await page.evaluate(()=>Object.keys(window.__STORE__['schedule/seg-1'].bookings).filter(k=>k.startsWith('07:20|')&&window.__STORE__['schedule/seg-1'].bookings[k].patient).length);
const btn = page.locator('[data-row-action="clear"][data-doc="seg-1"][data-time="07:20"]');
await btn.click(); await btn.click(); await page.waitForTimeout(300);
const after = await page.evaluate(()=>Object.keys(window.__STORE__['schedule/seg-1'].bookings).filter(k=>k.startsWith('07:20|')&&window.__STORE__['schedule/seg-1'].bookings[k].patient).length);
await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
const undo = await page.evaluate(()=>Object.keys(window.__STORE__['schedule/seg-1'].bookings).filter(k=>k.startsWith('07:20|')&&window.__STORE__['schedule/seg-1'].bookings[k].patient).length);
console.log('row clear removes the bookings of that time; Ctrl+Z brings back?', before>0 && after===0 && undo===before, before, after, undo);
await b.close(); })();
