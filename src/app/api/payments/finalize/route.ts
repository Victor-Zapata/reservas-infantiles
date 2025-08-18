import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_HOUR_FALLBACK = 10;

function toHHmm(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function addHoursTo(hhmm: string, add: number): string | null {
  const base = Number(hhmm.slice(0, 2));
  if (!Number.isFinite(base)) return null;
  const h = base + add;
  if (h < 0 || h > 23) return null;
  return toHHmm(h);
}

async function discountAndCompleteByReservation(
  reservationId: string,
  opts: {
    providerId: string; // puede ser paymentId real o "mo_{orderId}" o "return_*"
    amountPaid: number; // seña o total detectado
    raw: any; // guardamos lo que recibimos (MO/Payment/Return)
  }
) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { children: true },
  });
  if (!reservation)
    return { ok: false as const, error: "reservation-not-found" };

  const fecha = reservation.date;
  const horaInicio = toHHmm(reservation.hour);
  const childrenHours = reservation.children.map((c) => c.hours || 0);

  if (
    !fecha ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    !/^\d{2}:00$/.test(horaInicio) ||
    childrenHours.length === 0
  ) {
    return { ok: false as const, error: "incomplete-reservation" };
  }

  const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
  const MAX = cfg?.maxPerHour ?? MAX_PER_HOUR_FALLBACK;

  const hourlyRate = reservation.hourlyRate || 14000;
  const depositPct = reservation.depositPct || 50;
  const totalHours = reservation.children.reduce(
    (a, c) => a + (c.hours || 0),
    0
  );
  const totalAmount = reservation.totalAmount || totalHours * hourlyRate;
  const depositExp =
    reservation.depositAmount || Math.round(totalAmount * (depositPct / 100));

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
      : Math.abs(opts.amountPaid - (reservation.depositAmount || depositExp)) <=
        1
      ? "deposit"
      : "remainder";

  // Transacción idempotente
  await prisma.$transaction(async (tx) => {
    const current = await tx.reservation.findUnique({
      where: { id: reservation.id },
    });

    if ((current?.status as any) !== "completed") {
      for (const u of updates) {
        const row = await tx.slotStock.findUnique({
          where: { date_hour: { date: u.date, hour: u.hour } },
        });
        const used = row?.used ?? 0;
        if (used + u.inc > MAX) {
          throw new Error(
            `Sin cupo en ${u.date} ${String(u.hour).padStart(
              2,
              "0"
            )}:00 (used=${used}, inc=${u.inc})`
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
      return NextResponse.json(
        { ok: false, error: "Falta MP_ACCESS_TOKEN" },
        { status: 500 }
      );
    }

    const allowTrust = process.env.MP_ALLOW_RETURN_TRUST === "1";

    const url = new URL(req.url);
    console.log("[FINALIZE] hit", Object.fromEntries(url.searchParams));
    const qsPaymentId =
      url.searchParams.get("payment_id") ||
      url.searchParams.get("collection_id") ||
      "";
    const qsMO =
      url.searchParams.get("merchant_order_id") ||
      url.searchParams.get("merchant_order") ||
      "";
    const qsStatus = (
      url.searchParams.get("status") ||
      url.searchParams.get("collection_status") ||
      ""
    ).toLowerCase();
    const qsRes = url.searchParams.get("res") || "";

    const body = await req.json().catch(() => ({} as any));
    const paymentId = String(body?.paymentId || qsPaymentId || "");
    const merchantOrderId = String(body?.merchantOrderId || qsMO || "");
    const reservationIdQ = String(body?.reservationId || qsRes || "");
    const statusFromBody = String(body?.statusFromReturn || "").toLowerCase();

    // 1) Si tenemos paymentId, probamos el Payment
    if (paymentId) {
      const pResp = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );
      const pay = await pResp.json();

      if (pResp.ok && String(pay?.status || "").toLowerCase() === "approved") {
        const md = pay?.metadata || {};
        const reservationId: string | null =
          (md?.reservationId && String(md.reservationId)) ||
          (pay?.external_reference
            ? String(pay.external_reference)
            : reservationIdQ || null);

        if (!reservationId) {
          return NextResponse.json(
            { ok: false, error: "approved sin reservationId" },
            { status: 200 }
          );
        }
        const r = await discountAndCompleteByReservation(reservationId, {
          providerId: String(pay.id),
          amountPaid: Number(pay.transaction_amount || 0),
          raw: pay,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 200 });
      }
      // Si 404 o no approved, seguimos al plan B con MO si está disponible
    }

    // 2) Plan B: usar merchant_order_id de la URL de éxito
    if (merchantOrderId) {
      const moResp = await fetch(
        `https://api.mercadopago.com/merchant_orders/${merchantOrderId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }
      );
      const mo = await moResp.json();

      if (moResp.ok) {
        const reservationId: string | null = mo?.external_reference
          ? String(mo.external_reference)
          : reservationIdQ || null;

        if (reservationId) {
          const r0 = await prisma.reservation.findUnique({
            where: { id: reservationId },
            include: { children: true },
          });
          if (!r0)
            return NextResponse.json(
              { ok: false, error: "reservation-not-found" },
              { status: 200 }
            );

          const hourlyRate = r0.hourlyRate || 14000;
          const depositPct = r0.depositPct || 50;
          const totalHours = r0.children.reduce(
            (a, c) => a + (c.hours || 0),
            0
          );
          const totalAmount = r0.totalAmount || totalHours * hourlyRate;
          const expectedDep =
            r0.depositAmount || Math.round(totalAmount * (depositPct / 100));

          const orderStatus = String(mo?.status || "").toLowerCase(); // "closed" cuando está pagada
          const paidAmount = Number(mo?.paid_amount || 0);

          if (
            orderStatus === "closed" ||
            paidAmount >= Math.max(1, expectedDep)
          ) {
            const payments: Array<any> = Array.isArray(mo?.payments)
              ? mo.payments
              : [];
            const approvedPay = payments.find(
              (p) => String(p?.status).toLowerCase() === "approved"
            );
            const anyPay = payments[0];
            const providerId = approvedPay?.id
              ? String(approvedPay.id)
              : anyPay?.id
              ? String(anyPay.id)
              : `mo_${merchantOrderId}`;

            const res = await discountAndCompleteByReservation(reservationId, {
              providerId,
              amountPaid: Math.round(
                Number(
                  approvedPay?.transaction_amount ||
                    approvedPay?.total_paid_amount ||
                    paidAmount ||
                    0
                )
              ),
              raw: {
                merchant_order: mo,
                chosen_payment: approvedPay || anyPay || null,
              },
            });
            return NextResponse.json(res, { status: res.ok ? 200 : 200 });
          }
        }
      }
      // si la MO no está lista o no pagada → seguimos al fallback (si está permitido)
    }

    // 3) Fallback OPTIMISTA (sólo si se habilita por env)
    //    Confirma por URL de retorno "approved" + reservationId presente.
    if (
      allowTrust &&
      (qsStatus === "approved" || statusFromBody === "approved") &&
      reservationIdQ
    ) {
      const r0 = await prisma.reservation.findUnique({
        where: { id: reservationIdQ },
        include: { children: true },
      });
      if (!r0) {
        return NextResponse.json(
          { ok: false, error: "reservation-not-found" },
          { status: 200 }
        );
      }

      const hourlyRate = r0.hourlyRate || 14000;
      const depositPct = r0.depositPct || 50;
      const totalHours = r0.children.reduce((a, c) => a + (c.hours || 0), 0);
      const totalAmount = r0.totalAmount || totalHours * hourlyRate;
      const expectedDep =
        r0.depositAmount || Math.round(totalAmount * (depositPct / 100));

      const providerId =
        (paymentId && `ret_${paymentId}`) ||
        (merchantOrderId && `ret_mo_${merchantOrderId}`) ||
        `ret_${Date.now()}`;

      const res = await discountAndCompleteByReservation(reservationIdQ, {
        providerId,
        amountPaid: expectedDep,
        raw: {
          trusted_return: true,
          status_from_url: qsStatus || statusFromBody || null,
          payment_id: paymentId || null,
          merchant_order_id: merchantOrderId || null,
        },
      });
      return NextResponse.json({ ...res, trusted: true }, { status: 200 });
    }

    // 4) No se pudo confirmar todavía → pedir reintento suave
    return NextResponse.json(
      { ok: false, retry: true, reason: "not_ready_yet" },
      { status: 202 }
    );
  } catch (e: any) {
    console.error("[FINALIZE] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "error" },
      { status: 500 }
    );
  }
}
