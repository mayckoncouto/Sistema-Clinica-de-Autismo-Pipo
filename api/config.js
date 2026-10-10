// Entrega ao navegador a URL do projeto Supabase e a chave pública (anon).
// A chave anon é pública por definição — a segurança dos dados vem do RLS
// no banco (supabase/schema.sql). A service role key NUNCA sai daqui.
// Também entrega a cor dos botões da clínica (config/clinic → corBotoes /
// corTexto), para a tela de login já sair na cor escolhida, e as redes sociais
// da clínica (config/clinic → redes: rede + link, informação pública), mostradas
// na tela de login e na página do link de cadastro. Só isso sai daqui; o resto
// do cadastro continua exigindo login.
var HEX = /^#[0-9a-fA-F]{6}$/;

var REDES = ["instagram", "facebook", "youtube", "tiktok", "whatsapp", "maps", "site", "linkedin", "email", "outro"];
function cleanRedes(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map(function (r) {
    var url = String((r && r.url) || "").trim().slice(0, 300);
    if (!url || /^(javascript|data|vbscript|file):/i.test(url)) return null;
    return { rede: REDES.indexOf(r.rede) >= 0 ? r.rede : "outro", nome: String(r.nome || "").trim().slice(0, 40), url: url };
  }).filter(Boolean);
}

async function clinicInfo(url) {
  var key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return undefined;
  var h = { apikey: key };
  if (!/^sb_/.test(key)) h.Authorization = "Bearer " + key;
  var ctrl = typeof AbortController === "function" ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 2500) : null;
  try {
    var r = await fetch(url + "/rest/v1/documents?path=eq.config%2Fclinic&select=data", { headers: h, signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return undefined;
    var rows = await r.json();
    var d = (rows && rows[0] && rows[0].data) || {};
    var c = HEX.test(String(d.corBotoes || "").trim()) ? String(d.corBotoes).trim() : null;
    var t = HEX.test(String(d.corTexto || "").trim()) ? String(d.corTexto).trim() : null;
    return { theme: c ? { corBotoes: c, corTexto: t } : null, redes: cleanRedes(d.redes) };
  } catch (e) {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  // Aceita a URL colada com sufixo (ex.: ".../rest/v1/") ou barra no fim.
  var url = (process.env.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
  var anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY não configuradas na Vercel." });
    return;
  }
  var out = { supabaseUrl: url, supabaseAnonKey: anonKey };
  var info = await clinicInfo(url);
  if (info !== undefined) { out.theme = info.theme; out.redes = info.redes; }
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json(out);
};
