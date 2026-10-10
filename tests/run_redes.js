// Redes sociais da clínica (2026-10-10): cadastro na janela da Clínica (rede + link, "+ Inserir",
// ▲▼, ✕, "Outro" com nome), link inválido recusado, mensagem do link de cadastro e rodapé das
// impressões. Cria tests/page_rs.html com um "eval" para chamar o app direto. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_rs.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + pg);
  await page.waitForTimeout(700);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };

  check('icon bank loaded with the main networks?', await ev('PIPO_REDES.list.map(function(r){ return r.id; }).join(",")') === 'instagram,facebook,youtube,tiktok,whatsapp,maps,site,linkedin,email,outro');
  check('without networks: no text in the message, no print footer?', await ev('clinicSocialText() === "" && printSocialHtml() === "" && intakeMessage("novo", "", "https://x/c/1").indexOf("Conheça") === -1'));

  await ev('openClinicModal()'); await page.waitForSelector('#ovClinic');
  check('Clínica window has the "Redes sociais" group, empty?', /Redes sociais/.test(await page.textContent('#ovClinic')) && /Nenhuma rede/.test(await page.textContent('#clSocs')));
  await page.click('#clSocAdd'); await page.click('#clSocAdd');
  let rows = await page.$$eval('#clSocs .cl-soc select[data-sk="rede"]', (a) => a.map((s) => s.value));
  check('"+ Inserir" adds rows with the next network not used yet?', JSON.stringify(rows) === '["instagram","facebook"]', rows);
  await page.fill('#clSocs [data-soc="0"] [data-sk="url"]', 'instagram.com/clinica');
  await page.fill('#clSocs [data-soc="1"] [data-sk="url"]', 'facebook.com/clinica');
  await page.$eval('#clSocs [data-soc="1"] select[data-sk="rede"]', (s) => { s.value = 'outro'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  check('"Outro" asks for a name and keeps the link typed?', !!(await page.$('#clSocs [data-soc="1"] [data-sk="nome"]')) && (await page.inputValue('#clSocs [data-soc="1"] [data-sk="url"]')) === 'facebook.com/clinica');
  await page.fill('#clSocs [data-soc="1"] [data-sk="nome"]', 'Blog');
  await page.click('#clSocs [data-soc="1"] [data-socmv="-1"]');
  rows = await page.$$eval('#clSocs .cl-soc select[data-sk="rede"]', (a) => a.map((s) => s.value));
  check('▲ moves the row up?', JSON.stringify(rows) === '["outro","instagram"]', rows);
  await page.click('#clSocAdd');
  await page.fill('#clSocs [data-soc="2"] [data-sk="url"]', 'javascript:alert(1)');
  await page.click('#clSave'); await page.waitForTimeout(200);
  check('invalid link is refused with the network name?', !!(await page.$('#ovClinic')) && await ev('!(state.clinic && state.clinic.redes)'));
  await page.click('#clSocs [data-soc="2"] [data-socdel]');
  await page.click('#clSave'); await page.waitForTimeout(400);
  const saved = await ev('JSON.stringify(state.clinic && state.clinic.redes)');
  check('saved in order, with the name of "Outro"?', saved === '[{"rede":"outro","url":"facebook.com/clinica","nome":"Blog"},{"rede":"instagram","url":"instagram.com/clinica"}]', saved);
  const msg = await ev('intakeMessage("novo", "", "https://x/c/AB12")');
  check('link message ends with the networks?', /\n\nConheça mais sobre nosso trabalho:\nBlog: https:\/\/facebook\.com\/clinica\nInstagram: https:\/\/instagram\.com\/clinica$/.test(msg), msg);
  const foot = await ev('printSocialHtml()');
  check('print footer with icons and addresses?', /Conheça mais sobre nosso trabalho/.test(foot) && (foot.match(/<svg/g) || []).length === 2 && /instagram\.com\/clinica/.test(foot), foot.length);
  await ev('openClinicModal()'); await page.waitForSelector('#ovClinic');
  check('reopening shows the saved rows?', (await page.$$('#clSocs .cl-soc')).length === 2 && (await page.inputValue('#clSocs [data-soc="0"] [data-sk="nome"]')) === 'Blog');
  await page.click('#clCancel');

  // Celular: a linha quebra e nada passa da janela.
  await page.setViewportSize({width: 390, height: 800}); await ev('openClinicModal()'); await page.waitForSelector('#ovClinic');
  const fit = await page.evaluate(() => { const m = document.querySelector('#ovClinic .modal').getBoundingClientRect(); return [...document.querySelectorAll('#clSocs .cl-soc *')].every((e) => e.getBoundingClientRect().right <= m.right + 1); });
  check('phone: network rows fit inside the window?', fit);
  await page.click('#clCancel');

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
