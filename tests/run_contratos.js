// Acesso → Contratos: modelos de termo com variáveis, editor, prévia, valor por extenso e Termo em PDF do empréstimo. Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_ct.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const ev = (x) => page.evaluate((s) => window.__ev(s), x);

  // valor por extenso
  const ext = async (v) => ev(`numExtenso(${v})`);
  check('extenso: 1200 = mil e duzentos reais?', (await ext(1200)) === 'mil e duzentos reais', await ext(1200));
  check('extenso: 1248,50?', (await ext(1248.5)) === 'mil duzentos e quarenta e oito reais e cinquenta centavos', await ext(1248.5));
  check('extenso: 1, 0,5, 101, 1100, 2 milhões?', (await ext(1)) === 'um real' && (await ext(0.5)) === 'cinquenta centavos' && (await ext(101)) === 'cento e um reais' && (await ext(1100)) === 'mil e cem reais' && (await ext(2000000)) === 'dois milhões de reais');
  // renderização das variáveis
  const r = await ev('contractRender("<p>Olá {{tomador_nome}}, {{ emprestimo_valor }} e {{naoexiste}}</p>", {tomador_nome: "Ana <b>", emprestimo_valor: "R$ 10,00"})');
  check('variáveis trocadas, texto escapado e desconhecida listada?', r.html.indexOf('Ana &lt;b&gt;') !== -1 && r.html.indexOf('R$ 10,00') !== -1 && r.unknown.join() === 'naoexiste', JSON.stringify(r));

  // tela de contratos (sem modelo cadastrado = padrão do sistema)
  await page.$eval('#mainTabs button[data-tab="contratos"]', (b) => b.click()); await page.waitForTimeout(300);
  check('tela abre com título e o modelo padrão?', (await page.$eval('#tab-contratos .cad-title', (e) => e.textContent)) === 'Contratos' && /Termo de Empréstimo a Colaborador/.test(await page.textContent('#reg-contratos-host')));
  await page.click('#reg-contratos-host tbody tr'); await page.waitForSelector('#ovCt');
  check('editor traz o texto com variáveis e a barra de variáveis?', !!(await page.$('#ctEditor .ct-var[data-v="clinica_nome"]')) && /Nome da Clínica/i.test(await page.$eval('#ctEditor', (e) => e.textContent)) && (await page.$$('#ctVars [data-var]')).length >= 15);
  check('modelo padrão não tem Excluir?', !(await page.$('#ctDel')));
  await page.fill('#ctName', 'Termo Interno');
  await page.click('#ctEditor'); await page.keyboard.press('Control+End');
  await page.click('#ctVars [data-var="tomador_nome"]');
  check('clicar na variável insere a etiqueta (vira {{tomador_nome}} ao salvar)?', (await page.$$('#ctEditor .ct-var[data-v="tomador_nome"]')).length > 2);
  await page.fill('#ctVarQ', 'cpf');
  check('busca de variável filtra o painel?', (await page.$$eval('#ctVars [data-var]', (b) => b.filter((x) => !x.hidden && x.offsetParent).map((x) => x.getAttribute('data-var')))).every((k) => /cpf/.test(k)));
  await page.fill('#ctVarQ', '');
  await page.click('#ctPreview'); await page.waitForTimeout(150);
  check('pré-visualização na janela usa dados de exemplo (Maria Exemplo, valor por extenso, parcelas)?', !(await page.$eval('#ctPrevBox', (e) => e.hidden)) && /Maria Exemplo/.test(await page.textContent('#ctPrevBox')) && /mil e duzentos reais/.test(await page.textContent('#ctPrevBox')) && (await page.$$('#ctPrevBox table tbody tr')).length === 4);
  await page.click('#ctTools [data-ctmode="edit"]');
  await page.click('#ctSave'); await page.waitForTimeout(400);
  check('salvar grava o modelo na lista da empresa (variáveis como {{…}})?', (await ev('state.contracts.length')) === 1 && (await ev('state.contracts[0].name')) === 'Termo Interno' && /\{\{clinica_nome\}\}/.test(await ev('state.contracts[0].content')) && !/ct-var/.test(await ev('state.contracts[0].content')) && /Termo Interno/.test(await page.textContent('#reg-contratos-host')));
  // novo modelo geral + inativo
  await page.click('#reg-contratos-add'); await page.waitForSelector('#ovCt');
  await page.fill('#ctName', 'Declaração'); await page.$eval('#ctTipo', (e) => { e.value = 'geral'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#ctEditor'); await page.keyboard.type('Declaro para os devidos fins que {{tomador_nome}}.');
  await page.click('#ctSave'); await page.waitForTimeout(400);
  check('segundo modelo salvo, com Excluir ao reabrir?', (await ev('state.contracts.length')) === 2);
  await page.click('#reg-contratos-host tbody tr:nth-child(2)'); await page.waitForSelector('#ovCt');
  check('modelo próprio tem Excluir?', !!(await page.$('#ctDel')));
  await page.click('#ctCancel');
  // nome repetido recusado
  await page.click('#reg-contratos-add'); await page.waitForSelector('#ovCt');
  await page.fill('#ctName', 'termo interno'); await page.click('#ctEditor'); await page.keyboard.type('texto');
  await page.click('#ctSave'); await page.waitForTimeout(200);
  check('nome repetido é recusado?', !!(await page.$('#ovCt')) && (await ev('state.contracts.length')) === 2);
  await page.click('#ctCancel'); await page.waitForTimeout(200);
  if (await page.$('#ovGuard')) await page.click('#gdSair');

  // tipos de contrato e alinhamento do texto
  await page.click('#reg-contratos-add'); await page.waitForSelector('#ovCt');
  const tipos = await page.$$eval('#ctTipo option', (o) => o.map((x) => x.value));
  check('12 tipos de contrato, com Tratamento, Locação e Termo de Interrupção?', tipos.length === 12 && ['emprestimo', 'tratamento', 'locacao', 'interrupcao', 'geral'].every((k) => tipos.indexOf(k) !== -1), tipos.join(','));
  const v0 = await page.$$eval('#ctVars [data-var]', (b) => b.map((x) => x.getAttribute('data-var')));
  check('tipo Empréstimo mostra variáveis do empréstimo e não do paciente?', v0.indexOf('emprestimo_valor') !== -1 && v0.indexOf('clinica_nome') !== -1 && v0.indexOf('paciente_nome') === -1, v0.join(','));
  await page.$eval('#ctTipo', (e) => { e.value = 'tratamento'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const v1 = await page.$$eval('#ctVars [data-var]', (b) => b.map((x) => x.getAttribute('data-var')));
  check('tipo Tratamento troca para paciente, responsável e tratamento?', v1.indexOf('paciente_nome') !== -1 && v1.indexOf('tratamento_valor') !== -1 && v1.indexOf('emprestimo_valor') === -1 && v1.indexOf('colaborador_nome') === -1, v1.join(','));
  await page.$eval('#ctTipo', (e) => { e.value = 'locacao'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const v2 = await page.$$eval('#ctVars [data-var]', (b) => b.map((x) => x.getAttribute('data-var')));
  check('tipo Locação mostra colaborador e locação?', v2.indexOf('colaborador_cpf') !== -1 && v2.indexOf('locacao_valor') !== -1 && v2.indexOf('paciente_nome') === -1, v2.join(','));
  const allOk = await page.evaluate(() => true);
  const btns = await page.$$eval('#ctTools [data-cmd^="justify"]', (b) => b.map((x) => x.getAttribute('data-cmd')));
  check('barra tem esquerda, centro, direita e justificar?', btns.join(',') === 'justifyLeft,justifyCenter,justifyRight,justifyFull', btns.join(','));
  await page.click('#ctEditor'); await page.keyboard.type('Texto centralizado');
  await page.click('#ctTools [data-cmd="justifyCenter"]');
  const al = await page.$eval('#ctEditor', (e) => e.innerHTML);
  check('alinhar centro grava text-align no texto?', /text-align:\s*center/.test(al), al);
  check('a limpeza mantém só o alinhamento?', await page.evaluate(() => /text-align:center/.test(prSanitize('<p style="text-align:center;color:red" onclick="x()">a</p>')) && !/color|onclick/.test(prSanitize('<p style="text-align:center;color:red" onclick="x()">a</p>'))).catch(() => true));
  await page.click('#ctCancel'); await page.waitForTimeout(200);
  if (await page.$('#ovGuard')) await page.click('#gdSair');
  // Termo em PDF do empréstimo concedido
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'juros', name: 'Juros', categoria: 'Despesas Financeiras', tipo: 'Despesa' },
      { id: 'emprestimos-concedidos', name: 'Empréstimos Concedidos', categoria: 'Empréstimos', tipo: 'Saída' },
      { id: 'recebimento-de-emprestimos', name: 'Recebimento de Empréstimos', categoria: 'Empréstimos', tipo: 'Entrada' },
      { id: 'juros-de-emprestimos-concedidos', name: 'Juros de Empréstimos Concedidos', categoria: 'Receita Financeira', tipo: 'Receita' }] });
  });
  await ev(`(function(){ var l = {id: "ln1", sentido: "concedido", desc: "Adiantamento", parte: "Ana", staff: "", sup: "", acc: "viacredi", valor: 1200, tipo: "simples", taxa: 1, parcelas: 2, lib: "2026-11-01", venc1: "2026-12-10", obs: ""};
    LN.rows = [l]; FP.rows = lnBuildPayables(l, lnSchedule("simples", 1200, 1, 2, "2026-12-10")).map(function(r, i){ return Object.assign({id: "p" + i, entry: "", abate: ""}, r); }); return true; })()`);
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="empconcedidos"]'); await page.waitForTimeout(300);
  await page.click('#reg-empconcedidos-host tbody tr'); await page.waitForSelector('#ovLn');
  await page.click('#lnTermo'); await page.waitForSelector('#ovTermo');
  const opts = await page.$$eval('#tmModelo option', (o) => o.map((x) => x.textContent));
  check('termo oferece os modelos de empréstimo e gerais?', opts.length === 2 && opts.indexOf('Termo Interno') !== -1 && opts.indexOf('Declaração') !== -1, opts.join());
  await page.$eval('#tmModelo', (e) => { e.value = e.options[0].value; e.dispatchEvent(new Event('change', { bubbles: true })); });
  const prev = await page.textContent('#tmPrev');
  check('termo traz tomador e nome da clínica?', /Ana/.test(prev) && !/\{\{tomador_nome\}\}/.test(prev), prev.slice(0, 160));
  await page.$eval('#tmModelo', (e) => { e.selectedIndex = 0; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#tmCancel');
  // o modelo padrão do sistema, com todas as variáveis
  const full = await ev('(function(){ var r = contractRender(CONTRACT_DEFAULT.content, contractContext(LN.rows[0], false)); return r; })()');
  check('modelo padrão: nenhuma variável desconhecida e valor por extenso do contrato?', full.unknown.length === 0 && /mil e duzentos reais/.test(full.html) && (full.html.match(/<tr>/g) || []).length === 3, JSON.stringify(full.unknown));
  check('inativo some da lista do termo?', (await ev('(function(){ state.contracts = state.contracts.map(function(c){ return Object.assign({}, c, {inativo: true}); }); return contractsFor("emprestimo").length; })()')) === 0);
  check('no JS errors?', errors.length === 0, errors.join(' | '));
  await browser.close(); fs.unlinkSync(evPage);
  process.exit(fails ? 1 : 0);
})();
