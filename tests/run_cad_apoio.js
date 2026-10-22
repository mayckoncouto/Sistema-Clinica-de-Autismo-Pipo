// Cadastros de apoio em Outras Opções da tela principal (2026-10-21). Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let fails = 0;
  const check = (l, ok, x) => { console.log(l, !!ok, x === undefined ? '' : x); if (!ok) fails++; };
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_apoio.html'); fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  await page.goto('file://' + pg);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  await page.waitForSelector('td.slotcell');
  // Com permissão em tudo (pipoAuth simulado), os cadastros de apoio saem do menu Cadastros.
  await page.evaluate(() => { window.pipoAuth = { can: () => true, canDefault: () => true, isAdmin: () => true, isManager: () => true, canTool: () => true }; }); await ev('renderCadMenu()');
  const menu = await page.$$eval('#cadMenu [data-nav]', (e) => e.map((x) => x.getAttribute('data-nav')));
  check('menu Cadastros sem os cadastros de apoio', ['medicos', 'escolas', 'diagnosticos', 'origens', 'motivosbloq', 'tipostrat', 'motivos', 'tiposcolab', 'cbo', 'conselhos', 'grupos'].every((k) => menu.indexOf(k) === -1), menu.join(','));
  check('menu Cadastros com 9 itens', menu.length === 9, menu.join(','));
  // Pacientes → Outras Opções → Médicos
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click());
  await page.click('#patMoreBtn');
  const pm = await page.$$eval('#patMoreMenu [data-nav-sub]', (e) => e.map((x) => x.textContent));
  check('Pacientes → Outras Opções lista Médicos, Escolas, Diagnósticos, Origens e Motivos de Bloqueio', pm.join('|') === 'Médicos|Escolas|Diagnósticos|Origens|Motivos de Bloqueio', pm.join('|'));
  await page.click('#patMoreMenu [data-nav-sub="medicos"]');
  await page.waitForTimeout(150);
  check('clicar abre a tela Médicos e fecha o menu', !(await page.$eval('#tab-medicos', (s) => s.hidden)) && await page.$eval('#patMoreMenu', (m) => m.hidden));
  // Tratamentos → Outras Opções
  await page.$eval('#mainTabs button[data-tab="tratamentos"]', (b) => b.click());
  await page.click('[data-io-wrap="tratamentos"] [data-io-btn]');
  const tm = await page.$$eval('[data-io-wrap="tratamentos"] [data-nav-sub]', (e) => e.map((x) => x.textContent));
  check('Tratamentos → Outras Opções lista Tipos de Tratamento e Motivos de Cancelamento', tm.join('|') === 'Tipos de Tratamento|Motivos de Cancelamento', tm.join('|'));
  await page.click('[data-io-wrap="tratamentos"] [data-nav-sub="tipostrat"]'); await page.waitForTimeout(150);
  check('abre Tipos de Tratamento', !(await page.$eval('#tab-tipostrat', (s) => s.hidden)));
  // Colaboradores → Outras Opções
  await page.$eval('#mainTabs button[data-tab="colaboradores"]', (b) => b.click());
  check('Colaboradores ganhou Outras Opções', !(await page.$eval('#staffMoreWrap', (w) => w.hidden)));
  await page.click('#staffMoreBtn');
  const cm = await page.$$eval('#staffMoreMenu [data-nav-sub]', (e) => e.map((x) => x.textContent));
  check('Colaboradores → Outras Opções lista Tipos de Colaborador, CBO e Conselhos', cm.join('|') === 'Tipos de Colaborador|CBO|Conselhos', cm.join('|'));
  await page.click('#staffMoreMenu [data-nav-sub="cbo"]'); await page.waitForTimeout(150);
  check('abre CBO', !(await page.$eval('#tab-cbo', (s) => s.hidden)));
  // Sem acesso à tela principal: o cadastro de apoio volta para o menu.
  await page.evaluate(() => { window.pipoAuth.can = (m) => m !== 'pacientes'; }); await ev('renderCadMenu()');
  const menu2 = await page.$$eval('#cadMenu [data-nav]', (e) => e.map((x) => x.getAttribute('data-nav')));
  check('sem Pacientes, Médicos volta para o menu Cadastros', menu2.indexOf('medicos') !== -1 && menu2.indexOf('pacientes') === -1, menu2.join(','));
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(fails ? 'SOME FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
