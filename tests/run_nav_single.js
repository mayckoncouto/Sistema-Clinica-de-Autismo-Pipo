// Menus do topo (Cadastros, Planner): com UMA opção permitida, o botão vira
// essa opção direto (sem menu suspenso); com duas ou mais, menu como sempre.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_nav.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');

  const setPerm = (perms) => page.evaluate((p) => {
    window.pipoAuth = { can: (m, a) => !!(p[m] && p[m].indexOf(a) !== -1), canDefault: () => true, isAdmin: () => false, onProfile(){}, profile: () => null };
    window.__ev("renderNavMenus()");
  }, perms);

  // Só Pacientes em Cadastros e só Planner no menu Planner
  await setPerm({ pacientes: ['view'], planner: ['view'] });
  const cad = page.locator('#cadBtn');
  console.log('only Pacientes allowed: button reads "Pacientes" (no arrow)?', (await cad.innerText()).trim() === 'Pacientes' && (await cad.locator('svg').count()) === 0);
  console.log('button has no menu popup?', (await cad.getAttribute('aria-haspopup')) === null);
  await cad.click();
  await page.waitForTimeout(200);
  console.log('click opens the Pacientes screen directly (menu stays closed)?', await page.locator('#cadMenu').isHidden() &&
    await page.evaluate(() => window.__ev("state.tab") === 'pacientes'));
  console.log('the button is marked active on its screen?', await cad.evaluate((b) => b.classList.contains('active')));
  console.log('only Planner allowed: Planner button reads "Planner"?', (await page.locator('#plBtn').innerText()).trim() === 'Planner');
  await page.click('#plBtn');
  await page.waitForTimeout(200);
  console.log('click opens the Planner directly?', await page.evaluate(() => window.__ev("state.tab") === 'planner') && await page.locator('#plMenu').isHidden());

  // Pacientes + Tratamentos: volta a ser o menu "Cadastros"
  await setPerm({ pacientes: ['view'], tratamentos: ['view'], planner: ['view'] });
  console.log('two allowed: button reads "Cadastros" with arrow?', /^Cadastros/.test((await cad.innerText()).trim()) && (await cad.locator('svg').count()) === 1);
  await cad.click();
  const items = await page.locator('#cadMenu button:visible').allInnerTexts();
  console.log('menu lists exactly Pacientes and Tratamentos?', items.length === 2 && items[0] === 'Pacientes' && items[1] === 'Tratamentos');
  await page.keyboard.press('Escape');

  // Nenhuma: o botão some
  await setPerm({ planner: ['view'] });
  console.log('none allowed: Cadastros button hidden?', await cad.isHidden());

  // Celular: grupo com uma opção aparece direto
  await setPerm({ pacientes: ['view'], planner: ['view'] });
  await page.evaluate(() => window.__ev("mnavRender()"));
  const mob = await page.evaluate(() => ({ grp: [...document.querySelectorAll('#mnavPanel .mnav-grp')].map((b) => b.textContent.trim()), direct: !!document.querySelector('#mnavPanel > button[data-mnav="pacientes"]') }));
  console.log('mobile menu: Pacientes shown directly, no Cadastros group?', mob.direct && !mob.grp.some((t) => /Cadastros/.test(t)));

  await page.evaluate(() => { delete window.pipoAuth; window.__ev("renderNavMenus()"); });
  console.log('back to all options: Cadastros menu again?', /^Cadastros/.test((await cad.innerText()).trim()));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
