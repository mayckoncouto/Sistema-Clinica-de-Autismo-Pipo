// Tratamentos: cadastro, tipo automático (Novo/Renegociado), um só Ativo por
// paciente, bolinha de cor, paciente "somado" ao tratamento (ABA no Planner) e
// dupla verificação de terapeuta no Planner.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html') + '#tratamentos');
  await page.waitForSelector('#trHost');
  await page.waitForTimeout(500);
  // Cancelados e Renegociados ficam ocultos por padrão: os testes mostram todos.
  await page.check('#trShowCanc'); await page.check('#trShowReneg');

  const store = () => page.evaluate(() => JSON.parse(JSON.stringify((window.__STORE__['treatments/all'] || {list: []}).list)));
  async function openNew(pid){
    await page.click('#trAdd'); await page.waitForSelector('#ovTreat');
    await page.$eval('#trPat', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, pid);
    await page.waitForTimeout(200);
  }
  async function save(){
    await page.click('#trSave'); await page.waitForTimeout(200);
    if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(200); }
    if (await page.$('#rbNo')) { await page.click('#rbNo'); await page.waitForTimeout(100); }
  }

  console.log('missing-treatment notice counts all 6 patients?', (await page.textContent('#trMissing')).includes('6 pacientes'));
  // Só pacientes ATIVOS sem tratamento entram no aviso.
  const setInativo = (on) => page.evaluate(async (v) => {
    const db = await window.claude.use('db');
    const cur = JSON.parse(JSON.stringify(window.__STORE__['patients/all']));
    if (v) cur.list[0].inativo = true; else delete cur.list[0].inativo;
    await db.doc('patients/all').set(cur);
  }, on);
  await setInativo(true); await page.waitForTimeout(300);
  const missTxt = await page.textContent('#trMissing');
  console.log('an inactive patient is not counted as "sem tratamento ativo"?', missTxt.includes('5 pacientes'), missTxt);
  await setInativo(false); await page.waitForTimeout(300);

  // 1º tratamento: Novo; campos vêm do cadastro antigo; valor final automático.
  await openNew('duda-vermelho');
  console.log('first treatment is "novo" and the type field is locked?', await page.$eval('#trTipo', (s) => s.value === 'novo' && s.disabled));
  console.log('old ABA "Não" comes from the patient record?', (await page.$eval('#pAba', (s) => s.value)) === 'Não');
  await page.fill('#trVal', '1.500,00'); await page.fill('#trDesp', '200');
  console.log('final value = valor - descontos?', (await page.inputValue('#trFinal')) === 'R$ 1.300,00');
  await save();
  let L = await store();
  console.log('saved as Ativo/Novo with numbers?', L.length === 1 && L[0].status === 'ativo' && L[0].tipo === 'novo' && L[0].valor === 1500 && L[0].descontos === 200);

  // 2º com o 1º ainda ativo: confirma, o 1º vira Renegociado e o novo é Renegociado.
  await openNew('duda-vermelho');
  await page.$eval('#pAba', (s) => { s.value = 'Sim'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await save();
  L = (await store()).filter((t) => t.patientId === 'duda-vermelho');
  console.log('only one Ativo after the second treatment?', L.filter((t) => t.status === 'ativo').length === 1);
  console.log('previous became Renegociado and the new one is Renegociado?', L.some((t) => t.status === 'renegociado' && t.tipo === 'novo') && L.some((t) => t.status === 'ativo' && t.tipo === 'renegociado'));

  // Cancelar o ativo → o próximo é Novo.
  await page.click('#trHost tbody tr:has(.st-ativo)'); await page.waitForSelector('#ovTreat');
  await page.$eval('#trSt', (s) => { s.value = 'cancelado'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  console.log('choosing Cancelado shows the reason box?', await page.isVisible('#trCancelBox'));
  await page.click('#trSave'); await page.waitForTimeout(200);
  console.log('cannot cancel without a reason?', !!(await page.$('#ovTreat')) && (await store()).some((t) => t.patientId === 'duda-vermelho' && t.status === 'ativo'));
  await page.$eval('#trMot', (s) => { s.value = 'outro'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.click('#trSave'); await page.waitForTimeout(200);
  console.log('"Outro" requires the cancellation note?', !!(await page.$('#ovTreat')) && (await store()).some((t) => t.patientId === 'duda-vermelho' && t.status === 'ativo'));
  await page.fill('#trObsCancel', 'Família pediu pausa');
  // Um agendamento da Duda no Planner: ao cancelar, a janela pergunta se remove.
  await page.evaluate(async () => { const db = await window.claude.use('db'); const d = await db.doc('schedule/ter-2').get(); const bk = Object.assign({}, (d.exists && d.data().bookings) || {}); bk['09:20|r1|r1-t1'] = {patient: 'Duda Vermelho', note: ''}; await db.doc('schedule/ter-2').set({bookings: bk}); });
  await page.click('#trSave'); await page.waitForTimeout(200);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(200); }
  await page.waitForSelector('#ovRmBk', {timeout: 3000}).catch(() => {});
  const rbTxt = await page.textContent('#ovRmBk').catch(() => '');
  console.log('cancelling asks to remove the Planner bookings (count shown)?', /Planner/.test(rbTxt) && /1 agendamento/.test(rbTxt), rbTxt.slice(0, 120));
  await page.check('#rbPl'); await page.click('#rbYes'); await page.waitForTimeout(400);
  console.log('Planner booking removed after confirming?', await page.evaluate(() => !(((window.__STORE__['schedule/ter-2'] || {}).bookings || {})['09:20|r1|r1-t1'])));
  L = (await store()).filter((t) => t.patientId === 'duda-vermelho');
  const canc = L.filter((t) => t.status === 'cancelado')[0];
  console.log('cancelled with reason, note and history entry?', !!canc && canc.motivoCancel === 'outro' && canc.obsCancel === 'Família pediu pausa' &&
    canc.historico.some((h) => h.de === 'ativo' && h.para === 'cancelado' && h.motivo === 'outro'));
  const patInact = await page.evaluate(async () => { const db = await window.claude.use('db'); const d = await db.doc('patients/all').get(); const p = (d.data().list || []).filter((x) => x.id === 'duda-vermelho')[0]; return p ? !!p.inativo : null; });
  const stillActive = L.some((t) => t.status === 'ativo');
  console.log('cancelling the treatment inactivates the patient (when no other is active)?', stillActive ? patInact === false : patInact === true, stillActive, patInact);
  console.log('auto-renegotiated treatment got a history entry?', L.some((t) => t.status === 'renegociado' && (t.historico || []).some((h) => h.auto)));
  await page.click('#trHost tbody tr:has(.st-cancelado)'); await page.waitForSelector('#ovTreat');
  console.log('cancelled treatment: status locked and history shown?', await page.$eval('#trSt', (s) => s.disabled) && /Ativo → Cancelado/.test(await page.textContent('#ovTreat .tr-hist')));
  await page.click('#trCancel');
  await openNew('duda-vermelho');
  console.log('after a cancelled treatment the next one is "novo"?', (await page.$eval('#trTipo', (s) => s.value)) === 'novo');
  await page.click('#trCancel');

  // Bolinha de cor na lista de Tratamentos.
  console.log('treatment list shows the color dot before the name?', (await page.locator('#trHost tbody tr .pt-nome .pcolor-dot, #trHost tbody tr td:first-child .pcolor-dot').count()) > 0);

  // Paciente "somado" ao tratamento: Bruno com ABA "Não" no tratamento fica vermelho no Planner.
  await openNew('bruno-verde');
  await page.$eval('#pAba', (s) => { s.value = 'Não'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.$eval('#specRowsHost .hours-row:nth-child(1) .spec-prof', (s) => { s.value = 'andrelisa-terapeuta'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await save();
  await page.$eval('#mainTabs button[data-tab="pacientes"]', (b) => b.click()); await page.waitForTimeout(200);
  const brunoRow = await page.$$eval('#patListHost tbody tr', (trs) => { const r = trs.find((t) => t.textContent.includes('Bruno Verde')); const d = r && r.querySelector('.pcolor-dot'); return r ? {st: r.querySelector('.pt-trat').textContent.trim(), dot: d ? d.getAttribute('style') : ''} : null; });
  console.log('patient list shows the treatment status and the "não ABA" color from the active treatment?', !!brunoRow && brunoRow.st === 'Ativo' && /#F4B7B7/i.test(brunoRow.dot), JSON.stringify(brunoRow));
  console.log('patient record itself keeps no treatment copy for Bruno (ABA stays as before)?', await page.evaluate(() => window.__STORE__['patients/all'].list.find((p) => p.id === 'bruno-verde').aba === 'Sim'));

  // Planner: Bruno (Psicologia indicada para Andrelisa) na coluna da Ana → dupla verificação.
  await page.$eval('#mainTabs button[data-tab="planner"]', (b) => b.click()); await page.waitForTimeout(400);
  await page.locator('td.slotcell[data-doc="seg-1"][data-key="08:00|r1|r1-t1"]').click(); await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Bruno Verde'); await page.click('#bkSave'); await page.waitForTimeout(250);
  console.log('Planner asks before booking with a different therapist?', (await page.locator('#cfTitle').textContent().catch(() => '')) === 'Terapeuta diferente do tratamento');
  await page.click('#cfCancel'); await page.waitForTimeout(200);
  console.log('cancelling keeps the slot empty?', await page.evaluate(() => !((window.__STORE__['schedule/seg-1'] || {}).bookings || {})['08:00|r1|r1-t1']));

  // Paciente inativo aparece na lista do tratamento novo com "(inativo)"; salvar o tratamento reativa.
  const pInact = () => page.evaluate(() => { const p = (window.__STORE__['patients/all'].list || []).filter((x) => x.id === 'duda-vermelho')[0]; return !!p.inativo; });
  if (await page.$('#ovTreat')) await page.click('#trCancel');
  await page.evaluate(async () => { const db = await window.claude.use('db'); const d = await db.doc('patients/all').get(); const l = d.data().list.map((x) => x.id === 'duda-vermelho' ? Object.assign({}, x, {inativo: true}) : x); await db.doc('patients/all').set({list: l}); });
  await page.waitForTimeout(150);
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#trAdd'); await page.waitForSelector('#ovTreat');
  const optTxt = await page.$eval('#trPat', (s) => Array.from(s.options).filter((o) => o.value === 'duda-vermelho').map((o) => o.textContent)[0] || '');
  console.log('inactive patient listed in a new treatment with "(inativo)"?', /\(inativo\)/.test(optTxt), optTxt);
  await page.$eval('#trPat', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, 'duda-vermelho');
  await page.waitForTimeout(200);
  await save(); await page.waitForTimeout(200);
  console.log('saving a new treatment reactivates the patient?', (await pInact()) === false);

  // Ordem das colunas da lista de Tratamentos e coluna ABA com Sim/Não.
  if (await page.$('#ovTreat')) await page.click('#trCancel').catch(() => {});
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(200);
  const abaCol = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('#trHost table.tr-main thead th')].map((th) => th.textContent.trim());
    const i = ths.findIndex((t) => /^ABA/.test(t));
    const vals = [...document.querySelectorAll('#trHost table.tr-main tbody tr')].map((tr) => tr.cells[i] ? tr.cells[i].textContent.trim() : '?');
    return {i, ths, vals};
  });
  console.log('treatments list columns in the requested order, ABA with Sim/Não?', abaCol.ths.slice(0, 9).map((t) => t.replace(/[⇅▲▼]/g, '').trim()).join('|') === 'Paciente|Início|Vencimento|Convênio|ABA|Término|Tipo|Status|Mês (realizado/contratado)' && abaCol.vals.some((v) => v === 'Sim' || v === 'Não'), JSON.stringify(abaCol.ths));

  // Horário de atendimento: menu "Outras opções" (limpar todos, limpar sem Disponível, copiar) + Desfazer.
  await openNew('ana-azul');
  const ph = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const head = [...document.querySelectorAll('#pHours thead th')].map((th) => th.textContent.trim());
    const items = [...document.querySelectorAll('#pHoursMore [data-ph-act]')].map((b) => b.textContent.trim());
    const rows = [...document.querySelectorAll('#pHours tbody tr')];
    const act = async (k) => { document.getElementById('pHoursMoreBtn').click(); await wait(50); document.querySelector('#pHoursMore [data-ph-act="' + k + '"]').click(); await wait(50); };
    // terça desmarcada com horário sobrando
    const ter = rows.find((tr) => tr.dataset.day === 'ter');
    ter.querySelector('.cl-ativo').checked = false; document.getElementById('ph-ter-mi').value = '08:00';
    const segBefore = document.getElementById('ph-seg-mi').value;
    await act('clear-off');
    const offOk = document.getElementById('ph-ter-mi').value === '' && document.getElementById('ph-seg-mi').value === segBefore && segBefore !== '';
    const undoShown = !document.getElementById('pHoursUndo').hidden;
    document.getElementById('pHoursUndo').click();
    const undoOk = document.getElementById('ph-ter-mi').value === '08:00';
    await act('clear-all');
    const cleared = rows.every((tr) => !tr.querySelector('.cl-ativo').checked && [...tr.querySelectorAll('input.cl-time')].every((x) => x.value === '' && x.disabled));
    const seg = rows.find((tr) => tr.dataset.day === 'seg').querySelector('.cl-ativo');
    seg.checked = true; seg.dispatchEvent(new Event('change', {bubbles: true}));
    document.getElementById('ph-seg-mi').value = '08:00'; document.getElementById('ph-seg-mf').value = '11:00';
    await act('copy');
    const copied = rows.every((tr) => tr.querySelector('.cl-ativo').checked && tr.querySelector('input[id$="-mi"]').value === '08:00');
    return {head: head.slice(0, 2), items, offOk, undoShown, undoOk, cleared, copied};
  });
  console.log('patient hours: "Disponível" column, Outras opções (clear all / clear unmarked / copy) and Desfazer work?',
    ph.head.join('|') === 'Dia|Disponível' && ph.items.length === 3 && ph.offOk && ph.undoShown && ph.undoOk && ph.cleared && ph.copied, JSON.stringify(ph));
  await page.click('#trCancel').catch(() => {});

  // Data de término digitável: antes do início é recusada; válida fica gravada e aparece na lista.
  if (await page.$('#ovTreat')) await page.click('#trCancel').catch(() => {});
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#trHost tbody tr'); await page.waitForSelector('#ovTreat');
  const fimInfo = await page.evaluate(() => ({ini: document.getElementById('trIni').value, editable: !document.getElementById('trFim').disabled, hint: (document.getElementById('trFimHint') || {}).textContent || ''}));
  await page.$eval('#trFim', (e) => { e.value = '2000-01-01'; e.dispatchEvent(new Event('change', {bubbles: true})); });
  await page.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
  await page.click('#trSave'); await page.waitForTimeout(200);
  const fimErr = await page.innerText('#toastHost');
  const fimDate = '2099-12-31';
  await page.$eval('#trFim', (e, v) => { e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }, fimDate);
  const trId = await page.evaluate(() => { var o = document.getElementById('ovTreat'); return o && o.dataset && o.dataset.tr || null; });
  await page.click('#trSave'); await page.waitForTimeout(300);
  if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(300); }
  const savedFim = await page.evaluate((v) => (window.__STORE__['treatments/all'].list || []).some((x) => x.termino === v), fimDate);
  const listShows = await page.$$eval('#trHost tbody tr', (r) => r.some((x) => x.textContent.indexOf("31/12/2099") !== -1));
  console.log('Término is editable: before the start is refused; a valid date is saved and shown in the list?',
    fimInfo.editable && /automático/.test(fimInfo.hint) && /término não pode ser antes do início/.test(fimErr) && savedFim && listShows, JSON.stringify(fimInfo), fimErr);

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
