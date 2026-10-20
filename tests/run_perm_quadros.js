// Níveis de Permissão em quadros: grupos por menu, quadro por janela, Ativar/Desativar Tudo, ferramentas herdando a tela.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };
  const sup = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipo-supabase.js'), 'utf8');
  const toolsSrc = 'window.pipoTools = {list: [' + sup.slice(sup.indexOf('var TOOLS = [') + 13, sup.indexOf('  function toolDef')).replace(/\];\s*$/, '') + ']};';
  await page.setContent('<div id="modalHost"></div><div id="mainTabs"></div>');
  await page.evaluate(toolsSrc);
  await page.evaluate(() => {
    window.pipoPerms = { isNew: () => true, upgrade: (x) => x, downgrade: (x) => x };
    window.pipoStatuses = () => [{ id: 'finalizado', name: 'Finalizado', color: '#2E9E5B' }];
    window.pipoCrmModules = () => [{ key: 'crm_listas', label: 'CRM', actions: ['view'] }, { key: 'crm_atendimento', label: 'CRM – Atendimento' }];
    window.pipoAnamModules = () => [];
    window.showToast = () => {};
    window.pipoAuth = { isAdmin: () => true, isManager: () => true, can: () => true, client: { from: () => ({}) }, onRoleChange: () => {}, session: () => null };
  });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'usuarios.js') });
  await page.evaluate(() => {
    window.__pipoRolesTest.setRoles([{ id: 'sec', name: 'Secretária', is_admin: false, permissions: { planner: { view: true, create: true, edit: false, delete: false }, pacientes: { view: true } } }]);
    window.__pipoRolesTest.openRole('sec');
  });
  await page.waitForSelector('#rPermBox');
  const groups = await page.$$eval('#rPermBox .perm-grp > .perm-grp-head .tr-sec', (e) => e.map((x) => x.textContent));
  check('groups in menu order?', groups.join('|') === 'Cadastros|Planner|Agenda|Prontuário|CRM|Relatórios|Financeiro|Menu Acesso', groups.join('|'));
  const quads = await page.$$eval('#rPermBox .perm-quad', (e) => e.length);
  check('many quadros (one per window)?', quads > 50, quads);
  check('no module left in "Outros"?', !(await page.$('#rPermBox .perm-grp[data-g="Outros"]')));
  const pl = '#rPermBox .perm-quad[data-q="planner"]';
  check('Planner quadro: body starts closed, summary shown?', (await page.$eval(pl + ' .perm-qbody', (e) => e.hidden)) && /de \d+ ativas/.test(await page.$eval(pl + ' .perm-qsum', (e) => e.textContent)));
  await page.click(pl + ' [data-qedit]');
  check('Editar opens the quadro?', !(await page.$eval(pl + ' .perm-qbody', (e) => e.hidden)));
  check('Planner quadro has its tools (Importar Planilha, Sugerir Agendamento, Cópias…)?', await page.$eval(pl, (q) => ['Importar Planilha', 'Sugerir Agendamento', 'Cópias do Planner', 'Substituir Terapeuta'].every((t) => q.textContent.indexOf(t) !== -1)));
  const tool = (k) => page.$eval('input[data-m="' + k + '"][data-a="view"]', (c) => c.checked);
  check('tools inherit the screen: Importar (planner.create on) on, Limpar por Filtro (planner.delete off) off, Cópias (planner.edit off) off?', (await tool('ferr_pl_importar')) && !(await tool('ferr_pl_limpar')) && !(await tool('ferr_pl_copias')));
  check('Exportar Excel (planner.view) on?', await tool('ferr_pl_exportar'));
  await page.click(pl + ' [data-qall="0"]');
  check('Desativar Tudo clears the quadro and the summary says 0?', (await page.$$eval(pl + ' input:checked', (e) => e.length)) === 0 && /^0 de/.test(await page.$eval(pl + ' .perm-qsum', (e) => e.textContent)));
  await page.click(pl + ' [data-qall="1"]');
  check('Ativar Tudo marks everything (actions and tools)?', (await page.$$eval(pl + ' input:not(:checked)', (e) => e.length)) === 0);
  // ver/incluir/editar/excluir continuam ligados
  await page.click(pl + ' [data-qall="0"]');
  await page.click('input[data-m="planner"][data-a="edit"]');
  check('marking Editar also marks Ver?', await page.$eval('input[data-m="planner"][data-a="view"]', (c) => c.checked));
  await page.click('input[data-m="planner"][data-a="view"]');
  check('unmarking Ver clears the other actions of that screen?', !(await page.$eval('input[data-m="planner"][data-a="edit"]', (c) => c.checked)));
  // grupo inteiro
  await page.click('#rPermBox .perm-grp[data-g="Planner"] [data-gall="1"]');
  check('group Ativar Tudo marks every quadro of the group?', (await page.$$eval('#rPermBox .perm-grp[data-g="Planner"] input:not(:checked)', (e) => e.length)) === 0);
  await page.click('#rPermBox .perm-grp[data-g="Planner"] [data-gall="0"]');
  check('group Desativar Tudo clears it?', (await page.$$eval('#rPermBox .perm-grp[data-g="Planner"] input:checked', (e) => e.length)) === 0);
  // status e relatórios dentro dos quadros
  check('Status dos atendimentos lives in the Agenda quadro and Relatórios has its own quadro?', !!(await page.$('.perm-quad[data-q="agenda"] #rStatusPerms')) && !!(await page.$('.perm-quad[data-q="relatorios"] #rReportPerms')));
  // salvar: normalize inclui as chaves de ferramenta
  const n = await page.evaluate(() => window.__pipoRolesTest.normalize({ planner: { view: true, create: true }, ferr_pl_limpar: { view: true } }));
  check('normalize: saved tool kept, unsaved tool inherits?', n.ferr_pl_limpar.view === true && n.ferr_pl_importar.view === true && n.ferr_pl_copias.view === false);
  // Lista de níveis em quadros, na ordem Gestor, Supervisor, Administrador, demais
  await page.evaluate(() => {
    window.pipoAuth.isManager = () => false;   // Administrador
    window.__pipoRolesTest.setRoles([
      { id: 'sec', name: 'Secretária', sort: 3, is_admin: false, permissions: {} },
      { id: 'administrador', name: 'Administrador', sort: 2, is_admin: true, permissions: {} },
      { id: 'supervisor', name: 'Supervisor', sort: 1, is_admin: false, all_units: true, permissions: {} },
      { id: 'gestao', name: 'Gestor', sort: 0, is_admin: true, is_manager: true, permissions: {} }]);
    window.__pipoRolesTest.sortRoles();
    window.__pipoRolesTest.openList();
  });
  await page.waitForSelector('#rlList .room-row');
  const order = await page.$$eval('#rlList .room-row .rn', (e) => e.map((x) => x.textContent.split(' ')[0]));
  check('levels as cards in order Gestor, Supervisor, Administrador, others?', order.join('|') === 'Gestor|Supervisor|Administrador|Secretária', order.join('|'));
  const btns = await page.$$eval('#rlList .room-row', (e) => e.map((r) => [...r.querySelectorAll('button')].map((b) => b.textContent).join('+')));
  check('Administrador: Gestor/Supervisor/Administrador only "Ver"; others Duplicar + Editar?', btns.join('|') === 'Ver|Ver|Ver|Duplicar+Editar', btns.join('|'));
  await page.click('#rlList [data-role-id="supervisor"] [data-rl-edit]');
  await page.waitForSelector('#ovRole');
  check('Supervisor opens read-only for Administrador (no Salvar, all-units box disabled)?', !(await page.$('#rSave')) && (await page.$eval('#rAllUnits', (c) => c.checked && c.disabled)));
  await page.evaluate(() => { window.pipoAuth.isManager = () => true; window.__pipoRolesTest.openRole('supervisor'); });
  check('Gestor can edit Supervisor and the all-units box?', !!(await page.$('#rSave')) && (await page.$eval('#rAllUnits', (c) => c.checked && !c.disabled)));
  // Histórico e Testar
  await page.evaluate(() => { window.pipoAuth.isManager = () => true; window.__pipoRolesTest.openRole('sec'); });
  check('level window has "Testar como Este Nível" and the history section?', !!(await page.$('#rTest')) && !!(await page.$('#rHistToggle')));
  const df = await page.evaluate(() => window.__pipoRolesTest.diff({ name: 'A', permissions: { planner: { view: true } } }, { name: 'B', permissions: { planner: { view: true, create: true }, pacientes: { view: true } } }));
  check('history diff describes name and permission changes?', df.some((x) => /Nome: A → B/.test(x)) && df.some((x) => /^Planner: ligou Incluir/.test(x)) && df.some((x) => /^Pacientes: ligou Ver/.test(x)), JSON.stringify(df));
  await page.evaluate(() => window.__pipoRolesTest.openList());
  check('levels list has the Histórico button?', !!(await page.$('#rlHist')));
  check('no JS errors?', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
