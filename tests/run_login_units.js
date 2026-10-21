// Unidades (Fase 1): escolha da unidade na tela de login, conferência de acesso, seletor da Gestão no topo.
// Roda js/pipo-supabase.js de verdade, com um Supabase simulado (sem rede).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'pipo-supabase.js'), 'utf8');
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div class="brand-mark"></div><div id="userPill" hidden></div><script>' + code.replace(/<\/script>/g, '<\\/script>') + '</script></body></html>';
  const browser = await chromium.launch(require('./launch-opts'));
  let fails = 0;
  const check = (label, ok, extra) => { console.log(label, !!ok, extra === undefined ? '' : extra); if (!ok) fails++; };

  // O Supabase simulado: perfil e unidades vêm de window.__cfg (mudam por cenário); a sessão fica no sessionStorage (sobrevive ao reload).
  const stub = (cfg) => `
    window.__cfg = ${JSON.stringify(cfg)};
    window.supabase = { createClient: function(){
      var ls = [];
      function sess(){ try { return JSON.parse(sessionStorage.getItem('__s') || 'null'); } catch(e){ return null; } }
      var client = {
        auth: {
          onAuthStateChange: function(f){ ls.push(f); },
          getSession: function(){ return Promise.resolve({data: {session: sess()}}).then(function(r){ if (r.data.session) setTimeout(function(){ ls.forEach(function(f){ f('SIGNED_IN', r.data.session); }); }, 0); return r; }); },
          signInWithPassword: function(){ var s = {access_token: 't', user: {id: 'u1'}}; sessionStorage.setItem('__s', JSON.stringify(s)); setTimeout(function(){ ls.forEach(function(f){ f('SIGNED_IN', s); }); }, 0); return Promise.resolve({error: null}); },
          updateUser: function(a){ (window.__upd = window.__upd || []).push(a.data.active_unit); window.__tokUnit = a.data.active_unit; return Promise.resolve({error: null}); },
          refreshSession: function(){ var c = sess() || {user: {id: 'u1'}}; var n = {access_token: 'jwt-' + window.__tokUnit, user: c.user}; sessionStorage.setItem('__s', JSON.stringify(n)); return Promise.resolve({data: {session: n}, error: null}); },
          signOut: function(){ sessionStorage.removeItem('__s'); ls.forEach(function(f){ f('SIGNED_OUT', null); }); return Promise.resolve({}); }
        },
        rpc: function(n){ return Promise.resolve({data: n === 'login_units' ? window.__cfg.units : null, error: null}); },
        from: function(t){ var q = { select: function(){ return q; }, eq: function(){ return q; }, in: function(){ return q; }, maybeSingle: function(){ var d = {data: t === 'roles' ? window.__cfg.testRole : window.__cfg.profile, error: null}; return sessionStorage.getItem('__slow') ? new Promise(function(r){ setTimeout(function(){ r(d); }, 1500); }) : Promise.resolve(d); }, upsert: function(){ return Promise.resolve({data: null, error: null}); } }; return q; },
        channel: function(){ var c = { on: function(){ return c; }, subscribe: function(){ return c; } }; return c; },
        realtime: { setAuth: function(){} }
      };
      return client; } };
  `;
  const units = [{ id: 'unidade-1', name: 'Unidade 1 – Blumenau' }, { id: 'unidade-2', name: 'Unidade 2 – Joinville' }];
  const role = (o) => Object.assign({ id: 'r', name: 'Secretária', is_admin: false, is_manager: false, permissions: {} }, o);
  const profile = (r, unit) => ({ id: 'u1', email: 'x@y.com', full_name: 'Pessoa Teste', active: true, role_id: r.id, unit_id: unit, role: r });

  async function open(cfg) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://pipo.test/**', (route) => {
      const u = route.request().url();
      if (u.endsWith('/api/config')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', clinica: { nome: 'Clínica Pipo', subtitulo: 'Matriz' }, unidades: { 'unidade-1': { theme: null, clinica: { nome: 'Clínica Pipo', subtitulo: 'Matriz' } }, 'unidade-2': { theme: { corBotoes: '#aa3355', corTexto: null }, clinica: { nome: 'Pipo Joinville', subtitulo: 'Filial' } } } }) });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.addInitScript(stub(cfg));
    await page.goto('http://pipo.test/');
    await page.waitForSelector('.pipo-login:not([hidden])');
    await page.waitForTimeout(150);
    return { page, ctx, errors };
  }
  const login = async (page, unit) => {
    await page.fill('input[name=email]', 'x@y.com'); await page.fill('input[name=password]', 'senha1234');
    await page.click('.pipo-login button[type=submit]');
  };

  // 1) a tela de login não tem escolha de unidade (nem lista pública)
  let s = await open({ units, profile: profile(role({}), 'unidade-1') });
  check('login has no Unidade field?', !(await s.page.$('select[name=unit]')) && !(await s.page.$('.unit-field')));
  check('login shows the default brand?', (await s.page.$eval('.pipo-login .brand h2', (e) => e.textContent)) === 'Clínica Pipo');
  await s.ctx.close();

  // 2) nível comum de OUTRA unidade entra na unidade dele, sem recusa e sem escolha
  s = await open({ units, profile: profile(role({}), 'unidade-2') });
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  check('common level enters its own unit (unidade-2) and sees no selector?', (await s.page.evaluate(() => window.pipoAuth.unit().id)) === 'unidade-2' && !(await s.page.$('#userPill select[data-unit-switch]')));
  check('the saved last unit never moves a common level to another unit?', await s.page.evaluate(() => { localStorage.setItem('agendaPipo:unit', 'unidade-1'); return true; }));
  await s.ctx.close();

  // 3) nível comum na própria unidade: entra e vê o nome fixo, sem seletor
  s = await open({ units, profile: profile(role({}), 'unidade-1') });
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  check('own unit enters with fixed unit name?', (await s.page.$eval('#userPill .user-unit', (e) => e.textContent)) === 'Unidade 1 – Blumenau' && !(await s.page.$('#userPill select[data-unit-switch]')));
  check('common level cannot see Unidades?', (await s.page.evaluate(() => window.pipoAuth.can('unidades', 'view'))) === false);
  await s.ctx.close();

  // 4) Administrador (não Gestão): acesso total, mas Unidades não
  s = await open({ units, profile: profile(role({ id: 'administrador', name: 'Administrador', is_admin: true }), 'unidade-1') });
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  check('non-manager never changes the token unit?', (await s.page.evaluate(() => (window.__upd || []).length)) === 0);
  check('Administrador has no unit switch?', !(await s.page.$('#userPill select[data-unit-switch]')));
  check('Administrador: isAdmin yes, isManager no, Unidades no?', await s.page.evaluate(() => window.pipoAuth.isAdmin() && !window.pipoAuth.isManager() && window.pipoAuth.can('unidades', 'view') === false && window.pipoAuth.can('pacientes', 'delete') === true));
  await s.ctx.close();

  // 5) Gestão: entra em qualquer unidade, tem o seletor no topo e a troca é lembrada
  s = await open({ units, profile: profile(role({ id: 'gestao', name: 'Gestão', is_admin: true, is_manager: true }), 'unidade-1') });
  await s.page.evaluate(() => localStorage.setItem('agendaPipo:unit', 'unidade-2'));
  await login(s.page, null);
  await s.page.waitForSelector('#userPill select[data-unit-switch]');
  check('Gestão enters the last unit it used?', (await s.page.$eval('#userPill select[data-unit-switch]', (e) => e.value)) === 'unidade-2' && (await s.page.evaluate(() => window.pipoAuth.unit().id)) === 'unidade-2');
  check('Gestão in another unit asks the token to carry the active unit?', (await s.page.evaluate(() => (window.__upd || []).join())) === 'unidade-2');
  const acts = await s.page.evaluate(() => Array.from(document.querySelectorAll('#acessoMenu button')).map((b) => b.getAttribute('data-act')));
  check('Acesso menu: Unidades before Clinica, Ajuda last before Sair?', acts.indexOf('unidades') >= 0 && acts.indexOf('unidades') < acts.indexOf('clinica') && acts[acts.length - 2] === 'ajuda' && acts[acts.length - 1] === 'sair', acts.join());
  check('enhancing a select that already left the screen does not throw?', await s.page.evaluate(() => { try { dpEnhanceOne(document.createElement('select')); return true; } catch (e) { return String(e); } }));
  check('Gestão can see Unidades?', await s.page.evaluate(() => window.pipoAuth.can('unidades', 'view') === true && window.pipoAuth.isManager()));
  await Promise.all([s.page.waitForNavigation(), s.page.selectOption('#userPill select[data-unit-switch]', 'unidade-1')]);
  await s.page.waitForSelector('#userPill select[data-unit-switch]');
  check('switching keeps the session and opens the other unit?', (await s.page.$eval('#userPill select[data-unit-switch]', (e) => e.value)) === 'unidade-1' && (await s.page.evaluate(() => window.pipoAuth.unit().id)) === 'unidade-1');
  check('no JS errors?', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // 6) sem unidades no banco (migração ainda não rodada): o login segue como antes
  s = await open({ units: [], profile: profile(role({}), 'unidade-1') });
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  check('login still works without units?', !!(await s.page.$('#userPill .user-name')));
  await s.ctx.close();

  // 7) Testar como este nível: o Gestor abre com ?testeNivel e passa a ver como o nível, sem gravar nada
  s = await open({ units, profile: profile(role({ id: 'gestao', name: 'Gestor', is_admin: true, is_manager: true }), 'unidade-1'), testRole: role({ id: 'secretaria', name: 'Secretária', permissions: { pacientes: { view: true } } }) });
  await s.page.evaluate(() => sessionStorage.setItem('agendaPipo:testRole', 'secretaria'));
  await login(s.page, null);
  await s.page.waitForSelector('#testNote');
  const tst = await s.page.evaluate(async () => {
    var w = await window.pipoAuth.client.from('documents').upsert({ path: 'x' });
    var r = await window.pipoAuth.client.rpc('patch_bookings', {});
    var rr = await window.pipoAuth.client.rpc('crm_people', {});
    return { admin: window.pipoAuth.isAdmin(), canPac: window.pipoAuth.can('pacientes', 'view'), canPlan: window.pipoAuth.can('planner', 'view'),
      write: w.error && w.error.code, rpc: r.error && r.error.code, read: rr.error ? 'erro' : 'ok', name: document.getElementById('testNoteName').textContent };
  });
  check('test mode: acts as the tested level and blocks writes?', !tst.admin && tst.canPac && !tst.canPlan && tst.write === 'teste' && tst.rpc === 'teste' && tst.read === 'ok' && tst.name === 'Secretária', JSON.stringify(tst));
  check('no JS errors?', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // 8) segunda abertura: o sistema não espera /api/config nem o perfil para mostrar o topo (último perfil do aparelho)
  s = await open({ units, profile: profile(role({ permissions: { pacientes: { view: true } } }), 'unidade-1') });
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  await s.page.evaluate(() => sessionStorage.setItem('__slow', '1'));
  await s.page.unroute('http://pipo.test/**');
  await s.page.route('http://pipo.test/**', (route) => {
    const u = route.request().url();
    if (u.endsWith('/api/config')) return new Promise((r) => setTimeout(r, 1500)).then(() => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'http://x', supabaseAnonKey: 'k' }) }));
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await s.page.addInitScript(() => { window.pipoEarlyNav = function(){ window.__early = (window.__early || 0) + 1; window.__earlyCan = window.pipoAuth.can('pacientes', 'view'); }; });
  await s.page.reload();
  await s.page.waitForTimeout(600);
  const ea = await s.page.evaluate(() => ({ pill: !!document.querySelector('#userPill .user-name'), prof: !!window.pipoAuth.profile(), early: window.__early, earlyCan: window.__earlyCan, canNow: window.pipoAuth.can('pacientes', 'view') }));
  check('reopen: top bar and menus drawn before config and profile arrive (cached), nothing granted meanwhile?', ea.pill && !ea.prof && ea.early === 1 && ea.earlyCan === true && ea.canNow === false, JSON.stringify(ea));
  await s.page.waitForFunction(() => !!window.pipoAuth.profile(), null, { timeout: 5000 });
  check('reopen: real profile arrives afterwards?', await s.page.evaluate(() => window.pipoAuth.can('pacientes', 'view')));
  check('no JS errors?', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  await browser.close();
  console.log(fails ? 'FALHOU: ' + fails : 'Tudo certo');
  process.exit(fails ? 1 : 0);
})();
