import { Prisma, type Appointment } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { generateAppointmentCode, googleEventId } from "./crypto";
import { getSettings, PRIVACY_VERSION } from "./settings";
import { queueBookingNotifications, queueCancellationNotifications, queueRescheduleNotifications } from "./notifications";

export type BookingErrorCode =
  | "SLOT_UNAVAILABLE"
  | "SLOT_IN_PAST"
  | "TOO_SOON"
  | "TOO_FAR"
  | "SEGMENT_MISMATCH"
  | "DUPLICATE_FAMILY"
  | "NOT_FOUND"
  | "ALREADY_CANCELLED"
  | "INVALID";

export class BookingError extends Error {
  constructor(public code: BookingErrorCode, message: string) {
    super(message);
  }
}

export const BOOKING_MESSAGES: Record<BookingErrorCode, string> = {
  SLOT_UNAVAILABLE: "Este horário acabou de ser reservado por outra família. Escolha outro horário.",
  SLOT_IN_PAST: "Este horário já passou.",
  TOO_SOON: "Este horário não está mais disponível para agendamento online (antecedência mínima).",
  TOO_FAR: "Este horário ainda não está aberto para agendamento.",
  SEGMENT_MISMATCH: "O horário escolhido não pertence ao segmento selecionado.",
  DUPLICATE_FAMILY: "Já existe um agendamento ativo para este aluno com este e-mail. Para alterar, fale com a escola.",
  NOT_FOUND: "Agendamento ou horário não encontrado.",
  ALREADY_CANCELLED: "Este agendamento já foi cancelado.",
  INVALID: "Dados inválidos.",
};

/** Transações curtas, mas com folga para picos de concorrência (fila no lock da linha). */
const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

const fail = (code: BookingErrorCode) => new BookingError(code, BOOKING_MESSAGES[code]);

export type BookInput = {
  slotId: string;
  segmentId: string;
  guardianName: string;
  studentName: string;
  studentClass?: string | null;
  phone: string;
  email: string;
  consentIp?: string | null;
  /** Agendamento feito pela equipe (ignora antecedência mínima e duplicidade). */
  byStaff?: boolean;
  now?: Date;
};

/** Reserva ATÔMICA de um horário. Toda a validação definitiva acontece aqui, dentro da transação. */
export async function bookSlot(input: BookInput): Promise<Appointment> {
  const now = input.now ?? new Date();
  const settings = await getSettings();

  const run = () =>
    prisma.$transaction(async (tx) => {
      // 1) Reserva condicional: só um UPDATE consegue mudar AVAILABLE -> BOOKED.
      //    Requisições concorrentes aguardam o lock da linha, reavaliam o WHERE e recebem count = 0.
      const claimed = await tx.availabilitySlot.updateMany({
        where: { id: input.slotId, status: "AVAILABLE" },
        data: { status: "BOOKED" },
      });
      if (claimed.count !== 1) {
        const exists = await tx.availabilitySlot.findUnique({ where: { id: input.slotId }, select: { id: true } });
        throw fail(exists ? "SLOT_UNAVAILABLE" : "NOT_FOUND");
      }

      const slot = await tx.availabilitySlot.findUniqueOrThrow({
        where: { id: input.slotId },
        include: { psychologist: true },
      });

      if (slot.segmentId !== input.segmentId) throw fail("SEGMENT_MISMATCH");
      if (!slot.psychologist.active || slot.psychologist.deletedAt) throw fail("SLOT_UNAVAILABLE");
      if (slot.startsAt <= now) throw fail("SLOT_IN_PAST");
      if (!input.byStaff) {
        if (slot.startsAt.getTime() - now.getTime() < settings.minLeadHours * 3600_000) throw fail("TOO_SOON");
        if (slot.startsAt.getTime() - now.getTime() > settings.maxDaysAhead * 86400_000) throw fail("TOO_FAR");

        const dup = await tx.appointment.findFirst({
          where: {
            email: { equals: input.email, mode: "insensitive" },
            studentName: { equals: input.studentName, mode: "insensitive" },
            status: "CONFIRMED",
            startsAt: { gt: now },
          },
          select: { id: true },
        });
        if (dup) throw fail("DUPLICATE_FAMILY");
      }

      // 2) Cria o agendamento. O índice único parcial é a rede de segurança final.
      const appointment = await tx.appointment.create({
        data: {
          code: generateAppointmentCode(),
          slotId: slot.id,
          psychologistId: slot.psychologistId,
          segmentId: slot.segmentId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          guardianName: input.guardianName,
          studentName: input.studentName,
          studentClass: input.studentClass || null,
          phone: input.phone,
          email: input.email.toLowerCase(),
          consentAt: now,
          consentVersion: PRIVACY_VERSION,
          consentIp: input.consentIp ?? null,
        },
      });

      // 3) Outbox: sincronização com Google e e-mails ficam registrados na MESMA transação.
      await tx.googleCalendarEvent.createMany({
        data: [
          {
            appointmentId: appointment.id,
            target: "PSYCHOLOGIST",
            googleEventId: googleEventId(appointment.id, "PSYCHOLOGIST"),
            psychologistId: slot.psychologistId,
          },
          { appointmentId: appointment.id, target: "TEAM", googleEventId: googleEventId(appointment.id, "TEAM") },
        ],
      });
      await queueBookingNotifications(tx, appointment.id, settings);
      return appointment;
    }, TX_OPTIONS);

  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw fail("SLOT_UNAVAILABLE");
    throw e;
  }
}

