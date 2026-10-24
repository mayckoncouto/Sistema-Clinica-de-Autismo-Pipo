// Sala com profissionais responsáveis: o cadastro grava `responsaveis` e o profissional
// que só vê a própria agenda ganha o botão Salas com as salas pelas quais responde.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_resp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  const prof = await ev(`state.professionals[0].id`);
  await ev(`openRoomModal(findRoom("r1"))`);
  await page.waitForTimeout(300);
  check('responsaveis field exists in room window?', !!(await page.$('#rmResp')));
  await page.evaluate(() => { const b = document.querySelector('#rmRespMs .ms-btn'); b.click(); });
  await page.evaluate((pid) => { const c = document.querySelector('#rmResp input[value="' + pid + '"]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); }, prof);
  await page.evaluate(() => { const sv = document.getElementById('rmSave'); sv.disabled = false; sv.click(); });
  await page.waitForTimeout(600);
  const saved = await ev(`(findRoom("r1").responsaveis || []).join(",")`);
  check('room saved with responsaveis?', saved === prof, saved);

  // Profissional com agenda própria
  await ev(`window.pipoAuth = {profile: function(){ return {professional_id: ${JSON.stringify(prof)}}; }, isAdmin: function(){ return false; }, can: function(m, a){ return !(m === "agenda" && a === "edit"); }}`);
  const own = await ev(`agdOwnRooms().map(function(r){ return r.id; }).join(",")`);
  check('agdOwnRooms lists the responsible room?', own.indexOf("r1") !== -1, own);
  await ev(`AD.mode = "sala"`);
  const resSala = await ev(`agdResources().map(function(r){ return r.id; }).join(",")`);
  check('sala mode lists only own rooms?', resSala === own, resSala);
  await ev(`AD.mode = "prof"`);
  const resProf = await ev(`agdResources().map(function(r){ return r.id; }).join(",")`);
  check('prof mode lists only himself?', resProf === prof, resProf);
  await ev(`window.pipoAuth = null`);

  console.log('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
