# Central de Agendamento de Anamneses – Eccoprime

Sistema web para as psicólogas da Eccoprime liberarem horários e para as famílias agendarem a anamnese por um link público (`/agendar`), com banco PostgreSQL, controle de acesso por perfil, Google Agenda e e-mails.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · componentes no estilo shadcn/ui · Lucide · Prisma 6 · PostgreSQL · Google Calendar API · Nodemailer (SMTP) · Vitest.

## O que está pronto (e o que depende de configuração externa)

| Área | Situação |
|---|---|
| Página pública `/agendar` (5 etapas, calendário, resumo, tela de sucesso com código `ANA-XXXXXXXX`) | ✅ Funcional e testada no navegador |
| Reserva atômica, sem dupla marcação (UPDATE condicional + índice único parcial + `EXCLUDE` anti-sobreposição) | ✅ Testada com 20 reservas simultâneas no mesmo horário |
| Painéis: Administrador, Psicóloga, Atendimento/Coordenação (RBAC no servidor) | ✅ |
| Liberar disponibilidade (período, dias da semana com janelas próprias, duração, intervalo), datas específicas, bloqueios | ✅ |
| Cancelar / remarcar / editar / agendar pela equipe, com proteção de horários agendados | ✅ |
| Dashboard, filtros, relatórios, exportação CSV (abre no Excel) | ✅ |
| Auditoria, configurações (identidade visual, regras, retenção LGPD), política de privacidade | ✅ |
| **Google Agenda** (psicóloga + agenda geral, criar/atualizar/cancelar, sem duplicar, retentativas) | 🟡 Código completo e testado com a API simulada. **Precisa de credenciais OAuth** → `docs/GOOGLE_CALENDAR.md` |
| **E-mails** (confirmação, psicóloga, equipe, cancelamento, remarcação, lembretes) | 🟡 Código completo e testado com SMTP simulado. **Precisa de `SMTP_*`**. Sem SMTP, ficam na fila (nada se perde) |
| WhatsApp Business API | ⏳ Apenas a estrutura (`src/lib/whatsapp.ts`, canal `WHATSAPP` nas notificações); envio não implementado |

A interface avisa quando algo está aguardando configuração; nada é simulado em produção.

## Rodando localmente

Requisitos: Node 20+ (testado em 22). **Não precisa de Docker nem PostgreSQL instalado** — há um Postgres embutido para desenvolvimento.

```bash
npm install
cp .env.example .env            # preencha; para segredos: npm run gen:secrets
npm run dev:db                  # terminal 1: PostgreSQL local na porta 5433 (deixe aberto)
# no .env:  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/anamneses_dev?schema=public"
npx prisma migrate deploy       # cria as tabelas e constraints
SEED_DEMO=true npm run db:seed  # segmentos, admin e (opcional) psicólogas/horários de demonstração
npm run dev                     # http://localhost:3000  → /agendar  e  /login
```

Contas de demonstração (só com `SEED_DEMO=true`, **nunca em produção**): `ana.demo@eccoprime.test`, `bruna.demo@eccoprime.test`, `atendimento.demo@eccoprime.test` (senha `Demo12345678`). O administrador é criado com `SEED_ADMIN_EMAIL` (senha aleatória impressa uma vez se `SEED_ADMIN_PASSWORD` não for definida).

### Testes
```bash
npm run dev:db        # banco local no ar
npm test              # 29+ testes; cria/usa o banco "anamneses_test" e aplica as migrations reais
npm run lint          # checagem de tipos (tsc)
```
Cobrem: reserva concorrente, constraints do banco, cancelamento/remarcação, fuso America/Recife, geração de horários, sincronização Google (falha, retentativa, 409, troca de psicóloga, revogação), e-mails (backoff, concorrência, escape de HTML), lembretes, retenção LGPD, RBAC, limitação de tentativas, criptografia e validações.

## Publicação
Veja **`docs/DEPLOY.md`** (Render: Web Service + PostgreSQL + Cron, migrations, domínio/HTTPS, backup/restauração). Arquitetura e regras: **`docs/ARQUITETURA.md`**.

## Estrutura
```
prisma/            schema.prisma, migrations/ (inclui constraints parciais/EXCLUDE), seed.ts
src/app/           /agendar, /privacidade, /login, /painel/*, /api/{health,public,google,cron,export}
src/components/    ui/ (estilo shadcn), booking/ (assistente público), painel
src/lib/           booking, slots, time, calendar-sync, google, notifications, mail, rbac, auth, settings…
src/server/        Server Actions (auth, admin, disponibilidade, agendamentos, configurações)
tests/             vitest (usa PostgreSQL real)
render.yaml        Blueprint do Render
```
