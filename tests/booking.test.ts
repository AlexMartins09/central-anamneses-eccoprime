import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { BookingError, bookSlot, cancelAppointment, rescheduleAppointment } from "../src/lib/booking";
import { buildEventBody } from "../src/lib/calendar-sync";
import { family, makeSlot, makeWorld, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("reserva atômica", () => {
  it("20 famílias disputando o MESMO horário: exatamente 1 vence", async () => {
    const { segment, psychologists } = await makeWorld();
    const slot = await makeSlot(psychologists[0].id, segment.id);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => bookSlot({ slotId: slot.id, segmentId: segment.id, ...family(i) })),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    for (const r of rejected) expect((r.reason as BookingError).code).toBe("SLOT_UNAVAILABLE");

    expect(await prisma.appointment.count()).toBe(1);
    expect((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("BOOKED");
  });

  it("guarda a turma do aluno e a inclui na descrição do evento do Google (só quando informada)", async () => {
    const { segment, psychologists } = await makeWorld();
    const include = { psychologist: true, segment: true } as const;

    const withClass = await bookSlot({ slotId: (await makeSlot(psychologists[0].id, segment.id, 72)).id, segmentId: segment.id, ...family(1), studentClass: "7º ano B" });
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: withClass.id }, include });
    expect(a.studentClass).toBe("7º ano B");
    expect(buildEventBody(a).description).toContain("Turma: 7º ano B");

    const without = await bookSlot({ slotId: (await makeSlot(psychologists[0].id, segment.id, 96)).id, segmentId: segment.id, ...family(2) });
    const b = await prisma.appointment.findUniqueOrThrow({ where: { id: without.id }, include });
    expect(b.studentClass).toBeNull();
    expect(buildEventBody(b).description).not.toContain("Turma:");
  });

  it("cria na mesma transação os eventos do Google (psicóloga + equipe) e os e-mails", async () => {
    const { segment, psychologists } = await makeWorld();
    const slot = await makeSlot(psychologists[0].id, segment.id);
    const appt = await bookSlot({ slotId: slot.id, segmentId: segment.id, ...family(1) });

    const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.map((e) => e.target).sort()).toEqual(["PSYCHOLOGIST", "TEAM"]);
    expect(events.every((e) => e.status === "PENDING" && /^[a-v0-9]{5,}$/.test(e.googleEventId))).toBe(true);

    const mails = await prisma.notification.findMany({ where: { appointmentId: appt.id } });
    expect(mails.map((m) => m.type).sort()).toEqual(["BOOKING_FAMILY", "BOOKING_PSYCHOLOGIST"]);
    expect(appt.code).toMatch(/^ANA-[0-9A-Z]{8}$/);
  });

  it("rejeita horário passado, muito próximo e de outro segmento — sem deixar o horário preso", async () => {
    const { segment, other, psychologists } = await makeWorld();
    const past = await makeSlot(psychologists[0].id, segment.id, -5);
    await expect(bookSlot({ slotId: past.id, segmentId: segment.id, ...family(1) })).rejects.toMatchObject({ code: "SLOT_IN_PAST" });

    const soon = await makeSlot(psychologists[0].id, segment.id, 2);
    await expect(bookSlot({ slotId: soon.id, segmentId: segment.id, ...family(1) })).rejects.toMatchObject({ code: "TOO_SOON" });

    const ok = await makeSlot(psychologists[0].id, segment.id, 200);
    await expect(bookSlot({ slotId: ok.id, segmentId: other.id, ...family(1) })).rejects.toMatchObject({ code: "SEGMENT_MISMATCH" });

    // a transação foi revertida: continuam LIVRES
    for (const s of [past, soon, ok]) {
      expect((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("AVAILABLE");
    }
    expect(await prisma.appointment.count()).toBe(0);
  });

  it("impede a mesma família/aluno de manter dois agendamentos ativos", async () => {
    const { segment, psychologists } = await makeWorld();
    const a = await makeSlot(psychologists[0].id, segment.id, 100);
    const b = await makeSlot(psychologists[0].id, segment.id, 200);
    await bookSlot({ slotId: a.id, segmentId: segment.id, ...family(1) });
    await expect(bookSlot({ slotId: b.id, segmentId: segment.id, ...family(1) })).rejects.toMatchObject({ code: "DUPLICATE_FAMILY" });
  });
});

