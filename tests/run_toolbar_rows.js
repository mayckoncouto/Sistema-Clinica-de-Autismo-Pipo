const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
// Barras das telas (regra do usuário, 2026-10-10): computador numa linha só (1280px ou mais; mais estreito nunca passa
// da tela, no máximo 2 linhas); celular no máximo 3 linhas abaixo do título.
const TABS = ["pacientes","tratamentos","tipostrat","convenios","motivos","medicos","escolas","diagnosticos","origens","motivosbloq","colaboradores","tiposcolab","especialidades","servicos","cbo","conselhos","fornecedores","catfornecedor","unidades","contratos","contas","planocontas","lancamentos","pagar","receber","emptomados","empconcedidos","conciliacao","vendas","automacoes","caixa","demonstrativos","agendamentos","plannerlist","salas","feriados","status","planner","resumo","disponibilidade","agenda","agendaplanner","visaogeral","prontuario","planos","objetivos","atividades","anamneses","tiposanam","escalas","habilidades","crm","autoplanner"];
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const widths = (process.argv[2] || "1280,1440,1024,390").split(",").map(Number);
  let fails = 0; const check = (l, ok, x) => { console.log(l, ok, x === undefined ? '' : JSON.stringify(x)); if (!ok) fails++; };
  for (const w of widths){
    const mobile = w < 761;
    const page = await browser.newPage({viewport: {width: w, height: 800}, isMobile: mobile, hasTouch: mobile});
    const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
    fs.writeFileSync(path.join(__dirname, 'page_aud.html'), src.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">'));
    await page.goto('file://' + path.join(__dirname, 'page_aud.html'));
    await page.waitForTimeout(900);
    const out = [];
    for (const t of TABS){
      const r = await page.evaluate((t) => {
        const b = document.querySelector('#mainTabs button[data-tab="' + t + '"]'); if (!b) return null;
        b.click();
        return null;
      }, t);
      await page.waitForTimeout(250);
      const res = await page.evaluate((t) => {
        const sec = document.getElementById(t === 'autoplanner' ? 'tab-planner' : 'tab-' + t); if (!sec || sec.hidden || sec.offsetParent === null && getComputedStyle(sec).display === 'none') return {t, err: 'sem tela'};
        const bar = sec.querySelector('.pat-toolbar, .controls, .agd-toolbar, .crm-toolbar, .rp-form'); if (!bar) return {t, err: 'sem barra'};
        const items = [];
        (function walk(el){ Array.from(el.children).forEach((c) => { const cs = getComputedStyle(c); if (cs.display === 'none' || cs.visibility === 'hidden') return; if (cs.display === 'contents'){ walk(c); return; } const rc = c.getBoundingClientRect(); if (rc.width < 2 || rc.height < 2) return; items.push({tag: (c.id || c.className || c.tagName).toString().slice(0, 30), top: Math.round(rc.top), bottom: Math.round(rc.bottom), right: Math.round(rc.right)}); }); })(bar);
        const rows = []; items.forEach((i) => { if (!rows.some((r) => Math.abs(r - i.top) < 14 || (i.top < r + 14 && i.bottom > r + 14))) rows.push(i.top); });
        const br = bar.getBoundingClientRect();
        return {t, title: !!bar.querySelector(':scope > .cad-title, :scope > .crm-title'), rows: rows.length, over: Math.max(0, Math.round(bar.scrollWidth - bar.clientWidth)), pageOver: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), outside: items.filter((i) => i.right > window.innerWidth + 1).map((i) => i.tag), items: items.length};
      }, t);
      out.push(res);
      if (process.env.SHOTS && res && !res.err && (process.env.ALL || res.rows > (mobile ? 3 : 1) || res.over || res.pageOver)){ const el = await page.$('#tab-' + (t === 'autoplanner' ? 'planner' : t) + ' :is(.pat-toolbar, .controls, .agd-toolbar, .crm-toolbar)'); if (el) await el.screenshot({path: process.env.SHOTS + '/' + w + '-' + t + '.png'}); }
    }
    out.filter((o) => !o.err).forEach((o) => {
      if (mobile) check(w + 'px ' + o.t + ': até 3 linhas abaixo do título, nada para fora?', o.rows <= (o.title ? 4 : 3) && !o.over && !o.pageOver && !o.outside.length, o);
      else if (w >= 1280) check(w + 'px ' + o.t + ': barra numa linha só?', o.rows === 1 && !o.over && !o.pageOver && !o.outside.length, o);
      else check(w + 'px ' + o.t + ': nada passa da tela?', !o.over && !o.pageOver && !o.outside.length && o.rows <= 2, o);
    });
    await page.close();
  }
  await browser.close();
  fs.unlinkSync(path.join(__dirname, 'page_aud.html'));
  if (fails){ console.log(fails + ' check(s) failed'); process.exit(1); }
  console.log('no JS errors? true');
})();
