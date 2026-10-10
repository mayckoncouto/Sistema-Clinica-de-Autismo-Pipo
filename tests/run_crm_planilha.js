// CRM: exportar e importar tarefas (Outras opções ▾ da barra do CRM). Exporta o que está na tela aberta;
// importa pela coluna Código (com código = atualiza, sem = nova); nome que não é paciente vira lead.
// Em memória. Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_crm_io.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForSelector('td.slotcell');
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : JSON.stringify(extra)); if (!ok) fails++; };

  await ev('(function(){ CRM.people = [{id: "local-me", full_name: "Você Teste"}, {id: "u2", full_name: "Bia Sec"}]; return true; })()');
  await page.click('#crmBtn'); await page.click('#crmMenu [data-nav="crm-atendimento"]'); await page.waitForTimeout(400);
  // duas tarefas para começar
  await ev(`(function(){ var p = state.patientsRaw[0];
    return Promise.all([crmInsert({list_id: "atendimento", status: "triagem", title: "Ligar para a família", priority: "normal", assignees: ["local-me"], lead: {nome: "Contato Antigo"}, position: 1}),
      crmInsert({list_id: "atendimento", status: "triagem", title: "Agendar avaliação", priority: "normal", assignees: [], patient_id: p.id, lead: {}, position: 2}),
      crmInsert({list_id: "agendas", status: "aberto", title: "Outra lista", priority: "normal", assignees: [], lead: {}, position: 1})]).then(function(){ crmRender(); return true; }); })()`);
  await page.waitForTimeout(200);

  check('CRM bar has "Outras opções" with Exportar/Importar planilha?', !!(await page.$('#tab-crm [data-io-wrap="tarefas"]')));
  const exp = JSON.parse(await ev('JSON.stringify(ioTaskExportRows())'));
  check('export = tasks of the open list (Atendimento), with Código, Lista, Status, Tarefa, Paciente ou Lead?', exp.length === 2 && exp.every((r) => r.codigo && r.lista === 'Atendimento') && exp.some((r) => r.quem === 'Contato Antigo' && r.resp === 'Você Teste'), exp.map((r) => [r.lista, r.status, r.tarefa, r.quem]));
  const fname = await ev('IO_KINDS.tarefas.file');
  check('file name follows the open screen?', fname === 'tarefas-atendimento', fname);

  const c1 = exp.find((r) => r.tarefa === 'Ligar para a família').codigo, c2 = exp.find((r) => r.tarefa === 'Agendar avaliação').codigo;
  const pat = await ev('state.patientsRaw[1].nome');
  const txt = ['Código\tLista\tStatus\tTarefa\tPaciente ou Lead\tResponsáveis\tVencimento\tPrioridade\tTelefone\tCriada em',
    `${c1}\t\t\t\t\tBia Sec\t20/12/2026\tAlta\t(47) 99999-1111\t01/01/2026`,
    `${c2}\t\t\t\t\t\t\t\t\t`,
    `\tAtendimento\tAvaliação\tNova pela planilha\tLead Planilha\tVocê Teste\t15/11/2026\tUrgente\t47 3333-2222\t`,
    `\t\t\tSem lista usa a aberta\t${pat}\t\t\t\t\t`,
    `\tAtendimento\tNão existe\tStatus errado\t\t\t\t\t\t`,
    `naoexiste\t\t\tCódigo errado\t\t\t\t\t\t`,
    `\tAtendimento\t\tData ruim\t\t\t31/02/2026\t\t\t`].join('\n');
  await page.click('#tab-crm [data-io-btn]'); await page.click('#tab-crm [data-io-act="import"]'); await page.waitForSelector('#ovIo');
  await page.fill('#ioPaste', txt);
  await page.click('#ioPrev'); await page.waitForTimeout(400);
  const prev = await page.evaluate(() => [...document.querySelectorAll('#ioOut tr[data-io-st]')].map((tr) => tr.getAttribute('data-io-st') + ':' + tr.children[1].textContent.replace(/\s+/g, ' ').trim().split(' · ')[0]));
  check('preview: 1 update, 1 same, 2 new, 3 with problem (status, code, date)?',
    prev.join('|') === 'atualizar:Ligar para a família|igual:Agendar avaliação|novo:Nova pela planilha|novo:Sem lista usa a aberta|problema:Status errado|problema:Código errado|problema:Data ruim', prev);
  const leadWarn = await page.evaluate(() => /não está no cadastro de pacientes: entra como lead/.test(document.getElementById('ioOut').textContent));
  check('name that is not a patient is shown as lead in the preview?', leadWarn);
  await ev('(window.__dl = [], xlDownload = function(n){ window.__dl.push(n); }, true)');
  await page.click('#ioGo'); await page.waitForSelector('#confirmHost .overlay');
  await page.evaluate(() => { const b = [...document.querySelectorAll('#confirmHost button')].find((x) => x.textContent.trim() === 'Importar'); b.click(); });
  await page.waitForTimeout(600);
  const dls = await ev('window.__dl');
  check('before importing, downloads a copy of the current tasks?', dls.length === 1 && /^tarefas-atendimento-.*\.xlsx$/.test(dls[0]), dls);
  const res = JSON.parse(await ev(`(function(){ var all = Object.keys(CRM.tasks).map(function(k){ return CRM.tasks[k]; });
    var u = CRM.tasks["${c1}"], n = all.filter(function(x){ return x.title === "Nova pela planilha"; })[0], s = all.filter(function(x){ return x.title === "Sem lista usa a aberta"; })[0];
    return JSON.stringify({u: {as: u.assignees, due: u.due_date, pr: u.priority, tel: (u.lead || {}).telefone, nome: (u.lead || {}).nome},
      n: n && {list: n.list_id, st: n.status, lead: n.lead, as: n.assignees, due: n.due_date, pr: n.priority},
      s: s && {list: s.list_id, pid: s.patient_id, st: s.status}, total: all.length}); })()`));
  check('update: responsáveis, vencimento, prioridade and lead phone (digits); lead name kept?', JSON.stringify(res.u.as) === '["u2"]' && res.u.due === '2026-12-20' && res.u.pr === 'alta' && res.u.tel === '47999991111' && res.u.nome === 'Contato Antigo', res.u);
  check('new task: list, status by name, lead with phone, responsible, due date, priority?', res.n && res.n.list === 'atendimento' && res.n.st === 'avaliacao' && res.n.lead.nome === 'Lead Planilha' && res.n.lead.telefone === '4733332222' && JSON.stringify(res.n.as) === '["local-me"]' && res.n.due === '2026-11-15' && res.n.pr === 'urgente', res.n);
  check('row without Lista goes to the open list, patient by name, first status?', res.s && res.s.list === 'atendimento' && !!res.s.pid && res.s.st === 'triagem', res.s);
  check('only valid rows were saved (3 + 2 new = 5)?', res.total === 5, res.total);
  // tela CRM: exporta todas as listas visíveis
  await ev('(crmGo("__home"), true)'); await page.waitForTimeout(300);
  const expHome = JSON.parse(await ev('JSON.stringify(ioTaskExportRows().map(function(r){ return r.lista; }))'));
  check('on the CRM screen, export brings tasks of all lists (with Lista column)?', expHome.length === 5 && expHome.indexOf('Agendas') !== -1, expHome);
  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log(fails + ' FAILED'); process.exit(1); }
})();
