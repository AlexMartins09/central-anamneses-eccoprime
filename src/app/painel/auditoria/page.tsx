import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Card, Table, Td, Th } from "@/components/ui/card";

export const metadata = { title: "Auditoria" };
const PAGE = 50;

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.pg) ? sp.pg[0] : sp.pg) || 1);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count(),
  ]);
  const pages = Math.ceil(total / PAGE);
  return (
    <>
      <PageHeader title="Histórico de alterações" description={`${total} registro(s). Ações administrativas, acessos e exportações.`} />
      <Card>
        <Table>
          <thead><tr><Th>Quando</Th><Th>Quem</Th><Th>Ação</Th><Th>Entidade</Th><Th>Detalhes</Th><Th>IP</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                <Td>{r.user?.name ?? "Sistema"}</Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td className="text-xs">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</Td>
                <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={r.details ? JSON.stringify(r.details) : ""}>{r.details ? JSON.stringify(r.details) : ""}</Td>
                <Td className="text-xs text-muted-foreground">{r.ip ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link className="font-semibold text-primary" href={`?pg=${page - 1}`}>← Anterior</Link>}
          <span className="text-muted-foreground">Página {page} de {pages}</span>
          {page < pages && <Link className="font-semibold text-primary" href={`?pg=${page + 1}`}>Próxima →</Link>}
        </nav>
      )}
    </>
  );
}
