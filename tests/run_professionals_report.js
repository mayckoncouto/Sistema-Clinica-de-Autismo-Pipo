const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  const url = 'file://' + path.resolve(__dirname, 'page.html');
  await page.goto(url);

  await page.waitForFunction(() => {
    const el = document.querySelector('#gridHost .book-main .pname');
    return el && el.textContent.includes('Paciente Um');
  }, { timeout: 5000 });

  // ---- TEST: seat headers resolve through the professionals registry ----
  const seatNames = await page.locator('table.sched .seathead-name').allInnerTexts();
  console.log('seat headers show "Ana" (via professionalId link)?', seatNames.includes('Ana'));
  console.log('seat headers show "Bia" (via professionalId link)?', seatNames.includes('Bia'));
  console.log('seat headers show "Caio" (legacy fallback, no professionalId)?', seatNames.includes('Caio'));

  // ---- TEST: Profissionais tab ----
  await page.$eval('#mainTabs button[data-tab="profissionais"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  console.log('Profissionais tab lists Ana?', (await page.locator('#profList').innerText()).includes('Ana'));
  console.log('Profissionais tab lists Bia?', (await page.locator('#profList').innerText()).includes('Bia'));
  const anaProfRow = page.locator('#profList tbody tr', { hasText: 'Ana' }).first();
  console.log('Ana row shows her specialty (Psicologia)?', (await anaProfRow.innerText()).includes('Psicologia'));
  console.log('Ana row lists the rooms she works in (Sala Teste, Coordenador)?',
    (await anaProfRow.innerText()).includes('Sala Teste') && (await anaProfRow.innerText()).includes('Coordenador'));
  await page.fill('#profListSearch', 'fono');
  await page.waitForTimeout(100);
  const fonoRows = await page.locator('#profList tbody tr').allInnerTexts();
  console.log('searching "fono" (no accent, lowercase) finds only Bia (Fonoaudiologia)?',
    fonoRows.length === 1 && fonoRows[0].includes('Bia'));
  console.log('the counter shows "1 de 3 profissionais"?', (await page.locator('#profCount').innerText()).trim() === '1 de 3 profissionais');
  await page.fill('#profListSearch', '');
  await page.waitForTimeout(100);

  // Create a new professional.
  await page.click('#addProfessionalBtn');
  await page.waitForSelector('#ovProf');
  await page.fill('#profName', 'Nova Terapeuta');
  await page.$eval('#profSpecialty', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, 'fono'); // select vira lista própria (dpEnhance)
  await page.click('#profSave');
  await page.waitForTimeout(150);
  console.log('new professional appears in the list?', (await page.locator('#profList').innerText()).includes('Nova Terapeuta'));
  const profStore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['config/professionals'])));
  console.log('new professional persisted with specialtyId "fono"?', profStore.list.filter(p => p.nome === 'Nova Terapeuta' && p.name === undefined)[0].specialtyId === 'fono');

  // ---- TEST: room modal therapist rows are selects wired to the registry ----
  await page.$eval('#mainTabs button[data-tab="salas"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(150);
  await page.locator('.room-row', { hasText: 'Sala Teste' }).locator('[data-edit]').click();
  await page.waitForSelector('#ovRoom');
  const selectCount = await page.locator('#rmTherapists select').count();
  console.log('room modal has a <select> per therapist column?', selectCount === 2);
  const selectedNames = await page.locator('#rmTherapists select').evaluateAll(els =>
    els.map(el => el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : null));
  console.log('first column pre-selected to Ana?', selectedNames[0] === 'Ana');
  console.log('second column pre-selected to Bia?', selectedNames[1] === 'Bia');
  await page.click('#rmCancel');

  // ---- TEST: Relatório tab — four-row header (especialidade / total esp. /
  // profissional / total prof.) + the "Pacientes" mid-row + data rows ----
  await page.$eval('#mainTabs button[data-tab="resumo"]', (b) => b.click()); // aba aberta pelos menus (botão oculto)
  await page.waitForTimeout(200);
  const reportText = await page.locator('#reportHost').innerText();
  console.log('report shows "Coordenador" row?', reportText.includes('Coordenador'));
  console.log('report shows "Aplicador ABA" row (always present, even with 0)?', reportText.includes('Aplicador ABA'));
  console.log('report shows real patient rows (Paciente Um, Bruno Verde, Carla Laranja)?',
    reportText.includes('Paciente Um') && reportText.includes('Bruno Verde') && reportText.includes('Carla Laranja'));
  console.log('report has a header row of specialty names (row 1)?', (await page.locator('.rpt-spec-name').count()) > 0);
  console.log('report has a header row of per-specialty totals (row 2)?', (await page.locator('.rpt-spec-total').count()) > 0);
  console.log('the specialty name cell for Fonoaudiologia is merged (colspan) across its professionals, not repeated per column?',
    parseInt(await page.locator('.rpt-spec-name', { hasText: 'Fonoaudiologia' }).getAttribute('colspan'), 10) >= 1 &&
    (await page.locator('.rpt-spec-name').count()) < (await page.locator('.rpt-prof-name').count()));
  console.log('report has a header row of professional names (row 3)?', (await page.locator('.rpt-prof-name').count()) > 0);
  console.log('report has a header row of per-professional totals (row 4)?', (await page.locator('.rpt-prof-total').count()) > 0);
  console.log('there is no "Pacientes" mid-row repeating the professional names (removed on request)?',
    (await page.locator('tr.rpt-mid').count()) === 0);

  const anaColIdx = (await page.locator('.rpt-prof-name').allInnerTexts()).indexOf('Ana');
  const biaColIdx = (await page.locator('.rpt-prof-name').allInnerTexts()).indexOf('Bia');
  console.log('Ana is a report column?', anaColIdx !== -1);
  console.log('Bia is a report column (even with zero attendances)?', biaColIdx !== -1);

  const anaTotal = (await page.locator('.rpt-prof-total').nth(anaColIdx).innerText()).trim();
  console.log('Ana\'s column total is 4 (Paciente Um + Coordenador + Bruno Verde + Carla Laranja, across all 20 docs)?', anaTotal === '4');
  const biaTotal = (await page.locator('.rpt-prof-total').nth(biaColIdx).innerText()).trim();
  console.log('Bia\'s column total is 0 (her only booking was blocked)?', biaTotal === '0');

  const coordRow = page.locator('.report-table tbody tr', { hasText: 'Coordenador' });
  const coordCells = await coordRow.locator('td').allInnerTexts();
  // cells: [Paciente/rowlabel, ...profOrder columns (index i -> cell i+1), Total (last)]
  console.log('Coordenador row: Bia column is empty ("—")?', coordCells[biaColIdx + 1].trim() === '—');
  console.log('Coordenador row: Ana column shows 1?', coordCells[anaColIdx + 1].trim() === '1');
  console.log('Coordenador row total is 1?', coordCells[coordCells.length - 1].trim() === '1');

  const specLabels = (await page.locator('.rpt-spec-name').allInnerTexts()).map(s => s.trim().toLowerCase());
  const specTotals = await page.locator('.rpt-spec-total').allInnerTexts();
  const fonoGroupIdx = specLabels.indexOf('fonoaudiologia');
  const psicoGroupIdx = specLabels.indexOf('psicologia');
  console.log('Fonoaudiologia specialty group total is 0 (Bia\'s only session was blocked)?', specTotals[fonoGroupIdx].trim() === '0');
  console.log('Psicologia specialty group total is 4?', specTotals[psicoGroupIdx].trim() === '4');
  // The Total column is no longer one cell merged across all 4 header rows — it now
  // has its own label/value per row: "Total" / (total) / "Profissionais" /
  // (total), so the grand total appears twice (row 2 and row 4), both the same value.
  const totalColRsh = await page.locator('.rpt-total-head .rsh-total').allInnerTexts();
  console.log('the Total column shows the grand total twice (once per grouping it echoes), both "4"?',
    totalColRsh.length === 2 && totalColRsh[0].trim() === '4' && totalColRsh[1].trim() === '4');
  // .innerText() reflects the rendered (CSS text-transform:uppercase) text, not the
  // raw DOM text, so compare case-insensitively (same reasoning as cornerLabels below).
  const totalColTitles = (await page.locator('.rpt-total-head').allInnerTexts()).map(s => s.trim().toLowerCase());
  console.log('the Total column\'s row1/row3 cells are plain titles "Total"/"Profissionais" (row1 relabeled from "Especialidades")?',
    totalColTitles.length === 4 && totalColTitles[0] === 'total' && totalColTitles[2] === 'profissionais');
  // The Total column should never stand out as its own dark/black block — every
  // one of its 4 header cells should share the light "rest of the row" background
  // (.rpt-prof-name / .rpt-prof-total's surface-2), not a distinct dark fill.
  const totalHeadBgs = await page.locator('.rpt-total-head').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
  const profNameBg = await page.locator('.rpt-prof-name').first().evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('none of the 4 Total-column header cells use a dark/black background?', totalHeadBgs.every(bg => bg !== 'rgb(0, 0, 0)' && bg === profNameBg));
  const grandTotal = totalColRsh[0].trim();
  console.log('grand total is 4?', grandTotal === '4');

  // ---- TEST: "Reunião Clínica" and a "Bloqueado" text saved without the blocked
  // flag never count as real attendances (fixture has one of each, on top of the
  // 4 real sessions above — if either leaked in, the totals above would be wrong) ----
  const fullBodyText = await page.locator('.report-table tbody').innerText();
  console.log('the weekly team meeting placeholder never shows up as its own patient row?', !fullBodyText.includes('Reunião Clínica'));
  console.log('a "Bloqueado" saved as patient text (no blocked flag) never shows up as its own patient row?',
    !fullBodyText.toLowerCase().includes('bloqueado'));

  // ---- TEST: the search box filters the patient rows and the totals follow the filter ----
  await page.fill('#reportSearch', 'Bruno');
  await page.waitForTimeout(150);
  const filteredBodyText = await page.locator('.report-table tbody').innerText();
  console.log('filtering by "Bruno" hides other patients (Paciente Um, Carla Laranja)?',
    !filteredBodyText.includes('Paciente Um') && !filteredBodyText.includes('Carla Laranja'));
  console.log('filtering by "Bruno" still shows his own row?', filteredBodyText.includes('Bruno Verde'));
  console.log('filtering by "Bruno" keeps the Coordenador and Aplicador ABA rows (they are never filtered out)?',
    filteredBodyText.includes('Coordenador') && filteredBodyText.includes('Aplicador ABA'));

  const anaTotalFiltered = (await page.locator('.rpt-prof-total').nth(anaColIdx).innerText()).trim();
  console.log('with the "Bruno" filter, Ana\'s header total drops to 1 (just Bruno\'s session, not all 4)?', anaTotalFiltered === '1');
  const grandTotalFilteredBoth = await page.locator('.rpt-total-head .rsh-total').allInnerTexts();
  console.log('with the "Bruno" filter, both Total-column totals drop to 1?',
    grandTotalFilteredBoth[0].trim() === '1' && grandTotalFilteredBoth[1].trim() === '1');
  const psicoSpecTotalFiltered = (await page.locator('.rpt-spec-total').nth(psicoGroupIdx).innerText()).trim();
  console.log('with the "Bruno" filter, the Psicologia specialty total also drops to 1?', psicoSpecTotalFiltered === '1');

  // A filter matching no patient shows a message and zeroes the totals, without hiding Coordenador/Aplicador ABA.
  await page.fill('#reportSearch', 'zzznoone');
  await page.waitForTimeout(150);
  const noMatchText = await page.locator('.report-table tbody').innerText();
  console.log('a filter matching nobody shows a "not found" message?', noMatchText.includes('Nenhum paciente encontrado'));
  console.log('a filter matching nobody still keeps Coordenador/Aplicador ABA visible?',
    noMatchText.includes('Coordenador') && noMatchText.includes('Aplicador ABA'));
  const grandTotalNoMatch = (await page.locator('.rpt-total-head .rsh-total').first().innerText()).trim();
  console.log('a filter matching nobody zeroes the grand total?', grandTotalNoMatch === '0');

  // Clearing the filter restores the full, unfiltered totals.
  await page.fill('#reportSearch', '');
  await page.waitForTimeout(150);
  const grandTotalCleared = (await page.locator('.rpt-total-head .rsh-total').first().innerText()).trim();
  console.log('clearing the filter restores the grand total to 4?', grandTotalCleared === '4');
  const clearedBodyText = await page.locator('.report-table tbody').innerText();
  console.log('clearing the filter shows every patient again?',
    clearedBodyText.includes('Paciente Um') && clearedBodyText.includes('Bruno Verde') && clearedBodyText.includes('Carla Laranja'));

  // ---- TEST: each header row has its own row-title in the leftmost column, instead
  // of one merged "Paciente" label spanning all four rows ----
  const cornerLabels = (await page.locator('.report-table thead .rpt-corner').allInnerTexts()).map(s => s.trim());
  console.log('the four header rows have their own titles (Especialidades / Total por especialidade / Profissionais / Total por Profissional)?',
    cornerLabels.length === 4 &&
    cornerLabels[0].toLowerCase() === 'especialidades' &&
    cornerLabels[1].toLowerCase() === 'total por especialidade' &&
    cornerLabels[2].toLowerCase() === 'profissionais' &&
    cornerLabels[3].toLowerCase() === 'total por profissional');

  // ---- TEST: every professional column is exactly the same width, wide enough to
  // fit "Andrelisa" (the fixture's longest professional name) without truncating it ----
  const widthInfo = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.rpt-prof-name'));
    return cells.map(el => ({
      text: el.textContent.trim(),
      width: Math.round(el.getBoundingClientRect().width),
      truncated: el.scrollWidth > el.clientWidth
    }));
  });
  const widths = [...new Set(widthInfo.map(c => c.width))];
  console.log('every professional column has the same width?', widths.length === 1);
  const andrelisaCell = widthInfo.find(c => c.text === 'Andrelisa');
  console.log('"Andrelisa" specifically fits without truncation (the column is sized for it)?', !!andrelisaCell && !andrelisaCell.truncated);

  // ---- TEST: numeric values across the table (specialty totals, professional totals,
  // per-row counts, row totals, grand total) all share one font size ----
  const fontSizes = await page.evaluate(() => {
    const sel = '.rpt-spec-total, .rpt-prof-total, .report-table td.rpt-count, .report-table td.rpt-total-col, .report-table th.rpt-total-head .rsh-total';
    return [...new Set(Array.from(document.querySelectorAll(sel)).map(el => getComputedStyle(el).fontSize))];
  });
  console.log('every numeric value in the report shares the same font size?', fontSizes.length === 1);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
