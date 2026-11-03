"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActionError, requireUserForAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, bool, str, type ActionState } from "@/lib/action";
import { saveSettings, settingsSchema } from "@/lib/settings";
import { GoogleApiError, revokeConnection, testCalendarAccess } from "@/lib/google";
import { requeueAfterConnect } from "@/lib/calendar-sync";
import { idSchema } from "@/lib/validation";
import { runRetention } from "@/lib/retention";

export async function saveSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const teamEmails = str(fd, "teamEmails").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const data = settingsSchema.parse({
      brandName: str(fd, "brandName"),
      brandTagline: str(fd, "brandTagline"),
      logoUrl: str(fd, "logoUrl"),
      colorPrimary: str(fd, "colorPrimary"),
      colorAccent: str(fd, "colorAccent"),
      welcomeText: str(fd, "welcomeText"),
      defaultDurationMinutes: Number(str(fd, "defaultDurationMinutes")),
      minLeadHours: Number(str(fd, "minLeadHours")),
      maxDaysAhead: Number(str(fd, "maxDaysAhead")),
      reminderHoursBefore: Number(str(fd, "reminderHoursBefore")),
      remindersEnabled: bool(fd, "remindersEnabled"),
      teamEmails,
      attendanceInstructions: str(fd, "attendanceInstructions"),
      schoolContactPhone: str(fd, "schoolContactPhone"),
      teamCalendarId: str(fd, "teamCalendarId") || "primary",
      coordinationCanCancel: bool(fd, "coordinationCanCancel"),
      retentionMonths: Number(str(fd, "retentionMonths")),
      privacyContactEmail: str(fd, "privacyContactEmail"),
    });
    await saveSettings(data);
    // mantém a conexão da agenda geral alinhada com o ID informado aqui
    await prisma.googleCalendarConnection.updateMany({ where: { kind: "TEAM" }, data: { calendarId: data.teamCalendarId } });
    await audit({ userId: me.id, action: "SETTINGS_UPDATED", entityType: "SystemSetting", entityId: "app", details: { keys: Object.keys(data) } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Configurações salvas." };
  });
}

/** Define o calendário (ID) da conta conectada que receberá os eventos e testa o acesso de escrita. */
export async function setCalendarIdAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const conn = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { id: idSchema.parse(str(fd, "connectionId")) } });
    if (conn.kind === "TEAM" && me.role !== "ADMIN") throw new ActionError("Sem permissão.");
    if (conn.kind === "PSYCHOLOGIST" && me.role === "PSYCHOLOGIST" && conn.psychologistId !== me.psychologistId) throw new ActionError("Sem permissão.");
    const calendarId = z.string().trim().min(1).max(300).parse(str(fd, "calendarId") || "primary");
    try {
      await testCalendarAccess(conn, calendarId);
    } catch (e) {
      if (e instanceof GoogleApiError) throw new ActionError(e.message);
      throw e;
    }
    await prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { calendarId, lastError: null } });
    if (conn.kind === "TEAM") await saveSettings({ teamCalendarId: calendarId });
    await requeueAfterConnect(conn.kind, conn.psychologistId);
    await audit({ userId: me.id, action: "GOOGLE_CALENDAR_SET", entityType: "GoogleCalendarConnection", entityId: conn.id, details: { calendarId } });
    revalidatePath("/painel/google");
    return { ok: true, message: "Calendário validado e salvo." };
  });
}

export async function disconnectGoogleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN", "PSYCHOLOGIST"]);
    const conn = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { id: idSchema.parse(str(fd, "connectionId")) } });
    if (conn.kind === "TEAM" && me.role !== "ADMIN") throw new ActionError("Sem permissão.");
    if (conn.kind === "PSYCHOLOGIST" && me.role === "PSYCHOLOGIST" && conn.psychologistId !== me.psychologistId) throw new ActionError("Sem permissão.");
    await revokeConnection(conn);
    await prisma.googleCalendarConnection.delete({ where: { id: conn.id } });
    await audit({ userId: me.id, action: "GOOGLE_DISCONNECTED", entityType: "GoogleCalendarConnection", entityId: conn.id, details: { kind: conn.kind } });
    revalidatePath("/painel/google");
    return { ok: true, message: "Conta Google desconectada." };
  });
}

export async function runRetentionAction(_p: ActionState): Promise<ActionState> {
  return run(async () => {
    const me = await requireUserForAction(["ADMIN"]);
    const r = await runRetention();
    await audit({ userId: me.id, action: "RETENTION_RUN", entityType: "SystemSetting", details: r });
    return { ok: true, message: `${r.anonymized} agendamento(s) anonimizado(s); ${r.notificationsDeleted} e-mail(s) antigo(s) removido(s).` };
  });
}
