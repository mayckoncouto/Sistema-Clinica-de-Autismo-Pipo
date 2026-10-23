// Abas da janela do paciente (Cadastro, Tratamento, Agenda, Prontuário, Anamneses, Anexos). Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html'));
  await page.waitForTimeout(800);
  const check = (l, ok, x) => console.log(l, !!ok, x === undefined ? '' : x);
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  const tabs = await page.$$eval('#pmTabs button', (a) => a.map((b) => b.textContent));
  check('abas no topo, Cadastro primeiro?', tabs[0] === 'Cadastro' && tabs.includes('Tratamento') && tabs.includes('Anexos'), tabs);
  check('Tratamento não é mais grupo do Cadastro?', !(await page.$('.pm-pane[data-pmp=cad] [data-pmsec=tratamento]')));
  await page.click('#pmTabs [data-pmt=trat]');
  check('aba Tratamento mostra o resumo e esconde o cadastro?', (await page.$('.pm-pane[data-pmp=trat] .pt-treat')) && await page.$eval('.pm-pane[data-pmp=cad]', (e) => e.hidden));
  check('Salvar e Excluir somem fora do Cadastro?', await page.$eval('#pSave', (e) => getComputedStyle(e).display === 'none'));
  await page.click('#pmTabs [data-pmt=anexos]'); await page.waitForTimeout(300);
  check('aba Anexos carrega a lista (ou aviso vazio)?', (await page.$eval('.pm-pane[data-pmp=anexos]', (e) => e.textContent)).length > 5);
  await page.click('#pmTabs [data-pmt=cad]');
  check('voltar ao Cadastro mostra Salvar?', await page.$eval('#pSave', (e) => getComputedStyle(e).display !== 'none'));
  await page.click('#closePat');
  await page.click('#addPatientBtn'); await page.waitForSelector('#ovPat');
  check('paciente novo não tem abas?', !(await page.$('#pmTabs')));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})();
