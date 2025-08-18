import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_HOUR_FALLBACK = 10;

function addHoursTo(hhmm: string, add: number): string | null {
  const base = Number(hhmm.slice(0, 2));
  if (!Number.isFinite(base)) return null;
  const h = base + add;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:00`;
}

async function discountAndCompleteByReservation(
  reservationId: string,
  opts: {
    providerId: string;               // puede ser el paymentId real o "mo_{orderId}"
    amountPaid: number;               // lo que detectamos pagado (seña o total)
    raw: any;                         // guardamos lo que recibimos (MO o Payment)
  }
) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { children: true },
  });
  if (!reservation) {
    return { ok: false as const, error: "reservation-not-found" };
  }

  const fecha = String(reservation.date || "");
  const horaInicio = `${String(reservation.hour).padStart(2, "0")}:00`;
  const childrenHours: number[] = reservation.children.map((rc) => rc.hours || 0);

  if (
    !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    !/^\d{2}:00$/.test(horaInicio) ||
    childrenHours.length === 0
  ) {
    return { ok: false as const, error: "incomplete-reservation" };
  }

  const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
  const MAX = cfg?.maxPerHour ?? MAX_PER_HOUR_FALLBACK;

  const hourlyRate = reservation.hourlyRate || 14000;
  const depositPct = reservation.depositPct || 50;
  const totalHoras = reservation.children.reduce((a, c) => a + (c.hours || 0), 0);
  const totalAmount = reservation.totalAmount || totalHoras * hourlyRate;
  const expectedDeposit = reservation.depositAmount || Math.round(totalAmount * (depositPct / 100));

  const maxHoras = Math.max(...childrenHours);
  const updates: Array<{ date: string; hour: number; inc: number }> = [];
  for (let i = 0; i < maxHoras; i++) {
    const inc = childrenHours.filter((h) => h > i).length;
    if (inc <= 0) continue;
    const hhmm = addHoursTo(horaInicio, i);
    if (!hhmm) continue;
    updates.push({ date: fecha, hour: Number(hhmm.slice(0, 2)), inc });
  }

  const kind: "deposit" | "remainder" | "full" =
    opts.amountPaid >= (reservation.totalAmount || totalAmount)
      ? "full"
      : Math.abs(opts.amountPaid - (reservation.depositAmount || expectedDeposit)) <= 1
      ? "deposit"
      : "remainder";

  // Transacción idempotente:
  await prisma.$transaction(async (tx) => {
    const current = await tx.reservation.findUnique({ where: { id: reservation.id } });

    // si ya está completed, no volvemos a descontar cupo
    if ((current?.status as any) !== "completed") {
      for (const u of updates) {
        const row = await tx.slotStock.findUnique({
          where: { date_hour: { date: u.date, hour: u.hour } },
        });
        const used = row?.used ?? 0;
        if (used + u.inc > MAX) {
          throw new Error(
            `Sin cupo en ${u.date} ${String(u.hour).padStart(2, "0")}:00 (used=${used}, inc=${u.inc})`
          );
        }
        await tx.slotStock.upsert({
          where: { date_hour: { date: u.date, hour: u.hour } },
          create: { date: u.date, hour: u.hour, used: used + u.inc },
          update: { used: used + u.inc },
        });
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "completed" as any },
      });
    }

    // evitar duplicar pagos por providerId
    const exists = await tx.payment.findFirst({
      where: { provider: "mercadopago", providerId: opts.providerId },
    });
    if (!exists) {
      await tx.payment.create({
        data: {
          provider: "mercadopago",
          providerId: opts.providerId,
          reservationId: reservation.id,
          amount: Math.round(opts.amountPaid),
          kind,
          status: "approved",
          raw: opts.raw,
        },
      });
    }
  });

  return { ok: true as const, updates };
}

export async function POST(req: NextRequest) {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ ok: false, error: "Falta MP_ACCESS_TOKEN" }, { status: 500 });
    }

    const url = new URL(req.url);
    const qPaymentId =
      url.searchParams.get("payment_id") ||
      url.searchParams.get("collection_id") ||
      url.searchParams.get("id") ||
      "";
    const qMerchantOrderId =
      url.searchParams.get("merchant_order_id") ||
      url.searchParams.get("merchant_order") ||
      "";

    const body = await req.json().catch(() => ({} as any));
    const paymentId: string = String(body?.paymentId || qPaymentId || "");
    const merchantOrderId: string = String(body?.merchantOrderId || qMerchantOrderId || "");

    // 1) Si tenemos paymentId, intentamos por /v1/payments/{id}
    if (paymentId) {
      const pResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const pay = await pResp.json();

      if (pResp.ok && String(pay?.status || "").toLowerCase() === "approved") {
        const md = pay?.metadata || {};
        const reservationId: string | null =
          (md?.reservationId && String(md.reservationId)) ||
          (pay?.external_reference ? String(pay.external_reference) : null);
        if (!reservationId) {
          return NextResponse.json({ ok: false, error: "approved sin reservationId" }, { status: 200 });
        }
        const res = await discountAndCompleteByReservation(reservationId, {
          providerId: String(pay.id),
          amountPaid: Number(pay.transaction_amount || 0),
          raw: pay,
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 200 });
      }

      // Si 404 ó no approved → seguimos al plan B con merchant_order (si hay)
      if (!merchantOrderId) {
        // no hay cómo reconciliar por MO, pedimos retry suave
        return NextResponse.json({ ok: false, retry: true, reason: "payment_not_ready" }, { status: 202 });
      }
    }

    // 2) Plan B: reconciliar por merchant_order_id (el que viene en la URL de éxito)
    if (!merchantOrderId) {
      return NextResponse.json({ ok: false, error: "merchantOrderId requerido" }, { status: 400 });
    }

    const moResp = await fetch(`https://api.mercadopago.com/merchant_orders/${merchantOrderId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const mo = await moResp.json();
    if (!moResp.ok) {
      return NextResponse.json({ ok: false, retry: true, reason: "mo_fetch_failed" }, { status: 202 });
    }

    const reservationId: string | null = mo?.external_reference ? String(mo.external_reference) : null;
    if (!reservationId) {
      return NextResponse.json({ ok: false, error: "MO sin external_reference" }, { status: 200 });
    }

    const orderStatus = String(mo?.status || "").toLowerCase(); // "closed" cuando está pagada
    const paidAmount = Number(mo?.paid_amount || 0);

    // Calculamos la seña esperada con la reserva para decidir si alcanza
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { children: true },
    });
    if (!r) return NextResponse.json({ ok: false, error: "reservation-not-found" }, { status: 200 });

    const hourlyRate = r.hourlyRate || 14000;
    const depositPct = r.depositPct || 50;
    const totalHoras = r.children.reduce((a, c) => a + (c.hours || 0), 0);
    const totalAmount = r.totalAmount || totalHoras * hourlyRate;
    const expectedDeposit = r.depositAmount || Math.round(totalAmount * (depositPct / 100));

    // Si la orden ya está "closed" o el pago acumulado cubre la seña, completamos
    if (orderStatus === "closed" || paidAmount >= Math.max(1, expectedDeposit)) {
      const payments: Array<any> = Array.isArray(mo?.payments) ? mo.payments : [];
      const approvedPay = payments.find((p) => String(p?.status).toLowerCase() === "approved");
      const anyPay = payments[0];
      const providerId = approvedPay?.id
        ? String(approvedPay.id)
        : anyPay?.id
        ? String(anyPay.id)
        : `mo_${merchantOrderId}`;

      const res = await discountAndCompleteByReservation(reservationId, {
        providerId,
        amountPaid: Math.round(
          Number(approvedPay?.transaction_amount || approvedPay?.total_paid_amount || paidAmount || 0)
        ),
        raw: { merchant_order: mo, chosen_payment: approvedPay || anyPay || null },
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 200 });
    }

    // Todavía no llegó a pagada → retry suave desde el front
    return NextResponse.json(
      { ok: false, retry: true, reason: "mo_not_paid_yet", orderStatus, paidAmount, expectedDeposit },
      { status: 202 }
    );
  } catch (e: any) {
    console.error("[RECONCILE] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
