// Backup: restaurar o CRM vai pela função backup_restore_crm e limpa usuários que não existem mais.
process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_teste";
const calls = [];
global.fetch = async (url, opts) => {
  calls.push({ url, opts });
  let body = null;
  if (url.endsWith("/auth/v1/user")) body = { id: "u-admin" };
  else if (url.includes("/rest/v1/profiles?select=id,active")) body = [{ id: "u-admin", active: true, role: { is_admin: true } }];
  else if (url.includes("/rest/v1/profiles?select=id")) body = [{ id: "u-admin" }, { id: "u-ok" }];
  else if (url.includes("/rpc/backup_restore_crm")) body = 2;
  else body = null;
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
const handler = require("../api/admin-backup.js");
function run(payload) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); } };
    handler({ method: "POST", headers: { authorization: "Bearer tk" }, body: payload }, res);
  });
}
(async () => {
  let ok = true; const check = (label, v) => { console.log(label, v); if (!v) ok = false; };
  const r = await run({ action: "restore", table: "tasks", rows: [
    { id: "t1", list_id: "a", status: "s", title: "T", created_by: "u-sumiu", assignees: ["u-ok", "u-sumiu"], extra: 1 },
    { id: "t2", list_id: "a", status: "s", title: "T2", created_by: "u-ok", assignees: [] }] });
  check("tasks restore ok?", r.code === 200 && r.body.count === 2);
  const rpc = calls.find((c) => c.url.includes("/rpc/backup_restore_crm"));
  check("went through backup_restore_crm?", !!rpc);
  const sent = JSON.parse(rpc.opts.body);
  check("table name sent?", sent.p_table === "tasks");
  check("unknown author becomes null?", sent.p_rows[0].created_by === null);
  check("unknown assignee removed?", JSON.stringify(sent.p_rows[0].assignees) === '["u-ok"]');
  check("unknown column dropped?", !("extra" in sent.p_rows[0]));
  calls.length = 0;
  const r2 = await run({ action: "restore", table: "appointments", rows: [{ id: "a1", date: "2026-10-10" }] });
  check("appointments still use upsert?", r2.code === 200 && calls.some((c) => c.url.includes("/rest/v1/appointments?on_conflict=id")));
  const r3 = await run({ action: "restore", table: "profiles", rows: [{ id: "x" }] });
  check("profiles cannot be restored?", r3.code === 400);
  console.log("no JS errors?", true);
  process.exit(ok ? 0 : 1);
})();
