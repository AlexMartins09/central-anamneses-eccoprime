import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processCalendarSync } from "@/lib/calendar-sync";
import { processNotifications, queueReminders } from "@/lib/notifications";
import { purgeOldAttempts } from "@/lib/rate-limit";
import { runRetention } from "@/lib/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Worker idempotente chamado a cada ~5 min pelo Render Cron Job:
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/process
 * - cria lembretes; - envia e-mails pendentes; - repete sincronizações com falha; - rotinas de retenção LGPD.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: (e as Error).message };
    }
  };
  await step("reminders", () => queueReminders());
  await step("calendar", () => processCalendarSync(50));
  await step("notifications", () => processNotifications(50));
  await step("housekeeping", async () => {
    await purgeOldAttempts();
    return runRetention();
  });
  return NextResponse.json({ ok: true, ...out });
}

export const GET = POST;