describe("cancelamento e remarcação", () => {
  it("cancelar libera o horário, reabre os eventos do Google e permite nova reserva", async () => {
    const { segment, psychologists } = await makeWorld();
    const slot = await makeSlot(psychologists[0].id, segment.id);
    const appt = await bookSlot({ slotId: slot.id, segmentId: segment.id, ...family(1) });
    await prisma.googleCalendarEvent.updateMany({ where: { appointmentId: appt.id }, data: { status: "SYNCED", syncedAt: new Date() } });

    await cancelAppointment({ appointmentId: appt.id, reason: "teste" });

    expect((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("AVAILABLE");
    const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId: appt.id } });
    expect(events.every((e) => e.status === "PENDING")).toBe(true); // worker removerá do Google
    await expect(cancelAppointment({ appointmentId: appt.id })).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });

    const again = await bookSlot({ slotId: slot.id, segmentId: segment.id, ...family(2) });
    expect(again.status).toBe("CONFIRMED");
  });

  it("remarcar troca de horário atomicamente e libera o antigo", async () => {
    const { segment, psychologists } = await makeWorld({ psychologists: 2 });
    const s1 = await makeSlot(psychologists[0].id, segment.id, 100);
    const s2 = await makeSlot(psychologists[1].id, segment.id, 150);
    const appt = await bookSlot({ slotId: s1.id, segmentId: segment.id, ...family(1) });

    const moved = await rescheduleAppointment({ appointmentId: appt.id, newSlotId: s2.id });
    expect(moved.psychologistId).toBe(psychologists[1].id);
    expect((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe("AVAILABLE");
    expect((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe("BOOKED");

    // destino ocupado -> falha e nada muda
    const s3 = await makeSlot(psychologists[0].id, segment.id, 300);
    await bookSlot({ slotId: s3.id, segmentId: segment.id, ...family(2) });
    await expect(rescheduleAppointment({ appointmentId: appt.id, newSlotId: s3.id })).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).slotId).toBe(s2.id);
  });
});

describe("garantias do banco (última linha de defesa)", () => {
  it("constraint EXCLUDE: horários sobrepostos da mesma psicóloga são recusados pelo PostgreSQL", async () => {
    const { segment, psychologists } = await makeWorld();
    const base = new Date(Date.now() + 100 * 3600_000);
    await prisma.availabilitySlot.create({
      data: { psychologistId: psychologists[0].id, segmentId: segment.id, startsAt: base, endsAt: new Date(base.getTime() + 3600_000) },
    });
    await expect(
      prisma.availabilitySlot.create({
        data: {
          psychologistId: psychologists[0].id,
          segmentId: segment.id,
          startsAt: new Date(base.getTime() + 1800_000),
          endsAt: new Date(base.getTime() + 5400_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("índice único parcial: dois agendamentos ativos no mesmo slot são recusados, cancelado não conta", async () => {
    const { segment, psychologists } = await makeWorld();
    const slot = await makeSlot(psychologists[0].id, segment.id);
    const mk = (code: string, status: "CONFIRMED" | "CANCELLED") =>
      prisma.appointment.create({
        data: {
          code, slotId: slot.id, psychologistId: slot.psychologistId, segmentId: slot.segmentId,
          startsAt: slot.startsAt, endsAt: slot.endsAt, status, ...family(1),
          consentAt: new Date(), consentVersion: "t",
        },
      });
    await mk("ANA-AAAAAAA1", "CANCELLED");
    await mk("ANA-AAAAAAA2", "CONFIRMED");
    await expect(mk("ANA-AAAAAAA3", "CONFIRMED")).rejects.toThrow();
  });
});
