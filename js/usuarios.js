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

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Busca sem acento e sem diferenciar maiúsculas (igual ao normText do app).
  function normText(s) {
    return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
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
  // Barra de ferramentas montada uma vez só (para a busca não perder o foco a
  // cada tecla); a lista embaixo é que é refeita.
  function renderUsers() {
    var h = document.getElementById("tab-usuarios");
    if (!h) return;
    if (!document.getElementById("userSearch")) {
      h.innerHTML =
        '<div class="pat-toolbar">' +
          '<div class="search-wrap" style="max-width:280px">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>' +
            '<input id="userSearch" type="text" placeholder="Buscar por nome, e-mail ou nível…">' +
          "</div>" +
          '<span class="pat-count" id="userCount"></span>' +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="rolesBtn">Níveis de permissão</button>' +
          '<button class="btn primary" id="addUserBtn">+ Novo usuário</button>' +
        "</div>" +
        '<div class="adm-wrap" id="usersListHost"></div>';
      document.getElementById("userSearch").addEventListener("input", renderUsers);
      document.getElementById("addUserBtn").addEventListener("click", function () { openUserModal(null); });
      document.getElementById("rolesBtn").addEventListener("click", function () { openRolesModal(); });
    }
    var host = document.getElementById("usersListHost");
    var countEl = document.getElementById("userCount");
    if (!(loaded.users && loaded.roles)) {
      host.innerHTML = '<div class="pat-count" style="padding:12px">Carregando…</div>';
      return;
    }
    var me = auth.profile();
    var q = normText(document.getElementById("userSearch").value.trim());
    var list = users.filter(function (u) {
      if (!q) return true;
      var role = roleById(u.role_id);
      return normText(u.full_name).indexOf(q) !== -1 || normText(u.email).indexOf(q) !== -1 ||
        normText(role ? role.name : "").indexOf(q) !== -1;
    });
    countEl.textContent = list.length + " de " + users.length + (users.length === 1 ? " usuário" : " usuários");
    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><b>Nenhum usuário encontrado</b>Ajuste a busca ou cadastre um novo usuário.</div>';
      return;
    }
    host.innerHTML =
        '<table class="adm-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Nível de permissão</th><th>Situação</th></tr></thead><tbody>' +
          list.map(function (u) {
            var role = roleById(u.role_id);
            return '<tr data-uid="' + esc(u.id) + '" class="' + (u.active ? "" : "inactive") + '" tabindex="0">' +
              '<td class="u-name">' + esc(u.full_name || "(sem nome)") + (me && me.id === u.id ? ' <span class="u-badge">você</span>' : "") + "</td>" +
              "<td>" + esc(u.email) + "</td>" +
              '<td><span class="u-badge' + (role && role.is_admin ? " admin" : "") + '">' + esc(role ? role.name : u.role_id) + "</span></td>" +
              "<td>" + (u.active ? '<span class="u-badge ok">Ativo</span>' : '<span class="u-badge off">Desativado</span>') + "</td>" +
            "</tr>";
          }).join("") +
        "</tbody></table>";
    host.querySelectorAll("tbody tr[data-uid]").forEach(function (tr) {
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
            ? "A pessoa entra com este e-mail e a senha inicial, e pode trocar a senha depois no menu \"Acesso\" do topo."
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
  function normalizePerms(p) {
    var out = {};
    p = p || {};
    MODULES.forEach(function (m) {
      out[m.key] = {};
      ACTIONS.forEach(function (a) { out[m.key][a.key] = !!(p[m.key] && p[m.key][a.key]); });
    });
    return out;
  }
  function slugify(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "nivel";
  }

  // Janela "Níveis de permissão" (aberta pelo botão na tela de Usuários, como
  // "Especialidades" em Pacientes): lista dos níveis + "Novo nível".
  function openRolesModal() {
    var counts = {};
    users.forEach(function (u) { counts[u.role_id] = (counts[u.role_id] || 0) + 1; });
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovRoles"><div class="modal wide" style="max-width:760px">' +
        '<div class="modal-head"><div><h3>Níveis de permissão</h3>' +
          '<div class="modal-sub">O que cada nível pode fazer em cada tela. Clique num nível para editar. ' +
          'Uma mudança vale na hora para todos os usuários daquele nível.</div></div>' +
          '<button class="modal-close" id="rlClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<table class="adm-table"><thead><tr><th style="width:24%">Nível</th><th>Permissões</th><th style="width:16%">Usuários</th></tr></thead><tbody>' +
            roles.map(function (r) {
              var n = counts[r.id] || 0;
              return '<tr data-role-id="' + esc(r.id) + '" tabindex="0">' +
                '<td class="u-name">' + esc(r.name) + (r.is_admin ? ' <span class="u-badge admin">Acesso total</span>' : "") + "</td>" +
                '<td class="pt-muted">' + esc(roleSummary(r)) + "</td>" +
                '<td><span class="u-badge">' + n + (n === 1 ? " usuário" : " usuários") + "</span></td>" +
              "</tr>";
            }).join("") +
          "</tbody></table>" +
        "</div>" +
        '<div class="modal-foot">' +
          '<button class="btn primary" id="addRoleBtn">+ Novo nível</button>' +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="rlDone">Fechar</button>' +
        "</div>" +
      "</div></div>";
    var ov = document.getElementById("ovRoles");
    function close() { mh.innerHTML = ""; }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("rlClose").addEventListener("click", close);
    document.getElementById("rlDone").addEventListener("click", close);
    document.getElementById("addRoleBtn").addEventListener("click", function () { openRoleModal(null); });
    ov.querySelectorAll("tbody tr[data-role-id]").forEach(function (tr) {
      function open() { var r = roleById(tr.getAttribute("data-role-id")); if (r) openRoleModal(r); }
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    });
  }

  function roleGridHtml(perms, locked) {
    return '<table class="perm-grid" id="rPermGrid"><thead><tr><th>Tela</th>' +
      ACTIONS.map(function (a) { return "<th>" + a.label + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      MODULES.map(function (m) {
        return "<tr><td><b>" + m.label + "</b>" + (m.hint ? "<small>" + m.hint + "</small>" : "") + "</td>" +
          ACTIONS.map(function (a) {
            var on = locked || !!(perms[m.key] && perms[m.key][a.key]);
            return '<td><input type="checkbox" data-m="' + m.key + '" data-a="' + a.key + '"' + (on ? " checked" : "") +
              (locked ? " disabled" : "") + ' aria-label="' + a.label + " em " + m.label + '"></td>';
          }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";
  }

  function openRoleModal(role) {
    var isNew = !role;
    var locked = !!(role && role.is_admin);
    var n = role ? users.filter(function (u) { return u.role_id === role.id; }).length : 0;
    var mh = document.getElementById("modalHost");
    mh.innerHTML =
      '<div class="overlay" id="ovRole"><div class="modal wide" style="max-width:560px">' +
        '<div class="modal-head"><div><h3>' + (isNew ? "Novo nível de permissão" : locked ? "Nível Administrador" : "Editar nível de permissão") + "</h3>" +
          '<div class="modal-sub">' + (locked
            ? "Acesso total, inclusive às telas de Usuários e Níveis de permissão. Este nível não pode ser alterado nem excluído."
            : "Marque o que este nível pode fazer em cada tela. Incluir, editar ou excluir marcam \"Ver\" junto.") + "</div></div>" +
          '<button class="modal-close" id="rClose" aria-label="Fechar">✕</button></div>' +
        '<div class="modal-body">' +
          '<div class="field"><label for="rName">Nome do nível</label><input id="rName" type="text" maxlength="40" value="' + esc(role ? role.name : "") + '"' + (locked ? " disabled" : "") + "></div>" +
          roleGridHtml(role ? (role.permissions || {}) : { agenda: { view: true }, pacientes: { view: true }, profissionais: { view: true }, salas: { view: true } }, locked) +
          (!isNew ? '<div class="pat-count">' + n + (n === 1 ? " usuário neste nível." : " usuários neste nível.") + "</div>" : "") +
        "</div>" +
        '<div class="modal-foot">' +
          (!isNew && !locked ? '<button class="btn danger" id="rDelete">Excluir nível</button>' : "<span></span>") +
          '<div class="spacer"></div>' +
          '<button class="btn ghost" id="rCancel">' + (locked ? "Fechar" : "Cancelar") + "</button>" +
          (locked ? "" : '<button class="btn primary" id="rSave">' + (isNew ? "Criar nível" : "Salvar") + "</button>") +
        "</div>" +
      "</div></div>";

    var ov = document.getElementById("ovRole");
    // Fechar o cadastro de um nível volta para a lista de níveis.
    function close() { openRolesModal(); }
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    document.getElementById("rClose").addEventListener("click", close);
    document.getElementById("rCancel").addEventListener("click", close);
    if (locked) return;

    var grid = document.getElementById("rPermGrid");
    grid.addEventListener("change", function (e) {
      var c = e.target;
      var m = c.getAttribute("data-m"), a = c.getAttribute("data-a");
      // Incluir/editar/excluir sem "ver" não faz sentido: marca "ver" junto;
      // desmarcar "ver" tira tudo daquela tela.
      if (a !== "view" && c.checked) {
        var v = grid.querySelector('input[data-m="' + m + '"][data-a="view"]');
        if (v) v.checked = true;
      }
      if (a === "view" && !c.checked) {
        grid.querySelectorAll('input[data-m="' + m + '"]').forEach(function (x) { x.checked = false; });
      }
    });
    function readPerms() {
      var p = normalizePerms({});
      grid.querySelectorAll("input[type=checkbox]").forEach(function (c) {
        p[c.getAttribute("data-m")][c.getAttribute("data-a")] = c.checked;
      });
      return p;
    }

    var saveBtn = document.getElementById("rSave");
    saveBtn.addEventListener("click", function () {
      var name = document.getElementById("rName").value.trim();
      if (!name) { toast("Informe o nome do nível.", true); document.getElementById("rName").focus(); return; }
      var clash = roles.filter(function (r) {
        return (!role || r.id !== role.id) && r.name.trim().toLowerCase() === name.toLowerCase();
      })[0];
      if (clash) { toast("Já existe um nível com esse nome.", true); return; }
      saveBtn.disabled = true;
      var q;
      if (isNew) {
        var base = slugify(name), id = base, i = 2;
        while (roleById(id)) id = base + "-" + (i++);
        q = auth.client.from("roles").insert({ id: id, name: name, permissions: readPerms() });
      } else {
        q = auth.client.from("roles").update({ name: name, permissions: readPerms() }).eq("id", role.id);
      }
      q.then(function (r) {
        if (r.error) {
          saveBtn.disabled = false;
          var m = /duplicate|unique|roles_name_unique/i.test(r.error.message || "") ? "Já existe um nível com esse nome." : friendlyDbError(r.error);
          toast("Não foi possível salvar: " + m, true);
          return;
        }
        toast(isNew ? "Nível \"" + name + "\" criado." : "Nível \"" + name + "\" salvo.");
        reloadAll().then(openRolesModal);
      });
    });

    var delBtn = document.getElementById("rDelete");
    if (delBtn) delBtn.addEventListener("click", function () {
      if (n > 0) {
        toast("Este nível ainda tem " + n + (n === 1 ? " usuário. Mude-o" : " usuários. Mude-os") + " de nível no cadastro de usuários antes de excluir.", true);
        return;
      }
      confirmBox({
        title: "Excluir nível",
        message: "Excluir o nível de permissão <b>" + esc(role.name) + "</b>? Isso não pode ser desfeito.",
        confirmLabel: "Excluir nível"
      }).then(function (ok) {
        if (!ok) return;
        auth.client.from("roles").delete().eq("id", role.id).then(function (r) {
          if (r.error) { toast("Não foi possível excluir: " + friendlyDbError(r.error), true); return; }
          toast("Nível \"" + role.name + "\" excluído.");
          reloadAll().then(openRolesModal);
        });
      });
    });

    document.getElementById("rName").focus();
  }

  function renderAll() { renderUsers(); }

  /* ---------------- ligação com as abas ---------------- */
  function init() {
    injectStyles();
    // A tela de Usuários abre pelo menu "Acesso" do topo, que clica no botão
    // (oculto) da aba "usuarios" — ouvimos esse clique para carregar os dados.
    var tabs = document.getElementById("mainTabs");
    if (tabs) tabs.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-tab="usuarios"]');
      if (!b || !auth.isAdmin()) return;
      if (!(loaded.users && loaded.roles)) renderAll();
      reloadAll();
    });
    // Outro administrador criou/mudou/excluiu um nível: atualiza a lista.
    if (auth.onRoleChange) auth.onRoleChange(function () {
      if (loaded.roles && auth.isAdmin()) reloadAll();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
