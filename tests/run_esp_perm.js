// Atendimentos especiais (Bloqueado, Reunião Clínica, Treinamento, Reserva): permissão própria de cada tipo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const i = src.indexOf('"use strict";');
  const evPage = path.join(__dirname, 'page_esp.html');
  fs.writeFileSync(evPage, src.slice(0, i + 13) + '\nwindow.__ev = function(x){ return eval(x); };\n' + src.slice(i + 13));
  const browser = await chromium.launch(require('./launch-opts'));
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + evPage);
  await page.waitForTimeout(800);
  const ev = (c) => page.evaluate((x) => window.__ev(x), c);
  const setPerm = (perms) => page.evaluate((p) => { window.pipoAuth = { can: (m, a) => !!(p[m] && p[m].indexOf(a) !== -1), isAdmin: () => false, onProfile(){}, profile: () => null }; }, perms);
  const ok = (l, v) => console.log(l + '?', v);

  // Só pode incluir Reserva (sem permissão de Agenda/Planner para incluir ou editar).
  await setPerm({ agenda: ['view'], planner: ['view'], esp_reserva: ['create'] });
  ok('reserva: espCanAny create', await ev('espCanAny("create")'));
  ok('reserva: recCan create em Reserva', await ev('recCan("agenda", {patient:"Reserva"}, "create")'));
  ok('reserva: NÃO cria Reunião Clínica', !(await ev('recCan("agenda", {patient:"Reunião Clínica"}, "create")')));
  ok('reserva: NÃO cria paciente', !(await ev('recCan("agenda", {patient:"Ana Azul"}, "create")')));
  ok('reserva: NÃO edita Reserva', !(await ev('recCan("agenda", {patient:"Reserva"}, "edit")')));
  ok('reserva: bloqueado usa esp_bloqueado', await ev('recMod("planner", {blocked:true,patient:"Bloqueado"}) === "esp_bloqueado"'));
  // Planner: gravação central
  ok('planner: incluir Reserva liberado', !(await ev('bookingPermDenied({"seg-1": {"07:20|r|s": {patient:"Reserva", reserva:true}}})')));
  ok('planner: incluir Treinamento negado', !!(await ev('bookingPermDenied({"seg-1": {"07:20|r|s": {patient:"Treinamento", training:true}}})')));
  ok('planner: incluir paciente negado (sem planner.create)', !!(await ev('bookingPermDenied({"seg-1": {"07:20|r|s": {patient:"Ana Azul"}}})')));
  // Agenda: gravação
  ok('agenda: grava Reserva nova', !(await ev('agdWriteDenied(null, {patient:"Reserva"})')));
  ok('agenda: grava Treinamento novo negado', !!(await ev('agdWriteDenied(null, {patient:"Treinamento"})')));
  // Quem edita a Agenda, mas não tem o tipo: não altera Reunião Clínica
  await setPerm({ agenda: ['view', 'create', 'edit', 'delete'], esp_reuniao: [] });
  ok('agenda total: NÃO edita Reunião Clínica sem a permissão do tipo', !!(await ev('agdWriteDenied({patient:"Reunião Clínica"}, {patient:"Reunião Clínica", note:"x"})')));
  ok('agenda total: edita paciente', !(await ev('agdWriteDenied({patient:"Ana Azul"}, {patient:"Ana Azul", note:"x"})')));
  ok('no JS errors', errors.length === 0 ? true : errors);
  console.log('no JS errors?', errors.length === 0, errors);
  await browser.close();
  fs.unlinkSync(evPage);
})();
