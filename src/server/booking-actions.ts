"use server";

import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { bookSlot } from "@/lib/booking";
import { run, str, type ActionState } from "@/lib/action";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { classSchema, emailSchema, idSchema, nameSchema, phoneSchema } from "@/lib/validation";
import { syncAppointmentNow } from "@/lib/calendar-sync";
import { processNotifications } from "@/lib/notifications";
import { mailConfigured } from "@/lib/mail";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { formatPhone } from "@/lib/utils";

const schema = z.object({
  slotId: idSchema,
  segmentId: idSchema,
  guardianName: nameSchema("responsável"),
  studentName: nameSchema("aluno"),
  studentClass: classSchema,
  phone: phoneSchema,
  email: emailSchema,
  consent: z.literal("on", { message: "É necessário aceitar a Política de Privacidade para continuar." }),
});

const HOUR = 3600_000;

/** Confirmação pública. TODA a validação definitiva (disponibilidade, antecedência, duplicidade) ocorre no backend. */
export async function createBookingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    // Honeypot: campo invisível que humanos não preenchem
    if (str(fd, "website")) return { ok: false, error: "Não foi possível concluir. Tente novamente." };

    const ip = (await clientIp()) ?? "unknown";
    const key = `booking:ip:${ip}`;
    if (await isRateLimited(key, 8, HOUR)) {
      return { ok: false, error: "Muitas tentativas de agendamento a partir deste dispositivo. Aguarde um pouco ou fale com a escola." };
    }
    await recordAttempt(key, true);

    const d = schema.parse({
      slotId: str(fd, "slotId"),
      segmentId: str(fd, "segmentId"),
      guardianName: str(fd, "guardianName"),
      studentName: str(fd, "studentName"),
      studentClass: str(fd, "studentClass"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      consent: str(fd, "consent"),
    });

    const appt = await bookSlot({
      slotId: d.slotId,
      segmentId: d.segmentId,
      guardianName: d.guardianName,
      studentName: d.studentName,
      studentClass: d.studentClass,
      phone: d.phone,
      email: d.email,
      consentIp: ip === "unknown" ? null : ip,
    });

    // Google Calendar e e-mails rodam DEPOIS da resposta; se falharem, o cron reprocessa (outbox).
    after(async () => {
      try {
        await syncAppointmentNow(appt.id);
        await processNotifications(10);
      } catch (e) {
        console.error("[booking:after]", e);
      }
    });

    const full = await prisma.appointment.findUniqueOrThrow({
      where: { id: appt.id },
      include: { psychologist: { select: { name: true } }, segment: { select: { name: true } } },
    });
    return {
      ok: true,
      data: {
        code: full.code,
        guardianName: full.guardianName,
        studentName: full.studentName,
        studentClass: full.studentClass ?? "",
        phone: formatPhone(full.phone),
        email: full.email,
        segment: full.segment.name,
        psychologist: full.psychologist.name,
        date: fmtDate(full.startsAt),
        longDate: fmtLongDate(full.startsAt),
        time: `${fmtTime(full.startsAt)} às ${fmtTime(full.endsAt)}`,
        emailEnabled: mailConfigured(),
      },
    };
  });
}
