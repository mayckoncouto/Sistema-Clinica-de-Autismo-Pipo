/* =====================================================================
 * Agenda Pipo — aba "Usuários" (só administradores)
 *
 * Lista os perfis (tabela public.profiles), cria usuários com senha inicial,
 * edita nome/administrador/permissões módulo × ação, troca senha, ativa/
 * desativa e exclui. Criar/senha/ativar/excluir passam por /api/admin-users
 * (precisa da service role key); nome e permissões são gravados direto no
 * banco — a política RLS de profiles só deixa administrador alterar.
 * ===================================================================== */
(function () {
  "use strict";
  if (!window.pipoAuth) return;

  var auth = window.pipoAuth;
  var MODULES = [
    { key: "agenda", label: "Agenda", hint: "também dá acesso ao Relatório" },
    { key: "pacientes", label: "Pacientes", hint: "inclui Convênios e Especialidades" },
    { key: "profissionais", label: "Profissionais", hint: "" },
    { key: "salas", label: "Salas", hint: "" }
  ];
  var ACTIONS = [
    { key: "view", label: "Ver" },
    { key: "create", label: "Incluir" },
    { key: "edit", label: "Editar" },
    { key: "delete", label: "Excluir" }
  ];
  var PRESETS = {
    leitura: function () { return buildPerms(function (m, a) { return a === "view"; }); },
    recepcao: function () {
      return buildPerms(function (m, a) {
        if (m === "agenda" || m === "pacientes") return true;
        return a === "view";
      });
    },
    total: function () { return buildPerms(function () { return true; }); }
  };

  var users = [];
  var loaded = false;
  var loading = false;

  function buildPerms(fn) {
    var p = {};
    MODULES.forEach(function (m) {
      p[m.key] = {};
      ACTIONS.forEach(function (a) { p[m.key][a.key] = !!fn(m.key, a.key); });
    });
    return p;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isErr) {
    if (typeof window.showToast === "function") window.showToast(msg, isErr);
  }
  function host() { return document.getElementById("tab-usuarios"); }

  function injectStyles() {
    var css =
      "#tab-usuarios .users-wrap{padding:0 14px 14px;overflow:auto;flex:1}" +
      "#tab-usuarios table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}" +
      "#tab-usuarios th{text-align:left;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface)}" +
      "#tab-usuarios td{padding:9px 12px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:middle}" +
      "#tab-usuarios tbody tr{cursor:pointer}" +
      "#tab-usuarios tbody tr:hover{background:var(--surface-2)}" +
      "#tab-usuarios tr.inactive td{color:var(--muted)}" +
      "#tab-usuarios .u-name{font-weight:700;color:var(--ink)}" +
      ".u-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);margin-right:4px;white-space:nowrap}" +
      ".u-badge.admin{background:var(--accent-weak);color:var(--accent)}" +
      ".u-badge.off{background:var(--danger-weak);color:var(--danger)}" +
      ".u-perm-sum{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11.5px;color:var(--ink-2);white-space:nowrap}" +
      ".perm-grid{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".perm-grid th,.perm-grid td{padding:6px 4px;border-bottom:1px solid var(--line);text-align:center}" +
      ".perm-grid th:first-child,.perm-grid td:first-child{text-align:left}" +
      ".perm-grid th{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--muted)}" +
      ".perm-grid td small{display:block;color:var(--muted);font-size:10.5px;font-weight:500}" +
      ".perm-grid input{width:16px;height:16px;cursor:pointer}" +
      ".perm-grid.disabled{opacity:.45;pointer-events:none}" +
      ".perm-presets{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--muted)}" +
      ".perm-presets .btn{padding:4px 9px;font-size:11.5px}" +
      ".u-actions{display:flex;gap:6px;flex-wrap:wrap}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- dados ---------------- */
  function loadUsers() {
    if (loading) return;
    loading = true;
    auth.client.from("profiles").select("*").order("full_name", { ascending: true }).then(function (r) {
      loading = false;
      if (r.error) { toast("Não foi possível carregar os usuários: " + r.error.message, true); return; }
      users = r.data || [];
      loaded = true;
      render();
    });
  }

  function adminApi(payload) {
    var s = auth.session();
    return fetch("/api/admin-users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (s ? s.access_token : "")
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || ("Erro " + r.status));
        return b;
      });
    });
  }

  /* ---------------- lista ---------------- */
  function permSummary(u) {
    if (u.is_admin) return "acesso total";
    var p = u.permissions || {};
    return MODULES.map(function (m) {
      var mp = p[m.key] || {};
      var letters = (mp.view ? "V" : "·") + (mp.create ? "I" : "·") + (mp.edit ? "E" : "·") + (mp["delete"] ? "X" : "·");
      return m.label.slice(0, 3) + " " + letters;
    }).join("  ");
  }

  function render() {
    var h = host();
    if (!h) return;
    var me = auth.profile();
    h.innerHTML =
      '<div class="pat-toolbar">' +
        "<div><b style=\"font-size:13px\">Usuários</b>" +
          '<div class="pat-count" style="margin-top:2px">Quem pode entrar no sistema e o que cada pessoa pode fazer. ' +
          "Na coluna Permissões: V = ver, I = incluir, E = editar, X = excluir.</div></div>" +
        '<div class="spacer"></div>' +
        '<button class="btn primary" id="addUserBtn">+ Novo usuário</button>' +
      "</div>" +
      '<div class="users-wrap">' +
        (!loaded ? '<div class="pat-count" style="padding:12px">Carregando…</div>' :
        "<table><thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th><th>Permissões</th></tr></thead><tbody>" +
          users.map(function (u) {
            return '<tr data-uid="' + esc(u.id) + '" class="' + (u.active ? "" : "inactive") + '">' +
              '<td class="u-name">' + esc(u.full_name || "(sem nome)") + (me && me.id === u.id ? ' <span class="u-badge">você</span>' : "") + "</td>" +
              "<td>" + esc(u.email) + "</td>" +
              "<td>" + (u.is_admin ? '<span class="u-badge admin">Administrador</span>' : "") +
                (u.active ? "" : '<span class="u-badge off">Desativado</span>') +
                (!u.is_admin && u.active ? '<span class="u-badge">Ativo</span>' : "") + "</td>" +
              '<td class="u-perm-sum">' + esc(permSummary(u)) + "</td>" +
            "</tr>";
          }).join("") +
        "</tbody></table>") +
      "</div>";
    document.getElementById("addUserBtn").addEventListener("click", function () { openUserModal(null); });
    var tb = h.querySelector("tbody");
    if (tb) tb.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-uid]");
      if (!tr) return;
      var u = users.filter(function (x) { return x.id === tr.getAttribute("data-uid"); })[0];
      if (u) openUserModal(u);
    });
  }

  /* ---------------- modal de usuário ---------------- */
  function permGridHtml(perms) {
    return '<table class="perm-grid" id="uPermGrid"><thead><tr><th>Módulo</th>' +
      ACTIONS.map(function (a) { return "<th>" + a.label + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      MODULES.map(function (m) {
        return "<tr><td><b>" + m.label + "</b>" + (m.hint ? "<small>" + m.hint + "</small>" : "") + "</td>" +
          ACTIONS.map(function (a) {
            var on = perms && perms[m.key] && perms[m.key][a.key];
            return '<td><input type="checkbox" data-m="' + m.key + '" data-a="' + a.key + '"' + (on ? " checked" : "") +
              ' aria-label="' + a.label + " em " + m.label + '"></td>';
          }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";
  }

  function readPerms() {
    var p = buildPerms(function () { return false; });
    document.querySelectorAll("#uPermGrid input[type=checkbox]").forEach(function (c) {
      p[c.getAttribute("data-m")][c.getAttribute("data-a")] = c.checked;
    });
    return p;
  }

  function setPerms(p) {
    document.querySelectorAll("#uPermGrid input[type=checkbox]").forEach(function (c) {
      c.checked = !!(p[c.getAttribute("data-m")] && p[c.getAttribute("data-m")][c.getAttribute("data-a")]);
    });
  }

  function openUserModal(u) {
    var isNew = !u;
    var me = auth.profile();
    var isMe = !!(u && me && u.id === me.id);
    var perms = isNew ? PRESETS.leitura() : (u.permissions || PRESETS.leitura());
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovUser"><div class="modal wide" style="max-width:560px">' +
        '<div class="modal-head"><div><h3>' + (isNew ? "Novo usuário" : "Editar usuário") + "</h3>" +
          '<div class="modal-sub">' + (isNew
            ? "A pessoa entra com este e-mail e a senha inicial. Ela pode trocar a senha depois, pelo botão \"Trocar senha\" no topo."
            : esc(u.email)) + "</div></div>" +
          '<button class="modal-close" id="uClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label for="uName">Nome</label><input id="uName" type="text" value="' + esc(u ? u.full_name : "") + '"></div>' +
          (isNew
            ? '<div class="field-row">' +
                '<div class="field"><label for="uEmail">E-mail</label><input id="uEmail" type="email" autocomplete="off"></div>' +
                '<div class="field"><label for="uPass">Senha inicial (mín. 8)</label><input id="uPass" type="text" autocomplete="off"></div>' +
              "</div>"
            : "") +
          '<label class="field-check"><input type="checkbox" id="uAdmin"' + (u && u.is_admin ? " checked" : "") + (isMe ? " disabled" : "") + "> " +
            "Administrador — acesso total, inclusive a esta tela de Usuários</label>" +
          '<div class="perm-presets">Modelos: ' +
            '<button type="button" class="btn" data-preset="leitura">Só visualizar</button>' +
            '<button type="button" class="btn" data-preset="recepcao">Recepção</button>' +
            '<button type="button" class="btn" data-preset="total">Tudo</button></div>' +
          permGridHtml(perms) +
          (!isNew
            ? '<div class="field" style="margin-top:4px"><label>Senha e acesso</label><div class="u-actions">' +
                '<button type="button" class="btn" id="uSetPass">Definir nova senha</button>' +
                (isMe ? "" : '<button type="button" class="btn" id="uToggle">' + (u.active ? "Desativar acesso" : "Reativar acesso") + "</button>") +
                (isMe ? "" : '<button type="button" class="btn danger" id="uDelete">Excluir usuário</button>') +
              "</div></div>"
            : "") +
        "</div>" +
        '<div class="modal-foot"><div class="spacer"></div>' +
          '<button class="btn ghost" id="uCancel">Cancelar</button>' +
          '<button class="btn primary" id="uSave">' + (isNew ? "Criar usuário" : "Salvar") + "</button></div>" +
      "</div></div>";

    var ov = document.getElementById("ovUser");
    function close() { mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("uClose").addEventListener("click", close);
    document.getElementById("uCancel").addEventListener("click", close);

    var adminChk = document.getElementById("uAdmin");
    function syncAdmin() {
      document.getElementById("uPermGrid").classList.toggle("disabled", adminChk.checked);
    }
    adminChk.addEventListener("change", syncAdmin);
    syncAdmin();

    ov.querySelector(".perm-presets").addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset]");
      if (b) setPerms(PRESETS[b.getAttribute("data-preset")]());
    });
    // Marcar incluir/editar/excluir sem "ver" não faz sentido: marca "ver" junto.
    document.getElementById("uPermGrid").addEventListener("change", function (e) {
      var c = e.target;
      var m = c.getAttribute("data-m"), a = c.getAttribute("data-a");
      if (a !== "view" && c.checked) {
        var v = document.querySelector('#uPermGrid input[data-m="' + m + '"][data-a="view"]');
        if (v) v.checked = true;
      }
      if (a === "view" && !c.checked) {
        document.querySelectorAll('#uPermGrid input[data-m="' + m + '"]').forEach(function (x) { x.checked = false; });
      }
    });

    var saveBtn = document.getElementById("uSave");
    saveBtn.addEventListener("click", function () {
      var name = document.getElementById("uName").value.trim();
      if (!name) { toast("Informe o nome.", true); return; }
      var payloadPerms = readPerms();
      saveBtn.disabled = true;
      var p;
      if (isNew) {
        p = adminApi({
          action: "create",
          email: document.getElementById("uEmail").value.trim(),
          password: document.getElementById("uPass").value,
          full_name: name,
          is_admin: adminChk.checked,
          permissions: payloadPerms
        }).then(function () { toast("Usuário criado."); });
      } else {
        p = auth.client.from("profiles")
          .update({ full_name: name, is_admin: adminChk.checked, permissions: payloadPerms })
          .eq("id", u.id)
          .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            toast("Usuário atualizado.");
          });
      }
      p.then(function () { close(); loadUsers(); }).catch(function (e) {
        saveBtn.disabled = false;
        toast(e.message, true);
      });
    });

    if (!isNew) {
      document.getElementById("uSetPass").addEventListener("click", function () {
        var pw = prompt("Nova senha para " + (u.full_name || u.email) + " (mínimo 8 caracteres):");
        if (pw == null) return;
        if (pw.length < 8) { toast("A senha precisa ter pelo menos 8 caracteres.", true); return; }
        adminApi({ action: "set_password", id: u.id, password: pw })
          .then(function () { toast("Senha alterada. Informe a nova senha à pessoa."); })
          .catch(function (e) { toast(e.message, true); });
      });
      var tg = document.getElementById("uToggle");
      if (tg) tg.addEventListener("click", function () {
        var activate = !u.active;
        if (!activate && !confirm("Desativar o acesso de " + (u.full_name || u.email) + "? A pessoa não conseguirá mais entrar.")) return;
        adminApi({ action: "set_active", id: u.id, active: activate })
          .then(function () { toast(activate ? "Acesso reativado." : "Acesso desativado."); close(); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
      var del = document.getElementById("uDelete");
      if (del) del.addEventListener("click", function () {
        if (!confirm("Excluir definitivamente o usuário " + (u.full_name || u.email) + "? Isso não pode ser desfeito. (Para só bloquear o acesso, use \"Desativar acesso\".)")) return;
        adminApi({ action: "delete", id: u.id })
          .then(function () { toast("Usuário excluído."); close(); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
    }

    var first = document.getElementById(isNew ? "uName" : "uName");
    if (first) first.focus();
  }

  /* ---------------- ligação com as abas ---------------- */
  function init() {
    injectStyles();
    var tabs = document.getElementById("mainTabs");
    if (tabs) tabs.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-tab="usuarios"]');
      if (!b || !auth.isAdmin()) return;
      if (!loaded) render();
      loadUsers();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
