// Agenda ▾ → Visão geral: todos os atendimentos de um dia por horário (Paciente, Sala, Serviço;
// cor da especialidade), filtros, contadores, avisos do dia e tempo real. Banco em memória.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_vg.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + ' @ ' + String(e.stack).split(/\n/).slice(1, 4).join(' | ')));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // Banco em memória com a mesma "cara" do cliente Supabase usada pelo app.
  await ev(`(function(){
    var db = {appointments: [], clinical_records: [], therapy_plans: []}, seq = 0;
    function q(table){
      var f = [], op = "select", payload = null, wantSel = false, rng = null;
      var o = {
        select: function(){ wantSel = true; return o; },
        gte: function(k, v){ f.push(function(r){ return r[k] >= v; }); return o; },
        lte: function(k, v){ f.push(function(r){ return r[k] <= v; }); return o; },
        eq: function(k, v){ f.push(function(r){ return r[k] === v; }); return o; },
        in: function(k, vs){ f.push(function(r){ return vs.indexOf(r[k]) !== -1; }); return o; },
        order: function(){ return o; },
        range: function(a, b){ rng = [a, b]; return o; },
        insert: function(rows){ op = "insert"; payload = rows; return o; },
        update: function(set){ op = "update"; payload = set; return o; },
        delete: function(){ op = "delete"; return o; },
        then: function(res, rej){
          var t = db[table], out;
          if (op === "insert"){ out = payload.map(function(r){ var x = Object.assign({id: "n" + (++seq), status: null}, r); t.push(x); return x; }); }
          else {
            var hit = t.filter(function(r){ return f.every(function(fn){ return fn(r); }); });
            if (op === "update"){ hit.forEach(function(r){ Object.assign(r, payload); }); out = hit; }
            else if (op === "delete"){ db[table] = t.filter(function(r){ return hit.indexOf(r) === -1; }); out = hit; }
            else out = rng ? hit.slice(rng[0], rng[1] + 1) : hit;
          }
          return Promise.resolve({data: JSON.parse(JSON.stringify(out)), error: null}).then(res, rej);
        }
      };
      return o;
    }
    window.__fakeAgd = db;
    state.statuses = [{id: "finalizado", name: "Finalizado", color: "#2e7d32"}, {id: "nao-compareceu", name: "Não compareceu", color: "#c62828"}, {id: "falta-justificada", name: "Falta justificada", color: "#f9a825"}];
    var fake = {from: q, channel: function(){ var ch = {on: function(){ return ch; }, subscribe: function(){ return ch; }}; return ch; },
      rpc: function(name, args){ var r = db.appointments.filter(function(x){ return x.id === args.p_id; })[0]; if (r) r.status = args.p_status; return Promise.resolve({data: r ? JSON.parse(JSON.stringify(r)) : null, error: null}); }};
    agdClient = function(){ return fake; };
    agdClient = function(){ return fake; };
    AD.channel = {};
    function a(id, time, prof, room, patient, extra){ db.appointments.push(Object.assign({id: id, date: "2030-01-07", time: time, professional_id: prof, room_id: room, patient: patient, note: "", blocked: false, service: "sessao", status: null}, extra || {})); }
    a("v1", "08:00", "ana-terapeuta", "r1", "Paciente Um");
    a("v2", "08:00", "bia-terapeuta", "r1", "Duda Vermelho");
    a("v3", "08:40", "ana-terapeuta", "r1", "Paciente Um");
    a("v4", "09:20", "bia-terapeuta", "r1", "Bloqueado", {blocked: true, service: null});
    a("v5", "07:20", "ana-terapeuta", "r1", "Outro Dia", {date: "2030-01-08"});
    var p = state.patients.filter(function(x){ return x.nome === "Duda Vermelho"; })[0]; if (p) p.nascimento = "2018-01-07";
    return true;
  })()`);

  // Menu Agenda ▾ com Agenda e Visão geral.
  const menu = await ev('AG_ITEMS.map(function(x){ return x.label; }).join("|")');
  check('top menu "Agenda ▾" has Agenda and Visão geral?', menu === 'Agenda|Visão geral' && !!(await page.$('#agBtn')), menu);
  await page.click('#agBtn');
  const opts = await page.$$eval('#agMenu [data-nav]', (r) => r.map((x) => x.textContent));
  check('clicking "Agenda" opens the menu with both options?', opts.join('|') === 'Agenda|Visão geral', opts);
  await page.click('#agMenu [data-nav="visaogeral"]');
  await ev('(function(){ VG.date = "2030-01-07"; vgLoad(); return true; })()');
  await page.waitForSelector('#vgHost .vg-card');
  const cards = await page.$$eval('#vgHost .vg-card', (r) => r.map((x) => x.textContent));
  check('shows that day only, no Bloqueado card (3 cards)?', cards.length === 3 && !cards.some((c) => /Bloqueado|Outro Dia/.test(c)), cards);
  const c1 = await page.$eval('#vgHost .vg-card', (e) => [e.querySelector(".vg-pat").textContent, Array.from(e.querySelectorAll(".vg-line")).map((x) => x.textContent), getComputedStyle(e).borderLeftColor]);
  check('card shows Paciente, Sala and Serviço with the specialty color?', c1[0] && c1[1].length === 2 && /Sess/.test(c1[1][1]) && c1[2] !== 'rgba(0, 0, 0, 0)', c1);
  const t8 = await page.$eval('#vgHost .vg-row:not(.empty) .vg-time small', (e) => e.textContent);
  check('count per time (08:00 = 2)?', t8 === '2', t8);
  const counts = await page.$eval('#vgCounts', (e) => e.textContent);
  check('day total and per-specialty chips?', /3 atendimentos no dia/.test(counts) && (await page.$$('#vgCounts .vg-chip')).length >= 1, counts);
  const alerts = await page.$eval('#vgAlerts', (e) => e.textContent);
  check('alerts: blocked professional, consecutive appointments, birthday?', /horário bloqueado: 09:20/.test(alerts) && /Paciente Um.*seguidos: 08:00, 08:40/.test(alerts) && alerts.includes('Duda Vermelho faz aniversário hoje (12 anos)'), alerts);

  // Filtros.
  await page.$eval('#vgProf', (s) => { s.value = "bia-terapeuta"; s.dispatchEvent(new Event("change", {bubbles: true})); });
  check('filter by professional?', (await page.$$('#vgHost .vg-card')).length === 1 && /com filtro/.test(await page.$eval('#vgCounts', (e) => e.textContent)));
  await page.$eval('#vgProf', (s) => { s.value = ""; s.dispatchEvent(new Event("change", {bubbles: true})); });
  await page.fill('#vgQ', 'paciente um');
  check('filter by patient (no accents/case)?', (await page.$$('#vgHost .vg-card')).length === 2);
  await page.fill('#vgQ', '');

  // Tempo real.
  await ev('(function(){ vgOnRealtime({eventType: "INSERT", new: {id: "v9", date: "2030-01-07", time: "10:00", professional_id: "ana-terapeuta", room_id: "r1", patient: "Carla Laranja", service: "sessao", status: null}}); return true; })()');
  await page.waitForTimeout(300);
  check('realtime insert shows up?', (await page.$$('#vgHost .vg-card')).length === 4);

  // Clique abre o atendimento.
  await page.click('#vgHost .vg-card');
  await page.waitForTimeout(300);
  check('clicking a card opens the appointment window?', (await page.$$('#modalHost .overlay')).length === 1);

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails){ console.log('FAILED', fails); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
