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

  const store = () => page.evaluate(() => JSON.parse(JSON.stringify((window.__STORE__['treatments/all'] || {list: []}).list)));
  async function openNew(pid){
    await page.click('#trAdd'); await page.waitForSelector('#ovTreat');
    await page.$eval('#trPat', (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }, pid);
    await page.waitForTimeout(200);
  }
  async function save(){
    await page.click('#trSave'); await page.waitForTimeout(200);
    if (await page.$('#cfOk')) { await page.click('#cfOk'); await page.waitForTimeout(200); }
  }

  console.log('missing-treatment notice counts all 6 patients?', (await page.textContent('#trMissing')).includes('6 pacientes'));

  // 1º tratamento: Novo; campos vêm do cadastro antigo; valor final automático.
  await openNew('duda-vermelho');
  console.log('first treatment is "novo" and the type field is locked?', await page.$eval('#trTipo', (s) => s.value === 'novo' && s.disabled));
  console.log('old ABA "Não" comes from the patient record?', (await page.$eval('#pAba', (s) => s.value)) === 'Não');
  await page.fill('#trVal', '1.500,00'); await page.fill('#trDesp', '200');
  console.log('final value = valor - despesas?', (await page.inputValue('#trFinal')) === 'R$ 1.300,00');
  await save();
  let L = await store();
  console.log('saved as Ativo/Novo with numbers?', L.length === 1 && L[0].status === 'ativo' && L[0].tipo === 'novo' && L[0].valor === 1500 && L[0].despesas === 200);

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
  await save();
  L = (await store()).filter((t) => t.patientId === 'duda-vermelho');
  const canc = L.filter((t) => t.status === 'cancelado')[0];
  console.log('cancelled with reason, note and history entry?', !!canc && canc.motivoCancel === 'outro' && canc.obsCancel === 'Família pediu pausa' &&
    canc.historico.some((h) => h.de === 'ativo' && h.para === 'cancelado' && h.motivo === 'outro'));
  console.log('auto-renegotiated treatment got a history entry?', L.some((t) => t.status === 'renegociado' && (t.historico || []).some((h) => h.auto)));
  await page.click('#trHost tbody tr:has(.st-cancelado)'); await page.waitForSelector('#ovTreat');
  console.log('cancelled treatment: status can change and history shown?', !(await page.$eval('#trSt', (s) => s.disabled)) && /Ativo → Cancelado/.test(await page.textContent('#ovTreat .tr-hist')));
  await page.click('#trCancel');
  await openNew('duda-vermelho');
  console.log('after a cancelled treatment the next one is "novo"?', (await page.$eval('#trTipo', (s) => s.value)) === 'novo');
  await page.click('#trCancel');
  // Cancelado pode voltar a Renegociado: o motivo sai e a troca entra no histórico.
  await page.click('#trHost tbody tr:has(.st-cancelado)'); await page.waitForSelector('#ovTreat');
  await page.$eval('#trSt', (s) => { s.value = 'renegociado'; s.dispatchEvent(new Event('change', {bubbles: true})); });
  await save();
  const back = (await store()).filter((t) => t.id === canc.id)[0];
  console.log('cancelled treatment goes back to another status (reason cleared, history kept)?', !!back && back.status === 'renegociado' && !back.motivoCancel &&
    back.historico.some((h) => h.de === 'cancelado' && h.para === 'renegociado'), back && back.status);

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
  await page.$eval('#mainTabs button[data-tab="agenda"]', (b) => b.click()); await page.waitForTimeout(400);
  await page.locator('td.slotcell[data-doc="seg-1"][data-key="08:00|r1|r1-t1"]').click(); await page.waitForSelector('#ovBook');
  await page.fill('#bkPatient', 'Bruno Verde'); await page.click('#bkSave'); await page.waitForTimeout(250);
  console.log('Planner asks before booking with a different therapist?', (await page.locator('#cfTitle').textContent().catch(() => '')) === 'Terapeuta diferente do tratamento');
  await page.click('#cfCancel'); await page.waitForTimeout(200);
  console.log('cancelling keeps the slot empty?', await page.evaluate(() => !((window.__STORE__['schedule/seg-1'] || {}).bookings || {})['08:00|r1|r1-t1']));

  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
