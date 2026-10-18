// Prontuário: o resumo por paciente vem agrupado do banco (RPC) e cai na leitura em páginas se a função não existe.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_prs.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  await ev(`(function(){
    window.__calls = [];
    agdClient = function(){ return {
      rpc: function(n){ window.__calls.push("rpc:" + n); return Promise.resolve({data: [{patient_id: "p1", n: 4, ultimo: "2026-09-30", profs: [{professional_id: null, author_name: "Ana"}, {professional_id: null, author_name: "Ana"}, {professional_id: null, author_name: "Bia"}]}], error: null}); },
      from: function(t){ window.__calls.push("from:" + t); var o = {select: function(){ return o; }, order: function(){ return o; }, range: function(){ return o; }, then: function(res){ return Promise.resolve({data: [], error: null, count: 0}).then(res); }}; return o; }
    }; };
    PR.loaded = false; PR.loading = false;
  })()`);
  await ev(`prLoadSummary()`);
  await page.waitForTimeout(300);
  check('usa a RPC (uma chamada, sem ler as evoluções)', JSON.stringify(await ev(`window.__calls`)) === '["rpc:clinical_records_summary"]', await ev(`JSON.stringify(window.__calls)`));
  check('resumo montado', (await ev(`JSON.stringify(PR.summary.p1)`)) === '{"count":4,"last":"2026-09-30","profs":["Ana","Bia"]}', await ev(`JSON.stringify(PR.summary.p1)`));
  // sem a função no banco: cai na leitura em páginas
  await ev(`(function(){ window.__calls = []; var old = agdClient; agdClient = function(){ var c = old(); c.rpc = function(n){ window.__calls.push("rpc:" + n); return Promise.resolve({data: null, error: {message: "nofunc"}}); }; return c; }; PR.loaded = false; })()`);
  await ev(`prLoadSummary()`);
  await page.waitForTimeout(400);
  check('sem a função, lê as evoluções', (await ev(`window.__calls`)).indexOf('from:clinical_records') !== -1, await ev(`JSON.stringify(window.__calls)`));
  check('sem erros de script', errors.length === 0, errors.join('|'));
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
  console.log(fails ? 'FALHOU: ' + fails : 'OK');
  process.exit(fails ? 1 : 0);
})();
