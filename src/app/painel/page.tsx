import Link from "next/link";
import { CalendarCheck, CalendarClock, CalendarX2, CheckCircle2, Clock, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { dashboardStats, parseFilters } from "@/lib/queries";
import { fmtDate, fmtTime } from "@/lib/time";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatCard, EmptyState } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { AppointmentStatusBadge } from "@/components/status-badges";

export const metadata = { title: "Início" };

type SP = Promise<Record<string, string | string[] | undefined>>;

function Bars({ items, empty }: { items: { id: string; name: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id}>
          <div className="mb-1 flex justify-between text-sm"><span>{i.name}</span><strong className="tabular-nums">{i.count}</strong></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (sp.negado) {
    // mensagem exibida abaixo
  }
  const f = parseFilters(sp, "mes");
  const s = await dashboardStats(user, f);
  const mine = user.role === "PSYCHOLOGIST" && !user.canViewOthers;
  const rangeLabel = f.period === "todos" ? "todo o histórico" : `${fmtDate(new Date(`${f.from}T12:00:00Z`))} a ${fmtDate(new Date(`${f.to}T12:00:00Z`))}`;

  return (
    <>
      <PageHeader
        title={mine ? `Olá, ${user.name.split(" ")[0]}` : "Painel geral"}
        description={`Indicadores de ${rangeLabel}${mine ? " — sua agenda" : ""}.`}
      />
      {sp.negado && <Alert variant="warning">Você não tem permissão para acessar essa página.</Alert>}

      <FilterBar f={f} segments={s.segments} psychologists={s.psychologists} showPsychologist={!mine} showSearch={false} action="/painel" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total de agendamentos" value={s.total} hint="inclui cancelados" icon={<CalendarCheck className="size-5" />} />
        <StatCard label="Agendadas / realizadas" value={s.activeTotal} hint={`${s.confirmed} confirmadas · ${s.completed} realizadas`} icon={<CheckCircle2 className="size-5" />} />
        <StatCard label="Horários disponíveis" value={s.slotsAvailable} hint="a partir de agora" icon={<CalendarClock className="size-5" />} />
        <StatCard label="Horários ocupados" value={s.slotsBooked} hint={`${s.slotsBlocked} bloqueados`} icon={<Lock className="size-5" />} />
        <StatCard label="Cancelamentos" value={s.cancelled} icon={<CalendarX2 className="size-5" />} />
        <StatCard label="Não compareceram" value={s.noShow} icon={<Clock className="size-5" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agendamentos por segmento</CardTitle></CardHeader>
          <CardContent><Bars items={s.bySegment} empty="Sem dados no período." /></CardContent>
        </Card>
        {!mine && (
          <Card>
            <CardHeader><CardTitle>Agendamentos por psicóloga</CardTitle></CardHeader>
            <CardContent><Bars items={s.byPsychologist} empty="Sem dados no período." /></CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Próximos atendimentos</CardTitle>
          <Link href="/painel/agenda" className="text-sm font-semibold text-primary hover:underline">Abrir agenda →</Link>
        </CardHeader>
        <CardContent>
          {s.upcoming.length === 0 ? (
            <EmptyState>Nenhum atendimento futuro agendado.</EmptyState>
          ) : (
            <ul className="divide-y">
              {s.upcoming.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                  <span className="w-28 font-semibold tabular-nums">{fmtDate(a.startsAt)} · {fmtTime(a.startsAt)}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/painel/agendamentos?ver=${a.id}`} className="font-medium hover:underline">{a.studentName}</Link>
                    <span className="text-muted-foreground"> · resp. {a.guardianName}</span>
                  </span>
                  <span className="text-muted-foreground">{a.segment.name}{mine ? "" : ` · ${a.psychologist.name}`}</span>
                  <AppointmentStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
