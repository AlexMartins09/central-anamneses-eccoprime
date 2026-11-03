import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { appointmentWhere, filtersToQuery, parseFilters } from "@/lib/queries";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/filter-bar";

export const metadata = { title: "Relatórios" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser(["ADMIN", "COORDINATION"]);
  const f = parseFilters(await searchParams, "mes");
  const where = appointmentWhere(user, f);

  const [segments, psychologists, bySeg, byPsy, failedSync, pendingSync, failedMail, pendingMail] = await Promise.all([
    prisma.schoolSegment.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.psychologist.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.appointment.groupBy({ by: ["segmentId", "status"], where, _count: true }),
    prisma.appointment.groupBy({ by: ["psychologistId", "status"], where, _count: true }),
    prisma.googleCalendarEvent.count({ where: { status: "FAILED" } }),
    prisma.googleCalendarEvent.count({ where: { status: { in: ["PENDING", "SKIPPED"] } } }),
    prisma.notification.count({ where: { status: "FAILED" } }),
    prisma.notification.count({ where: { status: "PENDING" } }),
  ]);

  const matrix = (rows: { status: string; _count: number; segmentId?: string; psychologistId?: string }[], key: "segmentId" | "psychologistId", id: string) => {
    const n = (st: string) => rows.filter((r) => r[key] === id && r.status === st).reduce((a, r) => a + r._count, 0);
    const total = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"].reduce((a, s) => a + n(s), 0);
    return { total, confirmed: n("CONFIRMED"), completed: n("COMPLETED"), noShow: n("NO_SHOW"), cancelled: n("CANCELLED"), rate: total ? Math.round((n("CANCELLED") / total) * 100) : 0 };
  };

  const head = (
    <tr><Th>Nome</Th><Th>Total</Th><Th>Confirmados</Th><Th>Realizados</Th><Th>Não compareceram</Th><Th>Cancelados</Th><Th>% cancel.</Th></tr>
  );
  const cells = (m: ReturnType<typeof matrix>) => (
    <>
      <Td className="font-semibold tabular-nums">{m.total}</Td><Td className="tabular-nums">{m.confirmed}</Td><Td className="tabular-nums">{m.completed}</Td>
      <Td className="tabular-nums">{m.noShow}</Td><Td className="tabular-nums">{m.cancelled}</Td><Td className="tabular-nums">{m.rate}%</Td>
    </>
  );

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Consolide agendamentos por segmento e psicóloga e acompanhe a saúde das integrações."
        actions={<Button asChild variant="outline"><a href={`/api/export/appointments?${filtersToQuery(f)}`}><Download /> Exportar CSV (Excel)</a></Button>}
      />
      <FilterBar f={f} segments={segments} psychologists={psychologists} showSearch={false} action="/painel/relatorios" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sincronizações Google com falha" value={failedSync} hint={`${pendingSync} pendentes / aguardando conexão`} />
        <StatCard label="E-mails com falha" value={failedMail} hint={`${pendingMail} na fila`} />
      </div>

      <Card>
        <CardHeader><CardTitle>Por segmento</CardTitle></CardHeader>
        <Table>
          <thead>{head}</thead>
          <tbody>{segments.map((s) => <tr key={s.id}><Td className="font-medium">{s.name}</Td>{cells(matrix(bySeg, "segmentId", s.id))}</tr>)}</tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader><CardTitle>Por psicóloga</CardTitle></CardHeader>
        <Table>
          <thead>{head}</thead>
          <tbody>{psychologists.map((p) => <tr key={p.id}><Td className="font-medium">{p.name}</Td>{cells(matrix(byPsy, "psychologistId", p.id))}</tr>)}</tbody>
        </Table>
        <CardContent />
      </Card>
    </>
  );
}
