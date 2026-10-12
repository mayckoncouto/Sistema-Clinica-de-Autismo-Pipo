// Demonstrativos — Custo por Atendimento (etapa 3). Dados fictícios; conferência dos números pela regra decidida:
// equipe paga dividida pela remuneração cadastrada; slot ÷ pacientes do profissional; apoio ÷ pacientes da sala;
// demais custos por hora de sala ocupada; receita do convênio pelos Lançamentos; todas as sessões agendadas.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_cus.html');
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
  const near = (a, b) => Math.abs(a - b) < 0.01;

  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.doc('config/bank_accounts').set({ list: [{ id: 'viacredi', name: 'Viacredi', tipo: 'Banco' }] });
    await db.doc('config/chart_accounts').set({ list: [
      { id: 'unimed', name: 'Unimed', categoria: 'Receita Operacional', tipo: 'Receita', convenioId: 'unimed' },
      { id: 'aval', name: 'Avaliação', categoria: 'Receita Operacional', tipo: 'Receita' },
      { id: 'rend', name: 'Rendimentos', categoria: 'Receita Financeira', tipo: 'Receita' },
      { id: 'sal', name: 'Salários', categoria: 'Despesas com Funcionários', tipo: 'Despesa' },
      { id: 'alu', name: 'Aluguel', categoria: 'Despesas Fixas', tipo: 'Despesa' },
      { id: 'mat', name: 'Materiais', categoria: 'Despesas Variáveis', tipo: 'Despesa' },
      { id: 'imp', name: 'Imposto', categoria: 'Imposto', tipo: 'Despesa' },
      { id: 'jur', name: 'Juros', categoria: 'Despesas Financeiras', tipo: 'Despesa' }] });
  });
  await page.waitForTimeout(300);
  await ev(`(function(){
    var mk = function(id, plan, valor){ return {id: id, acc: 'viacredi', date: '2026-03-10', desc: id, plan: plan, valor: valor, extDate: '', extVal: null, obs: '', key: ''}; };
    FL.rows = [mk('l1','sal',12000), mk('l2','alu',3000), mk('l3','mat',1000), mk('l4','imp',1000), mk('l5','jur',500), mk('l6','unimed',6000), mk('l7','aval',700), mk('l8','rend',50)];
    state.professionals = state.professionals.map(function(p){ return p; });
    STAFF.rows = [{id:'s-ana', professional_id:'ana-terapeuta', data:{tipos:['profissional']}}, {id:'s-bia', professional_id:'bia-terapeuta', data:{tipos:['profissional']}},
      {id:'s-and', professional_id:'andrelisa-terapeuta', data:{tipos:['profissional']}}, {id:'s-rec', professional_id:null, data:{nome:'Recepção', tipos:['recepcao']}}];
    STAFF.loaded = true;
    STAFF_PAY_MEM['s-ana'] = {valor: 4000}; STAFF_PAY_MEM['s-bia'] = {valor: 4000}; STAFF_PAY_MEM['s-and'] = {valor: 2000}; STAFF_PAY_MEM['s-rec'] = {valor: 2000};
    state.treatments = state.patients.map(function(p){ return {id: 't-' + p.id, patientId: p.id, inicio: '2026-01-01', status: 'ativo', convenioId: 'unimed', convenio: 'Unimed'}; });
    var r1 = state.rooms[0].id, r2 = state.rooms[1].id, p1 = state.patients[0], p2 = state.patients[1], p3 = state.patients[2];
    AD.rows = {
      a1: {id:'a1', date:'2026-03-02', time:'08:00', professional_id:'ana-terapeuta', room_id:r1, patient:p1.nome, patient_id:p1.id, blocked:false, service:'sessao'},
      a2: {id:'a2', date:'2026-03-02', time:'08:00', professional_id:'ana-terapeuta', room_id:r1, patient:p2.nome, patient_id:p2.id, blocked:false, service:'sessao'},
      g1: {id:'g1', date:'2026-03-02', time:'08:00', professional_id:'andrelisa-terapeuta', room_id:r1, patient:'Coordenador', group_id:'coord', blocked:false, service:'sessao'},
      b1: {id:'b1', date:'2026-03-02', time:'08:00', professional_id:'bia-terapeuta', room_id:r2, patient:p3.nome, patient_id:p3.id, blocked:false, service:'sessao'}
    };
    return 1; })()`);
  const R = JSON.parse(await ev(`(function(){ var r = cuCompute('2026-03', Object.keys(AD.rows).map(function(k){ return AD.rows[k]; }), STAFF_PAY_MEM);
    var sc = {}; r.people.forEach(function(p){ if (p.prof) sc[p.prof.id] = {sc: p.slotCost, share: p.share, slots: p.slots, avail: p.avail, used: p.used}; });
    return JSON.stringify({err: r.err, pools: r.pools, naoAssist: r.naoAssist, T: r.T, sc: sc, H: r.salaHours, recOther: r.recOther, eqAlloc: r.eqAlloc, ocioso: r.ociosoCost, eqAssist: r.eqAssist, nItems: r.items.length, byN: r.byN, warn: r.warn}); })()`));
  console.log(JSON.stringify(R));
  check('no error; 3 patient appointments (group row is not a patient)', !R.err && R.nItems === 3);
  check('pools by Plano de Contas category: equipe 12.000, fixo 3.000, variável 1.000, imposto 1.000, financeiras 500', R.pools.equipe === 12000 && R.pools.fixo === 3000 && R.pools.variavel === 1000 && R.pools.imposto === 1000 && R.pools.financeiro === 500);
  check('team pool split by cadastrada remuneração (Ana 4.000, Bia 4.000, coord 2.000, recepção 2.000 → sala)', near(R.sc['ana-terapeuta'].share, 4000) && near(R.sc['andrelisa-terapeuta'].share, 2000) && near(R.naoAssist, 2000));
  check('slot cost = share ÷ available slots of the month', near(R.sc['ana-terapeuta'].sc, 4000 / R.sc['ana-terapeuta'].slots) && R.sc['ana-terapeuta'].avail > 100, JSON.stringify(R.sc['ana-terapeuta']));
  check('equipe total = Ana slot (2 patients share it) + Bia slot', near(R.T.eq, R.sc['ana-terapeuta'].sc + R.sc['bia-terapeuta'].sc));
  check('apoio total = coordinator slot split among the 2 patients of the room', near(R.T.ap, R.sc['andrelisa-terapeuta'].sc));
  check('sala pool (fixo+var+imposto+não assistencial = 7.000) over 2 sala-hours, all absorbed', R.H === 2 && near(R.T.sa, 7000));
  check('receita = Lançamentos of the convênio (6.000); other operational 700; financial income excluded', near(R.T.rec, 6000) && near(R.recOther, 700));
  check('team money reconciles: alloc + idle = 10.000 paid to professionals', near(R.eqAlloc + R.ocioso, R.eqAssist) && near(R.eqAssist, 10000));
  check('by number of patients in the slot: 2 → 2 attendances (Ana), 1 → 1 (Bia)', R.byN['2'].sess === 2 && R.byN['1'].sess === 1);
  const eq2 = (await ev(`(function(){ var r = cuCompute('2026-03', Object.keys(AD.rows).map(function(k){ return AD.rows[k]; }), STAFF_PAY_MEM); return r.byN['2'].eq / r.byN['2'].sess; })()`));
  check('each of Ana\'s patients carries half of her slot', near(eq2, R.sc['ana-terapeuta'].sc / 2));

  // sem remuneração de alguém: peso = média, avisa
  const R2 = JSON.parse(await ev(`(function(){ var pays = {'s-ana': {valor: 4000}, 's-bia': {valor: 4000}}; var r = cuCompute('2026-03', Object.keys(AD.rows).map(function(k){ return AD.rows[k]; }), pays); return JSON.stringify({err: r.err, semPag: r.semPag, warn: r.warn}); })()`));
  check('people without pay get the mean weight and are listed', !R2.err && R2.semPag.length === 2 && /Sem remuneração cadastrada/.test(R2.warn[0]), JSON.stringify(R2));
  const R3 = JSON.parse(await ev(`(function(){ var r = cuCompute('2026-03', [], {}); return JSON.stringify({err: r.err}); })()`));
  check('no pay at all: clear message', /Sem remuneração cadastrada/.test(R3.err));

  // ---- tela ----
  await page.click('#finBtn'); await page.click('#finMenu [data-nav="demonstrativos"]'); await page.waitForTimeout(300);
  await page.click('#demSeg [data-dv="cus"]'); await page.waitForTimeout(600);
  const txt = await page.$eval('#demBody', (e) => e.textContent.replace(/\s+/g, ' '));
  check('third button exists and the view shows the sections', /Por especialidade/.test(txt) && /Por convênio/.test(txt) && /convênio × especialidade/.test(txt) && /número de pacientes/.test(txt) && /Ociosidade de equipe/.test(txt) && /De onde vem o custo/.test(txt), txt.slice(0, 200));
  check('toolbar hides period/comparison/conta in this view', await page.$eval('[data-dp-for="demPer"]', (e) => e.classList.contains('dem-off')) && await page.$eval('[data-dp-for="demCmp"]', (e) => e.classList.contains('dem-off')) && !(await page.$eval('[data-dp-for="demMon"]', (e) => e.classList.contains('dem-off'))));
  check('convênio and especialidade rows present', /Unimed/.test(txt) && /Psicologia/.test(txt) && /Fonoaudiologia/.test(txt));
  await page.click('#demMenuBtn'); await page.waitForTimeout(80);
  check('menu has Excel, PDF and Atualizar', !!(await page.$('#demMenu [data-dact="cuxlsx"]')) && !!(await page.$('#demMenu [data-dact="cuprint"]')) && !!(await page.$('#demMenu [data-dact="cureload"]')));
  await page.keyboard.press('Escape');
  // sem permissão de valores dos colaboradores
  await page.evaluate(() => { window.pipoAuth = { can: (m, a) => m === 'financeiro' && a === 'view', canDefault: () => true, isAdmin: () => false, onProfile: () => {} }; });
  await ev('renderDemonstrativos()'); await page.waitForTimeout(200);
  check('without Colaboradores – Valores: explains the permission', /Colaboradores – Valores/.test(await text('#demBody')));
  await page.evaluate(() => { delete window.pipoAuth; });
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  process.exit(fails || errors.length ? 1 : 0);
  function text(sel) { return page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ')); }
})();
