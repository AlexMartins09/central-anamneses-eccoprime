import { NextResponse } from "next/server";
import { z } from "zod";
import { publicSlots } from "@/lib/public-availability";

export const dynamic = "force-dynamic";

const schema = z.object({ segmentId: z.string().min(1).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = schema.safeParse({ segmentId: url.searchParams.get("segmentId"), date: url.searchParams.get("date") });
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  const slots = await publicSlots(parsed.data.segmentId, parsed.data.date);
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
}
