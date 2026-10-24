// Pacientes no celular: cartões com atalhos, índice A–Z na altura da lista e filtros rápidos.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const file = path.join(__dirname, 'page_patcards.html');
  fs.writeFileSync(file, src.replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1">'));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file); await page.waitForTimeout(1200);
  const ok = [];
  function chk(label, v, extra){ ok.push(!!v); console.log(label + '?', !!v, extra === undefined ? '' : JSON.stringify(extra)); }
  await page.evaluate(async () => {
    const db = await window.claude.use('db'); const d = await db.doc('patients/all').get();
    const l = (d && d.data && d.data().list) || [];
    const names = ['Alessandra Gabriela de Oliveira Fernandes Machado', 'Alan Fernandes', 'Bruno Souza', 'Carlos Eduardo', 'Davi Lucas', 'Eduarda Reis', 'Fábio Neto', 'Gabriela Dias', 'Miguel Santos', 'Zélia Moura'];
    names.forEach((n, i) => l.push({id: 'zz' + i, nome: n, nascimento: '2015-03-10', telefones: i === 3 ? [] : [{numero: '47991000' + String(100 + i), via: 'whatsapp'}]}));
    await db.doc('patients/all').set({list: l});
  });
  await page.evaluate(() => document.querySelector('#mainTabs button[data-tab="pacientes"]').click());
  await page.waitForTimeout(900);
  const q = await page.evaluate(() => {
    const box = document.getElementById('patCards'), idx = document.getElementById('patIdx');
    const r = box.getBoundingClientRect(), ri = idx.getBoundingClientRect();
    const nm = [...box.querySelectorAll('.pat-card')].find((c) => /Alessandra/.test(c.textContent));
    const nmR = nm.querySelector('.pc-nm').getBoundingClientRect(), chip = nm.querySelector('.pc-none, .tr-chip').getBoundingClientRect();
    return {
      cards: box.querySelectorAll('.pat-card').length, letters: idx.children.length, off: idx.querySelectorAll('.off').length,
      tableHidden: getComputedStyle(document.querySelector('#patListHost .pat-table-wrap')).display === 'none',
      idxTop: Math.round(ri.top - r.top), idxBottom: Math.round(r.bottom - ri.bottom),
      nameLines: Math.round(nmR.height / 20), chipH: Math.round(chip.height),
      callDisabled: !![...box.querySelectorAll('.pat-card')].find((c) => /Carlos/.test(c.textContent)).querySelector('span.pc-off'),
      wa: (box.querySelector('.pc-wa') || {}).href || '',
      chips: [...document.querySelectorAll('#patQuick .pq')].map((b) => b.textContent),
      rowsBelow: null
    };
  });
  chk('cartões no lugar da tabela', q.cards >= 10 && q.tableHidden, q);
  chk('índice A–Z completo, letras sem paciente apagadas', q.letters === 26 && q.off > 10, {letters: q.letters, off: q.off});
  chk('índice usa a altura da lista (colado em cima e embaixo)', q.idxTop <= 10 && q.idxBottom <= 10, {top: q.idxTop, bottom: q.idxBottom});
  chk('nome em 2+ linhas e etiqueta numa linha só', q.nameLines >= 2 && q.chipH <= 26, {lines: q.nameLines, chipH: q.chipH});
  chk('sem telefone: Ligar desativado; com telefone: link do WhatsApp', q.callDisabled && /wa\.me\/5547991000/.test(q.wa), q.wa);
  chk('filtros rápidos Todos, Ativos, Vencendo, Sem Trat., Cancelados', q.chips.length === 5 && /^Todos/.test(q.chips[0]) && /^Sem Trat\./.test(q.chips[3]), q.chips);
  // filtro: Sem Trat. mostra só quem não tem tratamento (todos os fictícios) e Cancelados fica vazio
  await page.click('#patQuick [data-pq="cancelados"]'); await page.waitForTimeout(300);
  chk('filtro Cancelados esvazia a lista', await page.evaluate(() => !document.querySelector('#patCards') && /Nenhum paciente/.test(document.getElementById('patListHost').textContent)));
  await page.click('#patQuick [data-pq=""]'); await page.waitForTimeout(300);
  // tocar numa letra leva ao grupo e destaca a letra
  const mv = await page.evaluate(async () => {
    const idx = document.getElementById('patIdx'), r = idx.getBoundingClientRect(), box = document.getElementById('patCards');
    const i = [...idx.children].findIndex((s) => s.dataset.let === 'M');
    const y = r.top + r.height * (i + 0.5) / idx.children.length;
    const ev = (t) => idx.dispatchEvent(new PointerEvent(t, {clientX: r.left + 5, clientY: y, pointerId: 1, bubbles: true}));
    ev('pointerdown'); const bubble = !document.getElementById('patIdxBub').hidden; ev('pointerup');
    await new Promise((res) => setTimeout(res, 250));
    const h = box.querySelector('.pat-let[data-let="M"]');
    return {bubble, st: box.scrollTop, hTop: Math.round(h.getBoundingClientRect().top - box.getBoundingClientRect().top), cur: [...idx.querySelectorAll('.cur')].map((x) => x.textContent)};
  });
  chk('tocar na letra M rola até o grupo (à vista) e mostra o balão', mv.bubble && mv.st > 0 && mv.hTop >= -4 && mv.hTop < 600 && mv.cur[0] === 'M', mv);
  // clicar no cartão abre o cadastro
  await page.evaluate(() => document.getElementById('patCards').scrollTo(0, 0));
  await page.click('#patCards .pat-card .pc-nm');
  await page.waitForTimeout(500);
  chk('tocar no cartão abre o cadastro do paciente', await page.evaluate(() => !!document.getElementById('ovPat')));
  console.log('no JS errors?', !errors.length, errors.slice(0, 2));
  await browser.close();
  try { fs.unlinkSync(file); } catch (e) {}
  process.exit(ok.includes(false) || errors.length ? 1 : 0);
})();
