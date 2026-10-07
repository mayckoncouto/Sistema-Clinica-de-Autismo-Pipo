// Planilhas: exportar/importar (Tratamentos, Pacientes, Objetivos, Habilidades, Escalas).
// Dados 100% fictícios. Chama as funções internas por um "eval" injetado numa cópia da página.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_io.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (code) => page.evaluate((c) => window.__ev(c), code);
  let fails = 0;
  const check = (label, ok, extra) => { if (!ok) fails++; console.log(label, ok, extra === undefined ? '' : JSON.stringify(extra)); };

  // 1) .xlsx: gravar e ler de volta (sem compressão e com compressão "deflate").
  const rt = await ev(`(function(){
    var rows = [["Nome", "Valor", "Data"], ["Ágata Ção", 2250.5, "01/06/2026"], ["Linha \\"aspas\\" & <tags>", 3, ""]];
    var blob = xlBuild([{name: "Dados", rows: rows, widths: [30, 12, 12]}, {name: "Instruções", rows: [["oi"]]}]);
    return blob.arrayBuffer().then(function(buf){ return xlRead(buf); }).then(function(sh){
      return {names: sh.map(function(s){ return s.name; }), rows: sh[0].rows};
    });
  })()`);
  check('xlsx round trip keeps sheets, accents, numbers and symbols?', rt.names.join('|') === 'Dados|Instruções' && rt.rows[1][0] === 'Ágata Ção' && rt.rows[1][1] === 2250.5 && rt.rows[2][0] === 'Linha "aspas" & <tags>' && rt.rows[1][2] === '01/06/2026', rt);
  const defl = await ev(`(function(){
    // Monta um .xlsx comprimido (como o Excel salva) e lê com DecompressionStream.
    var blob = xlBuild([{name: "P", rows: [["Paciente", "Início"], ["Teste Deflate", 46174]]}]);
    return blob.arrayBuffer().then(function(buf){ return xlUnzip(buf); }).then(function(files){
      var names = Object.keys(files), enc = [];
      return Promise.all(names.map(function(n){
        return new Response(new Blob([files[n]]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer().then(function(c){ return {n: n, raw: files[n], c: new Uint8Array(c)}; });
      })).then(function(list){
        var parts = [], central = [], off = 0, te = new TextEncoder();
        list.forEach(function(f){
          var name = te.encode(f.n), crc = xlCrc32(f.raw), h = new DataView(new ArrayBuffer(30));
          h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true); h.setUint32(14, crc, true); h.setUint32(18, f.c.length, true); h.setUint32(22, f.raw.length, true); h.setUint16(26, name.length, true);
          parts.push(new Uint8Array(h.buffer), name, f.c);
          var c = new DataView(new ArrayBuffer(46));
          c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, crc, true); c.setUint32(20, f.c.length, true); c.setUint32(24, f.raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
          central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + f.c.length;
        });
        var cs = central.reduce(function(s, p){ return s + p.length; }, 0), e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, list.length, true); e.setUint16(10, list.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
        return new Blob(parts.concat(central, [new Uint8Array(e.buffer)])).arrayBuffer();
      });
    }).then(function(buf){ return xlRead(buf); }).then(function(sh){ return {row: sh[0].rows[1], date: ioDate(sh[0].rows[1][1])}; });
  })()`);
  check('compressed xlsx (as Excel saves) is read, Excel date number becomes a date?', defl.row[0] === 'Teste Deflate' && defl.date === '2026-06-01', defl);
  const misc = await ev(`(function(){
    var rows = xlParseText("Nome\\tObs\\r\\nAna\\t\\"tem\\ttab\\"\\r\\nBia\\tx\\r\\n");
    return {rows: rows, d: [ioDate("01/06/2026"), ioDate("-"), ioDate("00/01/1900"), ioDate("2025-07-14"), ioDate("31/02/2026")], m: ioMoney("R$ 2.250,00"), yn: [ioYesNo("sim"), ioYesNo("NÃO"), ioYesNo("")]};
  })()`);
  check('pasted Excel lines (tabs, quotes) are split?', misc.rows.length === 3 && misc.rows[1][1] === 'tem\ttab', misc.rows);
  check('dates, money and Sim/Não are read?', JSON.stringify(misc.d) === JSON.stringify(['2026-06-01', '', null, '2025-07-14', null]) && misc.m === 2250 && misc.yn.join() === 'Sim,Não,', misc);

  // 2) Tratamentos: mesmo paciente + mesmo início = atualizar; outro início = novo;
  //    o da migração (tr-<id>) é substituído e passa as especialidades; tipo automático;
  //    paciente fora do cadastro e datas erradas = problema; cancelado sem motivo = pendente.
  const tr = await ev(`(function(){
    var P = state.patientsRaw.slice(0, 4);
    state.treatments = [
      {id: "tr-" + P[0].id, patientId: P[0].id, inicio: "2026-01-10", status: "ativo", tipo: "novo", aba: "Não", specHours: [{specId: "fono", hours: 4, profId: ""}], horarios: {seg: {ativo: true}}},
      {id: "tx-1", patientId: P[1].id, inicio: "2025-03-01", status: "ativo", tipo: "novo", aba: "Sim", plano: "Velho", sessoesMes: 8}
    ];
    P.forEach(function(p){ delete p.suporte; delete p.cid; });
    rebuildPatients();
    var txt = ["Nome\\tConvenio\\tData Início\\tData Fim\\tPacote\\tValor\\tAgenda\\tDespesas\\tValor Final\\tTipo\\tStatus\\tRetenção\\tPlano\\tData Nascimento\\tIdade\\tSuporte\\tABA\\tObservação",
      P[0].nome + "\\tUnimed\\t14/07/2025\\t01/11/2025\\t32\\tR$ 2.880,00\\t16\\tR$ 0,00\\tR$ 2.880,00\\tNovo\\tAlterado\\t4\\tMultidisciplinar\\t\\t5\\t\\t\\t",
      P[0].nome + "\\tUnimed\\t01/11/2025\\t01/06/2026\\t24\\tR$ 2.256,00\\t12\\tR$ 0,00\\tR$ 2.256,00\\tNegociado\\tAlterado\\t7\\tMultidisciplinar\\t\\t5\\t\\t\\tAgenda",
      P[0].nome.toUpperCase() + "  \\tUnimed\\t01/06/2026\\t-\\t15\\tR$ 2.250,00\\t15\\tR$ 0,00\\tR$ 2.250,00\\tNegociado\\tAtivo\\t4\\tMultidisciplinar\\t\\t5\\t2\\tSim\\tAtualização",
      P[1].nome + "\\tBradesco Saúde\\t01/03/2025\\t-\\t10\\tR$ 1.000,00\\t\\tR$ 100,00\\t\\tNovo\\tAtivo\\t\\tPsicologia\\t\\t\\tTDAH\\tNão\\t",
      P[2].nome + "\\tParticular\\t06/03/2025\\t01/10/2026\\t8\\tR$ 0,00\\t\\t\\t\\tNovo\\tCancelado\\t\\tPsicologia\\t\\t\\t\\t\\tCobrado no plano de outro",
      P[3].nome + "\\tUnimed\\t06/10/2025\\t01/10/2025\\t8\\t\\t\\t\\t\\tNovo\\tCancelado\\t\\t\\t\\t\\t\\t\\t",
      "Fulano Que Não Existe\\tUnimed\\t01/01/2026\\t-\\t4\\t\\t\\t\\t\\tNovo\\tAtivo\\t\\t\\t\\t\\t\\t\\t"].join("\\n");
    var R = ioRecords("tratamentos", xlParseText(txt));
    var plan = ioTrPlan(R.recs);
    var st = plan.items.map(function(it){ return it.line + ":" + it.st; });
    return Promise.resolve(ioTrApply(plan)).then(function(msg){
      var L = treatmentsOf(P[0].id).slice().reverse();
      var t1 = treatmentsOf(P[1].id)[0], t2 = treatmentsOf(P[2].id)[0];
      var again = ioTrPlan(ioRecords("tratamentos", xlParseText(txt)).recs).items.map(function(it){ return it.st; });
      return {unknown: R.unknown, st: st, notes: plan.notes.join(" | "), msg: msg,
        p0: L.map(function(t){ return [t.inicio, t.status, t.tipo, t.statusEm || "", (t.specHours || []).length, t.aba, t.id === "tr-" + P[0].id ? "mig" : ""].join("/"); }),
        p0val: trMoney(L[2]), p0sup: rawPatient(P[0].id).suporte,
        p1: [t1.id, t1.plano, t1.sessoesMes, t1.aba, t1.convenioId, trFinal(t1), (t1.historico || []).slice(-1)[0].acao], p1cid: rawPatient(P[1].id).cid,
        p2: [t2.status, !!t2.motivoPendente, t2.statusEm, t2.obs],
        again: again};
    });
  })()`);
  check('extra columns of the sheet are reported as ignored?', ['Agenda', 'Valor Final', 'Tipo', 'Retenção', 'Idade'].every((c) => tr.unknown.indexOf(c) !== -1), tr.unknown);
  check('preview: 3 new + update + new cancelled, wrong dates and unknown patient are problems?', tr.st.join(',') === '2:novo,3:novo,4:novo,5:atualizar,6:novo,7:problema,8:problema', tr.st);
  check('unknown patient listed in the notes?', /fora do cadastro.*Fulano Que Não Existe/.test(tr.notes), tr.notes);
  check('migration treatment replaced, specialties/hours move to the Ativo, automatic type, end dates?',
    tr.p0.join(' ') === '2025-07-14/renegociado/novo/2025-11-01/0/Sim/ 2025-11-01/renegociado/renegociado/2026-06-01/0/Sim/ 2026-06-01/ativo/renegociado/2026-06-01/1/Sim/', tr.p0);
  check('values (monthly) saved and Suporte 2 goes to the patient level?', tr.p0val.valor === 2250 && tr.p0sup === 'Nível 2', [tr.p0val, tr.p0sup]);
  check('same patient + same start updates the existing treatment (history entry)?', tr.p1.join('|') === 'tx-1|Psicologia|10|Não|bradesco-saude|900|importado', tr.p1);
  check('Suporte as text goes to the diagnosis (CID)?', tr.p1cid === 'TDAH', tr.p1cid);
  check('cancelled without motivo = pendente, with end date and observation?', tr.p2.join('|') === 'cancelado|true|2026-10-01|Cobrado no plano de outro', tr.p2);
  check('importing the same sheet again changes nothing?', tr.again.filter((s) => s === 'novo' || s === 'atualizar').length === 0, tr.again);

  // 3) Pacientes: existente só completa vazios; novo entra; CPF repetido = problema.
  const pa = await ev(`(function(){
    var P = state.patientsRaw[0];
    var keepName = P.nome, hadNasc = P.nascimento;
    var txt = ["Nome;Data de nascimento;Telefones;Mãe;Observações", keepName + ";01/01/2000;(47) 99999-1111;Maria Teste;nova obs", "Paciente Importado Teste;10/05/2019;47 98888-2222;;", ";;;;"].join("\\n");
    var plan = ioPatPlan(ioRecords("pacientes", xlParseText(txt)).recs);
    var st = plan.items.map(function(it){ return it.st; });
    return Promise.resolve(ioPatApply(plan)).then(function(){
      var a = rawPatient(P.id), n = state.patientsRaw.filter(function(p){ return p.nome === "Paciente Importado Teste"; })[0];
      return {st: st, nascKept: a.nascimento === (hadNasc || "2000-01-01"), tel: (a.telefones || []).length ? a.telefones[0].numero : "", mae: (a.mae || {}).nome, nw: n ? [n.nascimento, n.telefones[0].numero, n.entrada === trTodayIso()] : null};
    });
  })()`);
  check('patients: existing only gets blanks filled, new one is added?', pa.st.join(',') === 'atualizar,novo' && pa.nascKept && pa.tel === '47999991111' && pa.mae === 'Maria Teste' && pa.nw && pa.nw[0] === '2019-05-10' && pa.nw[1] === '47988882222' && pa.nw[2], pa);

  // 4) Habilidades → Escalas → Objetivos (mesmo nome = atualizar).
  const pl = await ev(`(function(){
    var hab = ioHabPlan(ioRecords("habilidades", xlParseText("Habilidade\\tEspecialidades sugeridas\\nImitação Teste\\tFonoaudiologia\\nComunicação\\t")).recs);
    return Promise.resolve(ioHabApply(hab)).then(function(){
      var sc = ioScalePlan(ioRecords("escalas", xlParseText("Escala;Nível;Cor\\nTrês passos;Começou;#ff0000\\nTrês passos;Meio;\\nTrês passos;Final;#00aa00\\nLikert;0 – Não realiza;")).recs);
      return Promise.resolve(ioScaleApply(sc)).then(function(){
        var gtxt = "Objetivo\\tHabilidade\\tCritério de sucesso\\tEscala\\tEspecialidades\\nPedir ajuda com gesto\\tImitação Teste\\t80% em 3 sessões\\tTrês passos\\tFonoaudiologia\\nObjetivo sem área\\tNão Existe\\t\\t\\t";
        var go = ioGoalPlan(ioRecords("objetivos", xlParseText(gtxt)).recs);
        return Promise.resolve(ioGoalApply(go)).then(function(){
          var g = goalBankList().filter(function(x){ return x.name === "Pedir ajuda com gesto"; })[0];
          var s = scalesList().filter(function(x){ return x.name === "Três passos"; })[0];
          var again = ioGoalPlan(ioRecords("objetivos", xlParseText(gtxt.replace("80% em 3 sessões", "90%"))).recs).items.map(function(i){ return i.st; });
          return {hab: hab.items.map(function(i){ return i.st; }), sc: sc.items.map(function(i){ return i.st; }), go: go.items.map(function(i){ return i.st; }),
            levels: s ? s.levels.map(function(l){ return l.name + l.color; }).join(",") : "", goal: g ? [skillAreaName(g.areaId), g.criterio, (scaleById(g.scaleId) || {}).name, (g.specIds || []).length] : null, again: again};
        });
      });
    });
  })()`);
  check('habilidades/escalas/objetivos import (new, same = igual, unknown skill = problem)?',
    pl.hab.join() === 'novo,igual' && pl.sc.join() === 'novo,problema' && pl.go.join() === 'novo,problema' && pl.levels === 'Começou#FF0000,Meio#EE8A3C,Final#00AA00' && pl.goal && pl.goal.join('|') === 'Imitação Teste|80% em 3 sessões|Três passos|1', pl);
  check('same objective with another criterion = update?', pl.again.join() === 'atualizar,problema', pl.again);

  // 5) Tela: menu "Outras opções" de Tratamentos, Exportar (arquivo .xlsx) e Importar (colar → prévia).
  await page.$eval('#mainTabs button[data-tab=tratamentos]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('[data-io-wrap="tratamentos"] [data-io-btn]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-io-wrap="tratamentos"] [data-io-act="export"]')]);
  const buf = fs.readFileSync(await dl.path());
  const exp = await ev(`(function(){ var u8 = new Uint8Array(${JSON.stringify(Array.from(buf))}); return xlRead(u8.buffer).then(function(sh){ return {names: sh.map(function(s){ return s.name; }), head: sh[0].rows[0], n: sh[0].rows.length}; }); })()`);
  check('export downloads an .xlsx that works as the import model?', /\.xlsx$/.test(dl.suggestedFilename()) && exp.names.join('|') === 'Tratamentos|Instruções' && exp.head[0] === 'Paciente' && exp.n > 3, [dl.suggestedFilename(), exp]);
  const reimp = await ev(`(function(){ var u8 = new Uint8Array(${JSON.stringify(Array.from(buf))}); return xlRead(u8.buffer).then(function(sh){ return ioTrPlan(ioRecords("tratamentos", sh[0].rows).recs).items.map(function(i){ return i.st; }); }); })()`);
  check('importing the exported file back changes nothing?', reimp.length > 0 && reimp.every((s) => s === 'igual'), reimp);
  await page.click('[data-io-wrap="tratamentos"] [data-io-btn]');
  await page.click('[data-io-wrap="tratamentos"] [data-io-act="import"]');
  await page.waitForSelector('#ovIo');
  const p0 = await ev('state.patientsRaw[0].nome');
  await page.fill('#ioPaste', 'Paciente\tInício\tStatus\n' + p0 + '\t01/02/2027\tAtivo\nNinguém\t01/02/2027\tAtivo');
  await page.click('#ioPrev'); await page.waitForTimeout(300);
  const ui = await page.evaluate(() => ({rows: document.querySelectorAll('#ioOut tr[data-io-st]').length, go: document.getElementById('ioGo').textContent, chips: document.querySelector('.io-sum').textContent}));
  check('import window: paste → preview with counts and "Importar (N)"?', ui.rows === 2 && ui.go === 'Importar (1)' && /1 Novo/.test(ui.chips) && /1 Com problema/.test(ui.chips), ui);
  await page.click('#ovIo [data-tclose]');
  // Pacientes: itens novos no menu que já existia.
  await page.$eval('#mainTabs button[data-tab=pacientes]', (b) => b.click()); await page.waitForTimeout(200);
  await page.click('#patMoreBtn');
  const pm = await page.evaluate(() => ['patExportBtn', 'patImportBtn'].every((id) => { const b = document.getElementById(id); return b && !b.hidden && b.offsetParent; }));
  check('Pacientes → Outras opções has Exportar/Importar planilha?', pm);
  check('Tratamentos filter "Cancelados sem motivo" exists?', await page.evaluate(() => !!document.querySelector('#trFilter option[value="semmotivo"]')));

  check('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
  if (fails) { console.log(fails + ' check(s) failed'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
