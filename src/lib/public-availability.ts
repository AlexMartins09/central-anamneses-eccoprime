import { prisma } from "./db";
import { getSettings } from "./settings";
import { availableDates } from "./slots";
import { addDaysKey, dateKey, endOfLocalDay, fmtTime, startOfLocalDay } from "./time";

/** Início/fim da janela pública (antecedência mínima e limite de dias à frente). */
export async function publicWindow(now = new Date()) {
  const s = await getSettings();
  return {
    min: new Date(now.getTime() + s.minLeadHours * 3600_000),
    max: new Date(now.getTime() + s.maxDaysAhead * 86400_000),
  };
}

export async function publicDates(segmentId: string, month: string) {
  const { min, max } = await publicWindow();
  const first = `${month}-01`;
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDaysKey(next.toISOString().slice(0, 10), -1);
  const dates = await availableDates(segmentId, first, last, min);
  return dates.filter((d) => startOfLocalDay(d) <= max);
}

export async function publicSlots(segmentId: string, date: string) {
  const { min, max } = await publicWindow();
  const rows = await prisma.availabilitySlot.findMany({
    where: {
      segmentId,
      status: "AVAILABLE",
      startsAt: { gte: new Date(Math.max(startOfLocalDay(date).getTime(), min.getTime())), lt: new Date(Math.min(endOfLocalDay(date).getTime(), max.getTime())) },
      psychologist: { active: true, deletedAt: null },
      segment: { active: true, deletedAt: null },
    },
    include: { psychologist: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });
  // Mesmo horário oferecido por duas psicólogas aparece uma vez só (a primeira por ordem de nome/início).
  const seen = new Set<number>();
  const out: { id: string; start: string; end: string; psychologist: string; day: string }[] = [];
  for (const r of rows) {
    const t = r.startsAt.getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ id: r.id, start: fmtTime(r.startsAt), end: fmtTime(r.endsAt), psychologist: r.psychologist.name, day: dateKey(r.startsAt) });
  }
  return out;
}
