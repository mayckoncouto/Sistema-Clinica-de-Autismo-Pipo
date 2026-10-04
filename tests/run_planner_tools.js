// Ferramentas da barra do Planner: Exportar Excel, Editar agendamento
// (resumo, pacote × Planner, copiar semana) e Trocar profissional.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForSelector('#gridHost .book');

  // ---- Barra: "Enviar para a Agenda" visível; o resto no menu Ferramentas ----
  console.log('Ferramentas menu starts closed?', await page.locator('#plToolsMenu').isHidden());
  console.log('Enviar para a Agenda stays on the bar (outside the menu)?', (await page.locator('.controls > #sendToAgendaBtn').count()) === 1);
  await page.click('#plToolsBtn');
  const items = await page.locator('#plToolsMenu button:visible').allInnerTexts();
  console.log('menu lists Horário livre, Editar agendamento, Trocar profissional, Exportar Excel, Limpar semana?', ['Horário livre', 'Editar agendamento', 'Trocar profissional', 'Exportar Excel', 'Limpar semana'].every((t) => items.some((i) => i.trim() === t)));
  await page.keyboard.press('Escape');
  console.log('Esc closes the menu?', await page.locator('#plToolsMenu').isHidden());

  // ---- Exportar Excel ----
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#plToolsBtn').then(() => page.click('#plExportBtn'))]);
  const csv = await new Promise((res) => { dl.createReadStream().then((s) => { let t = ''; s.on('data', (c) => (t += c)); s.on('end', () => res(t)); }); });
  const lines = csv.replace(/^﻿/, '').split(/\r\n/);
  console.log('export file name is planner.csv?', dl.suggestedFilename() === 'planner.csv');
  console.log('export has the header row?', lines[0] === 'Semana;Dia;Hora;Sala / grupo;Profissional;Agendamento;Tipo;Serviço;Observação');
  console.log('export lists Paciente Um on Monday 07:20 of the 1st week?', lines.some((l) => l.startsWith('1ª semana;Segunda-feira;07:20;Sala Teste;') && l.includes(';Paciente Um;Paciente;')));
  console.log('export marks special slots by type (Bloqueado)?', lines.some((l) => /;Bloqueado;/.test(l)));

  // ---- Editar agendamento: resumo e pacote × Planner ----
  await page.click('#plToolsBtn'); await page.click('#fixPatientBtn'); // dentro do menu Ferramentas
  await page.waitForSelector('#fxPat', { state: 'attached' });
  await page.waitForFunction(() => !/Carregando/.test(document.getElementById('fxReport').innerText));
  await page.$eval('#fxPat', (s) => { s.value = 'bruno-verde'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  const report = await page.innerText('#fxReport');
  console.log('summary table shows Bruno in Psicologia?', /Psicologia/.test(report));
  console.log('package comparison shows Fonoaudiologia contracted 3 and missing?', /Fonoaudiologia\s+3\s+0\s+-3/.test(report));

  // ---- Copiar a semana do paciente ----
  const before = await page.locator('#fxList .fx-item').count();
  await page.$eval('#fxCopyFrom', (s) => { s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#fxCopyTo', (s) => { s.value = '4'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#fxCopy');
  await page.locator('#confirmHost button', { hasText: 'Copiar' }).click();
  await page.waitForTimeout(400);
  console.log('copying the 1st week to the 4th adds Bruno there?', (await page.locator('#fxList .fx-item').count()) === before + 1 &&
    (await page.evaluate(() => !!(window.__STORE__['schedule/ter-4'] && window.__STORE__['schedule/ter-4'].bookings['07:20|r1|r1-t1']))));

  // ---- Visão geral: pacientes com pacote diferente ----
  await page.click('#fxAllBtn');
  const all = await page.innerText('#fxAll');
  console.log('overview lists patients whose package differs (Paciente Um, Bruno)?', /Paciente Um/.test(all) && /Bruno Verde/.test(all));
  await page.click('#fxCancel');

  // ---- Trocar profissional ----
  await page.click('#plToolsBtn'); await page.click('#swapProfBtn'); // dentro do menu Ferramentas
  await page.waitForSelector('#swFrom', { state: 'attached' });
  await page.$eval('#swFrom', (s) => { s.value = 'bia-terapeuta'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.$eval('#swTo', (s) => { s.value = 'andrelisa-terapeuta'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  console.log('lists Bia\'s columns to move?', /Sala Teste/.test(await page.innerText('#swSeats')));
  await page.click('#swApply');
  await page.locator('#confirmHost button', { hasText: /^Trocar$/ }).click();
  await page.waitForTimeout(300);
  const seat = await page.evaluate(() => window.__STORE__['config/rooms'].list.find((r) => r.id === 'r1').therapists.find((t) => t.id === 'r1-t2'));
  console.log('the column now belongs to Andrelisa (id and name)?', seat.professionalId === 'andrelisa-terapeuta' && seat.name === 'Andrelisa');

  // ---- Mesmo paciente + mesmo profissional + mesmo horário: recusado (mesmo com outro serviço) ----
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const rooms = (await db.doc('config/rooms').get()).data();
    rooms.list.find((r) => r.id === 'r1').therapists.push({ id: 'r1-t9', name: 'Ana', professionalId: 'ana-terapeuta' });
    await db.doc('config/rooms').set(rooms);
    const sv = { list: [{ id: 'sessao', name: 'Sessão' }, { id: 'orientacao', name: 'Orientação Familiar' }] };
    await db.doc('config/services').set(sv);
  });
  await page.waitForTimeout(300);
  const extra = page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="07:20|r1|r1-t9"]');
  await extra.locator('.book-main').click();
  await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Paciente Um');
  await page.$eval('#bkService', (s) => { s.value = 'orientacao'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#bkSave');
  await page.waitForTimeout(250);
  const stillOpen = await page.locator('#ovBook').count();
  const toast = await page.innerText('#toastHost');
  console.log('same patient with the same professional at the same time is refused (even with another service)?', stillOpen === 1 && /nem com outro servi/.test(toast) &&
    !(await page.evaluate(() => window.__STORE__['schedule/seg-1'].bookings['07:20|r1|r1-t9'])));
  await page.click('#bkCancel').catch(() => {});

  // ---- Grupo do próprio profissional apontando para a sala onde ele atende (caso "Lara") ----
  // Ana atende Paciente Um na Sala Teste às 07:20 e é a profissional da coluna do grupo Coordenador.
  const book = async (key, name) => {
    const td = page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="' + key + '"]');
    if (await td.evaluate((el) => el.classList.contains('slot-off'))) return 'LOCKED';
    await td.locator('.book-main').click();
    await page.waitForSelector('#ovBook');
    await page.fill('#bkPatient', name);
    await page.click('#bkSave');
    await page.waitForTimeout(250);
    const open = await page.locator('#ovBook').count();
    if (open) await page.click('#bkCancel');
    return open ? 'REFUSED' : 'ok';
  };
  console.log('own group column is free while she attends in a single room?', !(await page.locator('table.sched[data-doc="seg-1"] td.slotcell[data-key="07:20|coord|coord-t1"]').evaluate((el) => el.classList.contains('slot-off'))));
  console.log('group pointing to the SAME room where she attends is accepted?', (await book('07:20|coord|coord-t1', 'Sala Teste')) === 'ok');
  await book('10:00|r1|r1-t1', 'Carla Laranja');
  console.log('group pointing to ANOTHER room (while she attends in Sala Teste) is still refused?', (await book('10:00|coord|coord-t1', 'Sala Azul')) !== 'ok');
  // ao contrário: grupo já aponta para a Sala Teste às 09:20 → paciente na coluna dela na Sala Teste é aceito
  await book('09:20|coord|coord-t1', 'Sala Teste');
  console.log('patient in her room column while her group points to that room is accepted?', (await book('09:20|r1|r1-t1', 'Bruno Verde')) === 'ok');

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
