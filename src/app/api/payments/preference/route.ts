import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hhmm(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
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

    // --- Robustez: construir base URL sí o sí ---
    const envBase = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host =
      req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const reqBase = host ? `${proto}://${host}` : "";
    const base = envBase || reqBase || "http://localhost:3000";

    const body = await req.json().catch(() => ({}));
    const reservationId: string = body?.reservationId;
    if (!reservationId) {
      return NextResponse.json(
        { ok: false, error: "reservationId requerido" },
        { status: 400 }
      );
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { children: true, guardian: true },
    });
    if (!reservation) {
      return NextResponse.json(
        { ok: false, error: "Reserva no encontrada" },
        { status: 404 }
      );
    }
    if (!reservation.date || typeof reservation.hour !== "number") {
      return NextResponse.json(
        { ok: false, error: "Reserva sin date/hour" },
        { status: 400 }
      );
    }

    const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
    const hourlyRate = reservation.hourlyRate || cfg?.hourlyRate || 14000;
    const depositPct = reservation.depositPct || cfg?.depositPct || 50;

    const childrenHours = reservation.children.map((rc: any) => rc.hours || 0);
    const totalHoras = childrenHours.reduce((a: any, b: any) => a + b, 0);
    const totalAmount = reservation.totalAmount || totalHoras * hourlyRate;
    const depositAmount =
      reservation.depositAmount || Math.round(totalAmount * (depositPct / 100));
    const remainingAmount =
      reservation.remainingAmount || totalAmount - depositAmount;

    if (totalHoras <= 0 || totalAmount <= 0 || depositAmount <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "RESERVA_SIN_HORAS_O_SIN_MONTO",
          debug: {
            totalHoras,
            totalAmount,
            depositAmount,
            hourlyRate,
            depositPct,
          },
        },
        { status: 400 }
      );
    }

    const metadata = {
      reservationId: reservation.id,
      fecha: reservation.date,
      hora: hhmm(reservation.hour),
      childrenHours,
      total: totalAmount,
      totalHoras,
      hourlyRate,
      sena: depositAmount,
      restante: remainingAmount,
    };

    const qs = new URLSearchParams();
    qs.set("res", reservation.id);
    qs.set("fecha", reservation.date);
    qs.set("hora", hhmm(reservation.hour));

    // --- URLs finales ---
    const successUrl = `${base}/reserva/exito?${qs.toString()}`;
    const failureUrl = `${base}/reserva/pago?estado=failure`;
    const pendingUrl = `${base}/reserva/pago?estado=pending`;

    // Validación explícita para evitar el 400 de MP
    const urlOk = /^https?:\/\/.+/i.test(successUrl);
    if (!urlOk) {
      console.error("[PREFERENCE] invalid successUrl:", { base, successUrl });
      return NextResponse.json(
        {
          ok: false,
          error: "SUCCESS_URL_INVALID",
          debug: { base, successUrl },
        },
        { status: 400 }
      );
    }

    // 👇 NUEVO: URL de webhook (env o base detectada)
    const notificationUrl =
      (process.env.WEBHOOK_URL || "").replace(/\/+$/, "") ||
      `${base}/api/mercadopago/webhook`;

    // Solo usamos auto_return si la URL es https y no es localhost (para evitar 400 en local)
    const isHttps = /^https:\/\//i.test(successUrl);
    const isLocalhost = /localhost|127\.0\.0\.1/i.test(successUrl);

    const prefBody: any = {
      items: [
        {
          id: "senia-reserva",
          title: "Seña 50% - ME RE QUETÉ",
          quantity: 1,
          currency_id: "ARS",
          unit_price: depositAmount,
        },
      ],
      back_urls: {
        success: successUrl,
        failure: failureUrl,
        pending: pendingUrl,
      },
      // 👇 MUY IMPORTANTE: liga esta preferencia a TU webhook
      notification_url: `${notificationUrl}/api/mercadopago/webhook`.replace(
        /\/api\/mercadopago\/webhook\/api\/mercadopago\/webhook$/,
        "/api/mercadopago/webhook"
      ),
      external_reference: reservation.id,
      statement_descriptor: "ME RE QUETE",
      metadata,
      binary_mode: true,
    };

    if (isHttps && !isLocalhost) {
      prefBody.auto_return = "approved";
    }

    console.log("[PREFERENCE] base/urls:", {
      base,
      successUrl,
      failureUrl,
      pendingUrl,
      notificationUrl: prefBody.notification_url,
      auto_return: prefBody.auto_return ?? "(omitted)",
    });
    // ...

    // DEBUG opcional: ver exactamente lo que mandamos
    console.log("[PREFERENCE] base/urls:", {
      base,
      successUrl,
      failureUrl,
      pendingUrl,
    });

    const resp = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prefBody),
      }
    );

    const data = await resp.json().catch(() => ({}));
    console.log("[PREFERENCE] status:", resp.status);
    if (!resp.ok) {
      console.error("[PREFERENCE] MP error body:", data);
      return NextResponse.json(
        {
          ok: false,
          error: data?.message || "MP_BAD_REQUEST",
          cause: data?.cause || data,
        },
        { status: 502 }
      );
    }

    const checkoutUrl = data.sandbox_init_point || data.init_point;
    if (!checkoutUrl) {
      return NextResponse.json(
        { ok: false, error: "Sin checkout URL" },
        { status: 500 }
      );
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { mpPreferenceId: data.id || null, status: "pending_payment" },
    });

    return NextResponse.json({
      ok: true,
      checkoutUrl,
      preferenceId: data.id || null,
    });
  } catch (e: any) {
    console.error("[PREFERENCE] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "error" },
      { status: 500 }
    );
  }
}
