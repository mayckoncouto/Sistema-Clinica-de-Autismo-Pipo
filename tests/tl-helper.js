// Quadros do tratamento (2026-10-10): inclui ou edita um quadro pela janela "Incluir/Editar especialidade".
// o = {spec: "Nome da especialidade", hours, svc: id do serviço, prof: id, aba: "Sim"|"Não", dia, hora, semanas, room, seguidas, obs}
// Confirma os avisos ("Salvar assim mesmo") quando aparecem. editIndex = número do quadro a editar.
exports.addLine = async function(page, o, editIndex){
  if (editIndex == null) await page.click('#specRowAdd'); else await page.click('[data-tl-edit="' + editIndex + '"]');
  await page.waitForSelector('#ovTLine');
  await page.evaluate((o) => {
    function set(id, v){ var e = document.getElementById(id); if (v == null || !e || e.disabled) return; e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }
    function norm(s){ return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
    if (o.spec != null){
      var sel = document.getElementById('tlSpec'), op = Array.prototype.filter.call(sel.options, function(x){ return norm(x.textContent) === norm(o.spec) || x.value === o.spec; })[0];
      set('tlSpec', op ? op.value : '');
    }
    if (o.hours != null && !document.getElementById('tlHours').disabled) document.getElementById('tlHours').value = String(o.hours);
    set('tlSvc', o.svc); set('tlProf', o.prof); set('tlAba', o.aba); set('tlDia', o.dia); set('tlHora', o.hora);
    set('tlSem', o.semanas); set('tlRoom', o.room); set('tlSeg', o.seguidas == null ? null : String(o.seguidas));
    if (o.obs != null) document.getElementById('tlObs').value = o.obs;
  }, o);
  await page.click('#tlSave'); await page.waitForTimeout(150);
  if (await page.$('#ovTLine') && await page.$('#cfOk')){ await page.click('#cfOk'); await page.waitForTimeout(150); }
  return !(await page.$('#ovTLine'));
};
exports.lines = (page) => page.$$eval('#specRowsHost .tl-row', (a) => a.map((r) => ({name: r.querySelector('.rn').textContent.replace('🔒', '').trim(), sum: r.querySelector('.rs').textContent, hours: r.getAttribute('data-hours'), cover: (r.querySelector('.tl-cover') || {}).textContent || ''})));
