// Intervenção ABA por unidade/clínica, Meta % e faixas etárias editáveis (Clínica → Atendimento).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_abaun.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (l, ok, x) => { console.log(l, !!ok, x === undefined ? '' : x); if (!ok) fails++; };

  // 1) padrão: ABA ligada, cores por idade, legenda, Meta 80
  let r = JSON.parse(await ev(`JSON.stringify({on: abaOn(), meta: abaMeta(), cor: patientColor({nome: "X", idade: 3, specHours: []}), noaba: document.body.classList.contains("no-aba"), leg: document.querySelectorAll("[data-age-legend] span").length})`));
  check('Padrão: ABA ligada, Meta 80%, cor por idade e legenda das faixas?', r.on && r.meta === 80 && r.cor === '#AECCE5' && !r.noaba && r.leg >= 3, JSON.stringify(r));

  // 2) unidade sem ABA: unitAbaOn falso
  r = await ev(`(function(){ var o = window.pipoAuth; window.pipoAuth = {unit: function(){ return "u1"; }}; var bak = state.units; state.units = [{id: "u1", name: "U1", aba: "Não"}]; var a = unitAbaOn(); state.units = [{id: "u1", name: "U1"}]; var b = unitAbaOn(); state.units = bak; window.pipoAuth = o; return a + "," + b; })()`);
  check('Unidade com Intervenção ABA = Não desliga; sem o campo = Sim?', r === 'false,true', r);

  // 3) Clínica com ABA desligada: sem cor, sem regra "não ABA", sem restrição de grupo, campos ABA escondidos
  r = JSON.parse(await ev(`(function(){ state.clinic = Object.assign({}, state.clinic || {}, {aba: "Não"}); abaUiApply(true);
    var p = state.patients[0];
    return JSON.stringify({on: abaOn(), cor: patientColor({nome: "X", idade: 3, specHours: []}), nao: isNaoABABooking({patient: p ? p.nome : "X"}, "", 1), grp: sgGroupCheck({id: "x"}, {service: "sessao"}, "seg-1", "07:20", {therapists: []}, {}),
      noaba: document.body.classList.contains("no-aba"), legHidden: Array.prototype.every.call(document.querySelectorAll("[data-age-legend]"), function(e){ return e.hidden; }),
      abaLeg: Array.prototype.every.call(document.querySelectorAll(".color-legend .aba-only"), function(e){ return getComputedStyle(e).display === "none"; })}); })()`));
  check('ABA desligada: sem cor por idade/ABA, regra "não ABA" e grupo não valem, legenda e campos ABA escondidos?', !r.on && r.cor === null && r.nao === false && r.grp === '' && r.noaba && r.legHidden && r.abaLeg, JSON.stringify(r));
  await ev(`(function(){ state.clinic = Object.assign({}, state.clinic, {aba: ""}); abaUiApply(true); })()`);

  // 4) Clínica → Atendimento: caixa, Meta % e faixas (quadros); salva aba, metaGrupo e config/age_bands
  await ev(`openClinicModal()`);
  await page.waitForSelector('#ovClinic');
  r = JSON.parse(await ev(`JSON.stringify({cb: !!document.getElementById("clAba"), meta: (document.getElementById("clMeta") || {}).value, bands: document.querySelectorAll("#clBands .cl-band").length})`));
  check('Atendimento mostra Intervenção ABA, Meta % (80) e as 3 faixas?', r.cb && r.meta === '80' && r.bands === 3, JSON.stringify(r));
  await page.fill('#clMeta', '70');
  await page.click('#clBandAdd');
  r = JSON.parse(await ev(`JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#clBands .cl-band"), function(x){ return [x.querySelector(".clb-min").value, x.querySelector(".clb-max").value]; }))`));
  check('+ Incluir Faixa cria a 4ª faixa começando depois da última?', r.length === 4 && r[3][0] === '11', JSON.stringify(r));
  // 10+ sem limite e a nova 11+: precisa dar erro de sobreposição / sem limite
  await page.click('#clSave'); await page.waitForTimeout(300);
  let still = await page.$('#ovClinic');
  check('Faixa sem limite antes de outra é recusada?', !!still);
  await ev(`(function(){ var rows = document.querySelectorAll("#clBands .cl-band"); rows[2].querySelector(".clb-max").value = "10"; rows[3].querySelector(".clb-max").value = ""; rows[3].querySelector(".clb-max").dispatchEvent(new Event("input", {bubbles: true})); })()`);
  await page.click('#clSave');
  await page.waitForTimeout(400);
  const ok = await page.$('.confirm-overlay button.primary'); if (ok){ await ok.click(); await page.waitForTimeout(400); }
  await page.waitForFunction(() => !document.getElementById('ovClinic'), null, {timeout: 5000}).catch(() => {});
  r = JSON.parse(await ev(`JSON.stringify({meta: abaMeta(), clin: (window.__STORE__["config/clinic"] || {}).metaGrupo, fx: ((window.__STORE__["config/age_bands"] || {}).faixas || []).map(function(b){ return b.id + ":" + b.min + "-" + (b.max == null ? "" : b.max); }), bands: AGE_BANDS.length, last: AGE_BANDS[3] && AGE_BANDS[3].label})`));
  check('Salvou Meta 70% e as 4 faixas (ids antigos mantidos)?', r.meta === 70 && r.clin === 70 && r.fx.length === 4 && r.fx[0] === '0-4:0-4' && r.fx[2] === '10+:10-10' && r.last === '11+ anos', JSON.stringify(r));
  const title = await ev(`(function(){ openPlConfModal(); return new Promise(function(res){ setTimeout(function(){ res(document.getElementById("apqOut") ? document.getElementById("apqOut").innerText : ""); }, 800); }); })()`);
  check('Conferência usa o título Meta % (70%) quando há paciente ABA?', !/Meta de Grupo/.test(title), title.slice(0, 200));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
