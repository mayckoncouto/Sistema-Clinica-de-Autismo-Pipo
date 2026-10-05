// Agenda: a janela de atendimento recusa profissional fora do horário de trabalho
// (cadastro do colaborador); dentro do horário segue para as outras checagens.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_wh.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  // Ana trabalha só segunda de manhã (08:00–12:00); terça não trabalha.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const pr = (await db.doc('config/professionals').get()).data();
    const off = { manha: { inicio: '', fim: '' }, tarde: { inicio: '', fim: '' } };
    pr.list[0].horarios = { seg: { manha: { inicio: '08:00', fim: '12:00' }, tarde: { inicio: '', fim: '' } }, ter: off, qua: off, qui: off, sex: off, sab: off, dom: off };
    await db.doc('config/professionals').set(pr);
  });
  await page.waitForTimeout(300);

  // Data numa segunda-feira e numa terça.
  const mon = '2030-01-07', tue = '2030-01-08';
  const trySave = async (date, time) => {
    await ev(`window.__checked = 0; agdConflictsFor = function(){ window.__checked++; return Promise.reject(new Error("parou aqui")); }; agdOpenModal({date: "${date}", time: "${time}", profId: "ana-terapeuta"})`);
    await page.waitForSelector('#agdSave');
    await page.fill('#agdPac', 'Paciente Um');
    await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
    await page.click('#agdSave');
    await page.waitForTimeout(200);
    const r = { toast: await page.innerText('#toastHost'), checked: await page.evaluate(() => window.__checked) };
    await page.click('#agdCancel');
    return r;
  };
  const a = await trySave(mon, '14:10');
  console.log('Monday afternoon (outside her hours) is refused with the hours shown?', a.checked === 0 && /Fora do horário de trabalho de Ana/.test(a.toast) && /08:00–12:00/.test(a.toast), JSON.stringify(a));
  const b = await trySave(tue, '08:00');
  console.log('Tuesday (does not work) is refused?', b.checked === 0 && /não trabalha neste dia/.test(b.toast), JSON.stringify(b));
  const c = await trySave(mon, '08:00');
  console.log('Monday 08:00 (inside her hours) goes on to the other checks?', c.checked === 1 && !/Fora do horário de trabalho/.test(c.toast), JSON.stringify(c));

  // Atendimento antigo fora do horário: editar sem mudar profissional/data/hora continua possível.
  await ev(`window.__checked = 0; agdOpenModal({row: {id: "x1", date: "${mon}", time: "14:10", professional_id: "ana-terapeuta", patient: "Paciente Um", service: "sessao", room_id: null, note: ""}})`);
  await page.waitForSelector('#agdSave');
  await page.click('#agdSave');
  await page.waitForTimeout(200);
  console.log('editing an old out-of-hours booking in the same slot is not blocked?', await page.evaluate(() => window.__checked) === 1);
  await page.click('#agdCancel').catch(() => {});

  // Na grade: atendimento já marcado fora do horário (Ana, segunda 14:10) abre os Detalhes ao clicar; Editar abre a janela.
  const opened = await ev(`(function(){
    agdClient = function(){ return null; };
    AD.error = ""; AD.loaded = true; AD.view = "dia"; AD.mode = "prof"; AD.sel = "ana-terapeuta"; AD.date = new Date(2030, 0, 7);
    AD.rows = {x2: {id: "x2", date: "2030-01-07", time: "14:10", professional_id: "ana-terapeuta", patient: "Paciente Um", service: "sessao", room_id: null, note: ""}};
    document.getElementById("tab-agendadia").hidden = false;
    agdRender();
    var td = document.querySelector('#agdGrid td.agd-slot[data-t="14:10"]');
    var main = td && td.querySelector('.book[data-id="x2"] .book-main');
    if (!main) return "no cell: " + [].map.call(document.querySelectorAll('#agdGrid td[data-t="14:10"]'), function(t){ return t.className + '/' + t.innerHTML.slice(0, 80); }).join(' ; ') + ' :: ' + (document.getElementById('agdGrid') ? '' : document.getElementById('tab-agendadia').innerText.slice(0, 200));
    main.click();
    var det = !!document.getElementById("ovAgdDet"), ed = document.getElementById("agdDetEdit");
    if (ed) ed.click();
    return det && !!document.getElementById("agdSave");
  })()`);
  console.log('an existing booking out of hours opens the details and "Editar agendamento" opens the edit window?', opened === true, opened);
  await page.click('#agdCancel').catch(() => {});

  // Janela do colaborador: se o banco recusar o cadastro do profissional, não diz "Alterado"
  // e a janela continua aberta com o motivo.
  await ev(`(function(){ var orig = db.doc; db.doc = function(p){ var r = orig.call(db, p); if (p === "config/professionals") r.set = function(){ return Promise.reject(new Error("sem permissão no banco")); }; return r; }; })()`);
  await ev(`openProfessionalModal(findProfessional("ana-terapeuta"))`);
  await page.waitForSelector('#profSave');
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await page.click('#profSave');
  await page.waitForTimeout(400);
  const toast2 = await page.innerText('#toastHost');
  console.log('save refused by the database keeps the window open and explains why (no "Alterado")?', (await page.locator('#ovProf').count()) === 1 && /sem permissão no banco/.test(toast2) && !/Alterado/.test(toast2), JSON.stringify(toast2));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
