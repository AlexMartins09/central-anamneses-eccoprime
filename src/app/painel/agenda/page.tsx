import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { visibleToUser } from "@/lib/rbac";
import { DATE_KEY_RE, addDaysKey, dateKey, endOfLocalDay, fmtTime, startOfLocalDay, todayKey, weekdayOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

export const metadata = { title: "Agenda" };

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AgendaPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const view = one("v") === "semana" ? "semana" : "mes";
  const anchor = one("d") && DATE_KEY_RE.test(one("d")!) ? one("d")! : todayKey();

  let from: string, to: string;
  if (view === "mes") {
    const first = `${anchor.slice(0, 7)}-01`;
    const next = new Date(`${first}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = addDaysKey(next.toISOString().slice(0, 10), -1);
    from = addDaysKey(first, -weekdayOf(first));
    to = addDaysKey(last, 6 - weekdayOf(last));
  } else {
    from = addDaysKey(anchor, -weekdayOf(anchor));
    to = addDaysKey(from, 6);
  }

  const vis = visibleToUser(user);
  const psyFilter = vis.psychologistId ?? one("psicologa");
  const [slots, psychologists] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: {
        startsAt: { gte: startOfLocalDay(from), lt: endOfLocalDay(to) },
        ...(psyFilter ? { psychologistId: psyFilter } : {}),
        ...(one("segmento") ? { segmentId: one("segmento") } : {}),
      },
      include: {
        segment: { select: { name: true } },
        psychologist: { select: { name: true } },
        appointments: { where: { status: { not: "CANCELLED" } }, select: { id: true, studentName: true, code: true }, take: 1 },
      },
      orderBy: { startsAt: "asc" },
    }),
    user.role === "PSYCHOLOGIST" && !user.canViewOthers ? [] : prisma.psychologist.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
  ]);

  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const k = dateKey(s.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }

  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysKey(d, 1)) days.push(d);

  const [ay, am] = anchor.split("-").map(Number);
  const step = view === "mes" ? { prev: addDaysKey(`${anchor.slice(0, 7)}-01`, -1), next: addDaysKey(`${anchor.slice(0, 7)}-01`, 32) } : { prev: addDaysKey(anchor, -7), next: addDaysKey(anchor, 7) };
  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ v: view, d: anchor, ...(one("psicologa") ? { psicologa: one("psicologa")! } : {}), ...extra });
    return `?${p.toString()}`;
  };
  const title = view === "mes" ? `${MONTHS[am - 1]} de ${ay}` : `Semana de ${from.split("-").reverse().slice(0, 2).join("/")} a ${to.split("-").reverse().slice(0, 2).join("/")}`;
  const today = todayKey();

  const chip = (s: (typeof slots)[number]) => {
    const a = s.appointments[0];
    return cn(
      "flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs",
      s.status === "BOOKED" ? "bg-primary/15 text-primary" : s.status === "AVAILABLE" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      !a && s.status === "BOOKED" && "opacity-70",
    );
  };

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Calendário mensal e semanal com horários livres, ocupados e bloqueados."
        actions={
          <>
            <Button asChild variant={view === "mes" ? "default" : "outline"} size="sm"><Link href={link({ v: "mes" })}>Mês</Link></Button>
            <Button asChild variant={view === "semana" ? "default" : "outline"} size="sm"><Link href={link({ v: "semana" })}>Semana</Link></Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Anterior"><Link href={link({ d: step.prev })}><ChevronLeft /></Link></Button>
          <h2 className="min-w-48 text-center text-lg font-bold">{title}</h2>
          <Button asChild variant="outline" size="icon" aria-label="Próximo"><Link href={link({ d: step.next })}><ChevronRight /></Link></Button>
          <Button asChild variant="ghost" size="sm"><Link href={link({ d: today })}>Hoje</Link></Button>
        </div>
        {psychologists.length > 0 && (
          <form className="flex items-center gap-2">
            <input type="hidden" name="v" value={view} />
            <input type="hidden" name="d" value={anchor} />
            <Select name="psicologa" defaultValue={one("psicologa") ?? ""} aria-label="Psicóloga" className="w-52">
              <option value="">Todas as psicólogas</option>
              {psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button type="submit" variant="outline">Filtrar</Button>
          </form>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-success/30" /> Livre</span>
        <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-primary/30" /> Agendado</span>
        <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-muted-foreground/30" /> Bloqueado</span>
      </div>

      {view === "mes" ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b bg-secondary/50 text-center text-xs font-semibold text-muted-foreground">
            {DOW.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const free = list.filter((s) => s.status === "AVAILABLE").length;
              const booked = list.filter((s) => s.status === "BOOKED");
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              return (
                <Link key={d} href={link({ v: "semana", d })}
                  className={cn("min-h-24 border-b border-r p-1.5 text-xs transition-colors hover:bg-secondary/60 sm:min-h-28", !inMonth && "bg-muted/40 text-muted-foreground", d === today && "ring-2 ring-inset ring-primary")}>
                  <span className={cn("mb-1 block text-sm font-semibold", d === today && "text-primary")}>{Number(d.slice(8))}</span>
                  {list.length > 0 && (
                    <>
                      <span className="hidden gap-1 sm:flex"><span className="font-semibold text-success">{free} livres</span><span className="text-primary">· {booked.length} ocup.</span></span>
                      <span className="flex gap-1 sm:hidden">
                        {free > 0 && <i className="size-2 rounded-full bg-success" />}
                        {booked.length > 0 && <i className="size-2 rounded-full bg-primary" />}
                      </span>
                      <span className="mt-1 hidden space-y-0.5 sm:block">
                        {booked.slice(0, 2).map((s) => (
                          <span key={s.id} className="block truncate rounded bg-primary/15 px-1 py-0.5 text-primary">{fmtTime(s.startsAt)} {s.appointments[0]?.studentName.split(" ")[0]}</span>
                        ))}
                        {booked.length > 2 && <span className="block text-muted-foreground">+{booked.length - 2}</span>}
                      </span>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <Card key={d} className={cn("p-3", d === today && "ring-2 ring-primary")}>
                <p className="mb-2 text-sm font-bold">{DOW[weekdayOf(d)]} <span className="font-normal text-muted-foreground">{d.slice(8)}/{d.slice(5, 7)}</span></p>
                {list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem horários</p>
                ) : (
                  <ul className="space-y-1">
                    {list.map((s) => {
                      const a = s.appointments[0];
                      return (
                        <li key={s.id} className={chip(s)}>
                          <span className="font-semibold tabular-nums">{fmtTime(s.startsAt)}</span>
                          {a ? (
                            <Link href={`/painel/agendamentos?ver=${a.id}`} className="truncate hover:underline" title={`${a.studentName} · ${s.segment.name}`}>{a.studentName}</Link>
                          ) : (
                            <span className="truncate">{s.status === "AVAILABLE" ? "Livre" : "Bloqueado"}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
