// src/app/api/mercadopago/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
// ❌ No importamos el enum de Prisma para evitar choques de tipos
// import { ReservationStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_HOUR_FALLBACK = 10;
// Usamos string literal estable para el estado final
const STATUS_COMPLETED = "completed" as const;

const addHoursTo = (hhmm: string, add: number): string | null => {
  const base = Number(hhmm.slice(0, 2));
  if (!Number.isFinite(base)) return null;
  const h = base + add;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:00`;
};

// Ping opcional
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  console.log("[WEBHOOK][GET] ping", Object.fromEntries(url.searchParams));
  return NextResponse.json({ ok: true, ping: true });
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qsId = url.searchParams.get("data.id") || url.searchParams.get("id") || "";
    const qsType = url.searchParams.get("topic") || url.searchParams.get("type") || "";

    let body: any = {};
    try { body = await req.json(); } catch {}
    const bodyId = body?.data?.id || body?.id || "";
    const bodyType = body?.type || body?.topic || body?.action || ""; // ej: "payment.created"

    const rawTopic = (qsType || bodyType || "").toString().toLowerCase();
    const topic: "payment" | "merchant_order" | "unknown" =
      rawTopic.includes("merchant_order") ? "merchant_order" :
      rawTopic.includes("payment") ? "payment" : "unknown";

    const token = process.env.MP_ACCESS_TOKEN!;
    if (!token) {
      console.error("[WEBHOOK] Falta MP_ACCESS_TOKEN");
      return NextResponse.json({ ok: false, error: "Falta MP_ACCESS_TOKEN" }, { status: 500 });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // A) topic = merchant_order  → usar la orden si ya está pagada/cerrada
    // ─────────────────────────────────────────────────────────────────────────────
    if (topic === "merchant_order") {
      const orderId = String(qsId || bodyId || "");
      if (!orderId) {
        console.log("[WEBHOOK] merchant_order sin id → 200 ignored");
        return NextResponse.json({ ok: true, ignored: true, reason: "merchant_order-without-id" });
      }

      const moResp = await fetch(`https://api.mercadopago.com/merchant_orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const mo = await moResp.json();

      if (!moResp.ok) {
        console.log("[WEBHOOK] merchant_order fetch no OK", moResp.status, mo);
        return NextResponse.json({ ok: true, ignored: true, reason: "merchant_order-fetch-failed", status: moResp.status });
      }

      const reservationId: string | null = mo?.external_reference ? String(mo.external_reference) : null;
      if (!reservationId) {
        console.log("[WEBHOOK] MO sin external_reference → 200 ignored");
        return NextResponse.json({ ok: true, ignored: true, reason: "merchant_order-without-external_reference" });
      }

      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { children: true },
      });
      if (!reservation) {
        console.error("[WEBHOOK] reserva no encontrada (MO):", reservationId);
        return NextResponse.json({ ok: true, ignored: true, reason: "reservation-not-found" });
      }

      // ✅ Idempotencia por reserva (comparación con string literal, SIN enum)
      if ((reservation.status as any) === STATUS_COMPLETED) {
        return NextResponse.json({ ok: true, idempotent: true, note: "reservation already completed (MO)" });
      }

      const payments: Array<any> = Array.isArray(mo?.payments) ? mo.payments : [];
      const orderStatus = String(mo?.status || "").toLowerCase(); // "closed" cuando está pagada
      const paidAmount = Number(mo?.paid_amount || 0);

      // Seña esperada (50% del total)
      const hourlyRate = reservation.hourlyRate || 14000;
      const depositPct = reservation.depositPct || 50;
      const totalHoras = reservation.children.reduce((a, c) => a + (c.hours || 0), 0);
      const totalAmount = reservation.totalAmount || totalHoras * hourlyRate;
      const expectedDeposit = reservation.depositAmount || Math.round(totalAmount * (depositPct / 100));

      const approvedish =
        orderStatus === "closed" ||
        paidAmount >= Math.max(1, expectedDeposit);

      if (!approvedish) {
        console.log("[WEBHOOK] merchant_order aún no pagada (no closed / paid_amount insuficiente) → 200 ignored", {
          orderStatus, paidAmount, expectedDeposit
        });
        return NextResponse.json({ ok: true, ignored: true, reason: "merchant_order-not-paid" });
      }

      const approvedPay = payments.find(p => String(p?.status).toLowerCase() === "approved");
      const anyPay = payments[0];
      const paymentId = approvedPay?.id ? String(approvedPay.id) : (anyPay?.id ? String(anyPay.id) : `mo_${orderId}`);

      // Idempotencia adicional por Payment.providerId (si tenemos uno real)
      if (!paymentId.startsWith("mo_")) {
        const alreadyPayment = await prisma.payment.findFirst({
          where: { provider: "mercadopago", providerId: paymentId },
        });
        if (alreadyPayment) {
          // asegurar estado “completed”
          if ((reservation.status as any) !== STATUS_COMPLETED) {
            await prisma.reservation.update({ where: { id: reservation.id }, data: { status: STATUS_COMPLETED as any } });
          }
          return NextResponse.json({ ok: true, idempotent: true, note: "payment ya registrado (MO)" });
        }
      }

      const fecha = String(reservation.date || "");
      const horaInicio = `${String(reservation.hour).padStart(2, "0")}:00`;
      const childrenHours: number[] = reservation.children.map(rc => rc.hours || 0);

      if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:00$/.test(horaInicio) || childrenHours.length === 0) {
        console.error("[WEBHOOK] MO pagada pero reserva incompleta", { fecha, horaInicio, childrenHours });
        return NextResponse.json({ ok: true, ignored: true, reason: "merchant_order-paid-incomplete-reservation" });
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
        updates.push({ date: fecha, hour: Number(hhmm.slice(0, 2)), inc });
      }

      const paid =
        Math.round(Number(approvedPay?.transaction_amount || approvedPay?.total_paid_amount || paidAmount || 0));

      await prisma.$transaction(async (tx) => {
        // re-chequeo de estado en tx
        const current = await tx.reservation.findUnique({ where: { id: reservation.id } });
        if ((current?.status as any) !== STATUS_COMPLETED) {
          for (const u of updates) {
            const row = await tx.slotStock.findUnique({ where: { date_hour: { date: u.date, hour: u.hour } } });
            const used = row?.used ?? 0;
            if (used + u.inc > MAX) {
              throw new Error(`Sin cupo en ${u.date} ${String(u.hour).padStart(2, "0")}:00 (used=${used}, inc=${u.inc})`);
            }
            await tx.slotStock.upsert({
              where: { date_hour: { date: u.date, hour: u.hour } },
              create: { date: u.date, hour: u.hour, used: used + u.inc },
              update: { used: used + u.inc },
            });
          }
          await tx.reservation.update({ where: { id: reservation.id }, data: { status: STATUS_COMPLETED as any } });
        }

        const providerId = paymentId;
        const exists = await tx.payment.findFirst({
          where: { provider: "mercadopago", providerId },
        });
        if (!exists) {
          await tx.payment.create({
            data: {
              provider: "mercadopago",
              providerId,
              reservationId: reservation.id,
              amount: paid || expectedDeposit,
              kind:
                (paid || expectedDeposit) >= (reservation.totalAmount || totalAmount)
                  ? "full"
                  : Math.abs((paid || expectedDeposit) - (reservation.depositAmount || expectedDeposit)) <= 1
                  ? "deposit"
                  : "remainder",
              status: "approved",
              raw: { merchant_order: mo, chosen_payment: approvedPay || anyPay || null },
            },
          });
        }
      });

      console.log("[WEBHOOK][MO] discounted + payment recorded", { paymentId, updates, orderStatus, paidAmount });
      return NextResponse.json({ ok: true, discounted: true, via: "merchant_order", updates });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // B) topic = payment (o desconocido) → consultar /v1/payments/{id}
    // ─────────────────────────────────────────────────────────────────────────────
    let paymentId = String(qsId || bodyId || "");
    if (!paymentId) {
      console.log("[WEBHOOK] sin payment id resoluble → 200 ignored");
      return NextResponse.json({ ok: true, ignored: true, reason: "no-resolved-payment-id" });
    }

    const pResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const pay = await pResp.json();

    if (pResp.status === 404 || pay?.error === "not_found") {
      console.warn("[WEBHOOK] MP 404 Payment not found; solicitar retry", { paymentId });
      return NextResponse.json({ ok: false, retry: true, reason: "mp_payment_404_not_ready" }, { status: 502 });
    }

    const statusStr = String(pay?.status ?? pay?.status_detail ?? pResp.status ?? "unknown");
    await prisma.paymentEvent.upsert({
      where: { id: paymentId },
      update: { status: statusStr, raw: pay },
      create: { id: paymentId, status: statusStr, raw: pay },
    });

    const alreadyPayment = await prisma.payment.findFirst({
      where: { provider: "mercadopago", providerId: String(pay?.id || "") },
    });
    if (alreadyPayment) {
      return NextResponse.json({ ok: true, idempotent: true, note: "payment ya registrado" });
    }

    const status = String(pay?.status || "").toLowerCase(); // pending | in_process | approved | rejected | ...
    if (status !== "approved") {
      console.log("[WEBHOOK] pago no aprobado aún:", { status, id: paymentId, topic });
      return NextResponse.json({ ok: true, ignored: true, status, topic });
    }

    const md = pay?.metadata || {};
    const reservationId: string | null =
      (md?.reservationId && String(md.reservationId)) ||
      (pay?.external_reference ? String(pay.external_reference) : null);

    if (!reservationId) {
      console.error("[WEBHOOK] approved pero sin reservationId en metadata/external_reference");
      return NextResponse.json({ ok: true, ignored: true, reason: "approved-without-reservationId" });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { children: true },
    });
    if (!reservation) {
      console.error("[WEBHOOK] reserva no encontrada:", reservationId);
      return NextResponse.json({ ok: true, ignored: true, reason: "reservation-not-found" });
    }

    const fecha = String(md?.fecha || reservation.date || "");
       const horaInicio = String(md?.hora || `${String(reservation.hour).padStart(2, "0")}:00`);
    const childrenHours: number[] = Array.isArray(md?.childrenHours)
      ? md.childrenHours.map((n: any) => Number(n) || 0)
      : reservation.children.map(rc => rc.hours || 0);

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:00$/.test(horaInicio) || childrenHours.length === 0) {
      console.error("[WEBHOOK] approved pero metadata incompleta", { fecha, horaInicio, childrenHours });
      return NextResponse.json({ ok: true, ignored: true, reason: "approved-without-metadata" });
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
      updates.push({ date: fecha, hour: Number(hhmm.slice(0, 2)), inc });
    }

    const paidAmount = Math.round(Number(pay?.transaction_amount || 0));
    const kind: "deposit" | "remainder" | "full" =
      paidAmount >= (reservation.totalAmount || 0)
        ? "full"
        : Math.abs(paidAmount - (reservation.depositAmount || 0)) <= 1
        ? "deposit"
        : "remainder";

    await prisma.$transaction(async (tx) => {
      const current = await tx.reservation.findUnique({ where: { id: reservation.id } });
      if ((current?.status as any) !== STATUS_COMPLETED) {
        for (const u of updates) {
          const row = await tx.slotStock.findUnique({ where: { date_hour: { date: u.date, hour: u.hour } } });
          const used = row?.used ?? 0;
          if (used + u.inc > MAX) {
            throw new Error(`Sin cupo en ${u.date} ${String(u.hour).padStart(2, "0")}:00 (used=${used}, inc=${u.inc})`);
          }
          await tx.slotStock.upsert({
            where: { date_hour: { date: u.date, hour: u.hour } },
            create: { date: u.date, hour: u.hour, used: used + u.inc },
            update: { used: used + u.inc },
          });
        }
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: STATUS_COMPLETED as any } });
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
    });

    console.log("[WEBHOOK] discounted + payment recorded", { paymentId, topic, updates });
    return NextResponse.json({ ok: true, discounted: true, updates, topic });
  } catch (e: any) {
    console.error("[WEBHOOK] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
