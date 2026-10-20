// Auditoria das janelas no CELULAR (390px, toque): só relata.
// Abre as mesmas janelas de tests/auditar_janelas.js e anota: janela mais larga que a tela, conteúdo que rola para o lado,
// campo com letra < 16px (o iPhone dá zoom), botão/campo pequeno demais para o dedo (< 36px), rodapé com botão fora da tela.
// Uso: node tests/build.js && node tests/auditar_janelas_mobile.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const base = fs.readFileSync(path.join(__dirname, 'auditar_janelas.js'), 'utf8');
const TABS = eval(base.match(/const TABS = (\[[\s\S]*?\]);/)[1]);
const PL_BTNS = eval(base.match(/const PL_BTNS = (\[[\s\S]*?\]);/)[1]);
const EXTRA = eval(base.match(/const EXTRA = (\[[\s\S]*?\]);/)[1]);

function audit() {
  const ovs = [...document.querySelectorAll('.overlay')].filter((o) => o.offsetParent || getComputedStyle(o).display !== 'none');
  const ov = ovs[ovs.length - 1]; if (!ov) return null;
  const title = ((ov.querySelector('.modal-head h3') || {}).textContent || ov.id || '(sem título)').trim();
  const out = []; const W = window.innerWidth;
  const vis = (e) => e.offsetParent && e.getBoundingClientRect().width > 0;
  const lab = (e) => { const f = e.closest('.field'); const l = f && f.querySelector('label'); return (l ? l.textContent : (e.getAttribute('aria-label') || e.placeholder || e.id || e.textContent || '?')).trim().slice(0, 40); };
  const m = ov.querySelector('.modal');
  if (m) { const r = m.getBoundingClientRect(); if (r.width > W + 1 || r.left < -1) out.push('Janela mais larga que a tela (' + Math.round(r.width) + 'px)'); }
  const body = ov.querySelector('.modal-body');
  if (body && body.scrollWidth > body.clientWidth + 4) {
    const wide = [...body.querySelectorAll('*')].filter((e) => vis(e) && e.getBoundingClientRect().right > body.getBoundingClientRect().right + 4 && !e.closest('.pat-table-wrap, .tr-month-wrap, .fx-table, table, .pv-scroll, [style*="overflow"]'));
    if (wide.length) out.push('Conteúdo passa da largura da janela: ' + (wide[0].id ? '#' + wide[0].id : wide[0].className || wide[0].tagName).toString().slice(0, 40));
  }
  ov.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=color]), select, textarea, [contenteditable=true]').forEach((e) => {
    if (!vis(e)) return; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15.5) out.push('Letra ' + fs + 'px (zoom no iPhone): ' + lab(e));
  });
  ov.querySelectorAll('.modal-body .dp-btn, .modal-body .ms-btn, .modal-body input[type=text], .modal-body select').forEach((e) => {
    if (!vis(e) || e.closest('table')) return; const h = e.getBoundingClientRect().height; if (h && h < 36) out.push('Campo baixo para o dedo (' + Math.round(h) + 'px): ' + lab(e));
  });
  ov.querySelectorAll('.modal-foot button, .modal-head button').forEach((b) => {
    if (!vis(b)) return; const r = b.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.push('Botão fora da tela: ' + b.textContent.trim().slice(0, 30));
    if (r.height < 32 && !b.classList.contains('modal-close')) out.push('Botão baixo para o dedo (' + Math.round(r.height) + 'px): ' + b.textContent.trim().slice(0, 30));
  });
  return { title, id: ov.id, issues: [...new Set(out)] };
}

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  let html = src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13);
  html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">');
  const p2 = path.join(__dirname, 'page_audm.html'); fs.writeFileSync(p2, html);
  await page.goto('file://' + p2); await page.waitForTimeout(1500);
  const seen = {}; const res = [];
  const record = async (where) => { await page.waitForTimeout(250); const r = await page.evaluate(audit); if (r && !seen[r.title]) { seen[r.title] = 1; r.where = where; res.push(r); } };
  const closeAll = async () => { for (let k = 0; k < 5; k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(60); const g = await page.$('#gdSair'); if (g) await g.click().catch(() => {}); } await page.evaluate(() => { ['modalHost', 'quickHost', 'confirmHost', 'tlHost', 'stackHost'].forEach((id) => { const h = document.getElementById(id); if (h) h.innerHTML = ''; }); }); };
  for (const t of TABS) {
    const ok = await page.evaluate((t) => { const b = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!b) return false; b.click(); return true; }, t);
    if (!ok) continue; await page.waitForTimeout(400);
    for (const kind of ['incluir', 'linha']) {
      const opened = await page.evaluate(([t, kind]) => {
        const sec = document.getElementById('tab-' + t); if (!sec || !sec.offsetParent) return false;
        let el = kind === 'incluir' ? [...sec.querySelectorAll('button')].find((b) => /^\+ (Incluir|Tarefa)/.test(b.textContent.trim()) && b.offsetParent)
          : sec.querySelector('table.pat-table tbody tr[data-id], table.pat-table tbody tr[data-open], table.pat-table tbody tr:not(.cx-grp)') || sec.querySelector('.room-row');
        if (!el) return false; el.click(); return true;
      }, [t, kind]);
      if (opened) { await record(t + ' (' + kind + ')'); await closeAll(); }
    }
  }
  for (const f of EXTRA) { await page.evaluate((f) => { try { window.__ev(f); } catch (e) {} }, f); await record(f); await closeAll(); }
  let n = 0;
  res.filter((r) => r.issues.length).forEach((r) => { n += r.issues.length; console.log('\n## ' + r.title + '  [' + r.where + ']'); r.issues.forEach((x) => console.log('  - ' + x)); });
  console.log('\nJanelas abertas: ' + res.length + ' · com problema: ' + res.filter((r) => r.issues.length).length + ' · itens: ' + n);
  console.log('erros de script: ' + errors.length + (errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); fs.unlinkSync(p2);
})();
