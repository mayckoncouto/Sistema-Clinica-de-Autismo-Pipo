---
name: backup-diario
description: Backup diário automático do sistema (19h de Brasília) para a pasta "Sistema Backup" do Google Drive. Use para conferir, rodar na hora ou mudar o backup automático.
---
# Backup diário automático

- Função: `api/backup-diario.js`; agendamento em `vercel.json` (`crons`, `0 22 * * *` = 19:00 de Brasília).
- Gera `backup-agenda-pipo-AAAA-MM-DD-HHMM.json.gz` (mesmo formato do Backup do menu Acesso, compactado) na pasta
  `BACKUP_DRIVE_FOLDER` (padrão `18aK9o4AlwOfeLufSpCKjif6YA7p3wrKa`) e manda para a lixeira os automáticos com mais de `BACKUP_KEEP_DAYS` (30).
- Variáveis na Vercel: `CRON_SECRET` (obrigatória), `GOOGLE_SERVICE_ACCOUNT_JSON`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- A pasta precisa estar no Drive compartilhado em que a conta de serviço é membro (conta de serviço não tem espaço próprio).
- Rodar na hora: `curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/backup-diario`. Restaurar: descompactar e usar Acesso → Backup → Restaurar.
- O arquivo tem dados de saúde: nunca versionar nem enviar por canal aberto. Teste: `node tests/run_backup_diario.js`.
