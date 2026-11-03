import { CheckCircle2, Link2, Unplug, XCircle } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { googleConfig } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { SyncBadge } from "@/components/status-badges";
import { disconnectGoogleAction, setCalendarIdAction } from "@/server/settings-actions";
import { retrySyncAction } from "@/server/appointment-actions";

export const metadata = { title: "Google Agenda" };

type SP = Promise<Record<string, string | string[] | undefined>>;
type Conn = NonNullable<Awaited<ReturnType<typeof prisma.googleCalendarConnection.findFirst>>>;

function ConnectionCard({ title, description, conn, connectHref, canEdit, extra }: {
  title: string; description: string; conn: Conn | null; connectHref: string; canEdit: boolean; extra?: string;
}) {
  const ok = conn?.active;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Link2 className="size-4" /> {title}</CardTitle>
          <Badge variant={ok ? "success" : conn ? "danger" : "muted"}>{ok ? "Conectado" : conn ? "Reconexão necessária" : "Não conectado"}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conn && (
          <p className="flex items-center gap-2 text-sm">
            {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
            Conta: <strong>{conn.googleEmail}</strong> · desde {fmtDateTime(conn.createdAt)}
          </p>
        )}
        {conn?.lastError && <Alert variant="error">{conn.lastError}</Alert>}
        {conn && canEdit && (
          <ActionForm action={setCalendarIdAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="connectionId" value={conn.id} />
            <Field label="ID do calendário que receberá os eventos" hint={extra ?? 'Use "primary" para a agenda principal da conta, ou o ID de um calendário compartilhado (ex.: abc123@group.calendar.google.com).'}>
              <Input name="calendarId" defaultValue={conn.calendarId} />
            </Field>
            <SubmitButton size="sm" variant="outline" pendingText="Testando…">Validar e salvar</SubmitButton>
          </ActionForm>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={conn ? "outline" : "default"}><a href={connectHref}>{conn ? "Reconectar conta Google" : "Conectar conta Google"}</a></Button>
            {conn && (
              <ActionForm action={disconnectGoogleAction}>
                <input type="hidden" name="connectionId" value={conn.id} />
                <SubmitButton size="sm" variant="ghost" pendingText="…"><Unplug /> Desconectar</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function GooglePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser(["ADMIN", "PSYCHOLOGIST"]);
  const sp = await searchParams;
  const cfg = googleConfig();
  const settings = await getSettings();

  const [team, mine, psychologists, problems, counts] = await Promise.all([
    prisma.googleCalendarConnection.findFirst({ where: { kind: "TEAM" } }),
    user.psychologistId ? prisma.googleCalendarConnection.findFirst({ where: { kind: "PSYCHOLOGIST", psychologistId: user.psychologistId } }) : null,
    user.role === "ADMIN" ? prisma.psychologist.findMany({ where: { deletedAt: null, active: true }, include: { connections: true }, orderBy: { name: "asc" } }) : [],
    prisma.googleCalendarEvent.findMany({
      where: {
        status: { in: ["FAILED", "PENDING", "SKIPPED"] },
        appointment: { status: { not: "CANCELLED" }, startsAt: { gt: new Date() }, ...(user.role === "PSYCHOLOGIST" ? { psychologistId: user.psychologistId! } : {}) },
      },
      include: { appointment: { include: { segment: true, psychologist: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.googleCalendarEvent.groupBy({ by: ["status"], _count: true }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Google Agenda" description="Cada agendamento é enviado à agenda da psicóloga responsável e à agenda geral da equipe." />

      {sp.ok && <Alert variant="success">Conta Google conectada com sucesso.</Alert>}
      {sp.erro && <Alert variant="error">{String(sp.erro)}</Alert>}
      {!cfg.configured && (
        <Alert variant="warning">
          <strong>Integração ainda não configurada no servidor.</strong> Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (veja docs/GOOGLE_CALENDAR.md).
          Enquanto isso os agendamentos funcionam normalmente e os eventos ficam na fila como “Aguardando conexão”.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {user.role === "PSYCHOLOGIST" && (
          <ConnectionCard title="Minha agenda Google" description="Os atendimentos agendados com você aparecerão nesta agenda." conn={mine} connectHref="/api/google/connect?kind=psychologist" canEdit={cfg.configured} />
        )}
        <ConnectionCard
          title="Agenda geral da equipe"
          description="Recebe todos os agendamentos, para a equipe de atendimento acompanhar."
          conn={team}
          connectHref="/api/google/connect?kind=team"
          canEdit={user.role === "ADMIN" && cfg.configured}
          extra={`Atual: ${settings.teamCalendarId}. Compartilhe o calendário com a conta conectada (permissão “Fazer alterações em eventos”).`}
        />
      </div>

      {user.role === "ADMIN" && (
        <Card>
          <CardHeader><CardTitle>Psicólogas conectadas</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {psychologists.map((p) => {
                const c = p.connections[0];
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="font-medium">{p.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {c ? c.googleEmail : "—"}
                      <Badge variant={c?.active ? "success" : c ? "danger" : "muted"}>{c?.active ? "Conectada" : c ? "Reconectar" : "Não conectada"}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fila de sincronização</CardTitle>
          <CardDescription>{n("SYNCED")} sincronizados · {n("PENDING")} pendentes · {n("SKIPPED")} aguardando conexão · {n("FAILED")} com falha. Falhas são reenviadas automaticamente a cada 5 minutos.</CardDescription>
        </CardHeader>
        <CardContent>
          {problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência. Tudo sincronizado.</p>
          ) : (
            <ul className="divide-y text-sm">
              {problems.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-36 font-medium">{e.appointment.code}</span>
                  <span className="text-muted-foreground">{e.target === "TEAM" ? "Equipe" : e.appointment.psychologist.name}</span>
                  <SyncBadge status={e.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={e.lastError ?? ""}>{e.lastError}</span>
                  <ActionForm action={retrySyncAction}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <SubmitButton size="sm" variant="outline" pendingText="…">Tentar novamente</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
