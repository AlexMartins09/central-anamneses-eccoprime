import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { appointmentInclude, appointmentWhere, parseFilters } from "@/lib/queries";
import { fmtDate, fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/utils";
import { APPOINTMENT_STATUS_LABEL } from "@/components/status-badges";

export const dynamic = "force-dynamic";

/** Evita injeção de fórmulas ao abrir no Excel (=, +, -, @) e escapa aspas/separadores. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role === "PSYCHOLOGIST") return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = parseFilters(sp, "mes");
  const rows = await prisma.appointment.findMany({
    where: appointmentWhere(user, f),
    include: appointmentInclude,
    orderBy: { startsAt: "asc" },
    take: 20000,
  });

  const header = ["Código", "Aluno", "Responsável", "Telefone", "E-mail", "Segmento", "Psicóloga", "Data", "Horário", "Status", "Criado em"];
  const lines = rows.map((a) =>
    [a.code, a.studentName, a.guardianName, formatPhone(a.phone), a.email, a.segment.name, a.psychologist.name,
     fmtDate(a.startsAt), `${fmtTime(a.startsAt)}-${fmtTime(a.endsAt)}`, APPOINTMENT_STATUS_LABEL[a.status], fmtDate(a.createdAt)]
      .map(cell).join(";"),
  );
  // BOM + separador ";" para abrir corretamente no Excel em português
  const body = "﻿" + [header.map(cell).join(";"), ...lines].join("\r\n");
  await audit({ userId: user.id, action: "EXPORT_APPOINTMENTS", entityType: "Appointment", details: { count: rows.length, period: f.period } });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agendamentos-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
