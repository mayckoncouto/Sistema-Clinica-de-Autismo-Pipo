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

  // ---- TEST: the seathead column header carries no lock/unlock buttons anymore ----
  console.log('seathead has no period buttons (relocated out of the column header)?', (await page.locator('th.seathead .period-btn').count()) === 0);

  // ---- TEST: a dedicated row right before 07:20 carries the manhã controls ----
  const rows = page.locator('table.sched tbody tr');
  const firstRowClass = await rows.first().getAttribute('class');
  console.log('the very first tbody row is the pre-07:20 lock row?', firstRowClass === 'periodrow periodrow-pre');
  const firstTimeRowTime = await rows.nth(1).locator('td.timecol .timecell').innerText();
  console.log('the row right after the pre-row is 07:20 (the first real slot)?', firstTimeRowTime.trim() === '07:20');

  const preRow = page.locator('tr.periodrow-pre');
  console.log('the pre-row has no visible time label (it just sits above 07:20)?', (await preRow.locator('td.timecol .timecell').innerText()).trim() === '');
  console.log('the pre-row has one seat cell per seat (4 seats)?', (await preRow.locator('.periodrow-seat').count()) === 4);
  console.log('every button in the pre-row is a manhã button?', (await preRow.locator('.period-btn[data-period="afternoon"]').count()) === 0 &&
    (await preRow.locator('.period-btn[data-period="morning"]').count()) === 12);
  console.log('each seat has liberar / bloquear / limpar for the manhã?',
    (await preRow.locator('.period-btn[data-period-action="clear"]').count()) === 4);

  // ---- TEST: the 12:00 divider row carries the tarde controls (plus the existing name repeat) ----
  const midRow = page.locator('tr.periodrow-mid');
  console.log('the divider row is labeled 12:00 (end of the morning block)?', (await midRow.locator('.timecell-time').innerText()).trim() === '12:00');
  console.log('the divider row still repeats each seat\'s professional name?',
    (await midRow.locator('.periodrow-seatname').allInnerTexts()).includes('Ana'));
  console.log('every button in the 12:00 row is a tarde button?', (await midRow.locator('.period-btn[data-period="morning"]').count()) === 0 &&
    (await midRow.locator('.period-btn[data-period="afternoon"]').count()) === 12);

  // ---- TEST: Ana's (r1-t1) manhã buttons live in the pre-row, scoped to her seat ----
  const anaMorningLock = preRow.locator('.period-btn[data-period-action="lock"][data-room="r1"][data-seat="r1-t1"]');
  const anaMorningUnlock = preRow.locator('.period-btn[data-period-action="unlock"][data-room="r1"][data-seat="r1-t1"]');
  console.log('Ana has a manhã lock button in the pre-row?', (await anaMorningLock.count()) === 1);
  console.log('Ana has a manhã unlock button in the pre-row?', (await anaMorningUnlock.count()) === 1);

  // Bia (r1-t2) has her own separate manhã buttons, independent of Ana's.
  const biaMorningLock = preRow.locator('.period-btn[data-period-action="lock"][data-room="r1"][data-seat="r1-t2"]');
  console.log('Bia has her own separate manhã lock button (different seat)?', (await biaMorningLock.count()) === 1);

  // ---- TEST: bulk-blocking Ana's morning via the pre-row needs a double click, and only touches her seat ----
  const anaCell = page.locator('td.slotcell[data-key="07:20|r1|r1-t1"]');
  const biaCell = page.locator('td.slotcell[data-key="08:40|r1|r1-t2"]');
  console.log('before locking: Ana\'s slot shows the real patient, not blocked?', (await anaCell.innerText()).includes('Paciente Um'));

  await anaMorningLock.click();
  await page.waitForTimeout(50);
  console.log('first click only arms the button (shows confirm state)?', await anaMorningLock.evaluate(el => el.classList.contains('confirm')));
  const storeBeforeConfirm = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('nothing written yet after just one click?', storeBeforeConfirm.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um');

  await anaMorningLock.click();
  await page.waitForTimeout(200);
  console.log('confirm state cleared after the second click fires the action?', !(await anaMorningLock.evaluate(el => el.classList.contains('confirm'))));
  const storeAfterLock = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('bloquear keeps the occupied slot (07:20 r1-t1 still "Paciente Um", not blocked)?',
    !storeAfterLock.bookings['07:20|r1|r1-t1'].blocked && storeAfterLock.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um');
  console.log('bloquear blocks Ana\'s free morning slots (08:00 r1-t1 was empty)?',
    storeAfterLock.bookings['08:00|r1|r1-t1'] && storeAfterLock.bookings['08:00|r1|r1-t1'].blocked === true);
  console.log('bloquear never blocks the Monday meeting slot (11:20 keeps the virtual "Reunião Clínica")?',
    !storeAfterLock.bookings['11:20|r1|r1-t1']);
  console.log('Ana\'s OTHER seat (coord-t1, same professional but a different column) is untouched — scoping is per seat, not per professional?',
    storeAfterLock.bookings['16:10|coord|coord-t1'] && storeAfterLock.bookings['16:10|coord|coord-t1'].patient === 'Fonoaudiologia ABA' && !storeAfterLock.bookings['16:10|coord|coord-t1'].blocked);
  console.log('afternoon slots were NOT touched by the morning action (13:30 r1-t1 still absent)?',
    !storeAfterLock.bookings['13:30|r1|r1-t1']);
  const cellAfterLock = await anaCell.innerText();
  console.log('grid still shows the patient in Ana\'s occupied slot?', cellAfterLock.includes('Paciente Um'));
  console.log('grid shows "Bloqueado" in Ana\'s free 08:00 slot?',
    (await page.locator('td.slotcell[data-key="08:00|r1|r1-t1"]').innerText()).includes('Bloqueado'));
  console.log('Bia\'s cell (different seat, pre-existing fixture data) is unaffected?', (await biaCell.innerText()).includes('Bloqueado'));

  // ---- TEST: the auto-disarm timeout resets an armed-but-unconfirmed button ----
  await anaMorningUnlock.click();
  await page.waitForTimeout(50);
  console.log('unlock button arms on first click?', await anaMorningUnlock.evaluate(el => el.classList.contains('confirm')));
  await page.waitForTimeout(4300);
  console.log('unlock button auto-disarms after ~4s without a second click?', !(await anaMorningUnlock.evaluate(el => el.classList.contains('confirm'))));
  const storeStillLocked = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('auto-disarm did NOT unlock anything (still blocked)?', storeStillLocked.bookings['08:00|r1|r1-t1'].blocked === true);

  // ---- TEST: confirming unlock actually releases just Ana's morning ----
  await anaMorningUnlock.click();
  await page.waitForTimeout(50);
  await anaMorningUnlock.click();
  await page.waitForTimeout(200);
  const storeAfterUnlock = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('liberar clears Ana\'s blocked slots (08:00 gone, no leftover blocked flag)?', !storeAfterUnlock.bookings['08:00|r1|r1-t1']);
  console.log('liberar keeps the patient in Ana\'s occupied slot (07:20 still "Paciente Um")?',
    storeAfterUnlock.bookings['07:20|r1|r1-t1'] && storeAfterUnlock.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um');
  console.log('Bia\'s slot (different seat) is unaffected by unlocking Ana\'s morning?',
    storeAfterUnlock.bookings['08:40|r1|r1-t2'] && storeAfterUnlock.bookings['08:40|r1|r1-t2'].blocked === true);
  const cellAfterUnlock = await anaCell.innerText();
  console.log('grid still shows the patient after liberar?', cellAfterUnlock.includes('Paciente Um'));
  console.log('grid shows Ana\'s 08:00 slot empty again after liberar?',
    !(await page.locator('td.slotcell[data-key="08:00|r1|r1-t1"]').innerText()).includes('Bloqueado'));

  // ---- TEST: the 12:00 row's tarde buttons for Ana bulk-block her afternoon only ----
  const anaAfternoonLock = midRow.locator('.period-btn[data-period-action="lock"][data-room="r1"][data-seat="r1-t1"]');
  const anaAfternoonUnlock = midRow.locator('.period-btn[data-period-action="unlock"][data-room="r1"][data-seat="r1-t1"]');
  const anaAfternoonCell = page.locator('td.slotcell[data-key="13:30|r1|r1-t1"]');
  console.log('before locking: Ana\'s 13:30 slot is empty?', (await anaAfternoonCell.locator('.empty-plus').count()) === 1);

  await anaAfternoonLock.click();
  await page.waitForTimeout(50);
  await anaAfternoonLock.click();
  await page.waitForTimeout(200);
  const storeAfterAfternoonLock = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('Ana\'s afternoon slot (13:30 r1-t1) is now blocked via the 12:00 row?',
    storeAfterAfternoonLock.bookings['13:30|r1|r1-t1'] && storeAfterAfternoonLock.bookings['13:30|r1|r1-t1'].blocked === true);
  console.log('Ana\'s morning was not touched by the afternoon action?',
    storeAfterAfternoonLock.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um' && !storeAfterAfternoonLock.bookings['08:00|r1|r1-t1']);

  // ---- TEST: limpar clears EVERYTHING in the period (patient, blocked, meeting) for that seat only ----
  const anaMorningClear = preRow.locator('.period-btn[data-period-action="clear"][data-room="r1"][data-seat="r1-t1"]');
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const cur = JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1']));
    cur.bookings['09:20|r1|r1-t1'] = { patient: 'Bloqueado', note: '', blocked: true };
    await db.doc('schedule/seg-1').set(cur);
  });
  await page.waitForTimeout(200);
  await anaMorningClear.click();
  await page.waitForTimeout(50);
  const storeBeforeClearConfirm = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('limpar also needs a confirming second click?',
    await anaMorningClear.evaluate(el => el.classList.contains('confirm')) && storeBeforeClearConfirm.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um');
  await anaMorningClear.click();
  await page.waitForTimeout(200);
  const storeAfterClear = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('limpar removes the patient (07:20) and the blocked slot (09:20)?',
    !storeAfterClear.bookings['07:20|r1|r1-t1'] && !storeAfterClear.bookings['09:20|r1|r1-t1']);
  console.log('limpar also clears the Monday meeting slot (explicit empty tombstone at 11:20)?',
    storeAfterClear.bookings['11:20|r1|r1-t1'] && storeAfterClear.bookings['11:20|r1|r1-t1'].patient === '');
  console.log('limpar leaves the afternoon (13:30 still blocked) and other seats (Bia 08:40) alone?',
    storeAfterClear.bookings['13:30|r1|r1-t1'].blocked === true && storeAfterClear.bookings['08:40|r1|r1-t2'].blocked === true);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const storeAfterClearUndo = await page.evaluate(() => JSON.parse(JSON.stringify(window.__STORE__['schedule/seg-1'])));
  console.log('Ctrl+Z brings back everything limpar removed?',
    storeAfterClearUndo.bookings['07:20|r1|r1-t1'].patient === 'Paciente Um' && storeAfterClearUndo.bookings['09:20|r1|r1-t1'].blocked === true &&
    !storeAfterClearUndo.bookings['11:20|r1|r1-t1']);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
