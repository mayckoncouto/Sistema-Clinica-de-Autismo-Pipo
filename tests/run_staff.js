// RH → Funcionários e Prestadores: lista, janela única (profissional = tipo
// "Profissional"), horário livre que vira o horário de atendimento, remuneração e
// desligamento. Sem sistema online os dados do RH ficam na memória. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_staff.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  const setv = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  // Menu RH e lista: os profissionais já cadastrados aparecem como tipo Profissional.
  const menu = await ev(`(function(){ renderNavMenus(); return Array.prototype.map.call(document.querySelectorAll("#rhMenu [data-nav]"), function(b){ return b.textContent; }); })()`);
  console.log('RH menu has Funcionários e Prestadores and Tipos?', menu.join('|') === 'Funcionários e Prestadores|Tipos de funcionário', JSON.stringify(menu));
  await page.$eval('#mainTabs button[data-tab=funcionarios]', (b) => b.click()); await page.waitForTimeout(300);
  const nProf = await ev('state.professionals.filter(function(p){ return !p.inativo; }).length');
  const rows0 = await page.$$eval('#staffListHost tbody tr', (r) => r.map((x) => x.cells[1].textContent));
  console.log('existing professionals listed with type Profissional?', rows0.length === nProf && rows0.every((t) => t === 'Profissional'), rows0.length, nProf);

  // Novo funcionário (não profissional) com horário livre, remuneração e acesso.
  await page.click('#staffAddBtn'); await page.waitForSelector('#ovProf');
  const atendHidden = await page.$eval('[data-sfsec="atend"]', (e) => e.hidden);
  console.log('new staff: Atendimento hidden until "Profissional" is checked?', atendHidden);
  const sat = await page.$eval('#profHours tr[data-day="sab"] .ph-start[data-p="m"]', (e) => e.value);
  const mon = await page.$eval('#profHours tr[data-day="seg"] .ph-start[data-p="m"]', (e) => e.value);
  console.log('hours start from the clinic (Mon open, Sat closed)?', mon === '07:20' && sat === '', mon, sat);
  await page.fill('#profName', 'Rita Recepção');
  await page.check('#sfTypes input[value="recepcao"]');
  await setv('#profHours tr[data-day="sab"] .ph-start[data-p="m"]', '0800');
  await setv('#profHours tr[data-day="sab"] .ph-end[data-p="m"]', '1130');
  const satFmt = await page.$eval('#profHours tr[data-day="sab"] .ph-start[data-p="m"]', (e) => e.value);
  console.log('free time typed "0800" becomes 08:00?', satFmt === '08:00', satFmt);
  await setv('#sf-cargo', 'Recepcionista');
  await setv('#sf-vinculo', 'clt');
  await setv('#sf-jornada', '10');
  const jn = await page.$eval('#sfJornadaNote', (e) => !e.hidden);
  console.log('jornada different from the hours shows a note?', jn);
  await page.waitForSelector('#sfPays .pat-count');
  await setv('#sf-valor', '3000');
  await page.click('#sfPayAdd'); await page.click('#sfPayAdd');
  const boxes = await page.$$('#sfPays .sf-pay');
  await boxes[0].$eval('[data-pk=descricao]', (e) => { e.value = 'Salário'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await boxes[0].$eval('[data-pk=valor]', (e) => { e.value = '2500'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await boxes[1].$eval('[data-pk=descricao]', (e) => { e.value = 'Pensão alimentícia'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await boxes[1].$eval('[data-pk=valor]', (e) => { e.value = '400'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const sumBad = await page.$eval('#sfPaySum', (e) => e.classList.contains('sf-sum-bad') && /diferença de R\$\s?100,00/.test(e.textContent));
  console.log('payment rows that do not add up to the contract show the difference?', sumBad);
  await boxes[1].$eval('[data-pk=valor]', (e) => { e.value = '500'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const sumOk = await page.$eval('#sfPaySum', (e) => !e.classList.contains('sf-sum-bad'));
  console.log('sum matching the contract is ok?', sumOk);
  const bankHidden = await boxes[0].$eval('[data-show=banco]', (e) => e.hidden);
  await boxes[0].$eval('[data-pk=forma]', (e) => { e.value = 'transferencia'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const bankShown = await boxes[0].$eval('[data-show=banco]', (e) => !e.hidden);
  console.log('bank fields appear only for transfer/deposit?', bankHidden && bankShown);
  // Horário inválido é recusado.
  await setv('#profHours tr[data-day="ter"] .ph-end[data-p="m"]', '0700');
  await page.click('#profSave'); await page.waitForTimeout(200);
  const still = await page.$('#ovProf');
  console.log('end before start is refused?', !!still);
  await setv('#profHours tr[data-day="ter"] .ph-end[data-p="m"]', '12:00');
  await page.click('#profSave'); await page.waitForTimeout(300);
  const saved = await ev(`(function(){ var r = STAFF.rows.filter(function(x){ return x.data.nome === "Rita Recepção"; })[0]; return r ? {id: r.id, prof: r.professional_id, tipos: r.data.tipos, sab: r.data.horarios.sab, cargo: r.data.cargo, pay: STAFF_PAY_MEM[r.id]} : null; })()`);
  console.log('staff saved with hours (any day), contract and payments; not a professional?', !!saved && saved.prof === null && saved.tipos.join() === 'recepcao' && saved.sab.manha.inicio === '08:00' && saved.cargo === 'Recepcionista' && saved.pay.valor === 3000 && saved.pay.pagamentos.length === 2 && saved.pay.pagamentos[0].forma === 'transferencia', JSON.stringify(saved));
  const notProf = await ev('!state.professionals.some(function(p){ return p.name === "Rita Recepção"; })');
  console.log('non-professional staff does not enter the professionals list?', notProf);

  // Virar profissional: aparece a seção Atendimento e entra em config/professionals com o horário.
  await page.$eval('#staffSearch', (e) => { e.value = 'rita'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#staffListHost tbody tr'); await page.waitForSelector('#ovProf');
  const payBack = await page.$eval('#sf-valor', (e) => e.value);
  console.log('reopening shows the saved salary?', /3\.000,00/.test(payBack), payBack);
  await page.check('#sfTypes input[value="profissional"]');
  const atendShown = await page.$eval('[data-sfsec="atend"]', (e) => !e.hidden);
  const cnt = await page.$eval('#profHoursTotal', (e) => e.textContent);
  console.log('checking Profissional shows Atendimento and counts appointments?', atendShown && /atendimentos por semana/.test(cnt), cnt);
  await page.click('#profSave'); await page.waitForTimeout(300);
  const prof = await ev(`(function(){ var p = state.professionals.filter(function(x){ return x.name === "Rita Recepção"; })[0]; var r = STAFF.rows.filter(function(x){ return x.data.nome === "Rita Recepção"; })[0]; return p ? {pid: p.id, link: r.professional_id, sab: p.horarios.sab, okSat: profSlotOk(p, "sab", "08:40"), offSun: profSlotOk(p, "dom", "08:40")} : null; })()`);
  console.log('became a professional: linked, hours copied to the Planner/Agenda record?', !!prof && prof.link === prof.pid && prof.sab.manha.inicio === '08:00' && prof.okSat && !prof.offSun, JSON.stringify(prof));

  // Cadastros → Profissionais abre a mesma janela, com Profissional marcado.
  await page.$eval('#mainTabs button[data-tab=profissionais]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#addProfessionalBtn'); await page.waitForSelector('#ovProf');
  const preset = await page.$eval('#sfTypes input[value="profissional"]', (e) => e.checked);
  const atend2 = await page.$eval('[data-sfsec="atend"]', (e) => !e.hidden);
  console.log('Profissionais "+ Incluir" opens the staff window with Profissional checked?', preset && atend2);
  await page.click('#profCancel');

  // Desligamento até hoje: fica inativo (pessoa e profissional).
  await page.$eval('#mainTabs button[data-tab=funcionarios]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#staffListHost tbody tr'); await page.waitForSelector('#ovProf');
  const today = await ev('staffTodayIso()');
  await setv('#sf-deslig', today);
  await page.click('#profSave'); await page.waitForSelector('#ovConfirm');
  await page.click('#cfOk'); await page.waitForTimeout(300);
  const off = await ev(`(function(){ var p = state.professionals.filter(function(x){ return x.name === "Rita Recepção"; })[0]; var r = STAFF.rows.filter(function(x){ return x.data.nome === "Rita Recepção"; })[0]; return {p: !!p.inativo, r: !!r.data.inativo}; })()`);
  console.log('dismissal date today inactivates staff and professional?', off.p && off.r, JSON.stringify(off));
  const listed = await page.$$eval('#staffListHost tbody tr', (r) => r.length);
  console.log('dismissed person leaves the list (search "rita", Inativos off)?', listed === 0, listed);

  // Tipos de funcionário: Profissional travado.
  await page.$eval('#mainTabs button[data-tab=tiposfunc]', (b) => b.click()); await page.waitForTimeout(200);
  const types = await page.$$eval('#reg-tiposfunc-host tbody tr', (r) => r.length);
  console.log('Tipos de funcionário lists the 10 default types?', types === 10, types);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
