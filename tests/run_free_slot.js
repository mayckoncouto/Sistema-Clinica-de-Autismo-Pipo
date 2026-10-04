// Planner: "Horário livre" — horários livres para um paciente, respeitando regras,
// horário do profissional e do paciente; clicar abre a janela já preenchida.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('#gridHost .book');
  const setSel = (id, v) => page.$eval(id, (s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  await page.click('#freeSlotBtn');
  await page.waitForSelector('#frPat', { state: 'attached' });
  await page.waitForFunction(() => !/Carregando/.test(document.getElementById('frResult').innerText));
  await setSel('#frPat', 'carla-laranja');
  const all = await page.locator('.fr-slot').count();
  console.log('lists free slots for the patient (4 weeks)?', all > 0, all);
  const slots = await page.locator('.fr-slot').evaluateAll((els) => els.map((e) => e.textContent));
  console.log('never offers Paciente Um\'s occupied cell (Ana, Sala Teste, Monday 07:20 of the 1st week)?',
    !(await page.locator('details.fr-week').first().locator('.fr-day', { hasText: 'Segunda-feira' }).locator('.fr-slot', { hasText: '07:20' }).filter({ hasText: 'Sala Teste' }).filter({ hasText: 'Ana' }).count()));

  // filtro por profissional
  await setSel('#frProf', 'bia-terapeuta');
  const bia = await page.locator('.fr-slot').evaluateAll((els) => els.map((e) => e.textContent));
  console.log('professional filter shows only Bia?', bia.length > 0 && bia.every((t) => /Bia/.test(t)));
  await setSel('#frProf', '');

  // horário do paciente: Carla só às terças → nada fora de terça
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const cur = JSON.parse(JSON.stringify(window.__STORE__['patients/all']));
    const off = { ativo: false, manha: { inicio: '', fim: '' }, tarde: { inicio: '', fim: '' } };
    cur.list.find((p) => p.id === 'carla-laranja').horarios = { seg: off, ter: { ativo: true, manha: { inicio: '07:20', fim: '12:00' }, tarde: { inicio: '', fim: '' } }, qua: off, qui: off, sex: off };
    await db.doc('patients/all').set(cur);
  });
  await page.waitForTimeout(200);
  await setSel('#frSpec', '');
  const days = await page.locator('.fr-day > b').evaluateAll((els) => els.map((e) => e.textContent));
  console.log('respects the patient\'s hours (only Tuesday mornings)?', days.length > 0 && days.every((d) => d === 'Terça-feira') &&
    (await page.locator('.fr-slot').evaluateAll((els) => els.map((e) => e.textContent))).every((t) => t.slice(0, 5) < '12:00'));

  // clicar abre a janela de agendamento com o paciente
  const first = page.locator('.fr-slot').first();
  const txt = await first.innerText();
  await first.click();
  await page.waitForSelector('#ovBook');
  console.log('click opens the booking window with the patient filled in?', (await page.inputValue('#bkPatient')) === 'Carla Laranja');
  console.log('…at the right time?', (await page.innerText('#ovBook .modal-sub')).includes(txt.slice(0, 5)));
  await page.click('#bkSave');
  await page.waitForTimeout(250);
  console.log('saving books her there?', await page.evaluate(() => Object.keys(window.__STORE__).filter((k) => k.startsWith('schedule/ter-')).some((k) => Object.values(window.__STORE__[k].bookings).some((b) => b.patient === 'Carla Laranja'))));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
