// Guia (Ajuda): tela própria, menu por área, busca sem acento, botão "?" em cada
// tela abrindo o tópico dela, sem Novidades, filtro por permissão e celular.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForTimeout(600);

  await page.evaluate(() => window.pipoOpenHelp());
  await page.waitForTimeout(200);
  console.log('Ajuda opens the guide screen with the overview topic?', await page.isVisible('#tab-ajuda') && /Visão geral/.test(await page.textContent('#helpBody')));
  const groups = await page.$$eval('#helpNav .help-grp', (a) => a.map((x) => x.textContent));
  console.log('menu has the main areas (Cadastros, Planner, Agenda, Prontuário, Relatórios, Acesso)?', ['Cadastros', 'Planner', 'Agenda', 'Prontuário', 'Relatórios', 'Acesso'].every((g) => groups.includes(g)), groups.join(','));
  await page.click('#helpNav [data-help-go="tratamentos"]');
  const tb = await page.textContent('#helpBody');
  console.log('topic shows purpose, steps, rules and who can use?', /Como fazer/.test(tb) && /Regras e avisos/.test(tb) && /Quem pode usar/.test(tb) && /só um tratamento Ativo/.test(tb));
  await page.fill('#helpSearch', 'CANCELADO'); await page.dispatchEvent('#helpSearch', 'input');
  const res = await page.$$eval('#helpBody .help-results li', (a) => a.map((x) => x.textContent));
  console.log('search ignores case/accents and finds the cancellation topics?', res.some((t) => /Motivos de cancelamento/.test(t)) && res.some((t) => /Tratamentos/.test(t)));
  await page.fill('#helpSearch', ''); await page.dispatchEvent('#helpSearch', 'input');
  console.log('no "Novidades" in the guide menu?', !(await page.$('#helpNav [data-help-go="novidades"]')));

  // "?" na tela de Pacientes e no Planner abre o tópico certo.
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#tab-pacientes .help-q'); await page.waitForTimeout(200);
  console.log('"?" on Pacientes opens the Pacientes topic?', await page.isVisible('#tab-ajuda') && (await page.textContent('#helpBody .help-title')) === 'Pacientes');
  await page.$eval('#mainTabs button[data-tab=agenda]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#tab-agenda .help-q'); await page.waitForTimeout(200);
  console.log('"?" on the Planner opens the Planner topic?', /Planner/.test(await page.textContent('#helpBody .help-title')));
  const qCount = await page.$$eval('.help-q', (a) => a.length);
  console.log('every main screen has a "?" button (12+)?', qCount >= 12, qCount);

  // Permissão: sem "Tratamentos – valores" o tópico de valores some.
  await page.evaluate(() => { window.pipoAuth = { can: (m) => m !== 'tratamentos_valores' && m !== 'usuarios', isAdmin: () => false, onProfile(){}, profile: () => null }; window.pipoOpenHelp(); });
  await page.waitForTimeout(200);
  console.log('topics follow the permission level (values and Usuários hidden without the permission)?', !(await page.$('#helpNav [data-help-go="tratamentos-valores"]')) && !(await page.$('#helpNav [data-help-go="usuarios"]')) && !!(await page.$('#helpNav [data-help-go="tratamentos"]')));
  await page.evaluate(() => { delete window.pipoAuth; });

  // Celular: tópicos recolhidos atrás do botão.
  const m = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true });
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">');
  const mp = path.join(__dirname, 'page_help_m.html'); fs.writeFileSync(mp, src);
  await m.goto('file://' + mp); await m.waitForTimeout(800);
  await m.evaluate(() => window.pipoOpenHelp()); await m.waitForTimeout(200);
  const before = await m.isVisible('#helpNav');
  await m.click('#helpNavToggle');
  console.log('mobile: topic list collapsed until "Tópicos" is tapped, no side scroll?', !before && await m.isVisible('#helpNav') && (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  fs.unlinkSync(mp);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})();
