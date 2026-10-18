// Anamnese — link para a família (Enviar Link, Respondida pela Família) e a página pública anamnese.html
// (Supabase simulado). Dados fictícios. A automação de reavaliação é conferida em run_crm_auto.js.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_anlk.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const pat = await ev('(function(){ var p = state.patients[0]; return {id: p.id, nome: p.nome}; })()');
  const QS = [
    {id: 'q1', tipo: 'texto', titulo: 'Nome do responsável', obrigatoria: true},
    {id: 'q2', tipo: 'simnao', titulo: 'Toma medicação?', obrigatoria: true},
    {id: 'q3', tipo: 'texto', titulo: 'Qual?', obrigatoria: true, cond: {q: 'q2', op: 'igual', v: 'sim'}},
    {id: 'q4', tipo: 'escolha', titulo: 'Sono', opcoes: [{id: 'o1', label: 'Bom'}, {id: 'o2', label: 'Ruim'}]},
    {id: 'q5', tipo: 'multipla', titulo: 'Marque', opcoes: [{id: 'm1', label: 'A'}, {id: 'm2', label: 'B'}]},
    {id: 'q6', tipo: 'data', titulo: 'Data do diagnóstico'},
    {id: 'q7', tipo: 'arquivo', titulo: 'Laudo', obrigatoria: true},
    {id: 'q8', tipo: 'assinatura', titulo: 'Assinatura'}];
  await ev(`state.anamTypes = [{id: "t1", name: "Anamnese Inicial", validadeMeses: 12, versao: 1, descricao: "Conte sobre a criança.", perguntas: ${JSON.stringify(QS)}}]`);
  // 1) App: criar a anamnese, enviar o link
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="anamneses"]').click());
  await page.waitForTimeout(300);
  await page.click('#amAdd'); await page.waitForSelector('#ovAnNew');
  await page.evaluate((id) => { for (const [s, v] of [['anwType', 't1'], ['anwPat', id]]) { const el = document.getElementById(s); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); } }, pat.id);
  await page.click('#anwGo'); await page.waitForSelector('#ovAnam');
  check('draft shows the "Enviar Link para a Família" button?', !!(await page.$('#amLink')));
  await page.click('#amLink'); await page.waitForSelector('#ovAnLink');
  check('link window starts without a link and with the explanation?', await page.$eval('#alBox', (e) => e.hidden) && /7 dias/.test(await page.textContent('#ovAnLink .modal-sub')));
  await page.click('#alGen'); await page.waitForTimeout(200);
  const url = await page.inputValue('#alUrl');
  check('link generated in the short /a/<code> format?', /\/a\/[A-Za-z0-9]{10}$/.test(url), url);
  const tok = url.split('/a/')[1];
  check('link saved with the anamnese id and 7 days?', await ev(`(function(){ var l = AN.memLinks[0]; return l && l.anamnese_id === AN.mem[0].id && Math.round((new Date(l.expires_at) - new Date(l.created_at)) / 864e5) === 7; })()`));
  await page.click('#alClose'); await page.waitForTimeout(60);
  await page.click('#amLink'); await page.waitForSelector('#ovAnLink'); await page.waitForTimeout(150);
  check('reopening shows the active link again?', !(await page.$eval('#alBox', (e) => e.hidden)) && (await page.inputValue('#alUrl')) === url);
  await page.click('#alGen'); await page.waitForTimeout(200);
  check('"Gerar Outro Link" cancels the old one?', await ev('AN.memLinks.length === 2 && !!AN.memLinks[0].canceled_at && !AN.memLinks[1].canceled_at'));
  const url2 = await page.inputValue('#alUrl'), tok2 = url2.split('/a/')[1];
  await page.click('#alClose2');

  // 2) Página pública (Supabase simulado)
  const pub = await browser.newPage({ viewport: { width: 390, height: 800 } });
  pub.on('pageerror', (e) => errors.push('anamnese.html: ' + e.message));
  let sent = null, state = 'ok';
  await pub.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (/\/anamnese\?|\/a\//.test(u)) return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '..', 'anamnese.html'), 'utf8')});
    if (/\/favicon\.png/.test(u)) return route.fulfill({status: 404, body: ''});
    if (/\/js\/redes\.js/.test(u)) return route.fulfill({contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'js', 'redes.js'), 'utf8')});
    if (/\/api\/config/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify({supabaseUrl: 'http://pipo.test/sb', supabaseAnonKey: 'sb_publishable_teste', redes: [{rede: 'instagram', url: 'instagram.com/clinica'}]})});
    if (/rpc\/anamnese_form/.test(u)) return route.fulfill({contentType: 'application/json', body: JSON.stringify(state === 'ok'
      ? {ok: true, nome: 'Duda', tipo: 'Anamnese Inicial', descricao: 'Conte sobre a criança.', perguntas: QS, respostas: {q1: 'Mãe da Duda', q6: '2024-03-09'}, clinica: {nome: 'Clínica Fictícia', redes: [{rede: 'instagram', url: 'instagram.com/clinica'}]}}
      : {ok: false, motivo: state})});
    if (/rpc\/anamnese_send/.test(u)) { sent = JSON.parse(route.request().postData()); return route.fulfill({contentType: 'application/json', body: JSON.stringify({ok: true})}); }
    return route.fulfill({status: 404, body: ''});
  });
  await pub.goto('http://pipo.test/a/' + tok);
  await pub.waitForSelector('#frm');
  check('public: clinic name, type and patient in the header?', (await pub.textContent('#cName')) === 'Clínica Fictícia' && /Anamnese Inicial — Duda/.test(await pub.textContent('#cSub')));
  check('public: answers already filled come prefilled (text and date as dd/mm/aaaa)?', (await pub.inputValue('#q-q1')) === 'Mãe da Duda' && (await pub.inputValue('#q-q6')) === '09/03/2024');
  check('public: conditional question hidden, file question not shown?', await pub.$eval('[data-qid="q3"]', (e) => e.hidden) && !(await pub.$('[data-qid="q7"]')));
  await pub.fill('#q-q1', ''); await pub.click('#send'); await pub.waitForTimeout(100);
  check('public: required answers checked before sending (the file question is ignored)?', sent === null && (await pub.$$('.bad')).length >= 1 && /Responda as perguntas/.test(await pub.textContent('#err')));
  await pub.fill('#q-q1', 'Maria');
  await pub.click('[data-qid="q2"] input[value=sim]'); await pub.waitForTimeout(60);
  check('public: answering Sim shows the conditional question', !(await pub.$eval('[data-qid="q3"]', (e) => e.hidden)));
  await pub.click('#send'); await pub.waitForTimeout(100);
  check('public: the shown conditional is required', sent === null);
  await pub.fill('#q-q3', 'Risperidona');
  await pub.fill('#q-q6', '31/02/2024'); await pub.click('#send'); await pub.waitForTimeout(100);
  check('public: invalid date refused', sent === null && /inválidos/.test(await pub.textContent('#err')));
  await pub.fill('#q-q6', '09/03/2024');
  await pub.click('[data-qid="q4"] input[value=o2]'); await pub.click('[data-qid="q5"] input[value=m1]'); await pub.click('[data-qid="q5"] input[value=m2]');
  const cv = await pub.$('canvas[data-sign="q8"]'); const bb = await cv.boundingBox();
  await pub.mouse.move(bb.x + 20, bb.y + 30); await pub.mouse.down(); await pub.mouse.move(bb.x + 120, bb.y + 60, {steps: 5}); await pub.mouse.up();
  await pub.click('[data-qid="q2"] input[value=nao]'); await pub.waitForTimeout(60);
  check('public: answering Não hides the conditional again', await pub.$eval('[data-qid="q3"]', (e) => e.hidden));
  await pub.click('#send'); await pub.waitForTimeout(300);
  check('public: sent with the token and only visible answers (dates in ISO, multi as list, signature as image)?',
    sent && sent.p_token === tok && sent.p_answers.q1 === 'Maria' && sent.p_answers.q2 === 'nao' && !('q3' in sent.p_answers) && sent.p_answers.q4 === 'o2'
    && JSON.stringify(sent.p_answers.q5) === '["m1","m2"]' && sent.p_answers.q6 === '2024-03-09' && /^data:image\/png/.test(sent.p_answers.q8) && !('q7' in sent.p_answers), sent && JSON.stringify(Object.keys(sent.p_answers)));
  const ty = await pub.textContent('#box');
  check('public: thank-you with the network logos?', /Anamnese enviada/.test(ty) && /redes sociais/.test(ty) && (await pub.$$('#box .done a.soc-link')).length >= 1);
  check('public: fits the phone screen (no sideways scroll)?', await pub.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  for (const [st, re] of [['usado', /já foi usado/], ['vencido', /venceu/], ['cancelado', /cancelado/], ['invalido', /não existe/]]) {
    state = st; await pub.goto('http://pipo.test/a/' + tok); await pub.waitForTimeout(250);
    check('public: link ' + st + ' shows a clear message', re.test(await pub.textContent('#box')));
  }

  // 3) App: resposta da família vira rascunho com etiqueta; concluir limpa a marca
  if (await page.$('#ovAnam')) await page.click('#amCancel');
  await page.waitForTimeout(100);
  await ev(`(function(){ var r = AN.mem[0]; r.answers = Object.assign({}, r.answers, {q1: "Maria", q2: "nao"}); r.family = new Date().toISOString(); })()`);
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="anamneses"]').click());
  await page.waitForTimeout(300); await ev('renderAnamneses()');
  check('list shows the "Respondida pela Família" chip on the draft?', /Respondida pela Família/.test(await page.textContent('#reg-anamneses-host tbody tr:first-child')));
  await page.click('#reg-anamneses-host tbody tr'); await page.waitForSelector('#ovAnam');
  check('window shows the review banner?', /Respondida pela família/.test(await page.textContent('#ovAnam .ik-note')));
  await page.fill('#anq-q1', 'Maria Souza');
  await page.click('#amDraft'); await page.waitForTimeout(250);
  check('saving the draft keeps the family mark?', !!(await ev('AN.mem[0].family')));
  await page.click('#reg-anamneses-host tbody tr'); await page.waitForSelector('#ovAnam');
  await page.click('#amDone'); await page.waitForSelector('#cfOk', {timeout: 3000});
  await page.click('#cfOk'); await page.waitForTimeout(300);
  check('concluding clears the family mark and locks the anamnese?', (await ev('AN.mem[0].status')) === 'concluida' && !(await ev('AN.mem[0].family')));
  check('concluded row no longer shows the chip?', !/Respondida pela Família/.test(await page.textContent('#reg-anamneses-host tbody tr:first-child')));
  await page.click('#reg-anamneses-host tbody tr'); await page.waitForSelector('#ovAnam');
  check('concluded anamnese has no "Enviar Link" button?', !(await page.$('#amLink')));
  console.log('errors:', errors.length ? errors : 'none');
  console.log('no JS errors?', errors.length === 0);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
})();
