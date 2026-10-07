// Horários do Planner e da Agenda = horário da clínica + duração padrão: cabem só
// sessões inteiras; a linha do almoço e a linha final mostram a saída da última
// sessão da manhã e da tarde.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cs.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('#gridHost .book');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);

  // Clínica: seg–qui 07:20–12:00 / 13:30–18:10, sexta tarde até 17:30; duração 50 min.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const day = (fim) => ({ ativo: true, manha: { inicio: '07:20', fim: '12:00' }, tarde: { inicio: '13:30', fim: fim } });
    const off = { ativo: false, manha: { inicio: '', fim: '' }, tarde: { inicio: '', fim: '' } };
    await db.doc('config/clinic').set({ duracao: 50, horarios: { seg: day('18:10'), ter: day('18:10'), qua: day('18:10'), qui: day('18:10'), sex: day('17:30'), sab: off, dom: off } });
  });
  await page.waitForTimeout(400);
  const days = await ev(`JSON.stringify(DAYS.map(function(d){ return d.key + ":" + d.morning.join(",") + "|" + d.afternoon.join(","); }))`);
  const seg = JSON.parse(days).find((d) => d.startsWith('seg'));
  const sex = JSON.parse(days).find((d) => d.startsWith('sex'));
  console.log('50 min: only whole sessions fit (morning 07:20…10:40, afternoon 13:30…16:50)?', seg === 'seg:07:20,08:10,09:00,09:50,10:40|13:30,14:20,15:10,16:00,16:50', seg);
  console.log('Friday afternoon (until 17:30) has one session less?', sex === 'sex:07:20,08:10,09:00,09:50,10:40|13:30,14:20,15:10,16:00', sex);

  // Planner: linha do fim da manhã e linha final com a saída da última sessão.
  const pl = await page.evaluate(() => [...document.querySelectorAll('table.sched[data-doc="seg-1"] tr')].map((tr) => (tr.querySelector('.timecell') || {}).textContent || '').map((s) => s.trim()).filter(Boolean));
  console.log('Planner shows 11:30 (end of morning) and 17:40 (end of afternoon)?', pl.some((t) => t.startsWith('11:30')) && pl.some((t) => t.startsWith('17:40')), JSON.stringify(pl));

  // Agenda: almoço = 11:30, linha final = 17:40 (sexta mostra 16:50 na própria célula).
  const ag = await ev(`(function(){
    agdClient = function(){ return null; };
    AD.error = ""; AD.loaded = true; AD.rows = {}; AD.view = "semana"; AD.mode = "prof"; AD.sel = "ana-terapeuta"; AD.date = new Date(2030, 0, 7);
    document.getElementById("tab-agenda").hidden = false;
    agdRender();
    var lunch = document.querySelector('#agdGrid tr.agd-lunch:not(.agd-endrow) td.agd-tcol');
    var end = document.querySelector('#agdGrid tr.agd-endrow');
    var week = {lunch: lunch && lunch.textContent, end: end && end.querySelector('td.agd-tcol').textContent, cells: end ? [].map.call(end.querySelectorAll('td.agd-end-cell'), function(td){ return td.textContent; }) : null};
    AD.view = "dia"; AD.date = new Date(2030, 0, 11); agdRender();
    var endD = document.querySelector('#agdGrid tr.agd-endrow td.agd-tcol');
    week.friday = endD && endD.textContent;
    return week;
  })()`);
  console.log('Agenda week: lunch row 11:30, last row 17:40 and Friday shows its own 16:50?', ag.lunch === '11:30' && ag.end === '17:40' && ag.cells && ag.cells[4] === '16:50' && ag.cells[0] === '', JSON.stringify(ag));
  console.log('Agenda day view (Friday): last row shows 16:50?', ag.friday === '16:50');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})().catch((e) => { console.error(e); process.exit(1); });
