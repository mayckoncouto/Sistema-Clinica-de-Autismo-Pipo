// Celular: nos cadastros (menos Salas/Grupos), todo campo de escolha (lista, data, várias opções) abre a janela
// que sobe da parte de baixo (#mSheet ou painel .ms-sheet), como no CRM. Percorre as telas e as janelas de "+ Incluir".
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  let src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">');
  const pg = path.join(__dirname, 'page_sheets.html');
  fs.writeFileSync(pg, src);
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + pg);
  await page.waitForTimeout(1500);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  async function probe(scopeSel){
    const n = await page.$$eval(scopeSel + ' :is(.dp-btn,.ms-btn)', (r) => r.length);
    const bad = [];
    let tested = 0;
    for (let i = 0; i < n; i++){
      const info = await page.evaluate(([sel, i]) => {
        const b = document.querySelectorAll(sel + ' :is(.dp-btn,.ms-btn)')[i]; if (!b) return null;
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || b.disabled || b.closest('[hidden]') || getComputedStyle(b).visibility === 'hidden') return null;
        b.scrollIntoView({block: 'center'});
        const lab = (b.closest('.field') && b.closest('.field').querySelector('label') ? b.closest('.field').querySelector('label').textContent : b.getAttribute('aria-label') || b.textContent).trim().slice(0, 40);
        const target = b.classList.contains('dp-date') ? (b.querySelector('[data-dp-open]') || b) : b;
        target.click();
        return lab;
      }, [scopeSel, i]);
      if (info === null) continue;
      tested++;
      await page.waitForTimeout(120);
      const ok = await page.evaluate(() => !!document.getElementById('mSheet') || !!document.querySelector('.ms-panel.ms-sheet:not([hidden])'));
      if (!ok) bad.push(info);
      await page.evaluate(() => {
        const x = document.querySelector('#mSheet .msheet-x') || document.querySelector('.ms-panel.ms-sheet:not([hidden]) .msheet-x'); if (x) x.click();
        const p = document.getElementById('dpPop'); if (p) p.remove();
      });
      await page.waitForTimeout(80);
    }
    return {tested, bad};
  }
  const tabs = ['pacientes', 'tratamentos', 'convenios', 'motivos', 'medicos', 'escolas', 'colaboradores', 'tiposcolab', 'especialidades', 'servicos', 'cbo', 'conselhos', 'feriados', 'status'];
  const addBtn = {pacientes: '#addPatientBtn', tratamentos: '#trAdd', colaboradores: '#staffAddBtn'};
  for (const t of tabs){
    await page.evaluate((t) => { document.querySelector('#mainTabs button[data-tab="' + t + '"]').click(); }, t);
    await page.waitForTimeout(250);
    const lay = await page.evaluate((t) => { const s = document.getElementById('tab-' + t);
      const ths = [...s.querySelectorAll('.pat-table thead th')].filter((x) => getComputedStyle(x).display !== 'none').length;
      const hs = [...s.querySelectorAll('.pat-table tbody tr')].map((r) => Math.round(r.getBoundingClientRect().height));
      return {cols: ths, maxH: hs.length ? Math.max.apply(null, hs) : 0, sw: document.documentElement.scrollWidth}; }, t);
    check(t + ': list with 2-3 columns, one line per row, no sideways scroll?', (!lay.cols || (lay.cols <= 3)) && lay.maxH <= 44 && lay.sw <= 390, JSON.stringify(lay));
    const r1 = await probe('#tab-' + t);
    if (r1.tested) check(t + ': selection fields on the screen open the bottom window?', !r1.bad.length, JSON.stringify(r1));
    const add = addBtn[t] || '#reg-' + t + '-add';
    const has = await page.$(add);
    if (!has || !(await has.isVisible())) { console.log(t, 'no add button'); continue; }
    await has.click(); await page.waitForTimeout(400);
    const ov = await page.evaluate(() => { const o = [...document.querySelectorAll('#modalHost .overlay, #confirmHost .overlay')].pop(); return o ? '#' + o.id : null; });
    if (!ov){ console.log(t, 'no window'); continue; }
    const r2 = await probe(ov);
    check(t + ' window ' + ov + ': selection fields open the bottom window?', !r2.bad.length, JSON.stringify(r2));
    await page.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; const c = document.getElementById('confirmHost'); if (c) c.innerHTML = ''; });
    await page.waitForTimeout(150);
  }
  // Convênio já cadastrado (linhas de especialidade/serviço) e um tratamento aberto pela lista
  for (const [t, rowSel] of [['convenios', '#reg-convenios-host tbody tr'], ['tratamentos', '#trHost tbody tr']]){
    await page.evaluate((t) => { document.querySelector('#mainTabs button[data-tab="' + t + '"]').click(); }, t);
    await page.waitForTimeout(250);
    const row = await page.$(rowSel); if (!row){ console.log(t, 'no rows'); continue; }
    await row.click(); await page.waitForTimeout(400);
    const add = await page.$('#cvAdd, #cvAll'); if (add && await add.isVisible()) { await add.click(); await page.waitForTimeout(150); }
    const ov = await page.evaluate(() => { const o = [...document.querySelectorAll('#modalHost .overlay')].pop(); return o ? '#' + o.id : null; });
    const r = await probe(ov);
    check(t + ' (open an existing one) ' + ov + ': selection fields open the bottom window?', r.tested > 0 && !r.bad.length, JSON.stringify(r));
    await page.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; });
  }
  // a lista de cadastro (no computador é de digitar) vira lista com busca na janela de baixo
  await page.evaluate(() => { document.querySelector('#mainTabs button[data-tab="tratamentos"]').click(); });
  await page.waitForTimeout(200); await page.click('#trAdd'); await page.waitForTimeout(400);
  await page.evaluate(() => { const b = document.querySelector('#ovTreat [data-dp-for="trPat"]'); b.scrollIntoView({block: 'center'}); b.click(); });
  await page.waitForTimeout(150);
  check('patient list of the treatment: bottom window with a search field?', !!(await page.$('#mSheet .dp-filter')));
  await page.evaluate(() => { ['mSheet', 'mSheetBg', 'dpPop'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }); document.getElementById('modalHost').innerHTML = ''; });
  // várias opções (Tipos do colaborador): painel na parte de baixo com o título do campo
  await page.evaluate(() => { document.querySelector('#mainTabs button[data-tab="colaboradores"]').click(); });
  await page.waitForTimeout(200); await page.click('#staffAddBtn'); await page.waitForTimeout(400);
  await page.evaluate(() => { const b = document.querySelector('#sfTypesMs .ms-btn'); b.scrollIntoView({block: 'center'}); b.click(); });
  await page.waitForTimeout(150);
  const msT = await page.evaluate(() => { const p = document.querySelector('#sfTypes'); const r = p.getBoundingClientRect(); return {t: (p.querySelector('.ms-sheet-head b') || {}).textContent, bottom: Math.round(r.bottom), vh: innerHeight}; });
  check('multi-choice (Tipos) opens as a bottom window titled "Tipos"?', msT.t === 'Tipos' && Math.abs(msT.bottom - msT.vh) <= 2, JSON.stringify(msT));
  await page.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; });
  check('no JS errors?', errors.length === 0, errors);
  fs.unlinkSync(pg);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
