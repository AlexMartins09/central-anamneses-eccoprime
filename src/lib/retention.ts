import { prisma } from "./db";
import { getSettings } from "./settings";

/**
 * Retenção LGPD: após `retentionMonths` do atendimento, os dados pessoais são anonimizados
 * (contagens e relatórios continuam válidos) e e-mails enviados com dados pessoais são apagados.
 */
export async function runRetention(now = new Date()) {
  const s = await getSettings();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - s.retentionMonths);

  const anonymized = await prisma.appointment.updateMany({
    where: { startsAt: { lt: cutoff }, anonymizedAt: null },
    data: {
      guardianName: "Dado anonimizado",
      studentName: "Dado anonimizado",
      studentClass: null,
      phone: "",
      email: "anonimizado@invalid",
      consentIp: null,
      anonymizedAt: now,
    },
  });
  const mailCutoff = new Date(now.getTime() - 90 * 86400_000);
  const mails = await prisma.notification.deleteMany({
    where: { status: { in: ["SENT", "SKIPPED", "FAILED"] }, createdAt: { lt: mailCutoff } },
  });
  return { anonymized: anonymized.count, notificationsDeleted: mails.count };
}
