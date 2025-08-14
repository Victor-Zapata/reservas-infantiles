import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Config rápida */
const MAX_CAPACITY_PER_HOUR = 10;
const OPENING_HOUR = 9;   // 09:00
const CLOSING_HOUR = 20;  // 20:00 (muestra 09..20 inclusive)

/** Persistencia simple en archivo (para dev local) */
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "availability.json");

type Store = Record<string, number>; // "YYYY-MM-DD|HH" -> usados

async function ensureStoreDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

async function readStore(): Promise<Store> {
  try {
    await ensureStoreDir();
    const buf = await fs.readFile(DATA_FILE, "utf8");
    const json = JSON.parse(buf);
    return (json && typeof json === "object") ? json as Store : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await ensureStoreDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(store), "utf8");
}

/** GET /api/availability?date=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "Parámetro 'date' (YYYY-MM-DD) requerido." },
      { status: 400 }
    );
  }

  const store = await readStore();
  const hours: Array<{ time: string; remaining: number }> = [];

  for (let h = OPENING_HOUR; h <= CLOSING_HOUR; h++) {
    const hh = String(h).padStart(2, "0");
    const key = `${date}|${hh}`;
    const used = store[key] ?? 0;
    const remaining = Math.max(0, MAX_CAPACITY_PER_HOUR - used);
    hours.push({ time: `${hh}:00`, remaining });
  }

  return NextResponse.json({ ok: true, date, max: MAX_CAPACITY_PER_HOUR, hours });
}

/**
 * POST /api/availability
 * body: { date: "YYYY-MM-DD", hour: "HH:00", count: number }
 * Incrementa cupos usados de ese bloque.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = String(body?.date || "");
    const hour = String(body?.hour || "");
    const count = Number(body?.count || 0);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ ok: false, error: "date inválida" }, { status: 400 });
    if (!/^\d{2}:00$/.test(hour))
      return NextResponse.json({ ok: false, error: "hour inválida (HH:00)" }, { status: 400 });
    if (!Number.isFinite(count) || count <= 0)
      return NextResponse.json({ ok: false, error: "count inválido" }, { status: 400 });

    const hourNum = Number(hour.slice(0, 2));
    if (hourNum < OPENING_HOUR || hourNum > CLOSING_HOUR)
      return NextResponse.json({ ok: false, error: "Hora fuera de rango" }, { status: 400 });

    const store = await readStore();
    const key = `${date}|${String(hourNum).padStart(2, "0")}`;

    const used = store[key] ?? 0;
    if (used + count > MAX_CAPACITY_PER_HOUR) {
      return NextResponse.json({ ok: false, error: "Sin cupo suficiente" }, { status: 409 });
    }

    store[key] = used + count;
    await writeStore(store);

    return NextResponse.json({ ok: true, date, hour, used: store[key] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}
