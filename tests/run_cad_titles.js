// Título de cada tela de cadastro no começo da barra (2026-10-10): no computador antes da busca, no
// celular na 1ª linha; Salas troca para "Grupos de Suporte". Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const TABS = {pacientes: 'Pacientes', tratamentos: 'Tratamentos', convenios: 'Convênios', motivos: 'Motivos de cancelamento', medicos: 'Médicos',
  escolas: 'Escolas', diagnosticos: 'Diagnósticos', origens: 'Origens', colaboradores: 'Colaboradores', tiposcolab: 'Tipos de colaborador',
  especialidades: 'Especialidades', servicos: 'Serviços', cbo: 'CBO', conselhos: 'Conselhos', salas: 'Salas', feriados: 'Feriados e recessos',
  status: 'Status', objetivos: 'Objetivos', escalas: 'Escalas', habilidades: 'Habilidades'};
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  let ok = true;
  const check = (label, cond, info) => { console.log(label, !!cond, info === undefined ? '' : JSON.stringify(info)); if (!cond) ok = false; };
  const errors = [];
  for (const vw of [{width: 1300, height: 800}, {width: 390, height: 800}]) {
    const page = await browser.newPage({viewport: vw});
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + path.resolve(__dirname, 'page.html'));
    await page.waitForTimeout(900);
    const bad = [];
    for (const k of Object.keys(TABS)) {
      await page.$eval('#mainTabs button[data-tab="' + k + '"]', (b) => b.click()); await page.waitForTimeout(120);
      const r = await page.evaluate((k) => {
        const t = document.querySelector('#tab-' + k + ' .cad-title'), s = document.querySelector('#tab-' + k + ' .search-wrap');
        if (!t || !s) return null;
        const a = t.getBoundingClientRect(), b = s.getBoundingClientRect();
        return {txt: t.textContent, left: a.right <= b.left + 1 && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6, above: a.bottom <= b.top + 1,
          noSide: document.documentElement.scrollWidth <= innerWidth};
      }, k);
      const want = vw.width > 760 ? (r && r.left) : (r && r.above);
      if (!r || r.txt !== TABS[k] || !want || !r.noSide) bad.push({k, r});
    }
    check((vw.width > 760 ? 'computer' : 'phone') + ': every registry screen has its title ' + (vw.width > 760 ? 'before the search' : 'on the first line') + '?', bad.length === 0, bad);
    if (vw.width > 760) {
      await page.$eval('#mainTabs button[data-tab="salas"]', (b) => b.click()); await page.waitForTimeout(120);
      await page.click('#toggleGroupsBtn'); await page.waitForTimeout(150);
      check('Salas switched to groups shows "Grupos de Suporte"?', (await page.textContent('#tab-salas .cad-title')) === 'Grupos de Suporte');
    }
    await page.close();
  }
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  console.log(ok ? 'ALL PASS' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})();
