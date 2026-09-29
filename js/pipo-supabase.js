/* =====================================================================
 * Agenda Pipo — camada Supabase
 *
 * O app (index.html) foi escrito para o Claude Artifact e fala com os dados
 * por uma API pequena: window.claude.use("db") → db.doc(caminho) com
 * onSnapshot / get / set, e window.claude.use("user") → can(...).
 * Este arquivo implementa essa mesma API em cima do Supabase (tabela
 * public.documents + Realtime), mais login, sessão e permissões.
 *
 * Também expõe window.pipoAuth para o resto do app (permissões por módulo,
 * menu do usuário, aba Usuários).
 * ===================================================================== */
(function () {
  "use strict";

  var MODULES = ["agenda", "pacientes", "profissionais", "salas"];
  var ACTIONS = ["view", "create", "edit", "delete"];

  var client = null;
  var session = null;
  var profile = null;
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });
  var profileListeners = [];

  /* ---------------- documentos (substitui o db do Artifact) ---------------- */
  var docListeners = {};   // path -> [{cb, errCb}]
  var lastData = {};       // path -> data | undefined (último valor conhecido)
  var channel = null;

  function snap(data) {
    return { exists: data !== undefined && data !== null, data: function () { return data; } };
  }

  function emit(path) {
    (docListeners[path] || []).forEach(function (l) {
      try { l.cb(snap(lastData[path])); } catch (e) { console.error(e); }
    });
  }

  function fetchDoc(path) {
    return client.from("documents").select("data").eq("path", path).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      return r.data ? r.data.data : undefined;
    });
  }

  function refetchAll() {
    Object.keys(docListeners).forEach(function (path) {
      if (!docListeners[path].length) return;
      fetchDoc(path).then(function (d) { lastData[path] = d; emit(path); }).catch(function () {});
    });
  }

  function ensureChannel() {
    if (channel) return;
    var first = true;
    channel = client.channel("pipo-documents")
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, function (payload) {
        var row = payload.eventType === "DELETE" ? payload.old : payload.new;
        if (!row || !row.path) return;
        lastData[row.path] = payload.eventType === "DELETE" ? undefined : row.data;
        emit(row.path);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, function (payload) {
        if (profile && payload.new && payload.new.id === profile.id) setProfile(payload.new);
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          // Depois de uma reconexão, algo pode ter mudado enquanto estávamos fora.
          if (!first) refetchAll();
          first = false;
          setSyncState(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setSyncState(false);
        }
      });
  }

  function setSyncState(on) {
    var dot = document.getElementById("syncDot"), t = document.getElementById("syncText");
    if (dot) dot.className = "sync-dot" + (on ? "" : " off");
    if (t) t.textContent = on ? "sincronizado" : "reconectando…";
  }

  function friendlyError(err) {
    var msg = (err && (err.message || err.error_description)) || "";
    if (/permiss|42501|row-level security/i.test(msg)) {
      var e = new Error("Sem permissão para esta alteração.");
      e.code = "permission";
      return e;
    }
    return err instanceof Error ? err : new Error(msg || "Erro ao salvar.");
  }

  function makeDocRef(path) {
    return {
      onSnapshot: function (cb, errCb) {
        var l = { cb: cb, errCb: errCb };
        (docListeners[path] = docListeners[path] || []).push(l);
        ensureChannel();
        fetchDoc(path).then(function (d) {
          lastData[path] = d;
          cb(snap(d));
        }).catch(function (e) { if (errCb) errCb(e); });
        return function () {
          var arr = docListeners[path] || [];
          var i = arr.indexOf(l);
          if (i !== -1) arr.splice(i, 1);
        };
      },
      get: function () {
        return fetchDoc(path).then(function (d) { return snap(d); });
      },
      set: function (obj) {
        return client.from("documents").upsert({ path: path, data: obj }, { onConflict: "path" }).then(function (r) {
          if (r.error) {
            // O app já aplicou a mudança na tela; recarrega o valor real do
            // banco para desfazê-la visualmente.
            fetchDoc(path).then(function (d) { lastData[path] = d; emit(path); }).catch(function () {});
            var e = friendlyError(r.error);
            if (e.code === "permission") toast(e.message, true);
            throw e;
          }
        });
      },
      // Gravação atômica só das chaves alteradas (ver patch_bookings no schema.sql).
      patchBookings: function (changes) {
        return client.rpc("patch_bookings", { p_path: path, p_changes: changes }).then(function (r) {
          if (r.error) throw friendlyError(r.error);
        });
      }
    };
  }

  /* ---------------- permissões ---------------- */
  function can(module, action) {
    if (!profile || !profile.active) return false;
    if (profile.is_admin) return true;
    var p = profile.permissions || {};
    return !!(p[module] && p[module][action]);
  }
  function canWriteAnything() {
    if (!profile || !profile.active) return false;
    if (profile.is_admin) return true;
    return MODULES.some(function (m) { return can(m, "create") || can(m, "edit") || can(m, "delete"); });
  }

  function setProfile(p) {
    profile = p;
    if (!profile.active) {
      showLogin("Seu acesso foi desativado. Fale com o administrador da clínica.");
      client.auth.signOut();
      return;
    }
    renderUserPill();
    profileListeners.forEach(function (fn) { try { fn(profile); } catch (e) { console.error(e); } });
  }

  function loadProfile() {
    return client.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) throw new Error("Perfil não encontrado para este usuário.");
      return r.data;
    });
  }

  /* ---------------- login ---------------- */
  var loginEl = null;

  function injectStyles() {
    var css =
      ".pipo-login{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#f3f5f4)}" +
      ".pipo-login[hidden]{display:none}" +
      ".pipo-login form{width:100%;max-width:360px;background:var(--surface,#fff);border:1px solid var(--line,#dde3e1);border-radius:14px;padding:28px 24px;box-shadow:0 6px 20px rgba(20,30,28,.10);display:flex;flex-direction:column;gap:12px;font-family:Inter,system-ui,sans-serif;color:var(--ink,#182523)}" +
      ".pipo-login h2{margin:0;font-family:Manrope,Inter,sans-serif;font-size:20px;font-weight:800}" +
      ".pipo-login .sub{margin:-6px 0 6px;color:var(--muted,#788481);font-size:13px}" +
      ".pipo-login label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:var(--ink-2,#465350)}" +
      ".pipo-login input{font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--line-strong,#c7cfcc);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#182523)}" +
      ".pipo-login input:focus{outline:none;border-color:var(--accent,#2c7a72);box-shadow:0 0 0 3px var(--accent-weak,#e2f0ee)}" +
      ".pipo-login button{font:inherit;font-weight:700;font-size:14px;padding:11px;border:0;border-radius:8px;background:var(--accent,#2c7a72);color:var(--accent-ink,#fff);cursor:pointer;margin-top:4px}" +
      ".pipo-login button[disabled]{opacity:.6;cursor:default}" +
      ".pipo-login .err{min-height:18px;font-size:13px;color:var(--danger,#b6403a)}" +
      ".pipo-login .brand{display:flex;align-items:center;gap:10px;margin-bottom:4px}" +
      ".pipo-login .brand img{width:40px;height:40px}" +
      ".user-pill{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-2,#465350)}" +
      ".user-pill[hidden]{display:none}" +
      ".user-pill .user-name{font-weight:700;color:var(--ink,#182523);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".user-pill button{font:inherit;font-size:12px;font-weight:600;padding:5px 9px;border:1px solid var(--line,#dde3e1);border-radius:7px;background:var(--surface,#fff);color:var(--ink-2,#465350);cursor:pointer}" +
      ".user-pill button:hover{border-color:var(--line-strong,#c7cfcc);color:var(--ink,#182523)}" +
      "@media (max-width:640px){.user-pill .user-name{display:none}}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  function showLogin(message) {
    if (!loginEl) {
      var logo = document.querySelector(".brand-mark");
      loginEl = document.createElement("div");
      loginEl.className = "pipo-login";
      loginEl.innerHTML =
        '<form autocomplete="on">' +
          '<div class="brand">' + (logo ? '<img alt="" src="' + logo.getAttribute("src") + '">' : "") +
            '<div><h2>Agenda Pipo</h2></div></div>' +
          '<p class="sub">Clínica de Autismo Pipo — entre com seu e-mail e senha.</p>' +
          '<label>E-mail<input type="email" name="email" autocomplete="username" required></label>' +
          '<label>Senha<input type="password" name="password" autocomplete="current-password" required></label>' +
          '<div class="err" role="alert"></div>' +
          '<button type="submit">Entrar</button>' +
        "</form>";
      document.body.appendChild(loginEl);
      var form = loginEl.querySelector("form");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = form.querySelector("button");
        var errEl = form.querySelector(".err");
        errEl.textContent = "";
        btn.disabled = true;
        btn.textContent = "Entrando…";
        client.auth.signInWithPassword({
          email: form.email.value.trim(),
          password: form.password.value
        }).then(function (r) {
          btn.disabled = false;
          btn.textContent = "Entrar";
          if (r.error) {
            errEl.textContent = /invalid/i.test(r.error.message)
              ? "E-mail ou senha incorretos."
              : /banned/i.test(r.error.message)
                ? "Seu acesso foi desativado. Fale com o administrador da clínica."
                : r.error.message;
            return;
          }
          form.password.value = "";
          // onAuthStateChange cuida do resto
        });
      });
    }
    loginEl.querySelector(".err").textContent = message || "";
    loginEl.hidden = false;
    var em = loginEl.querySelector('input[name="email"]');
    if (em) setTimeout(function () { em.focus(); }, 0);
  }

  function hideLogin() {
    if (loginEl) loginEl.hidden = true;
  }

  /* ---------------- menu do usuário (topo) ---------------- */
  function renderUserPill() {
    var host = document.getElementById("userPill");
    if (!host || !profile) return;
    host.hidden = false;
    host.innerHTML =
      '<span class="user-name" title="' + escapeHtml(profile.email) + '">' +
        escapeHtml(profile.full_name || profile.email) + "</span>" +
      '<button type="button" data-act="senha">Trocar senha</button>' +
      '<button type="button" data-act="sair">Sair</button>';
  }

  function wireUserPill() {
    var host = document.getElementById("userPill");
    if (!host) return;
    host.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.getAttribute("data-act") === "sair") {
        client.auth.signOut().then(function () { location.reload(); });
      } else {
        openChangePassword();
      }
    });
  }

  function openChangePassword() {
    var host = document.getElementById("modalHost");
    if (!host) return;
    host.innerHTML =
      '<div class="overlay" id="ovPwd"><div class="modal" style="max-width:380px">' +
        '<div class="modal-head"><div><h3>Trocar minha senha</h3>' +
          '<div class="modal-sub">Mínimo de 8 caracteres.</div></div>' +
          '<button class="modal-close" id="pwdClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label>Nova senha</label><input type="password" id="pwdNew" autocomplete="new-password"></div>' +
          '<div class="field"><label>Repita a nova senha</label><input type="password" id="pwdNew2" autocomplete="new-password"></div>' +
        "</div>" +
        '<div class="modal-foot"><div class="spacer"></div>' +
          '<button class="btn ghost" id="pwdCancel">Cancelar</button>' +
          '<button class="btn primary" id="pwdSave">Salvar</button></div>' +
      "</div></div>";
    var ov = document.getElementById("ovPwd");
    function close() { host.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("pwdClose").addEventListener("click", close);
    document.getElementById("pwdCancel").addEventListener("click", close);
    document.getElementById("pwdSave").addEventListener("click", function () {
      var a = document.getElementById("pwdNew").value, b = document.getElementById("pwdNew2").value;
      if (a.length < 8) return toast("A senha precisa ter pelo menos 8 caracteres.", true);
      if (a !== b) return toast("As duas senhas não são iguais.", true);
      client.auth.updateUser({ password: a }).then(function (r) {
        if (r.error) return toast("Não foi possível trocar a senha: " + r.error.message, true);
        close();
        toast("Senha alterada.");
      });
    });
    document.getElementById("pwdNew").focus();
  }

  function toast(msg, isErr) {
    if (typeof window.showToast === "function") window.showToast(msg, isErr);
    else alert(msg);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------- inicialização ---------------- */
  function onSignedIn(s) {
    session = s;
    return loadProfile().then(function (p) {
      if (!p.active) {
        client.auth.signOut();
        showLogin("Seu acesso foi desativado. Fale com o administrador da clínica.");
        return;
      }
      hideLogin();
      setProfile(p);
      readyResolve(true);
    }).catch(function (e) {
      showLogin("Não foi possível carregar seu perfil: " + (e.message || e));
    });
  }

  function start() {
    injectStyles();
    wireUserPill();
    fetch("/api/config").then(function (r) {
      if (!r.ok) throw new Error("config " + r.status);
      return r.json();
    }).then(function (cfg) {
      if (!window.supabase || !window.supabase.createClient) throw new Error("biblioteca do Supabase não carregou");
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      window.pipoAuth.client = client;
      var handled = false;
      client.auth.onAuthStateChange(function (event, s) {
        if (event === "SIGNED_OUT") {
          session = null;
          profile = null;
          if (handled) location.reload();
          return;
        }
        if (s && !session) {
          handled = true;
          // Não chamar o Supabase direto dentro do callback (trava de sessão).
          setTimeout(function () { onSignedIn(s); }, 0);
        } else if (s) {
          session = s;
          if (client.realtime && client.realtime.setAuth) client.realtime.setAuth(s.access_token);
        }
      });
      return client.auth.getSession().then(function (r) {
        if (!r.data.session) showLogin("");
      });
    }).catch(function (e) {
      showLogin("Sistema não configurado corretamente (" + (e.message || e) + "). Avise o administrador.");
      var f = loginEl && loginEl.querySelector("button");
      if (f) f.disabled = true;
    });
  }

  window.pipoAuth = {
    client: null,
    MODULES: MODULES,
    ACTIONS: ACTIONS,
    ready: ready,
    can: can,
    isAdmin: function () { return !!(profile && profile.active && profile.is_admin); },
    profile: function () { return profile; },
    session: function () { return session; },
    onProfile: function (fn) { profileListeners.push(fn); if (profile) fn(profile); },
    signOut: function () { return client.auth.signOut(); }
  };

  // Mesma API que o Claude Artifact oferecia — o app não precisa saber a diferença.
  window.claude = {
    use: function (name) {
      if (name === "db") {
        return ready.then(function () { return { doc: makeDocRef }; });
      }
      if (name === "user") {
        return ready.then(function () {
          return {
            can: function () { return Promise.resolve(canWriteAnything()); },
            canEdit: function () { return canWriteAnything(); },
            isOwner: function () { return window.pipoAuth.isAdmin(); }
          };
        });
      }
      return Promise.resolve(null);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
