// Entrega ao navegador a URL do projeto Supabase e a chave pública (anon).
// A chave anon é pública por definição — a segurança dos dados vem do RLS
// no banco (supabase/schema.sql). A service role key NUNCA sai daqui.
module.exports = function handler(req, res) {
  var url = process.env.SUPABASE_URL;
  var anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    res.status(500).json({ error: "SUPABASE_URL / SUPABASE_ANON_KEY não configuradas na Vercel." });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ supabaseUrl: url, supabaseAnonKey: anonKey });
};
