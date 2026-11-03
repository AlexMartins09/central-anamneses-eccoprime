# Arquitetura e regras de negócio

## Visão geral
```
Família ──► /agendar (Next.js, Server Actions)         Equipe ──► /painel/* (RBAC no servidor)
                │                                               │
                └──────────────► Camada de domínio (src/lib) ◄──┘
                                  booking · slots · rbac · audit
                                         │
                         PostgreSQL (Prisma) ── fonte única da verdade
                         ├─ Appointment / AvailabilitySlot  (reserva atômica)
                         ├─ GoogleCalendarEvent  ┐ outbox: gravados na MESMA transação da reserva
                         └─ Notification         ┘
                                         │
        Cron do Render (5 min) ► /api/cron/process ► Google Calendar API · SMTP
```

## Modelo de dados (resumo)
`User` (perfil ADMIN/PSYCHOLOGIST/COORDINATION) · `Psychologist` · `SchoolSegment` · `PsychologistSegment` (N:N) · `AvailabilityRule` (regra recorrente) · `AvailabilitySlot` (horário concreto: AVAILABLE/BOOKED/BLOCKED) · `Appointment` · `GoogleCalendarConnection` (tokens criptografados) · `GoogleCalendarEvent` · `Notification` · `AuditLog` · `SystemSetting` · `LoginAttempt`.
Todas as tabelas têm `createdAt/updatedAt`, chaves `cuid`, integridade referencial (`Restrict` onde há histórico) e índices pelas consultas principais. Exclusão lógica (`deletedAt`/`active`) em usuários, psicólogas e segmentos.

## Como a dupla marcação é impossível
1. **UPDATE condicional atômico** dentro de uma transação: `UPDATE AvailabilitySlot SET status='BOOKED' WHERE id=? AND status='AVAILABLE'`. Requisições simultâneas esperam o lock da linha, reavaliam o `WHERE` e só uma recebe `count = 1`.
2. **Revalidação no backend** na mesma transação: horário no futuro, antecedência mínima e janela máxima, segmento coerente, psicóloga ativa, família sem outro agendamento ativo do mesmo aluno.
3. **Índices únicos parciais** em `Appointment` (`slotId` e `psychologistId+startsAt` onde `status <> 'CANCELLED'`) — rede de segurança no banco.
4. **Constraint `EXCLUDE USING gist`** impede horários sobrepostos da mesma psicóloga.
5. Tudo em `America/Recife` na apresentação e nas regras; no banco, `timestamptz` UTC.

## Perfis
| | Administrador | Psicóloga | Atendimento/Coordenação |
|---|---|---|---|
| Agendamentos | todos; criar/editar/cancelar/remarcar | só os seus (ou todos se autorizada) | todos; cancelar/remarcar se habilitado em Configurações |
| Disponibilidade | de qualquer psicóloga | a própria | somente leitura (agenda) |
| Psicólogas, segmentos, usuários, configurações, auditoria | ✅ | — | — |
| Relatórios e exportação CSV | ✅ | — | ✅ |
| Google Agenda | agenda geral + visão geral | a própria conta | — |

A checagem é feita **no servidor** em cada página, Server Action e rota de API (o menu apenas reflete essas regras). O `middleware` só barra requisições sem sessão válida.

## Segurança
- Senhas: `bcrypt` (custo 12), política mínima de 10 caracteres com maiúscula/minúscula/número. Comparação de hash mesmo para e-mail inexistente (evita enumeração).
- Sessão: JWT HS256 em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, 8 h; a cada requisição o usuário é revalidado no banco (desativar vale na hora).
- Limitação de tentativas persistida no banco: login (5 falhas/15 min por e-mail, 20 por IP) e agendamentos públicos (8/h por IP) + campo *honeypot*.
- CSRF: mutações só por Server Actions (verificação de `Origin` nativa do Next) e cookies `SameSite=Lax`; rotas GET não alteram estado; o cron exige `Authorization: Bearer CRON_SECRET` (comparação em tempo constante).
- SQL Injection: acesso exclusivo via Prisma (consultas parametrizadas). XSS: React escapa por padrão; e-mails escapam HTML manualmente.
- Cabeçalhos: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Exportação CSV neutraliza injeção de fórmulas do Excel e é registrada na auditoria.
- Segredos só em variáveis de ambiente; tokens do Google criptografados (AES-256-GCM).

## LGPD
- Minimização: coleta apenas responsável, aluno, telefone, e-mail, segmento/horário. **Sem dados clínicos**; eventos do Google só com dados administrativos.
- Consentimento específico do responsável legal (art. 14), com data/hora, versão da política e IP gravados.
- Política de privacidade pública (`/privacidade`) — **texto-modelo, a ser revisado pelo jurídico/encarregado da escola**.
- Retenção: anonimização automática após `retentionMonths` (padrão 24) pelo worker; e-mails antigos apagados após 90 dias; botão manual em Configurações.
- Auditoria de ações administrativas, logins e exportações.

## Pendências conscientes / próximos passos
- **Credenciais externas** (Google OAuth, SMTP) — ver `docs/GOOGLE_CALENDAR.md` e `docs/DEPLOY.md`.
- **WhatsApp Business API**: apenas estrutura pronta.
- Família não tem (ainda) link de autoatendimento para cancelar/remarcar; hoje isso é feito pela escola.
- Política de CSP estrita não configurada (o Next injeta scripts inline); avaliar com *nonces* se exigido.
- Recuperação de senha por e-mail não implementada: o administrador redefine senhas em Psicólogas/Usuários.
- Teste de carga e testes E2E automatizados de interface (o fluxo foi validado manualmente no navegador).
