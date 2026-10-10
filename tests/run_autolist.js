// Listas de sugestões ao digitar (.autolist) flutuam por cima da janela, coladas no campo, sem aumentar
// a rolagem da janela (2026-10-10). Agendamento do Planner e Paciente ou Lead do CRM. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_al.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + pg);
  await page.waitForSelector('td.slotcell');
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };
  function geo(listSel, inSel){
    return page.evaluate(([l, n]) => {
      const L = document.querySelector(l), I = document.querySelector(n), body = I.closest('.modal-body');
      const lr = L.getBoundingClientRect(), ir = I.getBoundingClientRect();
      return {fixed: getComputedStyle(L).position === 'fixed', hidden: L.hidden, items: L.querySelectorAll('button').length,
        glued: Math.abs(lr.top - ir.bottom - 4) < 2 || Math.abs(ir.top - lr.bottom - 4) < 2, left: Math.abs(lr.left - ir.left) < 2,
        bodySh: body ? body.scrollHeight : 0};
    }, [listSel, inSel]);
  }
  // Planner: janela do agendamento numa célula vazia.
  await page.click('td.slotcell[data-key="07:20|r1|r1-t2"]');
  await page.waitForSelector('#bkPatient');
  const sh0 = await page.evaluate(() => document.querySelector('#bkPatient').closest('.modal-body').scrollHeight);
  await page.fill('#bkPatient', 'a'); await page.dispatchEvent('#bkPatient', 'input'); await page.waitForTimeout(150);
  const g1 = await geo('#bkSuggest', '#bkPatient');
  check('booking suggestions float (fixed), glued under/over the field, window does not grow?', g1.fixed && !g1.hidden && g1.items > 0 && g1.glued && g1.left && g1.bodySh === sh0, {g1, sh0});
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  if (await page.$('#bkCancel')) await page.click('#bkCancel');
  // CRM: Paciente ou Lead.
  await page.$eval('#mainTabs button[data-tab="crm"]', (b) => b.click()); await page.waitForTimeout(300);
  await ev('(function(){ crmOpenTask(null, {listId: "atendimento"}); return true; })()');
  await page.waitForSelector('#crmWho');
    await page.fill('#crmWho', 'a'); await page.dispatchEvent('#crmWho', 'input'); await page.waitForTimeout(150);
  const g2 = await geo('#crmWhoSug', '#crmWho');
  const shNo = await page.evaluate(() => { const l = document.querySelector('#crmWhoSug'); l.style.display = 'none'; const h = document.querySelector('#crmWho').closest('.modal-body').scrollHeight; l.style.display = ''; return h; });
  check('CRM "Paciente ou Lead" suggestions float glued to the field without growing the window?', g2.fixed && !g2.hidden && g2.items > 0 && g2.glued && g2.left && g2.bodySh === shNo, {g2, shNo});
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
