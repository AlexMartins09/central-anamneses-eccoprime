"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActionError, requireUserForAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, str, type ActionState } from "@/lib/action";
import { bookSlot, cancelAppointment, rescheduleAppointment } from "@/lib/booking";
import { assertCanManageAppointment } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { retryEvent, syncAppointmentNow } from "@/lib/calendar-sync";
import { processNotifications } from "@/lib/notifications";
import { emailSchema, idSchema, nameSchema, optionalClassSchema, phoneSchema } from "@/lib/validation";

function refresh() {
  for (const p of ["/painel", "/painel/agendamentos", "/painel/agenda", "/painel/disponibilidade"]) revalidatePath(p);
}

/** Sincroniza com o Google e envia e-mails após a resposta; falhas ficam na fila para o cron. */
function background(appointmentId: string) {
  after(async () => {
    try {
      await syncAppointmentNow(appointmentId);
      await processNotifications(10);
    } catch (e) {
      console.error("[appointment:after]", e);
    }
  });
}

async function loadManaged(fd: FormData) {
  const me = await requireUserForAction(["ADMIN", "COORDINATION", "PSYCHOLOGIST"]);
  const appt = await prisma.appointment.findUnique({ where: { id: idSchema.parse(str(fd, "appointmentId")) } });
  if (!appt) throw new ActionError("Agendamento não encontrado.");
  assertCanManageAppointment(me, appt, await getSettings());
  return { me, appt };
}

export async function cancelAppointmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { me, appt } = await loadManaged(fd);
    const reason = str(fd, "reason").slice(0, 300);
    await cancelAppointment({ appointmentId: appt.id, byUserId: me.id, reason: reason || null });
    await audit({ userId: me.id, action: "APPOINTMENT_CANCELLED", entityType: "Appointment", entityId: appt.id, details: { code: appt.code, reason } });
    background(appt.id);
    refresh();
    return { ok: true, message: "Agendamento cancelado e horário liberado." };
  });
}

export async function rescheduleAppointmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { me, appt } = await loadManaged(fd);
    const newSlotId = idSchema.parse(str(fd, "newSlotId"));
    await rescheduleAppointment({ appointmentId: appt.id, newSlotId, byUserId: me.id });
    await audit({ userId: me.id, action: "APPOINTMENT_RESCHEDULED", entityType: "Appointment", entityId: appt.id, details: { code: appt.code, newSlotId } });
    background(appt.id);
    refresh();
    return { ok: true, message: "Agendamento remarcado. A família será avisada por e-mail." };
  });
}

const editSchema = z.object({
  guardianName: nameSchema("responsável"),
  studentName: nameSchema("aluno"),
  studentClass: optionalClassSchema,
  phone: phoneSchema,
  email: emailSchema,
  status: z.enum(["CONFIRMED", "COMPLETED", "NO_SHOW"]),
});

export async function updateAppointmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { me, appt } = await loadManaged(fd);
    if (appt.status === "CANCELLED") throw new ActionError("Agendamentos cancelados não podem ser editados.");
    const d = editSchema.parse({
      guardianName: str(fd, "guardianName"), studentName: str(fd, "studentName"), studentClass: str(fd, "studentClass"),
      phone: str(fd, "phone"), email: str(fd, "email"), status: str(fd, "status"),
    });
    await prisma.$transaction([
      prisma.appointment.update({ where: { id: appt.id }, data: d }),
      // os dados administrativos do evento no Google mudaram: reenviar
      prisma.googleCalendarEvent.updateMany({ where: { appointmentId: appt.id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: null } }),
    ]);
    await audit({ userId: me.id, action: "APPOINTMENT_UPDATED", entityType: "Appointment", entityId: appt.id, details: { code: appt.code, status: d.status } });
    background(appt.id);
    refresh();
    return { ok: true, message: "Agendamento atualizado." };
  });
}

/** Agendamento feito pela equipe (por telefone/presencial). Ignora antecedência mínima. */
export async function createAppointmentByStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "COORDINATION"]);
    const slotId = idSchema.parse(str(fd, "slotId"));
    const slot = await prisma.availabilitySlot.findUnique({ where: { id: slotId } });
    if (!slot) throw new ActionError("Horário não encontrado.");
    const d = editSchema.omit({ status: true }).parse({
      guardianName: str(fd, "guardianName"), studentName: str(fd, "studentName"), studentClass: str(fd, "studentClass"),
      phone: str(fd, "phone"), email: str(fd, "email"),
    });
    const appt = await bookSlot({ slotId, segmentId: slot.segmentId, ...d, byStaff: true });
    await audit({ userId: me.id, action: "APPOINTMENT_CREATED_BY_STAFF", entityType: "Appointment", entityId: appt.id, details: { code: appt.code } });
    background(appt.id);
    refresh();
    return { ok: true, message: `Agendamento criado: ${appt.code}.` };
  });
}

export async function retrySyncAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST", "COORDINATION"]);
    const ev = await prisma.googleCalendarEvent.findUniqueOrThrow({ where: { id: idSchema.parse(str(fd, "eventId")) }, include: { appointment: true } });
    assertCanManageAppointment(me, ev.appointment, await getSettings());
    const result = await retryEvent(ev.id);
    refresh();
    return result === "failed"
      ? { ok: false, error: "A sincronização falhou novamente. Veja o detalhe do erro no agendamento." }
      : { ok: true, message: result === "skipped" ? "Aguardando conexão com o Google." : "Sincronizado com o Google Agenda." };
  });
}

export async function retryNotificationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requireUserForAction(["ADMIN"]);
    await prisma.notification.update({
      where: { id: idSchema.parse(str(fd, "notificationId")) },
      data: { status: "PENDING", attempts: 0, scheduledFor: new Date(), lastError: null },
    });
    const r = await processNotifications(5);
    revalidatePath("/painel/configuracoes");
    return { ok: true, message: r.smtpConfigured ? "Reenvio solicitado." : "E-mail ainda não configurado (SMTP): permanece na fila." };
  });
}
