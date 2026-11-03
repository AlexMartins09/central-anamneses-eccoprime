import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { expandRule, persistSlots, slotsForDay } from "../src/lib/slots";
import { dateKey, fmtTime, localToUtc, weekdayOf } from "../src/lib/time";
import { makeWorld, resetDb } from "./helpers";

describe("fuso America/Recife", () => {
  it("09:00 em Recife = 12:00 UTC (UTC-3, sem horário de verão)", () => {
    expect(localToUtc("2027-03-10", 9 * 60).toISOString()).toBe("2027-03-10T12:00:00.000Z");
    expect(fmtTime(new Date("2027-03-10T12:00:00Z"))).toBe("09:00");
  });
  it("dateKey usa o dia de Recife (01:00 UTC ainda é o dia anterior)", () => {
    expect(dateKey(new Date("2027-03-10T01:00:00Z"))).toBe("2027-03-09");
  });
  it("dia da semana independe do fuso da máquina", () => {
    expect(weekdayOf("2027-03-08")).toBe(1); // segunda-feira
  });
});

describe("geração de horários", () => {
  it("08h–12h, 50 min + 10 min de intervalo = 4 horários", () => {
    const s = slotsForDay("2027-03-08", { startMinute: 480, endMinute: 720, durationMinutes: 50, gapMinutes: 10 });
    expect(s.map((x) => fmtTime(x.startsAt))).toEqual(["08:00", "09:00", "10:00", "11:00"]);
    expect(fmtTime(s[3].endsAt)).toBe("11:50");
  });
  it("não gera horário que ultrapasse o fim da janela", () => {
    const s = slotsForDay("2027-03-08", { startMinute: 480, endMinute: 560, durationMinutes: 50, gapMinutes: 0 });
    expect(s).toHaveLength(1);
  });
  it("regra semanal respeita dias da semana (seg/qua) no período", () => {
    const s = expandRule({
      startDate: "2027-03-08", endDate: "2027-03-14", weekdays: [1, 3],
      startMinute: 480, endMinute: 540, durationMinutes: 30, gapMinutes: 0,
    });
    expect(s).toHaveLength(4); // 2 dias × 2 horários
    expect(new Set(s.map((x) => dateKey(x.startsAt)))).toEqual(new Set(["2027-03-08", "2027-03-10"]));
  });
});

describe("persistência com conflitos", () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ignora passado e horários que colidem com os existentes; reaplicar não duplica", async () => {
    const { segment, psychologists } = await makeWorld();
    const p = psychologists[0];
    const times = expandRule({
      startDate: "2099-03-08", endDate: "2099-03-08", weekdays: [weekdayOf("2099-03-08")],
      startMinute: 480, endMinute: 720, durationMinutes: 60, gapMinutes: 0,
    });
    const first = await prisma.$transaction((tx) => persistSlots(tx, { psychologistId: p.id, segmentId: segment.id, ruleId: null, times }));
    expect(first.created).toBe(4);
    const second = await prisma.$transaction((tx) => persistSlots(tx, { psychologistId: p.id, segmentId: segment.id, ruleId: null, times }));
    expect(second).toMatchObject({ created: 0, skippedConflict: 4 });
    expect(await prisma.availabilitySlot.count()).toBe(4);

    const past = expandRule({
      startDate: "2020-01-06", endDate: "2020-01-06", weekdays: [1],
      startMinute: 480, endMinute: 540, durationMinutes: 60, gapMinutes: 0,
    });
    const r = await prisma.$transaction((tx) => persistSlots(tx, { psychologistId: p.id, segmentId: segment.id, ruleId: null, times: past }));
    expect(r).toMatchObject({ created: 0, skippedPast: 1 });
  });
});
