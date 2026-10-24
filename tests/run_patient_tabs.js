// Abas da janela do paciente (Cadastro, Tratamento, Agenda, Prontuário, Anamneses, Anexos). Dados fictícios.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i0 = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_pt.html');
  fs.writeFileSync(evPage, src.slice(0, i0 + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i0 + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const check = (l, ok, x) => console.log(l, !!ok, x === undefined ? '' : x);
  await page.evaluate(() => window.__ev("(function(){ var p = state.patients.filter(function(x){ return x.nome === 'Ana Azul'; })[0]; state.treatments = [{id: 'trT', patientId: p.id, inicio: '2026-01-01', status: 'ativo', tipo: 'novo', specHours: [], criadoEm: '2026-01-01'}]; })()"));
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(300);
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  const tabs = await page.$$eval('#pmTabs button', (a) => a.map((b) => b.textContent));
  check('abas no topo, Cadastro primeiro?', tabs[0] === 'Cadastro' && tabs.includes('Tratamento') && tabs.includes('Anexos'), tabs);
  check('aba Tarefas fica logo antes de Anexos?', tabs.indexOf('Tarefas') !== -1 && tabs.indexOf('Tarefas') === tabs.indexOf('Anexos') - 1, tabs);
  await page.click('#pmTabs [data-pmt=tarefas]'); await page.waitForTimeout(500);
  check('aba Tarefas mostra a lista (vazia) com busca?', await page.$eval('.pm-pane[data-pmp=tarefas]', (p) => !p.hidden && p.classList.contains('pt-list') && /Nenhuma tarefa/.test(p.textContent)));
  await page.click('#pmTabs [data-pmt=cad]');
  check('Tratamento não é mais grupo do Cadastro?', !(await page.$('.pm-pane[data-pmp=cad] [data-pmsec=tratamento]')));
  const modalH = () => page.$eval('#ovPat .modal', (e) => Math.round(e.getBoundingClientRect().height));
  const hCad = await modalH();
  await page.click('#pmTabs [data-pmt=trat]'); await page.waitForTimeout(400);
  check('aba Tratamento abre o formulário inteiro do tratamento?', await page.isVisible('#ovPat .modal-foot #trSave') && await page.isVisible('.pm-pane[data-pmp=trat] #pPac') && !(await page.$('#pOpenTreat')));
  check('esconde o cadastro e o Salvar do paciente?', await page.$eval('.pm-pane[data-pmp=cad]', (e) => e.hidden) && await page.$eval('#pSave', (e) => getComputedStyle(e).display === 'none'));
  check('altura da janela igual à do Cadastro?', (await modalH()) === hCad, [hCad, await modalH()]);
  // Agenda e Prontuário em tabela
  await page.evaluate(() => window.__ev("(function(){ var p = state.patients.filter(function(x){ return x.nome === 'Ana Azul'; })[0]; AD.rows = { a1: { id: 'a1', patient_id: p.id, date: '2026-10-01', time: '08:00', professional_id: (state.professionals[0] || {}).id, status: '' } }; })()"));
  await page.click('#pmTabs [data-pmt=agenda]'); await page.waitForTimeout(400);
  check('aba Agenda é tabela no estilo da lista de Pacientes?', (await page.$$('.pm-pane[data-pmp=agenda] table.pat-table tbody tr')).length === 1 && !!(await page.$('.pm-pane[data-pmp=agenda] .sort-btn')));
  check('altura continua a do Cadastro na Agenda?', (await modalH()) === hCad, await modalH());
  await page.click('#pmTabs [data-pmt=pront]'); await page.waitForTimeout(300);
  check('aba Prontuário tem barra de busca e contagem?', !!(await page.$('.pm-pane[data-pmp=pront] .pt-q')) && /evolu/.test(await page.$eval('.pm-pane[data-pmp=pront] .pt-count', (e) => e.textContent)));
  // Anexos direto no cadastro
  await page.click('#pmTabs [data-pmt=anexos]'); await page.waitForTimeout(300);
  check('aba Anexos tem + Incluir?', await page.isVisible('.pm-pane[data-pmp=anexos] .pt-add'));
  check('altura continua a do Cadastro em Anexos?', (await modalH()) === hCad, await modalH());
  await page.click('.pm-pane[data-pmp=anexos] .pt-add'); await page.waitForSelector('#ovAtt');
  await page.setInputFiles('#atFile', { name: 'laudo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 teste') });
  await page.fill('#atName', 'Laudo'); await page.waitForTimeout(100);
  const prev = await page.textContent('#atPrev');
  check('nome final leva o nome completo do paciente?', /Laudo Ana Azul\.pdf/.test(prev), prev);
  await page.click('#atOk'); await page.waitForTimeout(500);
  const rowTxt = await page.$$eval('.pm-pane[data-pmp=anexos] .pt-card', (a) => a.map((r) => r.textContent));
  check('anexo aparece na lista, origem Cadastro?', rowTxt.length === 1 && /Laudo Ana Azul\.pdf/.test(rowTxt[0]) && /Cadastro/.test(rowTxt[0]), rowTxt);
  await page.click('.pm-pane[data-pmp=anexos] [data-pta=ren]'); await page.waitForSelector('#ovAtt');
  await page.fill('#atName', 'Receita'); await page.click('#atOk'); await page.waitForTimeout(400);
  check('renomear funciona?', /Receita Ana Azul\.pdf/.test(await page.$eval('.pm-pane[data-pmp=anexos] .pt-cards', (e) => e.textContent)));
  await page.click('.pm-pane[data-pmp=anexos] [data-pta=del]'); await page.waitForSelector('#adDrive'); await page.click('#adDrive'); await page.waitForTimeout(400);
  check('excluir tira da lista?', (await page.$$('.pm-pane[data-pmp=anexos] .pt-card')).length === 0);
  await page.click('#pmTabs [data-pmt=cad]');
  check('voltar ao Cadastro mostra Salvar?', await page.$eval('#pSave', (e) => getComputedStyle(e).display !== 'none'));
  await page.click('#closePat');
  // Paciente sem tratamento: só o botão + Incluir
  await page.evaluate(() => window.__ev('window.__trBkp = state.treatments; state.treatments = [];'));
  await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat');
  await page.click('#pmTabs [data-pmt=trat]'); await page.waitForTimeout(300);
  check('sem tratamento: + Incluir no topo e nenhum formulário?', await page.isVisible('#pNewTreat') && !(await page.$('#ovPat .modal-foot #trSave')));
  await page.click('#pNewTreat'); await page.waitForTimeout(300);
  check('+ Incluir abre o formulário na própria aba e Cancelar volta?', await page.isVisible('#ovPat .modal-foot #trSave') && await page.isVisible('#ovPat .modal-foot #trCancel'));
  await page.click('#trCancel'); await page.waitForTimeout(200);
  check('Cancelar volta ao + Incluir?', await page.isVisible('#pNewTreat'));
  await page.click('#closePat');
  await page.evaluate(() => window.__ev('state.treatments = window.__trBkp;'));
  // Permissões
  const openWith = async (perms) => {
    await page.evaluate((p) => {
      window.pipoAuth = { can: (m, a) => !!(p[m] && p[m].indexOf(a) !== -1), canDefault: (m, a, d) => (p[m] !== undefined ? p[m].indexOf(a) !== -1 : d), isAdmin: () => false, onProfile() {}, profile: () => null };
    }, perms);
    await page.click('#patListHost tbody tr:has-text("Ana Azul")'); await page.waitForSelector('#ovPat'); await page.waitForTimeout(200);
    const t = await page.$$eval('#pmTabs button', (a) => a.map((b) => b.textContent));
    return t;
  };
  const base = { pacientes: ['view', 'create', 'edit', 'delete'], tratamentos: ['view', 'create', 'edit', 'delete'], agenda: ['view'], prontuario: ['view'], saude_paciente: ['view'], pacientes_anexos: ['view'] };
  let t1 = await openWith(base);
  check('só ver Anexos: aba aparece, sem + Incluir?', t1.includes('Anexos'));
  await page.click('#pmTabs [data-pmt=anexos]'); await page.waitForTimeout(300);
  check('sem incluir não há botão + Incluir?', !(await page.$('.pm-pane[data-pmp=anexos] .pt-add')));
  await page.click('#closePat');
  let t2 = await openWith(Object.assign({}, base, { pacientes_anexos: [], pabas_agenda: [], tratamentos: [] }));
  check('sem ver Anexos, sem aba Agenda (pabas_agenda) e sem Tratamento: abas somem?', !t2.includes('Anexos') && !t2.includes('Agenda') && !t2.includes('Tratamento') && t2.includes('Cadastro'), t2);
  await page.click('#closePat');
  await page.evaluate(() => { delete window.pipoAuth; });
  await page.click('#addPatientBtn'); await page.waitForSelector('#ovPat');
  check('paciente novo não tem abas?', !(await page.$('#pmTabs')));
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  try { fs.unlinkSync(evPage); } catch (e) {}
})();
