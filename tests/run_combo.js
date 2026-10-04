// Listas de cadastro viram campo de digitar com lista flutuante (dpEnhanceCombo):
// filtra sem acento/maiúscula, ↑ ↓ + Enter ou clique escolhem, texto que não
// existe volta ao valor anterior, Esc desfaz. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cb.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);

  await ev('openRoomModal(state.rooms.filter(function(r){ return !r.group; })[0])');
  await page.waitForTimeout(300);
  const inp = page.locator('.therapist-row .dp-combo .dp-in').first();
  const sel = page.locator('.therapist-row select').first();
  console.log('registry select becomes a typeable field showing the current item?', (await inp.inputValue()) === 'Ana');
  await inp.click(); await page.keyboard.type('BÍ'); await page.waitForTimeout(100);
  const vis = await page.$$eval('#dpPop .dp-opt:not([hidden])', (a) => a.map((x) => x.textContent + (x.classList.contains('kb') ? '*' : '')));
  console.log('typing filters the floating list (accent/case-insensitive) and marks the first?', JSON.stringify(vis) === '["Bia*"]', JSON.stringify(vis));
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  console.log('Enter picks it?', (await sel.inputValue()) === 'bia-terapeuta' && (await inp.inputValue()) === 'Bia' && !(await page.$('#dpPop')));
  await inp.click(); await page.waitForTimeout(100);
  console.log('click opens the full list?', (await page.$$eval('#dpPop .dp-opt:not([hidden])', (a) => a.length)) > 2);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(50);
  const kb = await page.$eval('#dpPop .dp-opt.kb', (x) => x.getAttribute('data-v'));
  await page.click('#dpPop .dp-opt[data-v="andrelisa-terapeuta"]'); await page.waitForTimeout(100);
  console.log('arrows move the mark and a mouse click picks?', !!kb && (await sel.inputValue()) === 'andrelisa-terapeuta' && (await inp.inputValue()) === 'Andrelisa');
  await inp.click(); await page.keyboard.type('xyz'); await page.waitForTimeout(80);
  console.log('no match shows "Nenhum item encontrado"?', await page.isVisible('#dpPop .dp-none'));
  await page.keyboard.press('Tab'); await page.waitForTimeout(80);
  console.log('leaving with unknown text goes back to the previous value?', (await inp.inputValue()) === 'Andrelisa' && (await sel.inputValue()) === 'andrelisa-terapeuta');
  await inp.click(); await page.keyboard.type('an'); await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  console.log('Esc closes the list, keeps the window and restores the text?', (await inp.inputValue()) === 'Andrelisa' && !(await page.$('#dpPop')) && (await page.isVisible('.therapist-row')));
  await ev('state.__x = 0; document.querySelector(".therapist-row select").addEventListener("change", function(){ state.__x++; })');
  await inp.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('ana'); await page.keyboard.press('Tab'); await page.waitForTimeout(80);
  console.log('typing the full name and leaving also picks it (fires change)?', (await sel.inputValue()) === 'ana-terapeuta' && (await ev('state.__x')) === 1);
  await ev('document.querySelector(".therapist-row select").value = "bia-terapeuta"');
  console.log('code setting .value updates the field?', (await inp.inputValue()) === 'Bia');
  // Lista curta que não é de cadastro continua botão.
  await page.keyboard.press('Escape');
  console.log('non-registry lists stay as buttons?', await ev('(function(){ var d = document.createElement("div"); d.innerHTML = "<select data-x><option>Sim</option><option>Não</option></select>"; document.body.appendChild(d); dpScan(d); var r = d.querySelector(".dp-btn").tagName === "BUTTON"; d.remove(); return r; })()'));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
