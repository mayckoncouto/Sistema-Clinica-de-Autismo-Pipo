// Campos de dinheiro: "=1500-200", "= 3 x 450,50" etc. calculam e preenchem o campo.
const fs = require('fs');
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_money.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const calc = (t) => page.evaluate((t) => window.__ev('calcMoneyExpr(' + JSON.stringify(t) + ')'), t);
  const cases = [['=1500-200', 1300], ['= 3 x 450,50', 1351.5], ['=(100+50)/2', 75], ['=1.500,50+0,50', 1501], ['=10/4', 2.5], ['=2*-3', -6]];
  for (const [t, v] of cases) console.log('calc "' + t + '" = ' + v + '?', (await calc(t)) === v);
  console.log('invalid / divide by zero / letters are refused?', (await calc('=10/0')) === null && (await calc('=abc')) === null && (await calc('=5+')) === null);
  console.log('parseMoney understands "="?', await page.evaluate(() => window.__ev("parseMoney('=1000-250') === 750 && parseMoney('1.234,50') === 1234.5")));
  // Campo Valor do tratamento
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click());
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => window.__ev("(function(){ try { openTreatmentModal(null, {patientId: state.patientsRaw[0].id}); return !!document.getElementById('trVal'); } catch (e) { return String(e); } })()"));
  if (opened === true) {
    await page.fill('#trVal', '=1500-200'); await page.press('#trVal', 'Tab');
    await page.fill('#trDesp', '= 2 x 50'); await page.press('#trDesp', 'Tab');
    const v = await page.evaluate(() => [trVal.value, trDesp.value, trFinal.value]);
    console.log('Valor and Descontos fields compute on leave and Valor Final updates?', /1\.300,00/.test(v[0]) && /100,00/.test(v[1]) && /1\.200,00/.test(v[2]), JSON.stringify(v));
  } else console.log('treatment window opened?', false, opened);
  console.log('no JS errors?', errors.length === 0, errors);
  fs.unlinkSync(evPage);
  await browser.close();
})();