export type CancelInput = { appointmentId: string; byUserId?: string | null; reason?: string | null; releaseSlot?: boolean };

/** Cancela, libera o horário (por padrão) e marca os eventos do Google para remoção. */
export async function cancelAppointment(input: CancelInput): Promise<Appointment> {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appt) throw fail("NOT_FOUND");
    if (appt.status === "CANCELLED") throw fail("ALREADY_CANCELLED");

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: input.byUserId ?? null,
        cancelReason: input.reason ?? null,
      },
    });
    await tx.availabilitySlot.update({
      where: { id: appt.slotId },
      data: { status: input.releaseSlot === false ? "BLOCKED" : "AVAILABLE", blockReason: input.releaseSlot === false ? "Cancelado" : null },
    });
    await markEventsPending(tx, appt.id);
    await queueCancellationNotifications(tx, appt.id, settings);
    return updated;
  });
}

/** Remarca para outro horário livre de forma atômica (inclui troca de psicóloga/segmento). */
export async function rescheduleAppointment(input: {
  appointmentId: string;
  newSlotId: string;
  byUserId?: string | null;
  now?: Date;
}): Promise<Appointment> {
  const now = input.now ?? new Date();
  const settings = await getSettings();
  try {
    return await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
      if (!appt) throw fail("NOT_FOUND");
      if (appt.status !== "CONFIRMED") throw fail("ALREADY_CANCELLED");
      if (appt.slotId === input.newSlotId) throw fail("INVALID");

      const claimed = await tx.availabilitySlot.updateMany({
        where: { id: input.newSlotId, status: "AVAILABLE", startsAt: { gt: now } },
        data: { status: "BOOKED" },
      });
      if (claimed.count !== 1) throw fail("SLOT_UNAVAILABLE");
      const slot = await tx.availabilitySlot.findUniqueOrThrow({ where: { id: input.newSlotId } });

      // Libera o horário antigo antes de apontar para o novo (o índice parcial é por slot ativo).
      await tx.availabilitySlot.update({ where: { id: appt.slotId }, data: { status: "AVAILABLE" } });
      const updated = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          slotId: slot.id,
          psychologistId: slot.psychologistId,
          segmentId: slot.segmentId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          reminderSentAt: null,
        },
      });
      await markEventsPending(tx, appt.id);
      await queueRescheduleNotifications(tx, appt.id, appt.startsAt, settings);
      return updated;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw fail("SLOT_UNAVAILABLE");
    throw e;
  }
}

/** Reabre os eventos do Google para sincronizar (criar/atualizar/remover conforme o estado do agendamento). */
async function markEventsPending(tx: Tx, appointmentId: string) {
  await tx.googleCalendarEvent.updateMany({
    where: { appointmentId },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
}
