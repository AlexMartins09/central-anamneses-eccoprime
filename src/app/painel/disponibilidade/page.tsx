import Link from "next/link";
import { Ban, CalendarPlus, Lock, Trash2, Unlock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { DATE_KEY_RE, addDaysKey, dateKey, endOfLocalDay, fmtLongDate, fmtTime, minutesToHHmm, startOfLocalDay, todayKey, WEEKDAY_LABELS } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { blockDayAction, deleteRuleAction, deleteSlotAction, releaseAvailabilityAction, releaseSpecificDateAction, toggleSlotBlockAction } from "@/server/availability-actions";

export const metadata = { title: "Disponibilidade" };

const DAYS_SHOWN = 14;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const checkbox = "size-4 accent-[hsl(var(--primary))]";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AvailabilityPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser(["ADMIN", "PSYCHOLOGIST"]);
  const sp = await searchParams;
  const val = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));

  const allPsy = user.role === "ADMIN" ? await prisma.psychologist.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" } }) : [];
  const psyId = user.role === "ADMIN" ? val("psi") ?? allPsy[0]?.id : user.psychologistId!;
  if (!psyId) {
    return (
      <>
        <PageHeader title="Disponibilidade" />
        <EmptyState>Cadastre ao menos uma psicóloga ativa para gerenciar disponibilidades.</EmptyState>
      </>
    );
  }

  const settings = await getSettings();
  const psy = await prisma.psychologist.findUniqueOrThrow({
    where: { id: psyId },
    include: { segments: { include: { segment: true } } },
  });
  const segments = psy.segments.map((s) => s.segment).filter((s) => s.active);

  const startKey = val("d") && DATE_KEY_RE.test(val("d")!) ? val("d")! : todayKey();
  const endKey = addDaysKey(startKey, DAYS_SHOWN - 1);
  const [slots, rules] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { psychologistId: psyId, startsAt: { gte: startOfLocalDay(startKey), lt: endOfLocalDay(endKey) } },
      include: { segment: true, appointments: { where: { status: { not: "CANCELLED" } }, take: 1 } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.availabilityRule.findMany({
      where: { psychologistId: psyId, active: true, endDate: { gte: new Date(todayKey()) } },
      include: { segment: true },
      orderBy: { startDate: "asc" },
    }),
  ]);

  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const k = dateKey(s.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const hidden = user.role === "ADMIN" ? <input type="hidden" name="psychologistId" value={psyId} /> : null;
  const q = (extra: Record<string, string>) => new URLSearchParams({ ...(user.role === "ADMIN" ? { psi: psyId } : {}), ...extra }).toString();

  return (
    <>
      <PageHeader
        title="Disponibilidade"
        description="Libere dias e horários para as famílias. Os horários são gerados automaticamente a partir das regras abaixo."
        actions={
          user.role === "ADMIN" && (
            <form className="flex items-center gap-2">
              <Select name="psi" defaultValue={psyId} aria-label="Psicóloga" className="w-56">
                {allPsy.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Button type="submit" variant="outline">Ver</Button>
            </form>
          )
        }
      />

      {segments.length === 0 && (
        <Alert variant="warning">Esta psicóloga ainda não está associada a nenhum segmento. Peça ao administrador para associá-la em Segmentos.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarPlus className="size-4" /> Liberar disponibilidade</CardTitle>
            <CardDescription>Escolha o período, os dias da semana e a janela de cada dia. Os horários são divididos pela duração informada.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={releaseAvailabilityAction} className="space-y-5">
              {hidden}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Segmento">
                  <Select name="segmentId" required>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Data inicial"><Input type="date" name="startDate" defaultValue={todayKey()} min={todayKey()} required /></Field>
                  <Field label="Data final"><Input type="date" name="endDate" defaultValue={addDaysKey(todayKey(), 30)} min={todayKey()} required /></Field>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Dias da semana e horários</legend>
                {WEEK_ORDER.map((d) => (
                  <div key={d} className="grid grid-cols-[110px_1fr_1fr] items-center gap-2 sm:grid-cols-[130px_150px_150px]">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={`wd${d}`} className={checkbox} defaultChecked={false} />
                      {WEEKDAY_LABELS[d]}
                    </label>
                    <Input type="time" name={`wd${d}_start`} defaultValue="08:00" aria-label={`${WEEKDAY_LABELS[d]} início`} />
                    <Input type="time" name={`wd${d}_end`} defaultValue="12:00" aria-label={`${WEEKDAY_LABELS[d]} término`} />
                  </div>
                ))}
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Duração de cada atendimento (min)"><Input type="number" name="durationMinutes" min={10} max={240} defaultValue={settings.defaultDurationMinutes} required /></Field>
                <Field label="Intervalo entre atendimentos (min)"><Input type="number" name="gapMinutes" min={0} max={120} defaultValue={10} required /></Field>
              </div>
              <SubmitButton disabled={segments.length === 0} pendingText="Gerando horários…">Salvar disponibilidade</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Liberar data específica</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={releaseSpecificDateAction} className="space-y-3">
                {hidden}
                <Field label="Segmento"><Select name="segmentId">{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="Data"><Input type="date" name="date" min={todayKey()} required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Início"><Input type="time" name="start" defaultValue="08:00" required /></Field>
                  <Field label="Término"><Input type="time" name="end" defaultValue="12:00" required /></Field>
                  <Field label="Duração (min)"><Input type="number" name="durationMinutes" defaultValue={settings.defaultDurationMinutes} min={10} max={240} required /></Field>
                  <Field label="Intervalo (min)"><Input type="number" name="gapMinutes" defaultValue={10} min={0} max={120} required /></Field>
                </div>
                <SubmitButton size="sm" disabled={segments.length === 0}>Liberar data</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Ban className="size-4" /> Bloquear dia inteiro</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={blockDayAction} className="space-y-3">
                {hidden}
                <Field label="Data"><Input type="date" name="date" min={todayKey()} required /></Field>
                <Field label="Motivo (opcional)"><Input name="reason" maxLength={120} placeholder="Ex.: reunião pedagógica" /></Field>
                <SubmitButton size="sm" variant="outline">Bloquear dia</SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Regras recorrentes ativas</CardTitle></CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma regra ativa.</p>
          ) : (
            <ul className="divide-y">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span>
                    <strong>{r.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")}</strong> · {minutesToHHmm(r.startMinute)}–{minutesToHHmm(r.endMinute)} · {r.durationMinutes} min
                    {r.gapMinutes ? ` (+${r.gapMinutes} min)` : ""} · {r.segment.name}
                    <span className="block text-xs text-muted-foreground">
                      {r.startDate.toISOString().slice(0, 10).split("-").reverse().join("/")} a {r.endDate.toISOString().slice(0, 10).split("-").reverse().join("/")}
                    </span>
                  </span>
                  <ActionForm action={deleteRuleAction}>
                    <input type="hidden" name="ruleId" value={r.id} />
                    <SubmitButton size="sm" variant="outline" pendingText="Removendo…"><Trash2 /> Encerrar regra</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Horários — {fmtShort(startKey)} a {fmtShort(endKey)}</CardTitle>
            <CardDescription>Horários agendados não podem ser excluídos: use Agendamentos para cancelar ou remarcar.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`?${q({ d: addDaysKey(startKey, -DAYS_SHOWN) })}`}>← Anterior</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`?${q({ d: addDaysKey(startKey, DAYS_SHOWN) })}`}>Próximos →</Link></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {byDay.size === 0 && <EmptyState>Nenhum horário neste intervalo.</EmptyState>}
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-semibold capitalize">{fmtLongDate(list[0].startsAt)}</h3>
              <ul className="divide-y rounded-md border">
                {list.map((s) => {
                  const appt = s.appointments[0];
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-24 font-mono font-semibold tabular-nums">{fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}</span>
                      <span className="text-muted-foreground">{s.segment.name}</span>
                      <Badge variant={s.status === "AVAILABLE" ? "success" : s.status === "BOOKED" ? "default" : "muted"}>
                        {s.status === "AVAILABLE" ? "Livre" : s.status === "BOOKED" ? "Agendado" : "Bloqueado"}
                      </Badge>
                      {appt && <Link className="text-primary underline-offset-2 hover:underline" href={`/painel/agendamentos?q=${appt.code}`}>{appt.studentName}</Link>}
                      <span className="ml-auto flex gap-1">
                        {s.status !== "BOOKED" && (
                          <ActionForm action={toggleSlotBlockAction}>
                            <input type="hidden" name="slotId" value={s.id} />
                            <SubmitButton size="sm" variant="ghost" pendingText="…">{s.status === "BLOCKED" ? <><Unlock /> Liberar</> : <><Lock /> Bloquear</>}</SubmitButton>
                          </ActionForm>
                        )}
                        <ActionForm action={deleteSlotAction}>
                          <input type="hidden" name="slotId" value={s.id} />
                          <SubmitButton size="sm" variant="ghost" pendingText="…" title="Excluir horário"><Trash2 /></SubmitButton>
                        </ActionForm>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function fmtShort(key: string) {
  return key.split("-").reverse().slice(0, 2).join("/");
}
