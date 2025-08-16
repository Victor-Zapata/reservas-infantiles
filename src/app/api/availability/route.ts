import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok:false, error:"Parámetro 'date' (YYYY-MM-DD) requerido." }, { status: 400 });
  }

  const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
  const MAX = cfg?.maxPerHour ?? 10;
  const OPEN = 9, CLOSE = 20;

  const rows = await prisma.slotStock.findMany({ where: { date } });
  const map = new Map<number, number>();
  rows.forEach((r: any) => map.set(r.hour, r.used));

  const hours = [];
  for (let h = OPEN; h <= CLOSE; h++) {
    const used = map.get(h) ?? 0;
    hours.push({ time: `${String(h).padStart(2,"0")}:00`, remaining: Math.max(0, MAX - used) });
  }

  return NextResponse.json({ ok:true, date, max: MAX, hours });
}
