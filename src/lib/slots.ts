import { prisma, type Tx } from "./db";
import { dateKey as toDateKey, eachDateKey, endOfLocalDay, localToUtc, startOfLocalDay, weekdayOf } from "./time";

export type RuleInput = {
  startDate: string; // yyyy-MM-dd
  endDate: string;
  weekdays: number[]; // 0..6
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  gapMinutes: number;
};

export type SlotTime = { startsAt: Date; endsAt: Date };

/** Divide uma janela do dia em horários de `duration` min separados por `gap` min. Função pura. */
export function slotsForDay(dateKey: string, r: Pick<RuleInput, "startMinute" | "endMinute" | "durationMinutes" | "gapMinutes">): SlotTime[] {
  const out: SlotTime[] = [];
  let cursor = r.startMinute;
  while (cursor + r.durationMinutes <= r.endMinute) {
    out.push({
      startsAt: localToUtc(dateKey, cursor),
      endsAt: localToUtc(dateKey, cursor + r.durationMinutes),
    });
    cursor += r.durationMinutes + r.gapMinutes;
  }
  return out;
}

/** Expande uma regra recorrente em todos os horários concretos. Função pura. */
export function expandRule(r: RuleInput): SlotTime[] {
  const days = new Set(r.weekdays);
  const out: SlotTime[] = [];
  for (const key of eachDateKey(r.startDate, r.endDate)) {
    if (!days.has(weekdayOf(key))) continue;
    out.push(...slotsForDay(key, r));
  }
  return out;
}

export function overlaps(a: SlotTime, b: SlotTime): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export type GenerateResult = { created: number; skippedPast: number; skippedConflict: number };

/**
 * Cria os horários de uma regra, ignorando passado e qualquer horário que colida
 * com os já existentes da psicóloga (a constraint EXCLUDE do banco é a garantia final).
 */
export async function persistSlots(
  tx: Tx,
  args: { psychologistId: string; segmentId: string; ruleId: string | null; times: SlotTime[]; now?: Date },
): Promise<GenerateResult> {
  const now = args.now ?? new Date();
  const future = args.times.filter((t) => t.startsAt > now);
  const skippedPast = args.times.length - future.length;
  if (future.length === 0) return { created: 0, skippedPast, skippedConflict: 0 };

  const min = new Date(Math.min(...future.map((t) => t.startsAt.getTime())));
  const max = new Date(Math.max(...future.map((t) => t.endsAt.getTime())));
  const existing = await tx.availabilitySlot.findMany({
    where: { psychologistId: args.psychologistId, startsAt: { lt: max }, endsAt: { gt: min } },
    select: { startsAt: true, endsAt: true },
  });

  const accepted: SlotTime[] = [];
  let skippedConflict = 0;
  for (const t of future) {
    if (existing.some((e) => overlaps(t, e)) || accepted.some((a) => overlaps(t, a))) {
      skippedConflict++;
      continue;
    }
    accepted.push(t);
  }

  if (accepted.length) {
    await tx.availabilitySlot.createMany({
      data: accepted.map((t) => ({
        psychologistId: args.psychologistId,
        segmentId: args.segmentId,
        ruleId: args.ruleId,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
      })),
    });
  }
  return { created: accepted.length, skippedPast, skippedConflict };
}

/** Datas (yyyy-MM-dd, Recife) que possuem ao menos um horário LIVRE no segmento dentro de [from, to]. */
export async function availableDates(segmentId: string, fromKey: string, toKey: string, minStart: Date): Promise<string[]> {
  const from = new Date(Math.max(startOfLocalDay(fromKey).getTime(), minStart.getTime()));
  const rows = await prisma.availabilitySlot.findMany({
    where: {
      segmentId,
      status: "AVAILABLE",
      startsAt: { gte: from, lt: endOfLocalDay(toKey) },
      psychologist: { active: true, deletedAt: null },
    },
    select: { startsAt: true },
    orderBy: { startsAt: "asc" },
  });
  const set = new Set<string>();
  for (const r of rows) set.add(toDateKey(r.startsAt));
  return [...set];
}
