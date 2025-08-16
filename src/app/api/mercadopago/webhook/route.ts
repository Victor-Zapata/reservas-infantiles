// src/app/api/mercadopago/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_HOUR_FALLBACK = 10;

const addHoursTo = (hhmm: string, add: number): string | null => {
  const base = Number(hhmm.slice(0,2));
  if (!Number.isFinite(base)) return null;
  const h = base + add;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2,"0")}:00`;
};

// (Opcional) ping rápido para testear conectividad
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  console.log("[WEBHOOK][GET] ping", Object.fromEntries(url.searchParams));
  return NextResponse.json({ ok: true, ping: true });
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const paymentIdQS = url.searchParams.get("data.id") || url.searchParams.get("id");

    let body: any = {};
    try { body = await req.json(); } catch {}
    const paymentIdBody = body?.data?.id || body?.id;

    const paymentId = String(paymentIdQS || paymentIdBody || "");
    if (!paymentId) {
      // ⚠️ No cortar: algunos envíos vienen sin query params; si no hay body tampoco, sólo logueamos y 200.
      console.warn("[WEBHOOK] sin payment id en request");
      return NextResponse.json({ ok:true, ignored:true, reason:"no-payment-id" });
    }

    const token = process.env.MP_ACCESS_TOKEN!;
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const pay = await resp.json();

    const status = String(pay?.status || ""); // pending | in_process | approved | rejected | ...
    // Guardamos/actualizamos evento como LOG (no corta la ejecución)
    await prisma.paymentEvent.upsert({
      where: { id: paymentId },
      update: { status, raw: pay },
      create: { id: paymentId, status, raw: pay },
    });

    // Idempotencia REAL: si ya registramos este Payment, devolvemos 200
    const alreadyPayment = await prisma.payment.findFirst({
      where: { provider: "mercadopago", providerId: String(pay?.id || "") },
    });
    if (alreadyPayment) {
      return NextResponse.json({ ok:true, idempotent:true, note:"payment ya registrado" });
    }

    // ⛳️ CLAVE: para estados NO aprobados, devolvemos 200 y salimos SIN exigir metadata
    if (status !== "approved") {
      console.log("[WEBHOOK] pago no aprobado aún:", { status, id: paymentId });
      return NextResponse.json({ ok:true, ignored:true, status });
    }

    // A partir de acá, SÍ exigimos metadata para descontar cupo y confirmar
    const md = pay?.metadata || {};
    const reservationId: string | null =
      (md?.reservationId && String(md.reservationId)) ||
      (pay?.external_reference ? String(pay.external_reference) : null);

    if (!reservationId) {
      // No cortamos con 400: log y 200 para que MP no reintente eternamente
      console.error("[WEBHOOK] approved pero sin reservationId en metadata/external_reference");
      return NextResponse.json({ ok:true, ignored:true, reason:"approved-without-reservationId" });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { children: true },
    });
    if (!reservation) {
      console.error("[WEBHOOK] reserva no encontrada:", reservationId);
      return NextResponse.json({ ok:true, ignored:true, reason:"reservation-not-found" });
    }

    const fecha = String(md?.fecha || reservation.date || "");
    const horaInicio = String(md?.hora || `${String(reservation.hour).padStart(2,"0")}:00`);
    let childrenHours: number[] = Array.isArray(md?.childrenHours)
      ? md.childrenHours.map((n:any)=>Number(n)||0)
      : reservation.children.map((rc:any) => rc.hours || 0);

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:00$/.test(horaInicio) || childrenHours.length === 0) {
      console.error("[WEBHOOK] approved pero metadata incompleta", { fecha, horaInicio, childrenHours });
      return NextResponse.json({ ok:true, ignored:true, reason:"approved-without-metadata" });
    }

    const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
    const MAX = cfg?.maxPerHour ?? MAX_PER_HOUR_FALLBACK;

    const maxHoras = Math.max(...childrenHours);
    const updates: Array<{ date: string; hour: number; inc: number }> = [];
    for (let i = 0; i < maxHoras; i++) {
      const inc = childrenHours.filter(h => h > i).length;
      if (inc <= 0) continue;
      const hhmm = addHoursTo(horaInicio, i);
      if (!hhmm) continue;
      updates.push({ date: fecha, hour: Number(hhmm.slice(0,2)), inc });
    }

    const paidAmount = Math.round(Number(pay?.transaction_amount || 0));
    const kind: "deposit" | "remainder" | "full" =
      paidAmount >= (reservation.totalAmount || 0) ? "full"
      : Math.abs(paidAmount - (reservation.depositAmount || 0)) <= 1 ? "deposit"
      : "remainder";

    // Transacción: valida tope, descuenta stock, registra Payment y confirma reserva
    await prisma.$transaction(async (tx:any) => {
      for (const u of updates) {
        const row = await tx.slotStock.findUnique({ where: { date_hour: { date: u.date, hour: u.hour } } });
        const used = row?.used ?? 0;
        if (used + u.inc > MAX) {
          throw new Error(`Sin cupo en ${u.date} ${String(u.hour).padStart(2,"0")}:00 (used=${used}, inc=${u.inc})`);
        }
        await tx.slotStock.upsert({
          where: { date_hour: { date: u.date, hour: u.hour } },
          create: { date: u.date, hour: u.hour, used: used + u.inc },
          update: { used: used + u.inc },
        });
      }

      await tx.payment.create({
        data: {
          provider: "mercadopago",
          providerId: String(pay?.id || ""),
          reservationId: reservation.id,
          amount: paidAmount,
          kind,
          status: "approved",
          raw: pay,
        },
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "confirmed" },
      });
    });

    console.log("[WEBHOOK] discounted + payment recorded", { paymentId, updates });
    return NextResponse.json({ ok:true, discounted:true, updates });
  } catch (e:any) {
    console.error("[WEBHOOK] error:", e);
    return NextResponse.json({ ok:false, error: e?.message || "error" }, { status: 500 });
  }
}



