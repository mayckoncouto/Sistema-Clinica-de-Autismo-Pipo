// Agenda → "Outras opções": Limpar por período, Bloquear período, Trocar profissional,
// Copiar dia/semana, Pendências/Status em lote e Exportar. Usa um banco em memória
// (window.__fakeAgd) no lugar do Supabase.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_agdtools.html');
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

  // Banco em memória com a mesma "cara" do cliente Supabase usada pelo app.
  await ev(`(function(){
    var db = {appointments: [], clinical_records: []}, seq = 0;
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
    AD.channel = {}; AD.error = ""; AD.loaded = true; AD.rows = {}; AD.view = "semana"; AD.mode = "prof"; AD.sel = "ana-terapeuta";
    AD.date = new Date(2030, 0, 7);
    document.querySelectorAll("#mainTabs button[data-tab]").forEach(function(b){ if (b.getAttribute("data-tab") === "agendadia") b.click(); });
    function a(id, date, time, prof, patient, extra){ db.appointments.push(Object.assign({id: id, date: date, time: time, professional_id: prof, room_id: "r1", patient: patient, note: "", blocked: false, service: "sessao", status: null, source: null}, extra || {})); }
    a("a1", "2030-01-07", "08:00", "ana-terapeuta", "Paciente Um");
    a("a2", "2030-01-07", "08:40", "ana-terapeuta", "Bruno Verde", {status: "finalizado"});
    a("a3", "2030-01-08", "08:00", "ana-terapeuta", "Carla Laranja");
    a("a4", "2030-01-08", "09:20", "ana-terapeuta", "Bloqueado", {blocked: true, service: null});
    a("a5", "2030-01-09", "08:00", "bia-terapeuta", "Ana Azul");
    a("a6", "2030-01-09", "10:00", "ana-terapeuta", "Eva Sem Idade");
    db.clinical_records.push({id: "c1", appointment_id: "a6"});
    agdLoadWeek();
  })()`);
  await page.waitForTimeout(400);

  // Menu "Outras opções" no lugar de "Limpar semana"
  const menu = await ev(`(function(){ document.getElementById("agdToolsBtn").click();
    var items = Array.prototype.map.call(document.querySelectorAll("#agdToolsMenu [data-agd-tool]"), function(b){ return b.textContent; });
    document.getElementById("agdToolsBtn").click();
    return {wrap: !document.getElementById("agdToolsWrap").hidden, old: !!document.getElementById("agdClearWeekBtn"), items: items}; })()`);
  check('Agenda has "Outras opções" with the tools (no Limpar semana button)?', menu.wrap && !menu.old && menu.items.length === 7 && menu.items[0] === 'Limpar por período', JSON.stringify(menu));

  // Limpar por período: só Ana, tudo; protege status e evolução
  await ev(`agdOpenClearPeriod()`);
  await page.waitForTimeout(200);
  await ev(`(function(){ document.getElementById("acFrom").value = "2030-01-07"; document.getElementById("acTo").value = "2030-01-11"; document.getElementById("acSee").click(); })()`);
  await page.waitForTimeout(300);
  const cl = await ev(`({prev: document.getElementById("acPrev").textContent, go: document.getElementById("acGo").textContent})`);
  check('Limpar: preview deletes 3, keeps 1 with status and 1 with evolução?', /Serão apagados: 3/.test(cl.prev) && /têm status\): 1/.test(cl.prev) && /têm evolução\): 1/.test(cl.prev) && cl.go === 'Apagar (3)', JSON.stringify(cl));
  await page.click('#acGo'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(400);
  const left = await ev(`window.__fakeAgd.appointments.map(function(r){ return r.id; }).sort().join(",")`);
  check('Limpar: a1, a3, a4 gone; a2 (status), a5 (Bia) and a6 (evolução) stay?', left === 'a2,a5,a6', left);
  const undo1 = await ev(`AD_HISTORY.undo[AD_HISTORY.undo.length - 1].before.length`);
  check('Limpar enters the undo history?', undo1 === 3, undo1);

  // Bloquear período: Bia na terça de manhã (livres) com motivo
  await ev(`agdOpenBlockPeriod()`);
  await page.waitForTimeout(200);
  await ev(`(function(){ document.getElementById("abFrom").value = "2030-01-09"; document.getElementById("abTo").value = "2030-01-09";
    var p = document.getElementById("abPer"); p.value = "manha"; p.dispatchEvent(new Event("change", {bubbles: true}));
    document.getElementById("abNote").value = "Férias";
    var a0 = document.querySelector('#abProfs input[value="ana-terapeuta"]'); if (a0) a0.checked = false;
    var c = document.querySelector('#abProfs input[value="bia-terapeuta"]'); c.checked = true; c.dispatchEvent(new Event("change", {bubbles: true}));
    document.getElementById("abSee").click(); })()`);
  await page.waitForTimeout(300);
  const bl = await ev(`({prev: document.getElementById("abPrev").textContent})`);
  await page.click('#abGo'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(400);
  const blk = await ev(`(function(){ var b = window.__fakeAgd.appointments.filter(function(r){ return r.blocked && r.professional_id === "bia-terapeuta"; });
    return {n: b.length, note: b[0] && b[0].note, morning: b.every(function(r){ return r.time < "12:00"; }), keepsAna: !b.some(function(r){ return r.time === "08:00"; })}; })()`);
  check('Bloquear: blocks free morning slots of Bia (not the 08:00 já marcado), with motivo?', blk.n > 3 && blk.note === 'Férias' && blk.morning && blk.keepsAna && /continuam marcados: 1/.test(bl.prev), JSON.stringify(blk) + ' ' + bl.prev.slice(0, 120));

  // Trocar profissional: Ana → Bia em 07/01–09/01 (a2 tem status, fica)
  await ev(`window.__fakeAgd.appointments.push({id: "t1", date: "2030-01-10", time: "13:30", professional_id: "ana-terapeuta", room_id: "r1", patient: "Carla Laranja", note: "", blocked: false, service: "sessao", status: null})`);
  await ev(`agdOpenSwapPeriod()`);
  await page.waitForTimeout(200);
  await ev(`(function(){ document.getElementById("asFromP").value = "ana-terapeuta"; document.getElementById("asToP").value = "bia-terapeuta";
    document.getElementById("asFrom").value = "2030-01-07"; document.getElementById("asTo").value = "2030-01-11"; document.getElementById("asSee").click(); })()`);
  await page.waitForTimeout(300);
  const sw = await ev(`({prev: document.getElementById("asPrev").textContent, go: document.getElementById("asGo").textContent})`);
  check('Trocar: status row stays; others listed?', /Tem status/.test(sw.prev) && /Trocar \(/.test(sw.go), sw.go + ' | ' + sw.prev.slice(0, 160));
  await page.click('#asGo'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(400);
  const t1 = await ev(`window.__fakeAgd.appointments.filter(function(r){ return r.id === "t1"; })[0].professional_id`);
  const a2 = await ev(`window.__fakeAgd.appointments.filter(function(r){ return r.id === "a2"; })[0].professional_id`);
  check('Trocar: t1 now with Bia, a2 (Finalizado) still with Ana?', t1 === 'bia-terapeuta' && a2 === 'ana-terapeuta', t1 + ' ' + a2);

  // Copiar dia: quinta 10/01 → quinta 17/01
  await ev(`agdOpenCopyPeriod()`);
  await page.waitForTimeout(200);
  await ev(`(function(){ document.querySelectorAll("#acpProfs input:checked").forEach(function(c){ c.checked = false; }); document.getElementById("acpSrc").value = "2030-01-10"; document.getElementById("acpDst").value = "2030-01-17"; document.getElementById("acpSee").click(); })()`);
  await page.waitForTimeout(300);
  await page.click('#acpGo'); await page.waitForTimeout(400);
  const cp = await ev(`window.__fakeAgd.appointments.filter(function(r){ return r.date === "2030-01-17"; }).map(function(r){ return r.time + " " + r.patient + " " + (r.status || "-"); }).join(",")`);
  check('Copiar: Thursday copied to next Thursday, without status?', cp === '13:30 Carla Laranja -', cp);

  // Status em lote: marcar Não compareceu em t1
  await ev(`agdOpenStatusTool("lote")`);
  await page.waitForTimeout(200);
  await ev(`(function(){ document.querySelectorAll("#asxProfs input:checked").forEach(function(c){ c.checked = false; }); document.getElementById("asxFrom").value = "2030-01-10"; var t = document.getElementById("asxTo"); t.value = "2030-01-10"; t.dispatchEvent(new Event("change", {bubbles: true})); })()`);
  await page.waitForTimeout(300);
  const lote = await ev(`(function(){ var opts = Array.prototype.map.call(document.querySelectorAll("#asxSt option"), function(o){ return o.value; });
    var c = document.querySelector('[data-asx="t1"]'); if (c){ c.checked = true; c.dispatchEvent(new Event("change", {bubbles: true})); }
    document.getElementById("asxSt").value = "nao-compareceu"; return {opts: opts, found: !!c}; })()`);
  check('Status em lote: lists the day and has no Finalizado option?', lote.found && lote.opts.indexOf('finalizado') === -1 && lote.opts.length > 0, JSON.stringify(lote));
  await page.click('#asxGo'); await page.waitForTimeout(150); await page.click('#cfOk'); await page.waitForTimeout(400);
  const st = await ev(`window.__fakeAgd.appointments.filter(function(r){ return r.id === "t1"; })[0].status`);
  check('Status em lote applied?', st === 'nao-compareceu', st);
  await ev(`document.querySelector('#ovAgdLote [data-tclose]').click()`);

  // Pendências: atendimento passado sem status aparece
  await ev(`window.__fakeAgd.appointments.push({id: "p1", date: agdIso(agdAddDays(agdStartOfDay(new Date()), -2)), time: "08:00", professional_id: "ana-terapeuta", room_id: "r1", patient: "Paciente Um", note: "", blocked: false, service: "sessao", status: null})`);
  await ev(`agdOpenStatusTool("pend")`);
  await page.waitForTimeout(400);
  const pend = await ev(`({txt: document.getElementById("asxList").textContent, has: !!document.querySelector('[data-asx-open="p1"]')})`);
  check('Pendências lists past bookings without status?', pend.has && /sem status/.test(pend.txt), pend.txt.slice(0, 100));
  await ev(`document.querySelector('#ovAgdPend [data-tclose]').click()`);

  // Exportar Excel
  const exp = await ev(`(async function(){ var msgs = [], orig = showToast; showToast = function(m){ msgs.push(m); };
    var blobs = [], oc = URL.createObjectURL; URL.createObjectURL = function(b){ blobs.push(b); return "blob:x"; };
    agdOpenExport(); document.querySelectorAll("#aeProfs input:checked").forEach(function(c){ c.checked = false; });
    document.getElementById("aeFrom").value = "2030-01-07"; document.getElementById("aeTo").value = "2030-01-17";
    document.getElementById("aeGo").click();
    await new Promise(function(r){ setTimeout(r, 300); });
    showToast = orig; URL.createObjectURL = oc;
    var txt = blobs[0] ? await blobs[0].text() : "";
    return {msg: msgs.join(" | "), head: txt.split(String.fromCharCode(13, 10))[0], lines: txt.split(String.fromCharCode(13, 10)).length}; })()`);
  check('Exportar Excel downloads a CSV with status column?', /exportados/.test(exp.msg) && /Status/.test(exp.head) && exp.lines > 3, JSON.stringify(exp));

  // Mobile ☰ has the same tools
  const mob = await ev(`(function(){ document.getElementById("agdMoreBtn").click(); var n = document.querySelectorAll("#agdMoreMenu [data-agd-tool]").length; document.getElementById("agdMoreBtn").click(); return n; })()`);
  check('☰ (celular) has the same tools?', mob === 7, mob);

  check('no page errors?', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log('FAILED', fails); process.exit(1); }
})();
