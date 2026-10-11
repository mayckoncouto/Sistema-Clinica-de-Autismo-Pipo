# pipo-push — notificações do sistema (Web Push)

Envia os avisos de **Acesso → Notificações**: tarefas vencidas do CRM (resumo às 8h de Brasília,
segunda a sexta) e @menção em comentário (na hora, só para quem foi mencionado).

- `webpush.ts` — envio sem biblioteca (WebCrypto): criptografia RFC 8291 (aes128gcm) e VAPID (RFC 8292).
- `app.ts` — pedidos aceitos (POST JSON):
  - `{acao: "chave"}` → chave pública VAPID (o par é criado no 1º uso e guardado em `public.push_config`;
    a chave privada nunca sai do servidor);
  - `{acao: "teste"}` com o login da pessoa → aviso de teste para os aparelhos dela;
  - `{tipo: "mencao", evento}` e `{tipo: "vencidas"}` → só com o cabeçalho `x-pipo-push` = `push_config.secret`
    (quem chama é o banco: gatilho `task_events_push` e o agendamento `pipo-push-vencidas` do pg_cron).
- `index.ts` — entrada no Supabase (usa a chave de serviço do próprio projeto). Aparelho que o serviço de push
  diz que não existe mais (404/410) é apagado; 10 falhas seguidas também.

Banco: migração `supabase/2026-10-11-notificacoes.sql` (tabelas `push_subscriptions` e `push_config`,
`push_call`, gatilho, `push_mention_targets`, `push_overdue_counts`, agendamento).

Publicar: função `pipo-push` com **verify_jwt desligado** (o banco chama com a senha interna; o teste
confere o login dentro da função). Opcional: secret `PIPO_PUSH_SUBJECT` (padrão, o endereço do sistema).

Teste local (servidor de push falso que decifra a mensagem com outra biblioteca):

    NO_PROXY=127.0.0.1,localhost deno run -A --no-lock --config supabase/functions/pipo-push/deno.json supabase/functions/pipo-push/teste_local.ts
