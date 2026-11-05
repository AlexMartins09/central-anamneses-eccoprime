import type { Appointment, GoogleCalendarEvent, Psychologist, SchoolSegment } from "@prisma/client";
import { prisma } from "./db";
import { TZ } from "./time";
import { GoogleApiError, deleteEvent, upsertEvent, type EventBody } from "./google";
import { googleConfig } from "./env";

const MAX_ATTEMPTS = 10;

type Full = Appointment & { psychologist: Psychologist; segment: SchoolSegment };

/** Somente dados administrativos necessários — nenhum dado clínico vai para a agenda. */
export function buildEventBody(a: Full): EventBody {
  return {
    summary: `Anamnese – ${a.segment.name}`,
    description: [
      `Aluno(a): ${a.studentName}`,
      ...(a.studentClass ? [`Turma: ${a.studentClass}`] : []),
      `Responsável: ${a.guardianName}`,
      `Contato: ${a.phone}`,
      `Psicóloga: ${a.psychologist.name}`,
      `Código: ${a.code}`,
    ].join("\n"),
    start: { dateTime: a.startsAt.toISOString(), timeZone: TZ },
    end: { dateTime: a.endsAt.toISOString(), timeZone: TZ },
    extendedProperties: { private: { appointmentId: a.id, source: "central-anamneses" } },
  };
}

async function markSkipped(ev: GoogleCalendarEvent, reason: string) {
  await prisma.googleCalendarEvent.update({
    where: { id: ev.id },
    data: { status: "SKIPPED", lastError: reason, lastAttemptAt: new Date() },
  });
}

/** Sincroniza UM evento com o Google conforme o estado atual do agendamento. */
export async function syncEvent(eventId: string): Promise<"synced" | "skipped" | "failed" | "cancelled"> {
  const ev = await prisma.googleCalendarEvent.findUnique({
    where: { id: eventId },
    include: { appointment: { include: { psychologist: true, segment: true } } },
  });
  if (!ev) return "skipped";
  const appt = ev.appointment;

  try {
    if (!googleConfig().configured) {
      await markSkipped(ev, "Google não configurado no servidor (variáveis GOOGLE_CLIENT_ID/SECRET).");
      return "skipped";
    }

    // Agenda da psicóloga: se mudou de responsável, remove da agenda antiga primeiro.
    if (ev.target === "PSYCHOLOGIST" && ev.psychologistId && ev.psychologistId !== appt.psychologistId && ev.calendarId) {
      const old = await prisma.googleCalendarConnection.findFirst({
        where: { kind: "PSYCHOLOGIST", psychologistId: ev.psychologistId, active: true },
      });
      if (old) await deleteEvent(old, ev.calendarId, ev.googleEventId);
      await prisma.googleCalendarEvent.update({
        where: { id: ev.id },
        data: { psychologistId: appt.psychologistId, calendarId: null, syncedAt: null },
      });
      ev.calendarId = null;
      ev.syncedAt = null;
      ev.psychologistId = appt.psychologistId;
    }

    const ownerId = ev.target === "PSYCHOLOGIST" ? appt.psychologistId : null;
    const conn = await prisma.googleCalendarConnection.findFirst({
      where: ev.target === "TEAM" ? { kind: "TEAM" } : { kind: "PSYCHOLOGIST", psychologistId: ownerId },
    });
    if (!conn || !conn.active) {
      await markSkipped(
        ev,
        ev.target === "TEAM"
          ? "Agenda geral da equipe ainda não conectada (Painel > Google Agenda)."
          : "A psicóloga ainda não conectou a conta Google.",
      );
      return "skipped";
    }
    // A conexão é a fonte da verdade do calendário (ajustado em Google Agenda / Configurações).
    const calendarId = ev.calendarId ?? conn.calendarId;

    if (appt.status === "CANCELLED") {
      await deleteEvent(conn, calendarId, ev.googleEventId);
      await prisma.googleCalendarEvent.update({
        where: { id: ev.id },
        data: { status: "CANCELLED", lastError: null, syncedAt: new Date(), lastAttemptAt: new Date() },
      });
      return "cancelled";
    }

    await upsertEvent(conn, calendarId, ev.googleEventId, buildEventBody(appt), Boolean(ev.syncedAt));
    await prisma.googleCalendarEvent.update({
      where: { id: ev.id },
      data: {
        status: "SYNCED",
        calendarId,
        psychologistId: ownerId,
        lastError: null,
        syncedAt: new Date(),
        lastAttemptAt: new Date(),
        nextAttemptAt: null,
      },
    });
    return "synced";
  } catch (e) {
    const err = e as Error;
    if (e instanceof GoogleApiError && e.reconnectRequired) {
      await markSkipped(ev, err.message);
      return "skipped";
    }
    const attempts = ev.attempts + 1;
    await prisma.googleCalendarEvent.update({
      where: { id: ev.id },
      data: {
        status: "FAILED",
        attempts,
        lastError: err.message.slice(0, 500),
        lastAttemptAt: new Date(),
        nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000),
      },
    });
    return "failed";
  }
}

/** Processa fila: PENDING (novos) e FAILED (retentativas com backoff). */
export async function processCalendarSync(limit = 25, now = new Date()) {
  const due = await prisma.googleCalendarEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const out = { synced: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const ev of due) {
    // claim otimista para duas execuções simultâneas não processarem o mesmo evento
    const claim = await prisma.googleCalendarEvent.updateMany({
      where: { id: ev.id, status: ev.status, updatedAt: ev.updatedAt },
      data: { lastAttemptAt: now },
    });
    if (claim.count !== 1) continue;
    out[await syncEvent(ev.id)]++;
  }
  return out;
}

export async function syncAppointmentNow(appointmentId: string) {
  const events = await prisma.googleCalendarEvent.findMany({ where: { appointmentId } });
  for (const ev of events) await syncEvent(ev.id);
}

/** Depois de conectar uma conta, reabre eventos que estavam aguardando conexão. */
export async function requeueAfterConnect(kind: "PSYCHOLOGIST" | "TEAM", psychologistId: string | null) {
  await prisma.googleCalendarEvent.updateMany({
    where: {
      target: kind,
      status: { in: ["SKIPPED", "FAILED"] },
      appointment: {
        startsAt: { gt: new Date() },
        status: "CONFIRMED",
        ...(psychologistId ? { psychologistId } : {}),
      },
    },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
}

/** Botão "Tentar novamente" do painel. */
export async function retryEvent(eventId: string) {
  await prisma.googleCalendarEvent.update({
    where: { id: eventId },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
  return syncEvent(eventId);
}
