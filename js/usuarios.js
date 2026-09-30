/* =====================================================================
 * Agenda Pipo — abas "Usuários" e "Níveis de permissão" (só Administrador)
 *
 * Usuários: quem entra no sistema e em qual NÍVEL está (tabela profiles,
 *   coluna role_id). Criar / senha / ativar / excluir passam por
 *   /api/admin-users (precisa da service role key); nome e nível são
 *   gravados direto no banco — a política RLS só deixa administrador alterar.
 * Níveis de permissão: a grade módulo × ação de cada nível (tabela roles).
 *   O nível Administrador tem sempre acesso total e não é editável.
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

  var users = [], roles = [];
  var loaded = { users: false, roles: false };
  var dirtyRoles = {}; // roleId -> permissões ainda não salvas na tela de níveis

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isErr) { if (typeof window.showToast === "function") window.showToast(msg, isErr); }
  function confirmBox(opts) { return window.pipoConfirm ? window.pipoConfirm(opts) : Promise.resolve(window.confirm(opts.title)); }
  function roleById(id) { return roles.filter(function (r) { return r.id === id; })[0] || null; }
  function friendlyDbError(e) {
    var m = (e && e.message) || String(e || "");
    if (/administrador ativo/i.test(m)) return "É preciso manter pelo menos um administrador ativo.";
    if (/permission|42501|row-level/i.test(m)) return "Sem permissão para esta alteração.";
    return m;
  }

  function injectStyles() {
    var css =
      ".adm-wrap{padding:0 14px 14px;overflow:auto;flex:1}" +
      ".adm-table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}" +
      ".adm-table th{text-align:left;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface)}" +
      ".adm-table td{padding:9px 12px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:middle}" +
      ".adm-table tbody tr{cursor:pointer}" +
      ".adm-table tbody tr:hover{background:var(--surface-2)}" +
      ".adm-table tr.inactive td{color:var(--muted)}" +
      ".adm-table .u-name{font-weight:700;color:var(--ink)}" +
      ".u-badge{display:inline-block;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);margin-right:4px;white-space:nowrap}" +
      ".u-badge.admin{background:var(--accent-weak);color:var(--accent)}" +
      ".u-badge.off{background:var(--danger-weak);color:var(--danger)}" +
      ".u-badge.ok{background:#e3f1e2;color:#3d7a39}" +
      ".perm-grid{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".perm-grid th,.perm-grid td{padding:7px 6px;border-bottom:1px solid var(--line);text-align:center}" +
      ".perm-grid th:first-child,.perm-grid td:first-child{text-align:left}" +
      ".perm-grid th{font-size:10.5px;font-weight:800;text-transform:uppercase;color:var(--muted)}" +
      ".perm-grid td small{display:block;color:var(--muted);font-size:10.5px;font-weight:500}" +
      ".perm-grid input{width:16px;height:16px;cursor:pointer}" +
      ".perm-grid input:disabled{cursor:default}" +
      ".role-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px;padding:0 14px 14px;overflow:auto;flex:1;align-content:start}" +
      ".role-card{border:1px solid var(--line);border-radius:10px;background:var(--surface);display:flex;flex-direction:column}" +
      ".role-card-head{display:flex;align-items:center;gap:8px;padding:12px 14px 6px}" +
      ".role-card-head h4{margin:0;font-size:14px;font-weight:800;color:var(--ink)}" +
      ".role-card-head .spacer{flex:1}" +
      ".role-card-body{padding:0 14px 6px}" +
      ".role-card-note{font-size:11.5px;color:var(--muted);padding:0 14px 8px}" +
      ".role-card-foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}" +
      ".role-card-foot .spacer{flex:1}" +
      ".role-card.dirty{border-color:var(--warn)}" +
      ".role-dirty-note{font-size:11.5px;font-weight:700;color:var(--warn)}" +
      ".role-pick{display:flex;flex-direction:column;gap:6px}" +
      ".role-pick label{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12.5px}" +
      ".role-pick label:has(input:checked){border-color:var(--accent);background:var(--accent-weak)}" +
      ".role-pick label.disabled{opacity:.6;cursor:default}" +
      ".role-pick input{margin-top:2px}" +
      ".role-pick b{display:block;color:var(--ink)}" +
      ".role-pick span{color:var(--muted);font-size:11.5px}" +
      ".u-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end}" +
      ".u-actions .field{flex:1;min-width:160px;margin:0}";
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- dados ---------------- */
  function loadRoles() {
    return auth.client.from("roles").select("*").order("sort", { ascending: true }).then(function (r) {
      if (r.error) { toast("Não foi possível carregar os níveis: " + r.error.message, true); return; }
      roles = r.data || [];
      loaded.roles = true;
    });
  }
  function loadUsers() {
    return auth.client.from("profiles").select("*").order("full_name", { ascending: true }).then(function (r) {
      if (r.error) { toast("Não foi possível carregar os usuários: " + r.error.message, true); return; }
      users = r.data || [];
      loaded.users = true;
    });
  }
  function reloadAll() {
    return Promise.all([loadRoles(), loadUsers()]).then(renderAll);
  }

  function adminApi(payload) {
    var s = auth.session();
    return fetch("/api/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s ? s.access_token : "") },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || ("Erro " + r.status));
        return b;
      });
    });
  }

  // Resumo curto das permissões de um nível, para a escolha no cadastro.
  function roleSummary(role) {
    if (!role) return "";
    if (role.is_admin) return "Acesso total, inclusive Usuários e Níveis de permissão";
    var p = role.permissions || {};
    var parts = MODULES.map(function (m) {
      var mp = p[m.key] || {};
      if (!mp.view) return null;
      var w = [];
      if (mp.create) w.push("incluir");
      if (mp.edit) w.push("editar");
      if (mp["delete"]) w.push("excluir");
      return m.label + (w.length ? " (ver, " + w.join(", ") + ")" : " (só ver)");
    }).filter(Boolean);
    return parts.length ? parts.join(" · ") : "Sem acesso a nenhuma aba";
  }

  /* ================= Tela: Usuários ================= */
  function renderUsers() {
    var h = document.getElementById("tab-usuarios");
    if (!h) return;
    var me = auth.profile();
    h.innerHTML =
      '<div class="pat-toolbar">' +
        '<div><b style="font-size:13px">Cadastro de usuários</b>' +
          '<div class="pat-count" style="margin-top:2px">Quem pode entrar no sistema e em qual nível de permissão. ' +
          'O que cada nível pode fazer é definido na aba "Níveis de permissão".</div></div>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary" id="addUserBtn">+ Novo usuário</button>' +
      "</div>" +
      '<div class="adm-wrap">' +
        (!(loaded.users && loaded.roles) ? '<div class="pat-count" style="padding:12px">Carregando…</div>' :
        '<table class="adm-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Nível de permissão</th><th>Situação</th></tr></thead><tbody>' +
          users.map(function (u) {
            var role = roleById(u.role_id);
            return '<tr data-uid="' + esc(u.id) + '" class="' + (u.active ? "" : "inactive") + '" tabindex="0">' +
              '<td class="u-name">' + esc(u.full_name || "(sem nome)") + (me && me.id === u.id ? ' <span class="u-badge">você</span>' : "") + "</td>" +
              "<td>" + esc(u.email) + "</td>" +
              '<td><span class="u-badge' + (role && role.is_admin ? " admin" : "") + '">' + esc(role ? role.name : u.role_id) + "</span></td>" +
              "<td>" + (u.active ? '<span class="u-badge ok">Ativo</span>' : '<span class="u-badge off">Desativado</span>') + "</td>" +
            "</tr>";
          }).join("") +
        "</tbody></table>") +
      "</div>";
    document.getElementById("addUserBtn").addEventListener("click", function () { openUserModal(null); });
    h.querySelectorAll("tbody tr[data-uid]").forEach(function (tr) {
      function open() {
        var u = users.filter(function (x) { return x.id === tr.getAttribute("data-uid"); })[0];
        if (u) openUserModal(u);
      }
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    });
  }

  function rolePickerHtml(selectedId, disabled) {
    return '<div class="role-pick" id="uRolePick">' + roles.map(function (r) {
      return '<label class="' + (disabled ? "disabled" : "") + '"><input type="radio" name="uRole" value="' + esc(r.id) + '"' +
        (r.id === selectedId ? " checked" : "") + (disabled ? " disabled" : "") + ">" +
        "<div><b>" + esc(r.name) + "</b><span>" + esc(roleSummary(r)) + "</span></div></label>";
    }).join("") + "</div>";
  }

  function openUserModal(u) {
    var isNew = !u;
    var me = auth.profile();
    var isMe = !!(u && me && u.id === me.id);
    var defaultRole = roleById("secretaria") ? "secretaria" : (roles[roles.length - 1] || {}).id;
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovUser"><div class="modal wide" style="max-width:560px">' +
        '<div class="modal-head"><div><h3>' + (isNew ? "Novo usuário" : "Editar usuário") + "</h3>" +
          '<div class="modal-sub">' + (isNew
            ? "A pessoa entra com este e-mail e a senha inicial, e pode trocar a senha depois pelo botão \"Trocar senha\" no topo."
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
          '<div class="field"><label>Nível de permissão</label>' + rolePickerHtml(isNew ? defaultRole : u.role_id, isMe) +
            (isMe ? '<div class="pat-count" style="margin-top:6px">Você não pode mudar o seu próprio nível.</div>' : "") + "</div>" +
          (!isNew
            ? '<div class="field" style="margin-top:4px"><label>Senha e acesso</label><div class="u-actions">' +
                '<div class="field"><input id="uNewPass" type="text" placeholder="Nova senha (mín. 8)" autocomplete="off"></div>' +
                '<button type="button" class="btn" id="uSetPass">Definir senha</button>' +
              "</div>" +
              (isMe ? "" : '<div class="u-actions" style="margin-top:8px">' +
                '<button type="button" class="btn" id="uToggle">' + (u.active ? "Desativar acesso" : "Reativar acesso") + "</button>" +
                '<button type="button" class="btn danger" id="uDelete">Excluir usuário</button></div>') +
              "</div>"
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

    function selectedRole() {
      var c = document.querySelector('#uRolePick input[name="uRole"]:checked');
      return c ? c.value : "";
    }

    var saveBtn = document.getElementById("uSave");
    saveBtn.addEventListener("click", function () {
      var name = document.getElementById("uName").value.trim();
      if (!name) { toast("Informe o nome.", true); return; }
      var roleId = selectedRole();
      if (!roleId) { toast("Escolha o nível de permissão.", true); return; }
      saveBtn.disabled = true;
      var p;
      if (isNew) {
        p = adminApi({
          action: "create",
          email: document.getElementById("uEmail").value.trim(),
          password: document.getElementById("uPass").value,
          full_name: name,
          role_id: roleId
        }).then(function () { toast("Usuário criado."); });
      } else {
        var patch = { full_name: name };
        if (!isMe) patch.role_id = roleId;
        p = auth.client.from("profiles").update(patch).eq("id", u.id).then(function (r) {
          if (r.error) throw new Error(friendlyDbError(r.error));
          toast("Usuário atualizado.");
        });
      }
      p.then(function () { close(); reloadAll(); }).catch(function (e) {
        saveBtn.disabled = false;
        toast(e.message, true);
      });
    });

    if (!isNew) {
      document.getElementById("uSetPass").addEventListener("click", function () {
        var pw = document.getElementById("uNewPass").value;
        if (pw.length < 8) { toast("A senha precisa ter pelo menos 8 caracteres.", true); return; }
        adminApi({ action: "set_password", id: u.id, password: pw })
          .then(function () { document.getElementById("uNewPass").value = ""; toast("Senha alterada. Informe a nova senha à pessoa."); })
          .catch(function (e) { toast(e.message, true); });
      });
      var tg = document.getElementById("uToggle");
      if (tg) tg.addEventListener("click", function () {
        var activate = !u.active;
        (activate ? Promise.resolve(true) : confirmBox({
          title: "Desativar acesso",
          message: "Desativar o acesso de <b>" + esc(u.full_name || u.email) + "</b>? A pessoa não conseguirá mais entrar até ser reativada.",
          confirmLabel: "Desativar"
        })).then(function (ok) {
          if (!ok) return;
          adminApi({ action: "set_active", id: u.id, active: activate })
            .then(function () { toast(activate ? "Acesso reativado." : "Acesso desativado."); close(); reloadAll(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
      var del = document.getElementById("uDelete");
      if (del) del.addEventListener("click", function () {
        confirmBox({
          title: "Excluir usuário",
          message: "Excluir definitivamente o usuário <b>" + esc(u.full_name || u.email) + "</b>? Isso não pode ser desfeito.<br>Para só bloquear a entrada, use \"Desativar acesso\".",
          confirmLabel: "Excluir usuário"
        }).then(function (ok) {
          if (!ok) return;
          adminApi({ action: "delete", id: u.id })
            .then(function () { toast("Usuário excluído."); close(); reloadAll(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
    }

    document.getElementById("uName").focus();
  }

  /* ================= Tela: Níveis de permissão ================= */
  function permsOf(role) { return dirtyRoles[role.id] || role.permissions || {}; }

  function roleGridHtml(role) {
    var perms = permsOf(role);
    return '<table class="perm-grid" data-role="' + esc(role.id) + '"><thead><tr><th>Tela</th>' +
      ACTIONS.map(function (a) { return "<th>" + a.label + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      MODULES.map(function (m) {
        return "<tr><td><b>" + m.label + "</b>" + (m.hint ? "<small>" + m.hint + "</small>" : "") + "</td>" +
          ACTIONS.map(function (a) {
            var on = role.is_admin || !!(perms[m.key] && perms[m.key][a.key]);
            return '<td><input type="checkbox" data-m="' + m.key + '" data-a="' + a.key + '"' + (on ? " checked" : "") +
              (role.is_admin ? " disabled" : "") + ' aria-label="' + a.label + " em " + m.label + " (" + esc(role.name) + ')"></td>';
          }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";
  }

  function renderRoles() {
    var h = document.getElementById("tab-niveis");
    if (!h) return;
    var counts = {};
    users.forEach(function (u) { counts[u.role_id] = (counts[u.role_id] || 0) + 1; });
    h.innerHTML =
      '<div class="pat-toolbar">' +
        '<div><b style="font-size:13px">Níveis de permissão</b>' +
          '<div class="pat-count" style="margin-top:2px">O que cada nível pode fazer em cada tela. ' +
          'A mudança vale na hora para todos os usuários daquele nível.</div></div>' +
      "</div>" +
      (!(loaded.users && loaded.roles) ? '<div class="pat-count" style="padding:12px 14px">Carregando…</div>' :
      '<div class="role-cards">' + roles.map(function (r) {
        var n = counts[r.id] || 0;
        var dirty = !!dirtyRoles[r.id];
        return '<div class="role-card' + (dirty ? " dirty" : "") + '" data-role-card="' + esc(r.id) + '">' +
          '<div class="role-card-head"><h4>' + esc(r.name) + "</h4>" +
            (r.is_admin ? '<span class="u-badge admin">Acesso total</span>' : "") +
            '<div class="spacer"></div><span class="u-badge">' + n + (n === 1 ? " usuário" : " usuários") + "</span></div>" +
          (r.is_admin ? '<div class="role-card-note">Único nível com acesso às telas de Usuários e Níveis de permissão. Não pode ser alterado.</div>' : "") +
          '<div class="role-card-body">' + roleGridHtml(r) + "</div>" +
          (r.is_admin ? "" :
            '<div class="role-card-foot">' +
              (dirty ? '<span class="role-dirty-note">Alterações não salvas</span>' : "") +
              '<div class="spacer"></div>' +
              '<button type="button" class="btn ghost" data-role-undo="' + esc(r.id) + '"' + (dirty ? "" : " disabled") + ">Descartar</button>" +
              '<button type="button" class="btn primary" data-role-save="' + esc(r.id) + '"' + (dirty ? "" : " disabled") + ">Salvar</button>" +
            "</div>") +
        "</div>";
      }).join("") + "</div>");

    h.querySelectorAll("table.perm-grid").forEach(function (tbl) {
      tbl.addEventListener("change", function (e) {
        var c = e.target;
        var role = roleById(tbl.getAttribute("data-role"));
        if (!role || role.is_admin) return;
        var m = c.getAttribute("data-m"), a = c.getAttribute("data-a");
        // Incluir/editar/excluir sem "ver" não faz sentido: marca "ver" junto;
        // desmarcar "ver" tira tudo daquela tela.
        if (a !== "view" && c.checked) {
          var v = tbl.querySelector('input[data-m="' + m + '"][data-a="view"]');
          if (v) v.checked = true;
        }
        if (a === "view" && !c.checked) {
          tbl.querySelectorAll('input[data-m="' + m + '"]').forEach(function (x) { x.checked = false; });
        }
        var p = {};
        MODULES.forEach(function (mm) {
          p[mm.key] = {};
          ACTIONS.forEach(function (aa) {
            var box = tbl.querySelector('input[data-m="' + mm.key + '"][data-a="' + aa.key + '"]');
            p[mm.key][aa.key] = !!(box && box.checked);
          });
        });
        if (JSON.stringify(p) === JSON.stringify(normalizePerms(role.permissions))) delete dirtyRoles[role.id];
        else dirtyRoles[role.id] = p;
        renderRoles();
      });
    });
    h.querySelectorAll("[data-role-undo]").forEach(function (b) {
      b.addEventListener("click", function () { delete dirtyRoles[b.getAttribute("data-role-undo")]; renderRoles(); });
    });
    h.querySelectorAll("[data-role-save]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-role-save");
        var role = roleById(id);
        var perms = dirtyRoles[id];
        if (!role || !perms) return;
        b.disabled = true;
        auth.client.from("roles").update({ permissions: perms }).eq("id", id).then(function (r) {
          if (r.error) { b.disabled = false; toast("Não foi possível salvar: " + friendlyDbError(r.error), true); return; }
          role.permissions = perms;
          delete dirtyRoles[id];
          toast("Permissões do nível " + role.name + " salvas.");
          renderRoles();
        });
      });
    });
  }

  function normalizePerms(p) {
    var out = {};
    p = p || {};
    MODULES.forEach(function (m) {
      out[m.key] = {};
      ACTIONS.forEach(function (a) { out[m.key][a.key] = !!(p[m.key] && p[m.key][a.key]); });
    });
    return out;
  }

  function renderAll() { renderUsers(); renderRoles(); }

  /* ---------------- ligação com as abas ---------------- */
  function init() {
    injectStyles();
    var tabs = document.getElementById("mainTabs");
    if (tabs) tabs.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-tab="usuarios"],button[data-tab="niveis"]');
      if (!b || !auth.isAdmin()) return;
      if (!(loaded.users && loaded.roles)) renderAll();
      reloadAll();
    });
    // Outro administrador mudou um nível: atualiza a tela (sem apagar o que
    // estou editando e ainda não salvei).
    if (auth.onRoleChange) auth.onRoleChange(function (row) {
      if (!row || !loaded.roles) return;
      roles = roles.map(function (r) { return r.id === row.id ? row : r; });
      renderAll();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
