// Janelas abrem em leitura (sem aparência de campo) e o botão Editar libera. Serviços/tipos protegidos. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i0 = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vm.html');
  fs.writeFileSync(evPage, src.slice(0, i0 + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i0 + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__noViewMode = false; });
  const check = (l, ok, x) => console.log(l, !!ok, x === undefined ? '' : x);
  // Paciente
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  check('paciente abre em leitura?', await page.$eval('#ovPat .modal', (m) => m.classList.contains('modal-view')));
  check('Salvar escondido e Editar visível?', !(await page.isVisible('#pSave')) && await page.isVisible('#viewEditBtn'));
  const nome0 = await page.$eval('#pNome', (e) => e.value);
  await page.click('#pNome', { force: true }).catch(() => {});
  await page.keyboard.type('XYZ').catch(() => {});
  check('digitar não altera o nome?', (await page.$eval('#pNome', (e) => e.value)) === nome0);
  await page.click('#viewEditBtn');
  check('Editar libera: Salvar aparece e modo leitura sai?', await page.isVisible('#pSave') && !(await page.$eval('#ovPat .modal', (m) => m.classList.contains('modal-view'))));
  await page.fill('#pNome', nome0 + 'X');
  check('depois de Editar o campo aceita texto?', (await page.$eval('#pNome', (e) => e.value)) === nome0 + 'X');
  await page.evaluate(() => { document.getElementById('pCancel').click(); }); await page.waitForTimeout(200);
  if (await page.$('#gdSair')) await page.click('#gdSair');
  // Serviço protegido
  const prot = await page.evaluate(() => window.__ev("(function(){ return [svcProtected({id:'triagem'}), svcProtected({id:'x', name:'Devolutiva'}), svcProtected({id:'sessao', name:'Sessão'}), groupProtected({group:true, name:'Aplicador ABA'}), groupProtected({group:false, name:'Aplicador ABA'})]; })()"));
  check('proteção reconhece Triagem, Devolutiva e grupos?', JSON.stringify(prot) === JSON.stringify([true, true, false, true, false]), prot);
  await page.evaluate(() => window.__ev("openRegistryItem('servicos', servicesList().filter(function(x){ return x.id === 'triagem'; })[0] || {id:'triagem', name:'Triagem'})"));
  await page.waitForSelector('#ovReg');
  check('Triagem: nome travado e sem Excluir?', await page.$eval('#regName', (e) => e.disabled) && !(await page.$('#regDel')));
  console.log('no JS errors?', errors.length === 0, errors.slice(0, 3));
  fs.unlinkSync(evPage);
  await browser.close();
})();
