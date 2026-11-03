import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildAuthUrl } from "@/lib/google";
import { googleConfig } from "@/lib/env";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Inicia o OAuth do Google.
 *  ?kind=psychologist  -> a própria psicóloga conecta sua agenda (ou admin em nome de ?psi=<id>)
 *  ?kind=team          -> somente ADMIN: agenda geral da equipe
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const back = (msg: string) => NextResponse.redirect(`${appUrl()}/painel/google?erro=${encodeURIComponent(msg)}`);
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (!googleConfig().configured) return back("Google não configurado no servidor (GOOGLE_CLIENT_ID/SECRET).");

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");

  if (kind === "team") {
    if (user.role !== "ADMIN") return back("Somente o administrador conecta a agenda geral.");
    return NextResponse.redirect(await buildAuthUrl({ kind: "TEAM", psychologistId: null, userId: user.id }));
  }

  const psychologistId = user.role === "PSYCHOLOGIST" ? user.psychologistId : url.searchParams.get("psi");
  if (!psychologistId || (user.role !== "ADMIN" && user.role !== "PSYCHOLOGIST")) return back("Sem permissão.");
  if (user.role === "PSYCHOLOGIST" && psychologistId !== user.psychologistId) return back("Sem permissão.");
  return NextResponse.redirect(await buildAuthUrl({ kind: "PSYCHOLOGIST", psychologistId, userId: user.id }));
}
