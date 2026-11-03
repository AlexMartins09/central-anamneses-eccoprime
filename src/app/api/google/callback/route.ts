import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/env";
import { completeConnection, readState } from "@/lib/google";
import { processCalendarSync, requeueAfterConnect } from "@/lib/calendar-sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = (q: string) => NextResponse.redirect(`${appUrl()}/painel/google?${q}`);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);

  if (url.searchParams.get("error")) return to(`erro=${encodeURIComponent("Autorização negada no Google.")}`);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken) return to("erro=Resposta+inv%C3%A1lida+do+Google.");

  try {
    const state = await readState(stateToken);
    // O state precisa pertencer ao usuário logado (evita fixação/CSRF no fluxo OAuth)
    if (state.userId !== user.id) return to("erro=Sess%C3%A3o+diferente+da+que+iniciou+a+conex%C3%A3o.");
    if (state.kind === "TEAM" && user.role !== "ADMIN") return to("erro=Sem+permiss%C3%A3o.");
    if (state.kind === "PSYCHOLOGIST" && user.role === "PSYCHOLOGIST" && state.psychologistId !== user.psychologistId) return to("erro=Sem+permiss%C3%A3o.");

    const conn = await completeConnection(code, state);
    await audit({ userId: user.id, action: "GOOGLE_CONNECTED", entityType: "GoogleCalendarConnection", entityId: conn.id, details: { kind: state.kind, googleEmail: conn.googleEmail } });
    await requeueAfterConnect(state.kind, state.psychologistId);
    after(() => processCalendarSync(50).catch((e) => console.error("[google:callback]", e)));
    return to("ok=1");
  } catch (e) {
    console.error("[google:callback]", e);
    return to(`erro=${encodeURIComponent((e as Error).message?.slice(0, 200) || "Falha ao conectar.")}`);
  }
}
