// Agendamento especial "Reserva": mesma cor e mesmas regras do Treinamento.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const pg = path.join(__dirname, 'page_rsv.html');
  fs.writeFileSync(pg, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const b = await chromium.launch(require('./launch-opts')); const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + pg); await page.waitForTimeout(800);
  const r = await page.evaluate(() => window.__ev(`(function(){
    var rec = slotKindRecord("reserva", "obs");
    var k = SLOT_KINDS.filter(function(x){ return x.key === "reserva"; })[0];
    return {rec: rec, kind: bookingKind(rec), kindTxt: bookingKind({patient: "Reserva"}), mk: roomMeetingKind(rec), label: roomMeetingLabel("reserva"),
      color: k && k.color, tr: SLOT_KINDS.filter(function(x){ return x.key === "treinamento"; })[0].color, n: SLOT_KINDS.length,
      picker: slotKindPickerHtml("reserva").indexOf("Reserva") > -1, empty: chgEmptyBk({reserva: true}), svc: bookingServiceName(rec)};
  })()`));
  console.log(JSON.stringify(r));
  const ok = r.rec.patient === 'Reserva' && r.rec.reserva === true && r.kind === 'reserva' && r.kindTxt === 'reserva' && r.mk === 'reserva' &&
    r.label === 'Reserva' && r.color === r.tr && r.color === '#24E2FC' && r.n === 4 && r.picker && r.empty === false && r.svc === '' && !errs.length;
  console.log('reserva igual ao treinamento?', ok, errs.join('|'));
  fs.unlinkSync(pg); await b.close(); process.exit(ok ? 0 : 1);
})();
