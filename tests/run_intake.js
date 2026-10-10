// Link de cadastro rápido (2026-10-10): gerar link, aviso no botão Cadastros, revisar envio de
// paciente novo (cadastro + tratamento com o convênio) e de paciente existente (campos diferentes
// destacados), e a página pública cadastro.html (com o Supabase simulado). Dados fictícios.
// Cria tests/page_ik.html com um "eval" para chamar o app direto.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_ik.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + pg);
  await page.waitForTimeout(700);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };

  // 0) Antes do fim do script (perfil já carregado no início), as funções não quebram.
  const early = await ev('(function(){ var keep = INTAKE; INTAKE = undefined; try { intakeBadge(); intakeLoad(); intakePendingFor("x"); mnavRender(); return true; } catch(e){ return e.message; } finally { INTAKE = keep; } })()');
  check('link functions are safe before the module is ready?', early === true, early);

  // 1) Gerar link de atualização: já leva os dados do paciente; WhatsApp com a mensagem e o link.
  await ev('window.__opened = []; window.open = function(u){ window.__opened.push(u); return null; }; true');
  await ev('openIntakeLinkModal({kind: "atualizacao", patient: rawPatient("ana-azul")})');
  await page.waitForSelector('#ovIntake');
  await page.fill('#ikTel', '47999990000');
  await page.click('#ikGen'); await page.waitForTimeout(150);
  const url = await page.inputValue('#ikUrl');
  check('link generated (/cadastro?t=…)?', /\/cadastro\?t=t/.test(url), url);
  const link = await ev('intakeMem().links[0]');
  check('update link carries the patient data and lasts 7 days?', link.kind === 'atualizacao' && link.patient_id === 'ana-azul' && link.prefill.nome === 'Ana Azul' &&
    Math.round((new Date(link.expires_at) - new Date(link.created_at)) / 864e5) === 7, {k: link.kind, pf: link.prefill, exp: link.expires_at});
  await page.click('#ikWa');
  const wa = await ev('window.__opened[0]');
  check('WhatsApp opens wa.me with 55+phone and the link in the text?', /^https:\/\/wa\.me\/5547999990000\?text=/.test(wa) && decodeURIComponent(wa).indexOf(url) !== -1, wa);
  await page.click('#ikClose');

  // 2) Envio pendente: número no botão Cadastros e botão "Revisar cadastro" na tela Pacientes.
  await ev(`(function(){ intakeMem().subs.push({id: "s1", kind: "novo", status: "pendente", created_at: new Date().toISOString(), patient_id: null, task_id: null,
    data: {nome: "Caio Link Teste", nascimento: "2020-03-04", cpf: "52998224725", sexo: "Masculino", respNome: "Rita Link", respParentesco: "Mãe", telefone: "47988881111",
      email: "rita@exemplo.com", cep: "89010000", numero: "10", rua: "Rua A", bairro: "Centro", cidade: "Blumenau", uf: "SC", convenio: "Unimed", diagnostico: "TEA", laudo: "Sim", escola: "Escola Fictícia X", obs: "Prefere manhã"}});
    return intakeLoad().then(function(){ return true; }); })()`);
  await page.waitForTimeout(100);
  check('Cadastros button shows the count of pending submissions?', await page.$eval('#cadBadge', (e) => !e.hidden && e.textContent === '1'));
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); await page.waitForTimeout(200);
  check('"Revisar cadastro" button on the Pacientes screen?', await page.isVisible('#intakeRevBtn'));
  await page.click('#intakeRevBtn');
  await page.waitForSelector('#ovPat');
  const nv = await page.evaluate(() => ({nome: document.getElementById('pNome').value, mae: (document.getElementById('pm-mae-nome') || {}).value, banner: !!document.querySelector('#ovPat .ik-banner'),
    obs: (document.getElementById('pf-obs') || {}).value || '', cpf: (document.getElementById('pf-cpf') || {}).value}));
  check('review opens the new-patient window filled from the submission (with notice)?', nv.nome === 'Caio Link Teste' && nv.mae === 'Rita Link' && nv.banner && /Laudo: Sim/.test(nv.obs) && /Escola Fictícia X/.test(nv.obs), nv);
  await page.click('#pSave'); await page.waitForTimeout(500);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(400); }
  const after = await ev(`(function(){ var p = state.patientsRaw.filter(function(x){ return x.nome === "Caio Link Teste"; })[0]; var trs = p ? state.treatments.filter(function(t){ return t.patientId === p.id; }) : [];
    return {p: !!p, tel: p && p.telefones && p.telefones[0] && p.telefones[0].numero, fin: p && p.financeiro && p.financeiro.link, tr: trs.length, conv: trs[0] && trs[0].convenio, st: intakeMem().subs[0].status, res: intakeMem().subs[0].result_patient_id === (p && p.id)}; })()`);
  check('saved: patient created, treatment with the convênio, submission approved?', after.p && after.tel === '47988881111' && after.fin === 'mae' && after.tr === 1 && after.conv === 'Unimed' && after.st === 'aprovado' && after.res, after);
  check('badge gone after the review?', await page.$eval('#cadBadge', (e) => e.hidden) && !(await page.isVisible('#intakeRevBtn')));

  // 3) Atualização de paciente existente: campos diferentes destacados; telefone novo incluído.
  await ev(`(function(){ intakeMem().subs.push({id: "s2", kind: "atualizacao", status: "pendente", created_at: new Date().toISOString(), patient_id: "ana-azul",
    data: {nome: "Ana Azul", telefone: "47977776666", cep: "89020000", rua: "Rua Nova", numero: "99"}}); return intakeLoad().then(function(){ return true; }); })()`);
  await page.waitForTimeout(100);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  check('patient window shows "Revisar cadastro" when a submission is pending?', await page.isVisible('#pReview') && await page.isVisible('#pAskUpd'));
  await page.click('#pReview'); await page.waitForTimeout(300);
  const df = await page.evaluate(() => ({diffs: document.querySelectorAll('#ovPat .ik-diff').length, rua: document.getElementById('pa-rua').value,
    bar: (document.querySelector('#pa-rua') && document.querySelector('#pa-rua').closest('.field').querySelector('.ik-diff-bar') || {}).textContent || '',
    tels: [...document.querySelectorAll('#telHost [data-tk="numero"]')].map((x) => x.value)}));
  check('existing patient: differing fields highlighted, empty ones filled, new phone added?', df.diffs >= 2 && df.rua === 'Rua Nova' && /Usando o enviado/.test(df.bar) && df.tels.some((t) => /97777-6666/.test(t)), df);
  if (!(await page.inputValue('#pf-cpf'))) await page.fill('#pf-cpf', '111.444.777-35');
  await page.click('#pSave'); await page.waitForTimeout(500);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(400); }
  const upd = await ev('(function(){ var p = rawPatient("ana-azul"); return {rua: p.endereco && p.endereco.rua, tel: (p.telefones || []).map(function(t){ return t.numero; }), st: intakeMem().subs[1].status}; })()');
  check('update saved with the chosen values and submission approved?', upd.rua === 'Rua Nova' && upd.tel.indexOf('47977776666') !== -1 && upd.st === 'aprovado', upd);

  // 4) Descartar envio.
  await ev(`(function(){ intakeMem().subs.push({id: "s3", kind: "geral", status: "pendente", created_at: new Date().toISOString(), data: {nome: "Spam", telefone: "11"}}); return intakeLoad().then(function(){ return true; }); })()`);
  await ev('intakeReview(INTAKE.subs[0])'); await page.waitForSelector('#ovPat');
  await page.click('#ikDiscard'); await page.waitForSelector('#cfOk'); await page.click('#cfOk'); await page.waitForTimeout(200);
  check('discard: window closed and submission marked as discarded?', !(await page.$('#ovPat')) && (await ev('intakeMem().subs[2].status')) === 'descartado');

  // 5) Página pública cadastro.html (Supabase simulado).
  const pub = await browser.newPage({ viewport: { width: 390, height: 800 } });
  pub.on('pageerror', (e) => errors.push('cadastro.html: ' + e.message));
  let sent = null;
  await pub.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (/\/cadastro\?/.test(u)) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', 'cadastro.html'), 'utf8')});
    if (/\/favicon\.png/.test(u)) return route.fulfill({status: 404, body: ''});
    if (/\/api\/config/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({supabaseUrl: 'http://pipo.test/sb', supabaseAnonKey: 'sb_publishable_teste'})});
    if (/rpc\/intake_form/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, kind: 'novo', nome: 'Duda', prefill: {}, clinica: {nome: 'Clínica Fictícia'}, convenios: ['Unimed'], origens: ['Instagram']})});
    if (/rpc\/intake_send/.test(u)) { sent = JSON.parse(route.request().postData()); return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true})}); }
    return route.fulfill({status: 404, body: ''});
  });
  await pub.route('https://viacep.com.br/**', (route) => route.fulfill({contentType: 'application/json', body: JSON.stringify({logradouro: 'Rua do CEP', bairro: 'Velha', localidade: 'Blumenau', uf: 'SC'})}));
  await pub.goto('http://pipo.test/cadastro?t=abc');
  await pub.waitForSelector('#frm');
  check('public form opens with the clinic name and the patient name?', (await pub.textContent('#cName')) === 'Clínica Fictícia' && (await pub.inputValue('#nome')) === 'Duda');
  await pub.click('#send'); await pub.waitForTimeout(100);
  check('public form: required fields and consent are checked before sending?', sent === null && (await pub.$$('.bad')).length >= 4 && /autorização/.test(await pub.textContent('#err')));
  // Padrão do sistema no celular: listas abrem a janela de baixo; data digitável (dd/mm/aaaa) + calendário; campos de 44px.
  const look = await pub.evaluate(() => ({natives: [...document.querySelectorAll('#frm select')].every((s) => getComputedStyle(s).display === 'none'),
    btns: document.querySelectorAll('#frm .pk-btn').length, h: [...document.querySelectorAll('#frm input[type=text], #frm .pk-btn')].every((e) => Math.round(e.getBoundingClientRect().height) === 44),
    inCard: [...document.querySelectorAll('#frm input, #frm .pk-btn, #frm .pk-cal-btn')].every((e) => e.getBoundingClientRect().right <= document.getElementById('box').getBoundingClientRect().right)}));
  check('phone: lists are system buttons, fields 44px and nothing passes the card edge?', look.natives && look.btns >= 4 && look.h && look.inCard, look);
  check('phone: the date field opens no keyboard (read-only) and has no separate calendar button?', await pub.$eval('#nascimento', (e) => e.readOnly) && !(await pub.isVisible('[data-cal="nascimento"]')));
  await pub.click('#nascimento'); await pub.waitForTimeout(100);
  check('tapping the date opens the selection window?', !!(await pub.$('#pkSheet .pk-cal')));
  await pub.click('#pkSheet [data-years]'); await pub.waitForTimeout(80);
  await pub.click('#pkSheet [data-y="2019"]'); await pub.waitForTimeout(80);
  const ym = await pub.textContent('#pkSheet .pk-cal-t');
  check('year list jumps to the chosen year?', /2019/.test(ym), ym);
  await pub.click('#pkSheet .pk-x'); await pub.waitForTimeout(60);
  await pub.$eval('#nascimento', (e) => { e.value = '06/05/2019'; });
  await pub.click('#nascimento'); await pub.waitForTimeout(100);
  const cal = await pub.evaluate(() => ({sheet: !!document.querySelector('#pkSheet .pk-cal'), title: (document.querySelector('#pkSheet .pk-head b') || {}).textContent, sel: (document.querySelector('#pkSheet .pk-cal-g .sel') || {}).textContent}));
  check('calendar opens in the bottom window with the typed day selected?', cal.sheet && cal.title === 'Data de nascimento' && cal.sel === '6', cal);
  await pub.click('#pkSheet [data-d="2019-05-07"]'); await pub.waitForTimeout(80);
  check('picking a day fills the field and closes?', (await pub.inputValue('#nascimento')) === '07/05/2019' && !(await pub.$('#pkSheet')));
  await pub.click('#nascimento'); await pub.waitForTimeout(80); await pub.click('#pkSheet [data-clear]'); await pub.waitForTimeout(60);
  check('"Limpar" empties the date?', (await pub.inputValue('#nascimento')) === '');
  await pub.$eval('#nascimento', (e) => { e.value = '07/05/2019'; });
  await pub.fill('#cpf', '11111111111');
  await pub.fill('#respNome', 'Mara');
  await pub.click('#respParentesco + .pk-btn'); await pub.waitForTimeout(100);
  const sh = await pub.evaluate(() => ({title: (document.querySelector('#pkSheet .pk-head b') || {}).textContent, n: document.querySelectorAll('#pkSheet .pk-opt').length,
    h: Math.round(document.querySelector('#pkSheet .pk-opt').getBoundingClientRect().height)}));
  check('Parentesco opens the bottom window (title, 52px options)?', sh.title === 'Parentesco' && sh.n === 5 && sh.h >= 52, sh);
  await pub.click('#pkSheet .pk-opt[data-v="Mãe"]'); await pub.waitForTimeout(80);
  check('choosing fills the field and closes the window?', (await pub.inputValue('#respParentesco')) === 'Mãe' && /Mãe/.test(await pub.textContent('#respParentesco + .pk-btn')) && !(await pub.$('#pkSheet')));
  await pub.fill('#telefone', '47966665555');
  await pub.check('#consent'); await pub.click('#send'); await pub.waitForTimeout(100);
  check('public form: invalid CPF refused?', sent === null && /CPF inválido/.test(await pub.textContent('#err')));
  await pub.fill('#cpf', '529.982.247-25'); await pub.fill('#cep', '89010000'); await pub.dispatchEvent('#cep', 'change'); await pub.waitForTimeout(200);
  check('CEP fills the street?', (await pub.inputValue('#rua')) === 'Rua do CEP');
  await pub.click('#send'); await pub.waitForTimeout(300);
  check('public form sent (digits only, consent) and thank-you shown?', sent && sent.p_token === 'abc' && sent.p_data.cpf === '52998224725' && sent.p_data.telefone === '47966665555' && sent.p_data.consentimento === true && sent.p_data.nascimento === '2019-05-07' && sent.p_data.respParentesco === 'Mãe' && /Cadastro enviado/.test(await pub.textContent('#box')), sent);
  const noH = await pub.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('public form fits the phone screen (no sideways scroll)?', noH);
  await pub.unroute('http://pipo.test/**');
  await pub.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (/\/cadastro\?/.test(u)) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', 'cadastro.html'), 'utf8')});
    if (/\/api\/config/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({supabaseUrl: 'http://pipo.test/sb', supabaseAnonKey: 'sb_publishable_teste'})});
    if (/rpc\/intake_form/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: false, motivo: 'usado'})});
    return route.fulfill({status: 404, body: ''});
  });
  await pub.goto('http://pipo.test/cadastro?t=old'); await pub.waitForTimeout(300);
  // Campos do link escolhidos em Campos obrigatórios: some o CPF, Escola vira obrigatória.
  await pub.unroute('http://pipo.test/**');
  sent = null;
  await pub.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (/\/cadastro\?/.test(u)) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', 'cadastro.html'), 'utf8')});
    if (/\/api\/config/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({supabaseUrl: 'http://pipo.test/sb', supabaseAnonKey: 'sb_publishable_teste'})});
    if (/rpc\/intake_form/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true, kind: 'geral', nome: '', prefill: {}, clinica: {nome: 'C'}, convenios: [], origens: [],
      campos: {cpf: {show: false, req: false}, nascimento: {show: true, req: false}, responsavel: {show: false, req: false}, escola: {show: true, req: true}, endereco: {show: false, req: false}}})});
    if (/rpc\/intake_send/.test(u)) { sent = JSON.parse(route.request().postData()); return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true})}); }
    return route.fulfill({status: 404, body: ''});
  });
  await pub.setViewportSize({width: 1300, height: 900});
  await pub.goto('http://pipo.test/cadastro?t=g'); await pub.waitForSelector('#frm');
  await pub.click('#sexo + .pk-btn'); await pub.waitForTimeout(80);
  const dk = await pub.evaluate(() => { const p = document.getElementById('pkPop'), b = document.querySelector('#sexo + .pk-btn'); if (!p) return null; const r = p.getBoundingClientRect(), br = b.getBoundingClientRect();
    return {glued: Math.abs(r.top - br.bottom - 4) < 2, sheet: !!document.getElementById('pkSheet'), h: Math.round(br.height)}; });
  check('computer: list floats glued under the field (no bottom window), fields 38px?', dk && dk.glued && !dk.sheet && dk.h === 38, dk);
  await pub.keyboard.press('Escape');
  await pub.type('#nascimento', '06052019');
  check('computer: birth date can be typed as dd/mm/aaaa?', (await pub.inputValue('#nascimento')) === '06/05/2019');
  await pub.fill('#nascimento', '');
  const shownIds = await pub.$$eval('#frm input, #frm select, #frm textarea', (a) => a.map((x) => x.id));
  check('link fields follow the configuration (no CPF/responsável/endereço; escola required)?', shownIds.indexOf('cpf') === -1 && shownIds.indexOf('respNome') === -1 && shownIds.indexOf('cep') === -1 &&
    await pub.$eval('#escola', (e) => e.required) && !(await pub.$eval('#nascimento', (e) => e.required)), shownIds);
  await pub.fill('#nome', 'Ze'); await pub.fill('#telefone', '47955554444'); await pub.check('#consent'); await pub.click('#send'); await pub.waitForTimeout(100);
  check('configured required field (escola) blocks sending?', sent === null && await pub.$eval('#escola', (e) => e.classList.contains('bad')));
  await pub.fill('#escola', 'Escola Y'); await pub.click('#send'); await pub.waitForTimeout(300);
  check('sends with only the configured fields?', sent && sent.p_data.escola === 'Escola Y' && /Cadastro enviado/.test(await pub.textContent('#box')), sent && sent.p_data);
  await pub.unroute('http://pipo.test/**');
  await pub.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (/\/cadastro\?/.test(u)) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', 'cadastro.html'), 'utf8')});
    if (/\/api\/config/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({supabaseUrl: 'http://pipo.test/sb', supabaseAnonKey: 'sb_publishable_teste'})});
    if (/rpc\/intake_form/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: false, motivo: 'usado'})});
    return route.fulfill({status: 404, body: ''});
  });
  await pub.goto('http://pipo.test/cadastro?t=old'); await pub.waitForTimeout(300);
  check('used link shows "Link indisponível"?', /Link indisponível/.test(await pub.textContent('#box')) && /já foi usado/.test(await pub.textContent('#box')));

  // Janela Campos obrigatórios: colunas Aparece, Link rápido, Link fixo e Obrigatório numa tabela só.
  await page.bringToFront();
  await ev('openPatientFieldsModal()'); await page.waitForSelector('#ovPf');
  const hd = await page.$$eval('#ovPf thead th', (a) => a.map((x) => x.textContent));
  const lockNome = await page.$eval('tr[data-pfk="nome"] [data-pfx="fixo"]', (e) => e.disabled && e.checked);
  check('Campos obrigatórios columns: Campo, Aparece, Link rápido, Link fixo, Obrigatório (Nome locked)?', JSON.stringify(hd) === '["Campo","Aparece","Link rápido","Link fixo","ObrigatórioObrig."]' && lockNome, hd);
  check('link-only fields (Responsável, Convênio, Laudo) listed?', (await page.$$('tr[data-lonly]')).length === 3);
  const stick = await page.evaluate(() => new Promise((res) => { const body = document.querySelector('#ovPf .modal-body'); body.scrollTop = 600;
    setTimeout(() => { const th = document.querySelector('#ovPf thead th').getBoundingClientRect(), bb = body.getBoundingClientRect(); res(Math.abs(th.top - bb.top) < 2 && body.scrollTop > 100); }, 100); }));
  check('column titles stay on top while scrolling the window?', stick);
  await page.evaluate(() => { document.querySelector('#ovPf .modal-body').scrollTop = 0; });
  const fit = await page.evaluate(() => { const m = document.querySelector('#ovPf .modal-body'); return m.scrollWidth <= m.clientWidth + 1; });
  check('table fits the window (no sideways scroll)?', fit);
  await page.setViewportSize({width: 390, height: 800}); await page.waitForTimeout(200);
  const fitM = await page.evaluate(() => { const m = document.querySelector('#ovPf .modal-body'); return m.scrollWidth <= m.clientWidth + 1; });
  check('table fits a phone screen?', fitM);
  await page.setViewportSize({width: 1300, height: 850}); await page.waitForTimeout(200);
  await page.uncheck('tr[data-pfk="cpf"] [data-pfx="fixo"]');
  await page.check('tr[data-pfk="escolaId"] [data-pfx="req"]');
  await page.uncheck('tr[data-pfk="escolaId"] [data-pfx="rapido"]');
  await page.click('#pfSave'); await page.waitForTimeout(300);
  const lk = await ev('({link: state.patientLink, esc: state.patientFields.escolaId})');
  check('saved: CPF out of the fixed link; escola required in the fixed link and in the cadastro, not in the quick link?', lk.link.geral.cpf.show === false && lk.link.individual.cpf.show === true &&
    lk.link.geral.escola.req === true && lk.link.individual.escola.show === false && lk.link.individual.escola.req === false && lk.esc.req === true && lk.esc.show === true, lk);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(pg); } catch (e) {}
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
