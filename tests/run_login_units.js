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
          signOut: function(){ sessionStorage.removeItem('__s'); ls.forEach(function(f){ f('SIGNED_OUT', null); }); return Promise.resolve({}); }
        },
        rpc: function(n){ return Promise.resolve({data: n === 'login_units' ? window.__cfg.units : null, error: null}); },
        from: function(){ var q = { select: function(){ return q; }, eq: function(){ return q; }, in: function(){ return q; }, maybeSingle: function(){ return Promise.resolve({data: window.__cfg.profile, error: null}); } }; return q; },
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
      if (u.endsWith('/api/config')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'http://x', supabaseAnonKey: 'k' }) });
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
    if (unit) await page.selectOption('select[name=unit]', unit);
    await page.click('.pipo-login button[type=submit]');
  };

  // 1) a lista aparece com as unidades e lembra a última
  let s = await open({ units, profile: profile(role({}), 'unidade-1') });
  check('login shows the Unidade list with both units?', (await s.page.$$eval('select[name=unit] option', (o) => o.map((x) => x.textContent))).join() === 'Unidade 1 – Blumenau,Unidade 2 – Joinville');
  check('Unidade field is visible?', await s.page.$eval('.unit-field', (e) => !e.hidden));
  await s.ctx.close();

  // 2) nível comum escolhendo outra unidade: recusado, com a mensagem
  s = await open({ units, profile: profile(role({}), 'unidade-1') });
  await login(s.page, 'unidade-2');
  await s.page.waitForSelector('.pipo-login:not([hidden]) .err:not(:empty)', { timeout: 4000 });
  await s.page.waitForTimeout(300);
  const errTxt = await s.page.$eval('.pipo-login .err', (e) => e.textContent); check('wrong unit refused with a message?', /não tem acesso a esta unidade/i.test(errTxt), errTxt);
  check('no user pill after the refusal?', await s.page.$eval('#userPill', (e) => e.hidden));
  await s.ctx.close();

  // 3) nível comum na própria unidade: entra e vê o nome fixo, sem seletor
  s = await open({ units, profile: profile(role({}), 'unidade-1') });
  await login(s.page, 'unidade-1');
  await s.page.waitForSelector('#userPill .user-name');
  check('own unit enters with fixed unit name?', (await s.page.$eval('#userPill .user-unit', (e) => e.textContent)) === 'Unidade 1 – Blumenau' && !(await s.page.$('#userPill select[data-unit-switch]')));
  check('common level cannot see Unidades?', (await s.page.evaluate(() => window.pipoAuth.can('unidades', 'view'))) === false);
  await s.ctx.close();

  // 4) Administrador (não Gestão): acesso total, mas Unidades não
  s = await open({ units, profile: profile(role({ id: 'administrador', name: 'Administrador', is_admin: true }), 'unidade-1') });
  await login(s.page, 'unidade-1');
  await s.page.waitForSelector('#userPill .user-name');
  check('Administrador has no unit switch?', !(await s.page.$('#userPill select[data-unit-switch]')));
  check('Administrador: isAdmin yes, isManager no, Unidades no?', await s.page.evaluate(() => window.pipoAuth.isAdmin() && !window.pipoAuth.isManager() && window.pipoAuth.can('unidades', 'view') === false && window.pipoAuth.can('pacientes', 'delete') === true));
  await s.ctx.close();

  // 5) Gestão: entra em qualquer unidade, tem o seletor no topo e a troca é lembrada
  s = await open({ units, profile: profile(role({ id: 'gestao', name: 'Gestão', is_admin: true, is_manager: true }), 'unidade-1') });
  await login(s.page, 'unidade-2');
  await s.page.waitForSelector('#userPill select[data-unit-switch]');
  check('Gestão enters the chosen unit?', (await s.page.$eval('#userPill select[data-unit-switch]', (e) => e.value)) === 'unidade-2' && (await s.page.evaluate(() => window.pipoAuth.unit().id)) === 'unidade-2');
  check('Gestão can see Unidades?', await s.page.evaluate(() => window.pipoAuth.can('unidades', 'view') === true && window.pipoAuth.isManager()));
  await Promise.all([s.page.waitForNavigation(), s.page.selectOption('#userPill select[data-unit-switch]', 'unidade-1')]);
  await s.page.waitForSelector('#userPill select[data-unit-switch]');
  check('switching keeps the session and opens the other unit?', (await s.page.$eval('#userPill select[data-unit-switch]', (e) => e.value)) === 'unidade-1' && (await s.page.evaluate(() => window.pipoAuth.unit().id)) === 'unidade-1');
  check('no JS errors?', s.errors.length === 0, s.errors.join(' | '));
  await s.ctx.close();

  // 6) sem unidades no banco (migração ainda não rodada): o login segue como antes
  s = await open({ units: [], profile: profile(role({}), 'unidade-1') });
  check('without units the Unidade field stays hidden?', await s.page.$eval('.unit-field', (e) => e.hidden));
  await login(s.page, null);
  await s.page.waitForSelector('#userPill .user-name');
  check('login still works without units?', !!(await s.page.$('#userPill .user-name')));
  await s.ctx.close();

  await browser.close();
  console.log(fails ? 'FALHOU: ' + fails : 'Tudo certo');
  process.exit(fails ? 1 : 0);
})();
