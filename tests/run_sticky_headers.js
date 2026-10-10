// Padrão: em toda tela de lista, ao rolar a lista o título das colunas continua preso no alto
// (computador e celular). Telas sem dados no teste recebem uma tabela de 80 linhas pelo mesmo
// gtRender do sistema. Também confere a tabela dos Relatórios. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TABS = ['pacientes', 'tratamentos', 'convenios', 'motivos', 'medicos', 'escolas', 'diagnosticos', 'origens', 'colaboradores', 'tiposcolab',
  'especialidades', 'servicos', 'cbo', 'conselhos', 'feriados', 'status', 'prontuario', 'planos', 'objetivos', 'escalas', 'habilidades', 'crm', 'resumo', 'disponibilidade'];

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const base = src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13);
  const browser = await chromium.launch(require('./launch-opts'));
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  for (const mobile of [false, true]){
    const file = path.join(__dirname, mobile ? 'page_sticky_m.html' : 'page_sticky.html');
    fs.writeFileSync(file, mobile ? base.replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">') : base);
    const page = await browser.newPage(mobile ? {viewport: {width: 390, height: 760}, isMobile: true, hasTouch: true} : {viewport: {width: 1400, height: 760}});
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + file);
    await page.waitForTimeout(1200);
    const bad = [];
    for (const t of TABS){
      const r = await page.evaluate(async (t) => {
        const btn = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!btn) return 'skip';
        btn.click(); await new Promise((res) => setTimeout(res, 300));
        const sec = document.getElementById('tab-' + t); if (!sec || sec.hidden) return 'skip';
        let tb = sec.querySelector('table');
        if (!tb){
          const host = sec.querySelector('.reg-host, #crmHost, #prListHost, [id$="Host"]'); if (!host) return 'sem host';
          window.__ev('gtRender')(host, 'probe-' + t, [{key: 'a', label: 'A', width: 200}, {key: 'b', label: 'B', width: 200}],
            Array.from({length: 80}, (_, i) => ({attrs: '', cells: ['x' + i, 'y'], vals: [i, 'y']})), function(){});
          await new Promise((res) => setTimeout(res, 50)); tb = sec.querySelector('table');
        }
        const body = tb && tb.tBodies[0]; if (!body || !body.rows.length) return 'sem linhas';
        const row = body.rows[0]; for (let i = 0; i < 80; i++) body.appendChild(row.cloneNode(true));
        let sc = tb.parentElement;
        while (sc && sc !== document.documentElement){ const cs = getComputedStyle(sc); if (/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight > sc.clientHeight + 5) break; sc = sc.parentElement; }
        const scroller = sc && sc !== document.documentElement ? sc : document.scrollingElement;
        scroller.scrollTop = 600; window.scrollTo(0, 600);
        await new Promise((res) => setTimeout(res, 60));
        const th = tb.querySelector('thead th').getBoundingClientRect();
        const sTop = scroller === document.scrollingElement ? 0 : Math.max(0, scroller.getBoundingClientRect().top);
        const ok = th.top >= -1 && th.top < innerHeight && Math.abs(th.top - sTop) < 4;
        scroller.scrollTop = 0; window.scrollTo(0, 0);
        return ok ? 'ok' : 'título sumiu (' + Math.round(th.top) + ')';
      }, t);
      if (r !== 'ok' && r !== 'skip') bad.push(t + ': ' + r);
    }
    check((mobile ? 'celular' : 'computador') + ': column titles stay at the top while scrolling every list screen?', !bad.length, JSON.stringify(bad));
    if (!mobile){
      const rp = await page.evaluate(async () => {
        document.querySelector('#mainTabs button[data-tab="relatorios"]').click(); await new Promise((res) => setTimeout(res, 300));
        const out = document.getElementById('rpOut'); out.hidden = false;
        out.innerHTML = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody>' + Array.from({length: 120}, (_, i) => '<tr><td>' + i + '</td><td>x</td></tr>').join('') + '</tbody></table></div>';
        const w = out.querySelector('.rp-table-wrap'), th = out.querySelector('th');
        w.scrollTop = 600; await new Promise((res) => setTimeout(res, 50));
        return w.scrollTop > 0 && Math.abs(th.getBoundingClientRect().top - w.getBoundingClientRect().top) < 4;
      });
      check('Relatórios: report table scrolls inside with the titles on top?', rp);
    }
    check((mobile ? 'celular' : 'computador') + ': no JS errors?', errors.length === 0, JSON.stringify(errors));
    await page.close();
    fs.unlinkSync(file);
  }
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
