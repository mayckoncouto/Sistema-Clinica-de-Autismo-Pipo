// Aviso ao sair de janela de cadastro com campo alterado + "Criar Tarefa" nas janelas de cadastro. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, 'page.html'));
  await page.waitForSelector('td.slotcell');
  await page.evaluate(() => { window.__PIPO_NOGUARD = false; });
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  await page.click('#cadBtn');
  await page.click('#cadMenu [data-nav="status"]');
  await page.waitForTimeout(200);
  const open = async () => { await page.click('#reg-status-add'); await page.waitForSelector('#ovStItem'); };
  // sem alteração: fecha direto
  await open(); await page.click('#stiCancel'); await page.waitForTimeout(150);
  check('no change: Cancelar closes without asking?', !(await page.$('#ovStItem')) && !(await page.$('#ovGuard')));
  // alterado: Cancelar pergunta
  await open(); await page.fill('#stiName', 'Guarda Teste'); await page.click('#stiCancel'); await page.waitForTimeout(150);
  check('changed: Cancelar asks?', !!(await page.$('#ovGuard')) && !!(await page.$('#ovStItem')));
  check('dialog has the 3 buttons?', (await page.$$eval('#ovGuard .modal-foot button', (b) => b.map((x) => x.textContent.trim()))).join('|') === 'Sair sem Salvar|Continuar Editando|Salvar');
  await page.click('#gdCont'); await page.waitForTimeout(100);
  check('Continuar Editando keeps the window and the text?', !(await page.$('#ovGuard')) && (await page.inputValue('#stiName')) === 'Guarda Teste');
  // Esc
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check('Esc asks too?', !!(await page.$('#ovGuard')));
  await page.click('#gdCont');
  // ✕
  await page.click('#ovStItem .modal-close'); await page.waitForTimeout(100);
  check('✕ asks too?', !!(await page.$('#ovGuard')));
  await page.click('#gdCont');
  // clique fora
  await page.mouse.click(5, 5); await page.waitForTimeout(100);
  check('click outside asks too?', !!(await page.$('#ovGuard')));
  // sair sem salvar
  await page.click('#gdSair'); await page.waitForTimeout(150);
  check('Sair sem Salvar closes without saving?', !(await page.$('#ovStItem')) && !(await page.$$eval('#reg-status-host tbody tr', (r) => r.map((x) => x.textContent))).some((t) => /Guarda Teste/.test(t)));
  // salvar
  await open(); await page.fill('#stiName', 'Guarda Salva'); await page.click('#ovStItem .modal-close'); await page.waitForTimeout(100);
  await page.click('#gdSave'); await page.waitForTimeout(300);
  check('Salvar saves and closes?', !(await page.$('#ovStItem')) && (await page.$$eval('#reg-status-host tbody tr', (r) => r.map((x) => x.textContent))).some((t) => /Guarda Salva/.test(t)));
  // Criar Tarefa a partir do paciente
  await page.click('#mainTabs [data-tab="pacientes"]', { force: true }).catch(() => {});
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="pacientes"]').click());
  await page.waitForTimeout(300);
  await page.click('#tab-pacientes tbody tr'); await page.waitForSelector('#ovPat');
  check('Paciente has Outras Opções with Criar Tarefa?', !!(await page.$('#ovPat #pMoreBtn')));
  await page.click('#pMoreBtn'); await page.click('#mmCreateTask'); await page.waitForTimeout(300);
  const pick = await page.$('#ovTaskPick');
  if (pick) { await page.click('#tpOk'); await page.waitForTimeout(300); }
  check('task window opens over the patient window, prefilled?', !!(await page.$('#quickHost #ovCrm')) && !!(await page.$('#ovPat')) && /Paciente: Ana Azul/.test(await page.inputValue('#ovCrm input').catch(() => '')) && /Ana Azul/.test(await page.inputValue('#crmWho').catch(() => '')) , await page.inputValue('#ovCrm input').catch(() => ''));
  console.log('no JS errors?', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})();
