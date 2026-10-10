// Entrada da Edge Function "pipo-mcp" (publicar com --no-verify-jwt: o próprio servidor confere o
// login e responde 401 com o endereço do servidor de login, como o MCP pede).
import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { createHandler } from "./app.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// chave pública (anon/publishable): o acesso de verdade vem do token da pessoa
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("PIPO_PUBLISHABLE_KEY")!;
const PUBLIC_URL = (Deno.env.get("PIPO_MCP_URL") || `${SUPABASE_URL}/functions/v1/pipo-mcp`).replace(/\/$/, "");

const handler = createHandler({
  publicUrl: PUBLIC_URL,
  authServer: `${SUPABASE_URL}/auth/v1`,
  // Ferramentas de escrita só com PIPO_MCP_ESCRITA=1 (publicação em duas etapas: leitura primeiro)
  escrita: Deno.env.get("PIPO_MCP_ESCRITA") === "1",
  db(token) {
    const sb = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      async user() {
        const { data, error } = await sb.auth.getUser(token);
        return error || !data?.user ? null : data.user.id;
      },
      async rpc(fn, args) {
        const { data, error } = await sb.rpc(fn, args);
        return { data, error: error ? { message: error.message } : null };
      },
    };
  },
});

Deno.serve(handler);
