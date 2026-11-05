import type { Appointment, AvailabilitySlot, NotificationType, Psychologist, SchoolSegment } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { appUrl } from "./env";
import { fmtDate, fmtLongDate, fmtTime } from "./time";
import { getSettings, type AppSettings } from "./settings";
import { mailConfigured, sendMail } from "./mail";

const MAX_ATTEMPTS = 5;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Full = Appointment & { psychologist: Psychologist; segment: SchoolSegment; slot?: AvailabilitySlot };

function layout(s: AppSettings, title: string, inner: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<div style="background:hsl(${s.colorPrimary});color:#fff;padding:20px 24px"><div style="font-size:13px;opacity:.85">${esc(s.brandName)}</div>
<div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div></div>
<div style="padding:24px;font-size:15px;line-height:1.55">${inner}</div></div>
<p style="font-size:12px;color:#6b7280;text-align:center;margin-top:16px">Mensagem automática da Central de Agendamento de Anamneses. Não solicitamos nem registramos informações clínicas neste canal.</p>
</div></body></html>`;
}

function details(a: Full): string {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`;
  return `<table style="border-collapse:collapse;margin:12px 0">${[
    row("Código", a.code),
    row("Aluno(a)", a.studentName),
    ...(a.studentClass ? [row("Turma / série", a.studentClass)] : []),
    row("Responsável", a.guardianName),
    row("Segmento", a.segment.name),
    row("Data", fmtLongDate(a.startsAt)),
    row("Horário", `${fmtTime(a.startsAt)} às ${fmtTime(a.endsAt)}`),
    row("Psicóloga", a.psychologist.name),
  ].join("")}</table>`;
}

function familyBooking(s: AppSettings, a: Full) {
  return {
    subject: `Anamnese confirmada – ${fmtDate(a.startsAt)} às ${fmtTime(a.startsAt)}`,
    html: layout(
      s,
      "Agendamento confirmado",
      `<p>Olá, <strong>${esc(a.guardianName)}</strong>! Sua anamnese foi agendada com sucesso.</p>${details(a)}
<p><strong>Orientações para comparecimento</strong><br>${esc(s.attendanceInstructions).replace(/\n/g, "<br>")}</p>
${s.schoolContactPhone ? `<p>Dúvidas? Fale com a escola: <strong>${esc(s.schoolContactPhone)}</strong>.</p>` : ""}`,
    ),
  };
}

function staffBooking(s: AppSettings, a: Full, who: string) {
  return {
    subject: `Nova anamnese – ${a.segment.name} – ${fmtDate(a.startsAt)} ${fmtTime(a.startsAt)}`,
    html: layout(
      s,
      "Nova anamnese agendada",
      `<p>${esc(who)}, uma família realizou um novo agendamento.</p>${details(a)}
<p>Telefone: <strong>${esc(a.phone)}</strong><br>E-mail: <strong>${esc(a.email)}</strong></p>
<p><a href="${appUrl()}/painel/agendamentos">Abrir no painel</a></p>`,
    ),
  };
}

function cancellation(s: AppSettings, a: Full, forFamily: boolean) {
  return {
    subject: `Anamnese cancelada – ${fmtDate(a.startsAt)} às ${fmtTime(a.startsAt)}`,
    html: layout(
      s,
      "Agendamento cancelado",
      `<p>${forFamily ? `Olá, <strong>${esc(a.guardianName)}</strong>. ` : ""}O agendamento abaixo foi <strong>cancelado</strong>.</p>${details(a)}
${forFamily ? `<p>Se desejar, você pode escolher um novo horário em <a href="${appUrl()}/agendar">${appUrl()}/agendar</a>.</p>` : ""}`,
    ),
  };
}

function reschedule(s: AppSettings, a: Full, oldStart: Date) {
  return {
    subject: `Anamnese remarcada – ${fmtDate(a.startsAt)} às ${fmtTime(a.startsAt)}`,
    html: layout(
      s,
      "Agendamento remarcado",
      `<p>Olá, <strong>${esc(a.guardianName)}</strong>. Sua anamnese foi remarcada (antes: ${fmtDate(oldStart)} às ${fmtTime(oldStart)}).</p>${details(a)}
<p>${esc(s.attendanceInstructions).replace(/\n/g, "<br>")}</p>`,
    ),
  };
}

function reminder(s: AppSettings, a: Full) {
  return {
    subject: `Lembrete: anamnese em ${fmtDate(a.startsAt)} às ${fmtTime(a.startsAt)}`,
    html: layout(
      s,
      "Lembrete da sua anamnese",
      `<p>Olá, <strong>${esc(a.guardianName)}</strong>! Este é um lembrete do seu agendamento.</p>${details(a)}
<p>${esc(s.attendanceInstructions).replace(/\n/g, "<br>")}</p>`,
    ),
  };
}

async function load(tx: Tx, id: string): Promise<Full> {
  return tx.appointment.findUniqueOrThrow({ where: { id }, include: { psychologist: true, segment: true } });
}

