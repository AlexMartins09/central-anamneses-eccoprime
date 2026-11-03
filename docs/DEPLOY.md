# Publicação no Render

Tudo que o sistema grava fica no **PostgreSQL gerenciado do Render** — nada importante é guardado no disco do servidor, então reinícios e novos deploys não perdem dados.

## 1. Pré-requisitos
- Repositório no GitHub/GitLab com este projeto (`git init`, commit, push). O arquivo `.env` **não** é versionado.
- Conta no Render.
- Para o Google Agenda: siga `docs/GOOGLE_CALENDAR.md` (pode ser feito depois; o sistema funciona sem, e os eventos ficam como “aguardando conexão”).
- Para e-mails: uma conta SMTP (Google Workspace com senha de app, Brevo, Amazon SES, Mailgun etc.).

## 2. Criar tudo com o Blueprint (recomendado)
1. Render Dashboard → **New → Blueprint** → selecione o repositório. O arquivo `render.yaml` cria:
   - **PostgreSQL** `anamneses-db`;
   - **Web Service** `central-anamneses` (build, health check `/api/health`, HTTPS automático);
   - **Cron Job** `central-anamneses-worker` (a cada 5 min: reenvia falhas do Google, envia e-mails/lembretes, retenção LGPD).
2. Preencha as variáveis marcadas como “sync: false” (`APP_URL`, `GOOGLE_*`, `SMTP_*`, `MAIL_FROM`). `AUTH_SECRET`, `ENCRYPTION_KEY` e `CRON_SECRET` são gerados pelo Render.
3. No serviço **do worker**, defina também `APP_URL` (a mesma URL pública).
4. Confira os nomes dos planos no `render.yaml` com o que o painel do Render oferece hoje.

> **Plano do banco:** use um plano pago. O plano gratuito é apagado após um período e não oferece backups.

### Criação manual (sem Blueprint)
- **PostgreSQL**: New → PostgreSQL. Copie a **Internal Database URL**.
- **Web Service**: runtime Node 22 · Build: `npm ci --include=dev && npm run build` · Start: `npm start` · Health Check Path: `/api/health` · variáveis conforme `.env.example` (`DATABASE_URL` = Internal URL).
- **Cron Job**: schedule `*/5 * * * *` · comando: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/process"`.

## 3. Migrations (Prisma)
`npm start` executa `prisma migrate deploy` antes de iniciar o app; a primeira subida cria todas as tabelas, índices e constraints (inclusive as anti-conflito de horários). Novas versões aplicam apenas as migrations pendentes.
Uma migration nunca deve ser editada depois de publicada — crie uma nova com `npm run db:migrate` localmente.

## 4. Primeiro acesso (administrador)
Não precisa de Shell. A cada inicialização o `npm start` roda o seed, que cria os 4 segmentos, as configurações padrão e o administrador definido em `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` e `SEED_ADMIN_PASSWORD` (preencha no Render antes do primeiro deploy).
- Se `SEED_ADMIN_PASSWORD` ficar vazia, uma senha aleatória é **impressa uma única vez** nos *Logs* do serviço — copie e troque em *Minha conta*.
- O seed é idempotente: se o administrador já existir, nada é alterado (a senha nunca é sobrescrita).
- Depois do primeiro login, apague `SEED_ADMIN_PASSWORD` das variáveis do Render.
- Depois: cadastre as psicólogas (*Psicólogas*), associe-as aos segmentos (*Segmentos*), ajuste *Configurações* (identidade visual, e-mails da equipe, orientações) e peça que cada psicóloga libere suas disponibilidades.

## 5. Domínio personalizado e HTTPS
Serviço web → **Settings → Custom Domains → Add**. Crie o registro DNS indicado (CNAME para `*.onrender.com`). O certificado HTTPS é emitido e renovado automaticamente. Depois:
1. Atualize `APP_URL` para `https://agendamento.seudominio.com.br`;
2. Atualize a **URI de redirecionamento** no Google Cloud (`https://agendamento.seudominio.com.br/api/google/callback`);
3. O link para as famílias é `APP_URL/agendar`.

## 6. Logs e monitoramento
- Render → serviço → **Logs** (aplicação) e **Events** (deploys).
- O health check consulta o banco (`SELECT 1`); se falhar, o Render reinicia o serviço.
- Pendências de integração aparecem no próprio sistema: *Google Agenda* (fila de sincronização) e *Configurações* (e-mails com falha).
- O histórico de ações administrativas está em *Auditoria*.

## 7. Backup e recuperação
- **Automático:** planos pagos do Render PostgreSQL mantêm backups diários e (conforme o plano) recuperação para um ponto no tempo — veja *Database → Recovery*. Confirme a retenção do seu plano.
- **Manual (recomendado antes de mudanças grandes):**
  ```bash
  DATABASE_URL="<External Database URL>" npm run db:backup      # gera backups/anamneses-AAAAMMDD-HHMMSS.dump
  ```
  Guarde o arquivo fora do servidor. É necessário ter `pg_dump` instalado e liberar seu IP em *Database → Access Control*.
- **Restaurar** em um banco vazio (ou novo):
  ```bash
  pg_restore --clean --if-exists --no-owner -d "<URL do banco de destino>" backups/arquivo.dump
  ```
  Depois aponte `DATABASE_URL` para ele e faça o redeploy.
- Os backups contêm dados pessoais: armazene criptografados e com acesso restrito (LGPD).

## 8. Conectar ao banco de fora (diagnóstico)
Use a **External Database URL** em um cliente (psql, DBeaver) — exige liberar seu IP no *Access Control* do banco. Para desenvolvimento local, use o banco embutido: `npm run dev:db`.

## 9. Checklist de segurança antes de abrir às famílias
- [ ] `APP_URL` com `https://`.
- [ ] Senha do administrador trocada; contas de demonstração **não** existem em produção (`SEED_DEMO` nunca é usado).
- [ ] `ENCRYPTION_KEY` guardada em cofre (se for perdida, as psicólogas precisarão reconectar o Google).
- [ ] SMTP testado (faça um agendamento de teste e veja o e-mail chegar).
- [ ] Texto da Política de Privacidade (`src/app/privacidade/page.tsx`) revisado pelo jurídico/encarregado (DPO) da escola e canal de contato preenchido em *Configurações*.
- [ ] Plano de banco com backup ativo.
