// Auto Planner: grade própria (registros separados do Planner), trocar de tela, Enviar para o Planner e remoção.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_apg.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const check = (label, ok, extra) => console.log(label, !!ok, extra === undefined ? '' : extra);
  const store = (prefix) => ev(`JSON.stringify(Object.keys(window.__STORE__).filter(function(k){ return k.indexOf("${prefix}/") === 0; }).sort().filter(function(k){ return Object.keys(window.__STORE__[k].bookings || {}).length; }).map(function(k){ return [k, window.__STORE__[k].bookings]; }))`);
  const books = () => page.evaluate(() => Array.from(document.querySelectorAll('#gridHost .book-main')).filter((e) => e.textContent.trim() !== '+' && !/Reuni/.test(e.textContent)).length);
  const openMenu = async (id) => { await page.click('#plToolsBtn'); await page.click('#' + id); };

  const real0 = await store('schedule');
  const plannerHtml = await page.innerHTML('#gridHost');
  check('Planner mode: Enviar para o Planner / Remover are hidden?', await page.$eval('#apSendPlannerBtn', (b) => b.hidden) && await page.$eval('#apUnsendBtn', (b) => b.hidden));

  // abre o Auto Planner: sem registros próprios, a grade fica vazia (nada do Planner aparece)
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForTimeout(400);
  check('Auto Planner starts empty (only the automatic Monday Reunião Clínica)?', (await books()) === 0, await books());
  check('Enviar para o Planner / Remover visible; Trocar Profissional hidden?', !(await page.$eval('#apSendPlannerBtn', (b) => b.hidden)) && !(await page.$eval('#apUnsendBtn', (b) => b.hidden)) && (await page.$eval('#swapProfBtn', (b) => b.hidden)));
  check('Planner menu marks Auto Planner as the open item?', await ev(`PL_ITEMS.filter(function(i){ return i.key === "autoplanner"; })[0].isOn() && !PL_ITEMS[0].isOn()`));

  // marca à mão no Auto Planner (qua 1ª semana, Ana 09:20 = livre no Planner; seg 07:20 Ana = ocupado no Planner)
  await ev(`(async function(){
    var db = await window.claude.use('db');
    await db.doc('autoplan/qua-1').set({bookings: {"09:20|r1|r1-t1": {patient: "Ana Azul", note: "", auto: true}}});
    await db.doc('autoplan/seg-1').set({bookings: {"07:20|r1|r1-t1": {patient: "Bruno Verde", note: ""}, "10:00|r1|r1-t1": {patient: "Duda Vermelho", note: ""}, "10:00|r1|r1-t2": {patient: "", lock: true}}});
  })()`);
  await page.waitForTimeout(300);
  await page.$eval('#daySeg button[data-day="seg"]', (b) => b.click());
  await page.waitForTimeout(300);
  check('Auto Planner shows its own bookings (2 of Monday week 1)?', (await books()) >= 2, await books());
  check('Planner store still the same?', (await store('schedule')) === real0);

  // desfazer do Auto Planner não mistura com o do Planner
  check('Planner undo stack kept apart?', await ev(`bookingHistory.undo.length === 0`));

  // Enviar para o Planner: qua 09:20 Ana livre vai; seg 07:20 Ana ocupada (Paciente Um) é pulada; seg 10:00 Duda vai; bloqueio do Auto Planner não vai
  await openMenu('apSendPlannerBtn');
  await page.waitForSelector('#ovConfirm, .confirm-overlay');
  const txt = await page.innerText('.confirm-overlay');
  check('preview says how many go and how many stay out?', /2 atendimentos/.test(txt) && /1.*ficam de fora/s.test(txt), txt.replace(/\s+/g, ' ').slice(0, 220));
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForTimeout(400);
  check('second confirmation asked (real Planner)?', /Planner de verdade/.test(await page.innerText('.confirm-overlay')));
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForTimeout(500);
  const sent = JSON.parse(await store('schedule'));
  const qua = (sent.find((x) => x[0] === 'schedule/qua-1') || [0, {}])[1];
  const seg = (sent.find((x) => x[0] === 'schedule/seg-1') || [0, {}])[1];
  check('Ana Azul went to the Planner marked via=autoplanner (and auto flag dropped)?', qua['09:20|r1|r1-t1'] && qua['09:20|r1|r1-t1'].via === 'autoplanner' && !qua['09:20|r1|r1-t1'].auto, JSON.stringify(qua));
  check('occupied cell in the Planner kept Paciente Um?', seg['07:20|r1|r1-t1'].patient === 'Paciente Um');
  check('the lock of the Auto Planner did not go?', !seg['10:00|r1|r1-t2']);
  check('Duda went to the free cell?', seg['10:00|r1|r1-t1'] && seg['10:00|r1|r1-t1'].patient === 'Duda Vermelho');

  // voltar ao Planner: grade mostra o Planner (agora com os enviados) e some o controle do Auto Planner
  await page.$eval('#mainTabs button[data-tab="planner"]', (b) => b.click());
  await page.waitForFunction(() => !document.getElementById('tab-planner').classList.contains('pl-auto'));
  await page.waitForTimeout(400);
  check('Planner back: hash #planner, title is Planner, books visible?', (await page.evaluate(() => location.hash)) === '#planner' && (await page.$eval('#plAutoTitle', (b) => !b.hidden && b.textContent === 'Planner')) && (await books()) > 0);
  check('Planner reads schedule/* again?', await ev(`!PLA.on && schedPath("seg-1") === "schedule/seg-1"`));
  check('Planner and Auto Planner undo stacks swapped back?', await ev(`bookingHistory.undo.length === 0`));

  // remoção: só o que veio do Auto Planner
  await page.$eval('#mainTabs button[data-tab="autoplanner"]', (b) => b.click());
  await page.waitForFunction(() => document.getElementById('tab-planner').classList.contains('pl-auto'));
  await openMenu('apUnsendBtn');
  await page.waitForSelector('.confirm-overlay');
  check('removal asks for exactly the 2 sent bookings?', /2 atendimentos/.test(await page.innerText('.confirm-overlay')));
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForTimeout(400);
  check('second confirmation asked (real Planner)?', /Planner de verdade/.test(await page.innerText('.confirm-overlay')));
  await page.click('.confirm-overlay button.primary, .confirm-overlay .btn:not(.ghost)');
  await page.waitForTimeout(500);
  check('Planner back to what it was before sending?', (await store('schedule')) === real0);
  check('Auto Planner records kept after the removal?', JSON.parse(await store('autoplan')).length >= 2);

  // permissões: no Auto Planner incluir/editar/excluir seguem o módulo dele; ver não muda
  const perm = await ev(`(function(){
    var seen = [];
    window.pipoAuth = {can: function(m, a){ seen.push(m + ":" + a); return m === "autoplanner" ? a !== "delete" : true; }};
    var r = [can("planner", "create"), can("planner", "delete"), can("bloqueio_horario", "create"), can("bloqueio_horario", "delete")];
    PLA.on = false;
    var r2 = can("planner", "delete");
    PLA.on = true; delete window.pipoAuth;
    return JSON.stringify(r.concat([r2]));
  })()`);
  check('in Auto Planner mode can("planner"/"bloqueio_horario") follows the autoplanner module?', perm === '[true,false,true,false,true]', perm);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