async function enqueue(
  tx: Tx,
  rows: { appointmentId: string; type: NotificationType; to: string; subject: string; html: string; dedupeKey: string; scheduledFor?: Date }[],
) {
  if (!rows.length) return;
  await tx.notification.createMany({
    data: rows.map((r) => ({
      appointmentId: r.appointmentId,
      type: r.type,
      channel: "EMAIL" as const,
      toAddress: r.to,
      subject: r.subject,
      body: r.html,
      dedupeKey: r.dedupeKey,
      scheduledFor: r.scheduledFor ?? new Date(),
    })),
    skipDuplicates: true,
  });
}

export async function queueBookingNotifications(tx: Tx, appointmentId: string, s: AppSettings) {
  const a = await load(tx, appointmentId);
  const fam = familyBooking(s, a);
  const psy = staffBooking(s, a, `Olá, ${a.psychologist.name}`);
  const team = staffBooking(s, a, "Equipe de atendimento");
  await enqueue(tx, [
    { appointmentId, type: "BOOKING_FAMILY", to: a.email, ...fam, dedupeKey: `BOOKING_FAMILY:${appointmentId}` },
    { appointmentId, type: "BOOKING_PSYCHOLOGIST", to: a.psychologist.email, ...psy, dedupeKey: `BOOKING_PSYCHOLOGIST:${appointmentId}` },
    ...s.teamEmails.map((to) => ({
      appointmentId,
      type: "BOOKING_TEAM" as const,
      to,
      ...team,
      dedupeKey: `BOOKING_TEAM:${appointmentId}:${to}`,
    })),
  ]);
}

export async function queueCancellationNotifications(tx: Tx, appointmentId: string, s: AppSettings) {
  const a = await load(tx, appointmentId);
  await enqueue(tx, [
    { appointmentId, type: "CANCELLATION_FAMILY", to: a.email, ...cancellation(s, a, true), dedupeKey: `CANCEL_FAMILY:${appointmentId}` },
    { appointmentId, type: "CANCELLATION_PSYCHOLOGIST", to: a.psychologist.email, ...cancellation(s, a, false), dedupeKey: `CANCEL_PSY:${appointmentId}` },
  ]);
}

export async function queueRescheduleNotifications(tx: Tx, appointmentId: string, oldStart: Date, s: AppSettings) {
  const a = await load(tx, appointmentId);
  await enqueue(tx, [
    {
      appointmentId,
      type: "RESCHEDULE_FAMILY",
      to: a.email,
      ...reschedule(s, a, oldStart),
      dedupeKey: `RESCHEDULE_FAMILY:${appointmentId}:${a.startsAt.getTime()}`,
    },
  ]);
}

/** Cria lembretes para atendimentos dentro da janela configurada. Idempotente. */
export async function queueReminders(now = new Date()): Promise<number> {
  const s = await getSettings();
  if (!s.remindersEnabled) return 0;
  const horizon = new Date(now.getTime() + s.reminderHoursBefore * 3600_000);
  const due = await prisma.appointment.findMany({
    where: { status: "CONFIRMED", reminderSentAt: null, startsAt: { gt: now, lte: horizon } },
    include: { psychologist: true, segment: true },
    take: 200,
  });
  for (const a of due) {
    await prisma.$transaction(async (tx) => {
      await enqueue(tx, [
        {
          appointmentId: a.id,
          type: "REMINDER_FAMILY",
          to: a.email,
          ...reminder(s, a),
          dedupeKey: `REMINDER_FAMILY:${a.id}:${a.startsAt.getTime()}`,
        },
      ]);
      await tx.appointment.update({ where: { id: a.id }, data: { reminderSentAt: now } });
    });
  }
  return due.length;
}

/** Envia e-mails pendentes com retentativa exponencial. Seguro para execução repetida/concorrente. */
export async function processNotifications(limit = 30, now = new Date()) {
  const result = { sent: 0, failed: 0, skipped: 0, smtpConfigured: mailConfigured() };
  const pending = await prisma.notification.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  for (const n of pending) {
    if (n.channel === "WHATSAPP") {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "SKIPPED", lastError: "WhatsApp Business API ainda não conectada." },
      });
      result.skipped++;
      continue;
    }
    if (!result.smtpConfigured) {
      result.skipped++;
      continue; // permanece PENDING até o SMTP ser configurado
    }
    // "Claim" otimista para evitar envio duplo por execuções simultâneas
    const claim = await prisma.notification.updateMany({
      where: { id: n.id, status: "PENDING", attempts: n.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    try {
      await sendMail(n.toAddress, n.subject, n.body);
      await prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } });
      result.sent++;
    } catch (e) {
      const attempts = n.attempts + 1;
      await prisma.notification.update({
        where: { id: n.id },
        data: {
          status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          lastError: String((e as Error).message).slice(0, 500),
          scheduledFor: new Date(Date.now() + 2 ** attempts * 60_000),
        },
      });
      result.failed++;
    }
  }
  return result;
}
