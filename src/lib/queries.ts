import type { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./auth";
import { visibleToUser } from "./rbac";
import { addDaysKey, DATE_KEY_RE, endOfLocalDay, startOfLocalDay, todayKey, weekdayOf } from "./time";

export type Period = "hoje" | "semana" | "mes" | "personalizado" | "todos";

export type Filters = {
  period: Period;
  from: string; // yyyy-MM-dd (Recife)
  to: string;
  segmentId?: string;
  psychologistId?: string;
  status?: AppointmentStatus;
  q?: string;
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const STATUSES: AppointmentStatus[] = ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];

export function periodRange(period: Period, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const today = todayKey();
  switch (period) {
    case "hoje":
      return { from: today, to: today };
    case "semana": {
      const start = addDaysKey(today, -weekdayOf(today)); // domingo
      return { from: start, to: addDaysKey(start, 6) };
    }
    case "mes": {
      const first = `${today.slice(0, 7)}-01`;
      const next = new Date(`${first}T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { from: first, to: addDaysKey(next.toISOString().slice(0, 10), -1) };
    }
    case "personalizado":
      return {
        from: custom?.from && DATE_KEY_RE.test(custom.from) ? custom.from : today,
        to: custom?.to && DATE_KEY_RE.test(custom.to) ? custom.to : addDaysKey(today, 30),
      };
    default:
      return { from: "2000-01-01", to: "2099-12-31" };
  }
}

export function parseFilters(sp: SP, defaults: Period = "mes"): Filters {
  const p = one(sp.periodo) as Period | undefined;
  const period: Period = p && ["hoje", "semana", "mes", "personalizado", "todos"].includes(p) ? p : defaults;
  const range = periodRange(period, { from: one(sp.de), to: one(sp.ate) });
  const status = one(sp.status) as AppointmentStatus | undefined;
  return {
    period,
    ...range,
    segmentId: one(sp.segmento),
    psychologistId: one(sp.psicologa),
    status: status && STATUSES.includes(status) ? status : undefined,
    q: one(sp.q)?.slice(0, 80),
  };
}

export function appointmentWhere(user: SessionUser, f: Filters): Prisma.AppointmentWhereInput {
  const vis = visibleToUser(user);
  return {
    startsAt: { gte: startOfLocalDay(f.from), lt: endOfLocalDay(f.to) },
    ...(f.segmentId ? { segmentId: f.segmentId } : {}),
    ...(vis.psychologistId ? { psychologistId: vis.psychologistId } : f.psychologistId ? { psychologistId: f.psychologistId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? {
          OR: [
            { studentName: { contains: f.q, mode: "insensitive" } },
            { guardianName: { contains: f.q, mode: "insensitive" } },
            { code: { contains: f.q, mode: "insensitive" } },
            { email: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const appointmentInclude = { psychologist: true, segment: true, events: true } satisfies Prisma.AppointmentInclude;

export async function dashboardStats(user: SessionUser, f: Filters) {
  const now = new Date();
  const where = appointmentWhere(user, f);
  const vis = visibleToUser(user);
  const slotScope: Prisma.AvailabilitySlotWhereInput = {
    startsAt: { gte: startOfLocalDay(f.from), lt: endOfLocalDay(f.to) },
    ...(f.segmentId ? { segmentId: f.segmentId } : {}),
    ...(vis.psychologistId ? { psychologistId: vis.psychologistId } : f.psychologistId ? { psychologistId: f.psychologistId } : {}),
  };

  const [total, byStatus, bySegment, byPsy, slotsByStatus, upcoming, segments, psychologists] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.groupBy({ by: ["status"], where, _count: true }),
    prisma.appointment.groupBy({ by: ["segmentId"], where: { ...where, status: { not: "CANCELLED" } }, _count: true }),
    prisma.appointment.groupBy({ by: ["psychologistId"], where: { ...where, status: { not: "CANCELLED" } }, _count: true }),
    prisma.availabilitySlot.groupBy({ by: ["status"], where: { ...slotScope, startsAt: { ...(slotScope.startsAt as object), gte: new Date(Math.max(now.getTime(), startOfLocalDay(f.from).getTime())) } }, _count: true }),
    prisma.appointment.findMany({
      where: { ...appointmentWhere(user, { ...f, from: "2000-01-01", to: "2099-12-31", status: undefined }), status: "CONFIRMED", startsAt: { gt: now } },
      include: appointmentInclude,
      orderBy: { startsAt: "asc" },
      take: 8,
    }),
    prisma.schoolSegment.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.psychologist.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
  ]);

  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const slot = (s: string) => slotsByStatus.find((x) => x.status === s)?._count ?? 0;
  return {
    total,
    confirmed: count("CONFIRMED"),
    cancelled: count("CANCELLED"),
    completed: count("COMPLETED"),
    noShow: count("NO_SHOW"),
    activeTotal: total - count("CANCELLED"),
    slotsAvailable: slot("AVAILABLE"),
    slotsBooked: slot("BOOKED"),
    slotsBlocked: slot("BLOCKED"),
    bySegment: segments.map((s) => ({ id: s.id, name: s.name, count: bySegment.find((x) => x.segmentId === s.id)?._count ?? 0 })),
    byPsychologist: psychologists
      .map((p) => ({ id: p.id, name: p.name, count: byPsy.find((x) => x.psychologistId === p.id)?._count ?? 0 }))
      .filter((p) => p.count > 0 || !vis.psychologistId),
    upcoming,
    segments,
    psychologists,
  };
}

export function filtersToQuery(f: Partial<Filters>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.period) p.set("periodo", f.period);
  if (f.period === "personalizado") {
    if (f.from) p.set("de", f.from);
    if (f.to) p.set("ate", f.to);
  }
  if (f.segmentId) p.set("segmento", f.segmentId);
  if (f.psychologistId) p.set("psicologa", f.psychologistId);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}
