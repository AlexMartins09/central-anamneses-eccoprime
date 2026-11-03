import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sendMail: vi.fn(async (_o: unknown) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }));

import { prisma } from "../src/lib/db";
import { saveSettings } from "../src/lib/settings";
import { bookSlot, cancelAppointment } from "../src/lib/booking";
import { processNotifications, queueReminders } from "../src/lib/notifications";
import { runRetention } from "../src/lib/retention";
import { family, makeSlot, makeWorld, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  mail.sendMail.mockReset();
  mail.sendMail.mockResolvedValue({});
  process.env.SMTP_HOST = "smtp.test";
});
afterAll(async () => {
  delete process.env.SMTP_HOST;
  await prisma.$disconnect();
});

async function booked(hours = 100) {
  const w = await makeWorld();
  const slot = await makeSlot(w.psychologists[0].id, w.segment.id, hours);
  return bookSlot({ slotId: slot.id, segmentId: w.segment.id, ...family(1) });
}

describe("e-mails", () => {
  it("confirmação para família, psicóloga e equipe, com os dados exigidos e HTML escapado", async () => {
    await saveSettings({ teamEmails: ["equipe@escola.com"] });
    const w = await makeWorld();
    const slot = await makeSlot(w.psychologists[0].id, w.segment.id);
    await bookSlot({ slotId: slot.id, segmentId: w.segment.id, ...family(1), guardianName: "Maria <b>Silva</b> Souza" });

    const r = await processNotifications();
    expect(r.sent).toBe(3);
    const sent = mail.sendMail.mock.calls.map((c) => c[0] as { to: string; subject: string; html: string });
    expect(sent.map((m) => m.to).sort()).toEqual(["equipe@escola.com", "familia1@teste.com", "psi0@t.com"]);
    const fam = sent.find((m) => m.to === "familia1@teste.com")!;
    for (const needle of ["Aluno 1", "Educação Infantil", "Psi 0", "Orientações para comparecimento"]) expect(fam.html).toContain(needle);
    expect(fam.html).not.toContain("<b>Silva</b>");
    expect(fam.html).toContain("&lt;b&gt;Silva&lt;/b&gt;");
  });

  it("falha do SMTP: reagenda com backoff, não perde o e-mail e marca FAILED após 5 tentativas", async () => {
    await booked();
    mail.sendMail.mockRejectedValue(new Error("SMTP down"));
    const r = await processNotifications();
    expect(r.failed).toBe(2);
    let rows = await prisma.notification.findMany();
    expect(rows.every((n) => n.status === "PENDING" && n.attempts === 1 && n.scheduledFor > new Date())).toBe(true);

    for (let i = 2; i <= 5; i++) await processNotifications(30, new Date(Date.now() + i * 24 * 3600_000));
    rows = await prisma.notification.findMany();
    expect(rows.every((n) => n.status === "FAILED" && n.attempts === 5)).toBe(true);
  });

  it("sem SMTP configurado nada é enviado nem descartado: fica na fila", async () => {
    delete process.env.SMTP_HOST;
    await booked();
    const r = await processNotifications();
    expect(r).toMatchObject({ sent: 0, smtpConfigured: false });
    expect(await prisma.notification.count({ where: { status: "PENDING" } })).toBe(2);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it("execuções simultâneas não enviam o mesmo e-mail duas vezes", async () => {
    await booked();
    await Promise.all([processNotifications(), processNotifications(), processNotifications()]);
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
  });

  it("cancelamento gera aviso à família e à psicóloga", async () => {
    const appt = await booked();
    await cancelAppointment({ appointmentId: appt.id });
    const types = (await prisma.notification.findMany()).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(["CANCELLATION_FAMILY", "CANCELLATION_PSYCHOLOGIST"]));
  });
});

describe("lembretes", () => {
  it("só dentro da antecedência configurada e sem duplicar", async () => {
    await saveSettings({ reminderHoursBefore: 24 });
    await booked(100); // longe: sem lembrete
    expect(await queueReminders()).toBe(0);

    await prisma.appointment.updateMany({ data: { startsAt: new Date(Date.now() + 20 * 3600_000), endsAt: new Date(Date.now() + 21 * 3600_000) } });
    expect(await queueReminders()).toBe(1);
    expect(await queueReminders()).toBe(0);
    expect(await prisma.notification.count({ where: { type: "REMINDER_FAMILY" } })).toBe(1);
  });
});

describe("LGPD: retenção", () => {
  it("anonimiza dados pessoais após o prazo e preserva os números dos relatórios", async () => {
    await saveSettings({ retentionMonths: 6 });
    const appt = await booked();
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { startsAt: new Date(Date.now() - 400 * 86400_000), endsAt: new Date(Date.now() - 400 * 86400_000 + 3600_000) },
    });
    const r = await runRetention();
    expect(r.anonymized).toBe(1);
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(a).toMatchObject({ guardianName: "Dado anonimizado", studentName: "Dado anonimizado", phone: "", email: "anonimizado@invalid", consentIp: null });
    expect(a.status).toBe("CONFIRMED");
    expect(a.anonymizedAt).not.toBeNull();
  });
});
