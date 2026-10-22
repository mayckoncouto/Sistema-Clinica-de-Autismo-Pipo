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

  // 3) Unidade sem ABA: sem cor, sem regra "não ABA", sem restrição de grupo, campos ABA escondidos
  r = JSON.parse(await ev(`(function(){ window.__unitAbaBak = unitAbaOn; unitAbaOn = function(){ return false; }; abaUiApply(true);
    var p = state.patients[0];
    return JSON.stringify({on: abaOn(), cor: patientColor({nome: "X", idade: 3, specHours: []}), nao: isNaoABABooking({patient: p ? p.nome : "X"}, "", 1), grp: sgGroupCheck({id: "x"}, {service: "sessao"}, "seg-1", "07:20", {therapists: []}, {}),
      noaba: document.body.classList.contains("no-aba"), legHidden: Array.prototype.every.call(document.querySelectorAll("[data-age-legend]"), function(e){ return e.hidden; }),
      abaLeg: Array.prototype.every.call(document.querySelectorAll(".color-legend .aba-only"), function(e){ return getComputedStyle(e).display === "none"; })}); })()`));
  check('Unidade sem ABA: sem cor por idade/ABA, regra "não ABA" e grupo não valem, legenda e campos ABA escondidos?', !r.on && r.cor === null && r.nao === false && r.grp === '' && r.noaba && r.legHidden && r.abaLeg, JSON.stringify(r));
  await ev(`openClinicModal()`);
  await page.waitForSelector('#ovClinic');
  check('Unidade sem ABA: Clínica sem Meta %?', !(await page.$('#clMeta')));
  await page.click('#clClose');
  await ev(`(function(){ unitAbaOn = window.__unitAbaBak; abaUiApply(true); })()`);

  // 4) Clínica → Atendimento: só a Meta % (sem a caixa e sem as faixas)
  await ev(`openClinicModal()`);
  await page.waitForSelector('#ovClinic');
  r = JSON.parse(await ev(`JSON.stringify({cb: !!document.getElementById("clAba"), meta: (document.getElementById("clMeta") || {}).value, bands: !!document.getElementById("clBands")})`));
  check('Clínica mostra só Meta % (80), sem Intervenção ABA nem Faixas?', !r.cb && r.meta === '80' && !r.bands, JSON.stringify(r));
  await page.fill('#clMeta', '70');
  await page.click('#clSave');
  await page.waitForTimeout(400);
  const ok = await page.$('.confirm-overlay button.primary'); if (ok){ await ok.click(); await page.waitForTimeout(400); }
  await page.waitForFunction(() => !document.getElementById('ovClinic'), null, {timeout: 5000}).catch(() => {});
  check('Meta % salva (70)?', await ev(`abaMeta()`) === 70 && await ev(`(window.__STORE__["config/clinic"] || {}).metaGrupo`) === 70);

  // 5) Unidades → Outras Opções → Faixas Etárias (opção da empresa, fora do cadastro da unidade)
  await ev(`(function(){ state.units = [{id: "u1", name: "Unidade Um"}]; openRegistryItem("unidades", state.units[0]); })()`);
  await page.waitForSelector('#ovReg');
  check('Janela da unidade não tem mais as faixas?', !(await page.$('#abBands')));
  await page.click('#regCancel').catch(() => ev(`document.getElementById("modalHost").innerHTML = ""`));
  await ev(`document.getElementById("modalHost").innerHTML = ""`);
  await page.$eval('#mainTabs button[data-tab=unidades]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#unMoreBtn'); await page.click('#unBandsBtn');
  await page.waitForSelector('#abBands');
  check('Unidade mostra as 3 faixas no estilo dos quadros de Salas?', await ev(`(function(){ var rs = document.querySelectorAll("#abBands .cl-band"), r = rs[0]; return rs.length === 3 && !!(r.querySelector(".room-dot") && r.querySelector(".rn").textContent === "0–4 anos" && r.querySelector("[data-band-ed]") && r.querySelector("[data-band-rm]") && !r.querySelector("input")); })()`));
  await page.click('#abBandAdd');
  await page.waitForSelector('#ovBand');
  check('+ Incluir Faixa abre a janela já começando depois da última (11)?', await page.$eval('#bdMin', (e) => e.value) === '11');
  await page.click('#bdSave'); await page.waitForTimeout(200);
  r = JSON.parse(await ev(`JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#abBands .cl-band .rn"), function(x){ return x.textContent; }))`));
  check('4ª faixa no quadro?', r.length === 4 && r[3] === '11+ anos', JSON.stringify(r));
  await page.click('#abSave'); await page.waitForTimeout(300);
  check('Faixa sem limite antes de outra é recusada?', !!(await page.$('#ovAgeBands')));
  await ev(`document.querySelectorAll("#abBands [data-band-ed]")[2].click()`);
  await page.waitForSelector('#ovBand');
  await page.fill('#bdMax', '10');
  await page.click('#bdSave'); await page.waitForTimeout(200);
  await page.click('#abSave');
  await page.waitForFunction(() => !document.getElementById('ovAgeBands'), null, {timeout: 5000}).catch(() => {});
  await page.waitForTimeout(300);
  r = JSON.parse(await ev(`JSON.stringify({fx: ((window.__STORE__["config/age_bands"] || {}).faixas || []).map(function(b){ return b.id + ":" + b.min + "-" + (b.max == null ? "" : b.max); }), bands: AGE_BANDS.length, last: AGE_BANDS[3] && AGE_BANDS[3].label})`));
  check('Salvou as 4 faixas pela janela Faixas Etárias (ids antigos mantidos)?', r.fx.length === 4 && r.fx[0] === '0-4:0-4' && r.fx[2] === '10+:10-10' && r.last === '11+ anos', JSON.stringify(r));
  const title = await ev(`(function(){ openPlConfModal(); return new Promise(function(res){ setTimeout(function(){ res(document.getElementById("apqOut") ? document.getElementById("apqOut").innerText : ""); }, 800); }); })()`);
  check('Conferência usa o título Meta % (70%) quando há paciente ABA?', !/Meta de Grupo/.test(title), title.slice(0, 200));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  fs.unlinkSync(evPage);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
