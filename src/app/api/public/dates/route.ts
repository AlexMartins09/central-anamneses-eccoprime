import { NextResponse } from "next/server";
import { z } from "zod";
import { publicDates } from "@/lib/public-availability";

export const dynamic = "force-dynamic";

const schema = z.object({ segmentId: z.string().min(1).max(40), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = schema.safeParse({ segmentId: url.searchParams.get("segmentId"), month: url.searchParams.get("month") });
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  const dates = await publicDates(parsed.data.segmentId, parsed.data.month);
  return NextResponse.json({ dates }, { headers: { "Cache-Control": "no-store" } });
}
