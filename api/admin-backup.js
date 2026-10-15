// Cópia de segurança — restaurar (só administradores ativos).
//
// Baixar a cópia é feito no próprio navegador (o Administrador lê tudo pelo
// RLS). Restaurar passa por aqui porque precisa da service role key: grava
// com os ids, datas e autores originais, sem esbarrar nas regras de permissão
// que valem para quem usa o app (os triggers deixam passar quando não há
// usuário logado — ver supabase/2026-10-03-copia-de-seguranca.sql).
//
// POST /api/admin-backup   Authorization: Bearer <access_token do usuário>
//   { action: "restore", table: "documents" | "appointments" | "clinical_records" | "patient_health" | "treatment_finance" | "convenio_finance" | "bank_account_finance" | "finance_entries" | "finance_statement_lines" | "finance_loans" | "finance_payables" | "staff" | "staff_pay" | "therapy_plans" | "tasks" | "task_events" | "intake_links" | "intake_submissions", rows: [...] }
//
// Só acrescenta ou sobrescreve (upsert): nada que foi criado depois da cópia
// é apagado. O app manda as linhas em lotes pequenos (limite de 4,5 MB da Vercel).

var SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
var SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Mesmo tratamento dos dois formatos de chave de api/admin-users.js.
function adminHeaders() {
  var h = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!/^sb_/.test(SERVICE_KEY)) h.Authorization = "Bearer " + SERVICE_KEY;
  return h;
}

async function call(path, opts) {
  var r = await fetch(SUPABASE_URL + path, opts);
  var text = await r.text();
  var body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body: body };
}

function errMsg(resp, fallback) {
  var b = resp.body || {};
  return b.msg || b.message || b.error_description || b.error || b.details || fallback;
}

async function currentAdmin(req) {
  var auth = req.headers.authorization || "";
  var token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  var me = await call("/auth/v1/user", {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + token }
  });
  if (!me.ok || !me.body || !me.body.id) return null;
  var prof = await call(
    "/rest/v1/profiles?select=id,active,role:roles(is_admin,is_manager)&id=eq." + encodeURIComponent(me.body.id),
    { headers: adminHeaders() }
  );
  var row = prof.ok && Array.isArray(prof.body) ? prof.body[0] : null;
  if (!row || !row.active || !row.role || !row.role.is_manager) return null;
  return row;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

