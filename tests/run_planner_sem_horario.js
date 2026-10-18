// Relatório Planner Sem Horário de Atendimento: dias/semanas do Horário de Atendimento sem agendamento no Planner.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const f = path.join(__dirname, 'page_psh.html');
  fs.writeFileSync(f, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + f);
  await page.waitForTimeout(800);
  let fails = 0;
  const check = (l, ok, x) => { console.log(l, ok, x === undefined ? '' : x); if (!ok) fails++; };
  const r = JSON.parse(await page.evaluate(() => window.__ev(`(function(){
    var room = state.rooms.filter(function(r){ return !isGroup(r) && (r.therapists || []).length; })[0];
    var seat = room.therapists[0];
    var p = state.patients[0], q = state.patients[1];
    state.patients.forEach(function(x){ x.horarios = null; });
    var orig = activeTreatment; activeTreatment = function(){ return {status: "ativo"}; };
    p.horarios = {seg: {ativo: true, manha: {inicio: "08:00", fim: "10:40"}, tarde: {inicio: "", fim: ""}},
                  ter: {ativo: true, manha: {inicio: "08:00", fim: "10:40"}, tarde: {inicio: "", fim: ""}}};
    var all = {"seg-1": {}, "seg-2": {}, "seg-3": {}, "seg-4": {}, "ter-1": {}};
    all["seg-1"]["08:00|" + room.id + "|" + seat.id] = {patient: p.nome};
    all["seg-2"]["07:20|" + room.id + "|" + seat.id] = {patient: p.nome};
    all["seg-3"]["09:00|" + room.id + "|" + seat.id] = {patient: p.nome};
    all["ter-1"]["08:00|" + room.id + "|" + seat.id] = {patient: p.nome};
    var rep = RP_BUILDERS["planner-sem-horario"]([], {prof: "", pac: ""}, {}, all);
    var rep2 = RP_BUILDERS["planner-sem-horario"]([], {prof: "", pac: "zzzz"}, {}, all);
    activeTreatment = orig;
    return JSON.stringify({p: p.nome, rep: rep, n2: rep2.sections[0].rows.length, t: RP_TYPES.some(function(x){ return x.id === "planner-sem-horario" && x.noPeriod; })});
  })()`)));
  const sec = r.rep.sections.length === 1 && r.rep.sections[0];
  check('tipo cadastrado (sem período)', r.t);
  check('cabeçalho', sec.head.join() === 'Paciente,Semana,Dia,Horário do Paciente,Situação', sec.head && sec.head.join());
  const rows = sec.rows;
  // seg: semanas 2 (só fora da faixa) e 4 (nada); ter: semanas 2, 3, 4 (sem nada)
  check('5 linhas', rows.length === 5, JSON.stringify(rows));
  check('seg semana 2 só fora do horário', rows.some((x) => x[1] === '2ª' && x[2] === 'Segunda-feira' && /só fora/.test(x[4])));
  check('seg semana 4 sem agendamento', rows.some((x) => x[1] === '4ª' && x[2] === 'Segunda-feira' && x[4] === 'Sem agendamento no dia'));
  check('seg semanas 1 e 3 não entram', !rows.some((x) => x[2] === 'Segunda-feira' && (x[1] === '1ª' || x[1] === '3ª')));
  check('ter semana 1 não entra', !rows.some((x) => x[2] === 'Terça-feira' && x[1] === '1ª'));
  check('abre no Planner', await page.evaluate(() => window.__ev('rpGoKey(["Ana","2ª","Terça-feira"])')) === 'ter|2|Ana');
  check('filtro de paciente', r.n2 === 0);
  check('no JS errors?', errors.length === 0, errors.join('|'));
  fs.unlinkSync(f);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
