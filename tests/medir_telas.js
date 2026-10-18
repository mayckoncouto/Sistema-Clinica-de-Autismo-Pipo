// Mede (sem checar certo/errado) quanto tempo cada tela leva para abrir, com CPU 4x mais lenta.
// Uso: node tests/build.js && node tests/medir_telas.js   — parte do protocolo "Verificação Completa" (passo 6).
const { chromium } = require('playwright');
const path = require('path');
const TABS = ['planner', 'autoplanner', 'resumo', 'disponibilidade', 'agenda', 'agendaplanner', 'agendamentos', 'visaogeral', 'prontuario', 'planos', 'crm',
  'pacientes', 'tratamentos', 'colaboradores', 'salas', 'convenios', 'especialidades', 'objetivos', 'atividades', 'lancamentos', 'demonstrativos', 'pagar', 'receber', 'vendas', 'relatorios', 'ajuda'];
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'page.html')); await page.waitForTimeout(1500);
  const rows = [];
  for (const t of TABS) {
    const ms = await page.evaluate(async (t) => {
      const b = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!b) return null;
      const t0 = performance.now(); b.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    }, t);
    if (ms !== null) rows.push([t, ms]);
    await page.waitForTimeout(250);
  }
  rows.sort((a, b) => b[1] - a[1]);
  rows.forEach(([t, ms]) => console.log((ms > 1000 ? 'LENTA   ' : ms > 400 ? 'ATENÇÃO ' : 'ok      ') + String(ms).padStart(5) + ' ms  ' + t));
  // Janelas: em cada tela, abre a janela do "+ Incluir" e a da 1ª linha da lista e mede até aparecer.
  const wrows = [];
  const closeAll = async () => { for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(60); const g = await page.$('#gdSair'); if (g) await g.click().catch(() => {}); } };
  for (const t of TABS) {
    const ok = await page.evaluate((t) => { const b = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!b) return false; b.click(); return true; }, t);
    if (!ok) continue; await page.waitForTimeout(400);
    for (const kind of ['incluir', 'linha']) {
      const ms = await page.evaluate(async ([t, kind]) => {
        const sec = document.getElementById('tab-' + t); if (!sec || sec.hidden || !sec.offsetParent) return null;
        let el = null;
        if (kind === 'incluir') el = [...sec.querySelectorAll('button')].find((b) => /^\+ Incluir/.test(b.textContent.trim()) && b.offsetParent);
        else el = sec.querySelector('table.pat-table tbody tr[data-id], table.pat-table tbody tr[data-open], table.pat-table tbody tr');
        if (!el) return null;
        const before = document.querySelectorAll('.overlay:not([hidden])').length;
        const t0 = performance.now(); el.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const opened = document.querySelectorAll('.overlay:not([hidden])').length > before || !!document.querySelector('.overlay .modal');
        return opened ? Math.round(performance.now() - t0) : null;
      }, [t, kind]);
      if (ms !== null) wrows.push([t + ' (' + kind + ')', ms]);
      await closeAll();
    }
  }
  wrows.sort((a, b) => b[1] - a[1]);
  console.log('--- janelas ---');
  wrows.forEach(([t, ms]) => console.log((ms > 1000 ? 'LENTA   ' : ms > 400 ? 'ATENÇÃO ' : 'ok      ') + String(ms).padStart(5) + ' ms  ' + t));
  console.log('erros de script: ' + errors.length); await browser.close();
})();