// Colunas aceitas por tabela (o resto do arquivo é ignorado) e a chave do upsert.
// Colunas de usuário apontam para auth.users: usuário que não existe mais vira null.
var TABLES = {
  documents: {
    key: "path,unit_id",
    cols: ["unit_id", "path", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  appointments: {
    key: "id",
    cols: ["unit_id", "id", "date", "time", "professional_id", "room_id", "patient", "note", "blocked", "service",
           "source", "status", "patient_id", "group_id", "created_by", "updated_by", "created_at", "updated_at"],
    users: ["created_by", "updated_by"]
  },
  patient_health: {
    key: "patient_id",
    cols: ["unit_id", "patient_id", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  treatment_finance: {
    key: "treatment_id",
    cols: ["unit_id", "treatment_id", "valor", "descontos", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  convenio_finance: {
    key: "id",
    cols: ["id", "convenio_id", "spec_id", "valor", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  bank_account_finance: {
    key: "account_id",
    cols: ["unit_id", "account_id", "saldo_inicial", "data_saldo", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  finance_entries: {
    key: "id",
    cols: ["unit_id", "id", "account_id", "data", "descricao", "plan_id", "valor", "data_extrato", "valor_extrato", "obs", "origem_key",
           "created_at", "created_by", "updated_at", "updated_by"],
    users: ["created_by", "updated_by"]
  },
  finance_statement_lines: {
    key: "id",
    cols: ["unit_id", "id", "account_id", "data", "descricao", "valor", "doc", "key", "entry_id", "matched_at", "matched_by", "created_at", "created_by"],
    users: ["matched_by", "created_by"]
  },
  treatment_sales: {
    key: "id",
    cols: ["unit_id", "id", "treatment_id", "patient_id", "tipo", "data", "seller_id", "seller_name", "valor_mensal", "meses", "total", "forma", "status",
           "replaced_by", "obs", "created_at", "created_by", "created_by_name"],
    users: ["created_by"]
  },
  finance_loans: {
    key: "id",
    cols: ["unit_id", "id", "sentido", "descricao", "contraparte", "supplier_id", "account_id", "valor", "tipo", "taxa", "parcelas", "liberacao",
           "primeiro_venc", "obs", "created_at", "created_by", "updated_at", "updated_by"],
    users: ["created_by", "updated_by"]
  },
  finance_payables: {
    key: "id",
    cols: ["unit_id", "id", "vencimento", "descricao", "plan_id", "account_id", "supplier_id", "valor", "entry_id", "grupo", "parcela", "parcelas",
           "obs", "linhas", "loan_id", "staff_id", "abate_id", "sale_id", "created_at", "created_by", "updated_at", "updated_by"],
    users: ["created_by", "updated_by"]
  },
  staff: {
    key: "id",
    cols: ["unit_id", "id", "professional_id", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  staff_pay: {
    key: "staff_id",
    cols: ["unit_id", "staff_id", "data", "updated_at", "updated_by"],
    users: ["updated_by"]
  },
  therapy_plans: {
    key: "id",
    cols: ["unit_id", "id", "patient_id", "patient_name", "version", "status", "plan_date", "review_date", "summary", "sections",
           "prev_id", "created_by", "created_by_name", "created_at", "updated_by", "updated_by_name", "updated_at"],
    users: ["created_by", "updated_by"]
  },
  clinical_records: {
    key: "id",
    cols: ["unit_id", "id", "patient_id", "patient_name", "appointment_id", "appointment_date", "appointment_time",
           "professional_id", "author_id", "author_name", "content", "plan_goals", "created_at", "updated_at"],
    users: ["author_id"]
  },
  // CRM e links de cadastro: gravados pela função backup_restore_crm (supabase/2026-10-10v),
  // que mantém datas e autores originais e não refaz o histórico das tarefas.
  tasks: {
    key: "id", rpc: true,
    cols: ["id", "list_id", "status", "title", "description", "priority", "due_date", "assignees", "tags", "patient_id",
           "lead", "position", "created_by", "created_by_name", "created_at", "updated_at", "closed_at", "recurrence"],
    users: ["created_by"], userLists: ["assignees"]
  },
  task_events: {
    key: "id", rpc: true,
    cols: ["id", "task_id", "kind", "body", "data", "mentions", "author_id", "author_name", "created_at", "edited_at"],
    users: ["author_id"], userLists: ["mentions"]
  },
  intake_links: {
    key: "token", rpc: true,
    cols: ["token", "kind", "patient_id", "task_id", "nome", "telefone", "prefill", "created_by", "created_by_name",
           "created_at", "expires_at", "used_at", "canceled_at", "reminded_at"],
    users: ["created_by"]
  },
  intake_submissions: {
    key: "id", rpc: true,
    cols: ["id", "token", "kind", "patient_id", "task_id", "data", "status", "created_at", "reviewed_by",
           "reviewed_by_name", "reviewed_at", "result_patient_id"],
    users: ["reviewed_by"]
  }
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas na Vercel." });
    return;
  }
  var admin = await currentAdmin(req);
  if (!admin) {
    res.status(403).json({ error: "Apenas administradores podem restaurar a cópia de segurança." });
    return;
  }
  var body = await readJson(req);
  if (body.action !== "restore") { res.status(400).json({ error: "Ação desconhecida." }); return; }
  var cfg = TABLES[body.table];
  if (!cfg) { res.status(400).json({ error: "Tabela inválida." }); return; }
  var rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) { res.status(200).json({ ok: true, count: 0 }); return; }

  try {
    // Usuários que existem hoje (todo usuário do Auth tem perfil).
    var users = await call("/rest/v1/profiles?select=id", { headers: adminHeaders() });
    if (!users.ok) { res.status(500).json({ error: "Não foi possível ler os usuários: " + errMsg(users, "") }); return; }
    var known = {};
    (users.body || []).forEach(function (u) { known[u.id] = true; });

    var clean = [];
    rows.forEach(function (r) {
      if (!r || typeof r !== "object" || r[cfg.key.split(",")[0]] == null || r[cfg.key.split(",")[0]] === "") return;
      // Cópias anteriores a 2026-10-07: coluna "despesas" virou "descontos".
      if (body.table === "treatment_finance" && r.descontos === undefined && r.despesas !== undefined) r = Object.assign({}, r, { descontos: r.despesas });
      var o = {};
      cfg.cols.forEach(function (c) { if (Object.prototype.hasOwnProperty.call(r, c)) o[c] = r[c]; });
      cfg.users.forEach(function (c) { if (o[c] && !known[o[c]]) o[c] = null; });
      (cfg.userLists || []).forEach(function (c) { if (Array.isArray(o[c])) o[c] = o[c].filter(function (u) { return known[u]; }); });
      clean.push(o);
    });
    if (cfg.rpc) {
      var rp = await call("/rest/v1/rpc/backup_restore_crm", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ p_table: body.table, p_rows: clean })
      });
      if (!rp.ok) {
        var m = errMsg(rp, "Não foi possível gravar.");
        if (/backup_restore_crm/.test(String(m))) m = "Falta rodar no banco o SQL 2026-10-10v (restaurar o CRM).";
        res.status(400).json({ error: m }); return;
      }
      res.status(200).json({ ok: true, count: typeof rp.body === "number" ? rp.body : clean.length });
      return;
    }
    // PostgREST exige as mesmas colunas em todas as linhas de um upsert em lote:
    // linhas com conjuntos de colunas diferentes vão em envios separados (sem
    // inventar null, que quebraria colunas obrigatórias).
    var groups = {};
    clean.forEach(function (o) { var k = Object.keys(o).sort().join(","); (groups[k] = groups[k] || []).push(o); });
    var keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      var up = await call("/rest/v1/" + body.table + "?on_conflict=" + cfg.key, {
        method: "POST",
        headers: Object.assign(adminHeaders(), { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(groups[keys[i]])
      });
      if (!up.ok) { res.status(400).json({ error: errMsg(up, "Não foi possível gravar.") }); return; }
    }
    res.status(200).json({ ok: true, count: clean.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
