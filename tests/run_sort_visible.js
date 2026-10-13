// Padrão (celular): em toda tabela de lista o seletor de ordem (▲▼) aparece em TODAS as colunas, dentro da célula do título.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const TABS = ['pacientes', 'tratamentos', 'convenios', 'motivos', 'medicos', 'escolas', 'diagnosticos', 'origens', 'colaboradores', 'tiposcolab',
  'especialidades', 'servicos', 'cbo', 'conselhos', 'fornecedores', 'catfornecedor', 'contas', 'planocontas', 'feriados', 'status', 'objetivos', 'escalas', 'habilidades', 'crm'];
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const file = path.join(__dirname, 'page_sortvis.html');
  fs.writeFileSync(file, src.replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">'));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({viewport: {width: 390, height: 760}, isMobile: true, hasTouch: true});
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file); await page.waitForTimeout(1200);
  const bad = []; let seen = 0;
  for (const t of TABS){
    const r = await page.evaluate(async (t) => {
      const btn = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!btn) return null;
      btn.click(); await new Promise((res) => setTimeout(res, 350));
      const sec = document.getElementById('tab-' + t); if (!sec || sec.hidden) return null;
      const out = [];
      sec.querySelectorAll('table.pat-table thead th').forEach((th) => {
        if (getComputedStyle(th).display === 'none') return;
        const b = th.querySelector('.sort-btn'); if (!b) { out.push('sem botão'); return; }
        const a = th.getBoundingClientRect(), c = b.getBoundingClientRect();
        if (c.width < 8 || c.left < a.left - 1 || c.right > a.right + 1) out.push((th.textContent || '').trim().slice(0, 14) + ' (' + Math.round(a.width) + 'px)');
      });
      return out;
    }, t);
    if (r === null) continue; seen++;
    if (r.length) bad.push(t + ': ' + r.join(', '));
  }
  console.log('celular: sort button visible inside every column title? ', !bad.length, JSON.stringify(bad), 'telas conferidas:', seen);
  console.log('no JS errors?', !errors.length, errors.slice(0, 2));
  await browser.close();
  try { fs.unlinkSync(file); } catch (e) {}
  process.exit(bad.length || errors.length ? 1 : 0);
})();
