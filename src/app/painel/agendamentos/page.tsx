import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { canManageAppointment } from "@/lib/rbac";
import { appointmentInclude, appointmentWhere, filtersToQuery, parseFilters } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Alert, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { FilterBar } from "@/components/filter-bar";
import { AppointmentStatusBadge, SyncBadge } from "@/components/status-badges";
import {
  cancelAppointmentAction, createAppointmentByStaffAction, rescheduleAppointmentAction, retrySyncAction, updateAppointmentAction,
} from "@/server/appointment-actions";

export const metadata = { title: "Agendamentos" };
const PAGE = 40;

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AppointmentsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const f = parseFilters(sp, one("q") ? "todos" : "mes");
  const page = Math.max(1, Number(one("pg")) || 1);
  const where = appointmentWhere(user, f);
  const settings = await getSettings();
  const staff = user.role !== "PSYCHOLOGIST";

  const [rows, total, segments, psychologists, detail] = await Promise.all([
    prisma.appointment.findMany({ where, include: appointmentInclude, orderBy: { startsAt: "asc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.appointment.count({ where }),
    prisma.schoolSegment.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.psychologist.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    one("ver")
      ? prisma.appointment.findFirst({ where: { id: one("ver"), ...appointmentWhere(user, { ...f, period: "todos", from: "2000-01-01", to: "2099-12-31", status: undefined, q: undefined, segmentId: undefined, psychologistId: undefined }) }, include: appointmentInclude })
      : null,
  ]);

  // horários livres (para remarcar / agendar pela equipe)
  const needSlots = Boolean(detail) || staff;
  const freeSlots = needSlots
    ? await prisma.availabilitySlot.findMany({
        where: { status: "AVAILABLE", startsAt: { gt: new Date() }, psychologist: { active: true, deletedAt: null } },
        include: { psychologist: { select: { name: true } }, segment: { select: { name: true } } },
        orderBy: { startsAt: "asc" },
        take: 400,
      })
    : [];

  const qs = (extra: Record<string, string>) => filtersToQuery(f, extra);
  const pages = Math.ceil(total / PAGE);
  const slotLabel = (s: (typeof freeSlots)[number], withSegment = true) =>
    `${withSegment ? `${s.segment.name} — ` : ""}${fmtDate(s.startsAt)} ${fmtTime(s.startsAt)} — ${s.psychologist.name}`;

  return (
    <>
      <PageHeader
        title="Agendamentos"
        description={`${total} agendamento(s) encontrado(s) no filtro atual.`}
        actions={
          staff && (
            <Button asChild variant="outline">
              <a href={`/api/export/appointments?${filtersToQuery(f)}`}><Download /> Exportar CSV (Excel)</a>
            </Button>
          )
        }
      />

      <FilterBar f={f} segments={segments} psychologists={psychologists} showPsychologist={user.role !== "PSYCHOLOGIST" || user.canViewOthers} action="/painel/agendamentos" />

      {staff && (
        <Card>
          <details>
            <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold text-primary"><Plus className="size-4" /> Novo agendamento pela equipe</summary>
            <CardContent>
              <ActionForm action={createAppointmentByStaffAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                <Field label="Horário disponível" className="sm:col-span-2">
                  <Select name="slotId" required>
                    <option value="">Selecione…</option>
                    {freeSlots.map((s) => <option key={s.id} value={s.id}>{slotLabel(s)}</option>)}
                  </Select>
                </Field>
                <Field label="Responsável"><Input name="guardianName" required /></Field>
                <Field label="Aluno(a)"><Input name="studentName" required /></Field>
                <Field label="Turma / série"><Input name="studentClass" maxLength={40} placeholder="Ex.: 7º ano B" /></Field>
                <Field label="Telefone"><Input name="phone" required /></Field>
                <Field label="E-mail"><Input name="email" type="email" required /></Field>
                <SubmitButton className="sm:w-fit">Criar agendamento</SubmitButton>
              </ActionForm>
            </CardContent>
          </details>
        </Card>
      )}

      {detail && (
        <Card className="border-primary/40">
          <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Agendamento {detail.code}</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href={`?${qs({})}`}>Fechar</Link></Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {[
                ["Segmento", detail.segment.name], ["Turma / série", detail.studentClass ?? "—"], ["Psicóloga", detail.psychologist.name],
                ["Data e horário", `${fmtDate(detail.startsAt)} · ${fmtTime(detail.startsAt)} às ${fmtTime(detail.endsAt)}`],
                ["Telefone", formatPhone(detail.phone)], ["E-mail", detail.email],
                ["Criado em", fmtDateTime(detail.createdAt)],
                ["Aceite da política", `${fmtDateTime(detail.consentAt)} (v${detail.consentVersion})`],
                ...(detail.cancelledAt ? [["Cancelado em", `${fmtDateTime(detail.cancelledAt)}${detail.cancelReason ? ` — ${detail.cancelReason}` : ""}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Google Agenda</h3>
              <ul className="space-y-2">
                {detail.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <span className="w-44 font-medium">{e.target === "TEAM" ? "Agenda geral da equipe" : "Agenda da psicóloga"}</span>
                    <SyncBadge status={e.status} />
                    {e.lastError && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={e.lastError}>{e.lastError}</span>}
                    {e.status !== "SYNCED" && e.status !== "CANCELLED" && (
                      <ActionForm action={retrySyncAction} className="ml-auto">
                        <input type="hidden" name="eventId" value={e.id} />
                        <SubmitButton size="sm" variant="outline" pendingText="Tentando…">Tentar novamente</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {canManageAppointment(user, detail, settings) && detail.status !== "CANCELLED" && (
              <div className="grid gap-6 lg:grid-cols-3">
                <ActionForm action={updateAppointmentAction} className="space-y-3 lg:col-span-1">
                  <h3 className="text-sm font-semibold">Editar dados e situação</h3>
                  <input type="hidden" name="appointmentId" value={detail.id} />
                  <Field label="Responsável"><Input name="guardianName" defaultValue={detail.guardianName} required /></Field>
                  <Field label="Aluno(a)"><Input name="studentName" defaultValue={detail.studentName} required /></Field>
                  <Field label="Turma / série"><Input name="studentClass" defaultValue={detail.studentClass ?? ""} maxLength={40} /></Field>
                  <Field label="Telefone"><Input name="phone" defaultValue={detail.phone} required /></Field>
                  <Field label="E-mail"><Input name="email" type="email" defaultValue={detail.email} required /></Field>
                  <Field label="Situação">
                    <Select name="status" defaultValue={detail.status}>
                      <option value="CONFIRMED">Confirmado</option><option value="COMPLETED">Realizado</option><option value="NO_SHOW">Não compareceu</option>
                    </Select>
                  </Field>
                  <SubmitButton size="sm">Salvar</SubmitButton>
                </ActionForm>

                <ActionForm action={rescheduleAppointmentAction} className="space-y-3">
                  <h3 className="text-sm font-semibold">Remarcar</h3>
                  <input type="hidden" name="appointmentId" value={detail.id} />
                  <Field label="Novo horário (mesmo segmento)">
                    <Select name="newSlotId" required>
                      <option value="">Selecione…</option>
                      {freeSlots.filter((s) => s.segmentId === detail.segmentId).map((s) => <option key={s.id} value={s.id}>{slotLabel(s, false)}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton size="sm" variant="outline">Remarcar</SubmitButton>
                </ActionForm>

                <ActionForm action={cancelAppointmentAction} className="space-y-3">
                  <h3 className="text-sm font-semibold text-destructive">Cancelar agendamento</h3>
                  <input type="hidden" name="appointmentId" value={detail.id} />
                  <Field label="Motivo (opcional)"><Textarea name="reason" maxLength={300} /></Field>
                  <SubmitButton size="sm" variant="destructive">Cancelar e liberar horário</SubmitButton>
                </ActionForm>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState>Nenhum agendamento encontrado para os filtros selecionados.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr><Th>Aluno</Th><Th>Turma</Th><Th>Responsável</Th><Th>Segmento</Th><Th>Psicóloga</Th><Th>Data</Th><Th>Horário</Th><Th>Status</Th><Th>Agenda Google</Th><Th /></tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const worst = a.events.find((e) => e.status === "FAILED") ?? a.events.find((e) => e.status === "PENDING") ?? a.events.find((e) => e.status === "SKIPPED") ?? a.events[0];
                return (
                  <tr key={a.id} className={a.status === "CANCELLED" ? "opacity-60" : ""}>
                    <Td className="font-medium">{a.studentName}</Td>
                    <Td className="whitespace-nowrap">{a.studentClass ?? "—"}</Td>
                    <Td>{a.guardianName}</Td>
                    <Td>{a.segment.name}</Td>
                    <Td>{a.psychologist.name}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(a.startsAt)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{fmtTime(a.startsAt)}</Td>
                    <Td><AppointmentStatusBadge status={a.status} /></Td>
                    <Td>{worst ? <SyncBadge status={worst.status} /> : "—"}</Td>
                    <Td><Link className="font-semibold text-primary hover:underline" href={`?${qs({ ver: a.id, ...(page > 1 ? { pg: String(page) } : {}) })}`}>Detalhes</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Paginação">
          {page > 1 && <Link className="font-semibold text-primary" href={`?${qs({ pg: String(page - 1) })}`}>← Anterior</Link>}
          <span className="text-muted-foreground">Página {page} de {pages}</span>
          {page < pages && <Link className="font-semibold text-primary" href={`?${qs({ pg: String(page + 1) })}`}>Próxima →</Link>}
        </nav>
      )}
      {user.role === "PSYCHOLOGIST" && !user.canViewOthers && <Alert>Você visualiza apenas os agendamentos da sua agenda.</Alert>}
    </>
  );
}
