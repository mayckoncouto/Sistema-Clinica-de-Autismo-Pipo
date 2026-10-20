// Auditoria de padrão visual das janelas (sem certo/errado: só relata).
// Abre a janela do "+ Incluir" e da 1ª linha de cada tela, mais as janelas das Outras Opções do Planner e algumas avulsas,
// e anota campos fora do "Padrão de campos" (CLAUDE.md). Uso: node tests/build.js && node tests/auditar_janelas.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const TABS = ['pacientes', 'tratamentos', 'tipostrat', 'convenios', 'motivos', 'motivosbloq', 'medicos', 'escolas', 'diagnosticos', 'origens', 'colaboradores', 'tiposcolab',
  'especialidades', 'servicos', 'cbo', 'conselhos', 'salas', 'feriados', 'status', 'prontuario', 'planos', 'anamneses', 'tiposanam', 'objetivos', 'atividades', 'escalas', 'habilidades',
  'crm', 'automacoes', 'lancamentos', 'pagar', 'receber', 'emptomados', 'empconcedidos', 'conciliacao', 'fornecedores', 'catfornecedor', 'contas', 'planocontas', 'vendas',
  'contratos', 'unidades', 'usuarios', 'agenda'];
const PL_BTNS = ['plBlockBtn', 'plConfBtn', 'plCopiesBtn', 'plCopyWeekBtn', 'plMissBtn', 'plSubBtn', 'plSugBtn', 'plVagaBtn', 'plClearWeekBtn', 'plImportBtn', 'freeSlotBtn', 'fixPatientBtn', 'swapProfBtn', 'sendToAgendaBtn'];
const EXTRA = ['openClinicModal()', 'openPatientFieldsModal()', 'openNotifModal()', 'openBackupModal()', 'openSystemModal()'];

function audit() {
  const ovs = [...document.querySelectorAll('.overlay')].filter((o) => o.offsetParent || getComputedStyle(o).display !== 'none');
  const ov = ovs[ovs.length - 1]; if (!ov) return null;
  const title = (ov.querySelector('.modal-head h3') || {}).textContent || ov.id || '(sem título)';
  const out = [];
  const vis = (e) => e.offsetParent && e.getBoundingClientRect().width > 0;
  const lab = (e) => { const f = e.closest('.field'); const l = f && f.querySelector('label'); return (l ? l.textContent : (e.getAttribute('aria-label') || e.placeholder || e.id || e.name || '?')).trim().slice(0, 40); };
  ov.querySelectorAll('input[type=number]').forEach((e) => { if (vis(e)) out.push('Campo numérico do navegador (setinhas): ' + lab(e)); });
  ov.querySelectorAll('.modal-body input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=color]), .modal-body select, .modal-body textarea, .modal-body .dp-btn').forEach((e) => {
    if (!vis(e) || e.closest('table') || e.closest('.pat-toolbar') || e.closest('.ms-panel') || e.closest('.dp-btn') && e.tagName !== 'DIV' && !e.classList.contains('dp-btn')) return;
    if (e.tagName === 'SELECT' && e.style.display === 'none') return;
    if (e.closest('.pr-editor, .crm-compose, .an-form, .an-q, .pl-tbl, .room-row, .tl-row, .therapist-row, .hours-row')) return;
    const f = e.closest('.field');
    if (!f) { out.push('Campo sem rótulo em cima (fora de .field): ' + lab(e)); return; }
    const l = f.querySelector(':scope > label');
    if (l && l.getBoundingClientRect().bottom > e.getBoundingClientRect().top + 2 && !l.contains(e)) out.push('Rótulo ao lado do campo (não em cima): ' + lab(e));
    if (e.tagName !== 'TEXTAREA') { const h = Math.round(e.getBoundingClientRect().height); if (h && (h < 36 || h > 40)) out.push('Altura ' + h + 'px (padrão 38): ' + lab(e)); }
  });
  ov.querySelectorAll('textarea').forEach((e) => { if (!vis(e) || e.closest('.crm-compose')) return; const r = +e.getAttribute('rows') || 2; if ([3, 5, 8].indexOf(r) < 0) out.push('Texto longo com ' + r + ' linhas (padrão 3, ou 5 em Observações): ' + lab(e)); });
  ov.querySelectorAll('select').forEach((e) => { const o = [...e.options].map((x) => x.text.trim().toLowerCase()).filter(Boolean); if (o.length === 2 && o.indexOf('sim') >= 0 && o.indexOf('não') >= 0) out.push('Sim/Não em lista (padrão: caixa de marcar): ' + lab(e)); });
  ov.querySelectorAll('h4, .cl-card-title, .prof-section-head > span:not(.tr-sec):not(.ph-acts), .pm-sec-title, .prof-access-title, .crm-sec-t').forEach((e) => { if (vis(e)) out.push('Título de grupo fora do padrão .tr-sec: ' + e.textContent.trim().slice(0, 40)); });
  ov.querySelectorAll('.modal-body label').forEach((e) => {
    if (!vis(e) || e.querySelector('input,select,textarea') || e.closest('table,.chk-line,.kind-opt,.lib-opt,.agd-pick-it,.ms-opt')) return;
    const t = e.textContent.trim(); if (t && t.length > 3 && t === t.toLowerCase() && !/:$/.test(t)) out.push('Rótulo sem iniciais maiúsculas: ' + t.slice(0, 40));
  });
  const foot = ov.querySelector('.modal-foot');
  if (foot) { const del = [...foot.querySelectorAll('button')].find((b) => /^Excluir/.test(b.textContent.trim()) && vis(b)); const btns = [...foot.querySelectorAll('button')].filter(vis); if (del && btns.indexOf(del) !== 0) out.push('Excluir não está à esquerda do rodapé'); }
  return {title: title.trim(), id: ov.id, issues: [...new Set(out)]};
}

(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8'); const i = src.indexOf('"use strict";');
  const p2 = path.join(__dirname, 'page_aud.html'); fs.writeFileSync(p2, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
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
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="planner"]').click()); await page.waitForTimeout(500);
  for (const id of PL_BTNS) {
    const ok = await page.evaluate((id) => { const b = document.getElementById(id); if (!b) return false; b.click(); return true; }, id);
    if (ok) { await record('Planner · ' + id); await closeAll(); }
  }
  for (const f of EXTRA) { await page.evaluate((f) => { try { window.__ev(f); } catch (e) {} }, f); await record(f); await closeAll(); }
  let n = 0;
  res.filter((r) => r.issues.length).forEach((r) => { n += r.issues.length; console.log('\n## ' + r.title + '  [' + r.where + ']'); r.issues.forEach((x) => console.log('  - ' + x)); });
  console.log('\nJanelas abertas: ' + res.length + ' · com problema: ' + res.filter((r) => r.issues.length).length + ' · itens: ' + n);
  console.log('Sem problema: ' + res.filter((r) => !r.issues.length).map((r) => r.title).join(', '));
  console.log('erros de script: ' + errors.length + (errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); fs.unlinkSync(p2);
})();
