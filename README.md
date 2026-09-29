# Sistema Clínica de Autismo Pipo — Agenda Pipo

Sistema web de agendamento de atendimentos da Clínica de Autismo Pipo: grade semanal por sala/terapeuta/paciente, cadastros de pacientes, profissionais, salas, convênios e especialidades, e relatório de atendimentos. Login por e-mail e senha, com permissões por módulo.

**Hospedagem:** Vercel (site estático + 2 funções serverless) · **Banco e login:** Supabase

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | O app inteiro (HTML + CSS + JS). |
| `js/pipo-supabase.js` | Login, sessão, permissões e acesso ao banco (Supabase + Realtime). |
| `js/usuarios.js` | Aba **Usuários** (só administradores). |
| `api/config.js` | Entrega ao navegador a URL e a chave pública do Supabase. |
| `api/admin-users.js` | Criar/excluir usuário, trocar senha, ativar/desativar (usa a chave secreta). |
| `supabase/schema.sql` | Tabelas, regras de segurança (RLS), permissões e Realtime. |
| `tests/` | Testes automatizados (Playwright) com dados fictícios. |

## Implantação (uma vez)

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com) (região **South America (São Paulo)**).
2. **SQL Editor → New query**: cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. (Migração) Rode também o arquivo de importação dos dados reais, que **não** fica no repositório.
4. **Authentication → Sign In / Providers**: desligue **Allow new users to sign up** (só o administrador cria contas). Mantenha o provedor **Email** ligado.
5. **Authentication → Users → Add user → Create new user**: crie a sua conta (marque *Auto Confirm User*). **O primeiro usuário criado vira administrador.**
6. **Project Settings → API**: anote a *Project URL*, a chave **anon public** e a **service_role** (secreta).

### 2. Vercel
1. Em [vercel.com](https://vercel.com): **Add New → Project** → importe este repositório do GitHub.
2. Framework Preset: **Other**. Não precisa de comando de build.
3. **Environment Variables**:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = chave anon public
   - `SUPABASE_SERVICE_ROLE_KEY` = chave service_role (**nunca** exponha no navegador nem no código)
4. **Deploy**. Depois disso, todo `git push` na branch `main` publica sozinho.
5. No Supabase, em **Authentication → URL Configuration**, coloque o endereço da Vercel em *Site URL*.

## Testes

Precisam de Node.js e do Playwright:

```bash
npm install
npx playwright install chromium
npm test
```

## Dados

Este repositório contém apenas código e dados de teste fictícios. Os dados reais da clínica ficam somente no Supabase.
