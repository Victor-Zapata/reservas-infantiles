// app/api/reservations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db"; // Asegurate de exportar un prisma singleton en esta ruta
// (ej: src/lib/db.ts con new PrismaClient())

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------
// Tipos de apoyo (opcionales)
// ------------------------
type CreateDraftBody = {
  date: string; // "YYYY-MM-DD"
  hour: number; // 0..23
  guardianEmail?: string;
  guardianName?: string;
};

type UpdateBody = {
  reservationId: number; // ID de la reserva (del draft creado)
  guardianEmail?: string;
  guardianName?: string;
  childrenHours?: number; // Total de horas a cobrar (suma de niños x horas según tu lógica)
  // Si luego querés modelo ReservationChild, se puede expandir acá
};

type ToPendingBody = {
  reservationId: number;
};

// ------------------------
// Helpers
// ------------------------
async function getAppConfig() {
  // Se asume que tenés una fila con id=1 (puede ser otra estrategia)
  const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
  return {
    hourlyRate: cfg?.hourlyRate ?? 14000,
    depositPct: cfg?.depositPct ?? 50,
  };
}

function computeTotals(
  childrenHours: number,
  hourlyRate: number,
  depositPct: number
) {
  const totalHours = Math.max(0, childrenHours || 0);
  const totalAmount = totalHours * hourlyRate;
  const depositAmount = Math.round((totalAmount * depositPct) / 100);
  const remainingAmount = Math.max(0, totalAmount - depositAmount);
  return { totalHours, totalAmount, depositAmount, remainingAmount };
}

async function ensureGuardian(email?: string, name?: string) {
  const safeEmail = email?.trim() || `anon-${Date.now()}@example.com`;
  const existing = await prisma.guardian.findUnique({
    where: { email: safeEmail },
  });
  if (existing) return existing;
  return prisma.guardian.create({
    data: { email: safeEmail, name: name?.trim() || "Anónimo" },
  });
}

// ------------------------
// POST /api/reservations
// 1) Crear draft
// ------------------------
/**
 * Crea una reserva en estado "draft" cuando el usuario elige día y hora.
 * Body JSON:
 *  {
 *    "date": "YYYY-MM-DD",
 *    "hour": 9,              // 0..23
 *    "guardianEmail": "...", // opcional
 *    "guardianName": "..."   // opcional
 *  }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const date: string = body?.date;
    const hour: number = Number(body?.hour);
    const guardianEmail: string | undefined = body?.guardianEmail;
    const guardianName: string | undefined = body?.guardianName;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hour)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Parámetros inválidos. date=YYYY-MM-DD, hour=0..23",
        },
        { status: 400 }
      );
    }

    // Garantizamos que exista AppConfig (valores por defecto si no existe)
    const cfg = await prisma.appConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, hourlyRate: 14000, depositPct: 50, maxPerHour: 10 },
    });

    // Upsert del guardian por email (si hay). Si no, creamos uno anónimo único
    let guardian = guardianEmail
      ? await prisma.guardian.findUnique({ where: { email: guardianEmail } })
      : null;

    if (!guardian) {
      const email =
        guardianEmail && guardianEmail.includes("@")
          ? guardianEmail
          : `anon-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}@local.invalid`;

      guardian = await prisma.guardian.create({
        data: {
          email,
          name: guardianName || "Invitado",
        },
      });
    } else if (guardianName && guardian.name !== guardianName) {
      // Actualizamos el nombre si nos pasaron uno distinto
      guardian = await prisma.guardian.update({
        where: { id: guardian.id },
        data: { name: guardianName },
      });
    }

    const reservation = await prisma.reservation.create({
      data: {
        guardianId: guardian.id,
        date,
        hour,
        hourlyRate: cfg.hourlyRate,
        depositPct: cfg.depositPct,
        totalHours: 0,
        totalAmount: 0,
        depositAmount: 0,
        remainingAmount: 0,
        status: "draft",
      },
    });

    return NextResponse.json({ ok: true, reservation });
  } catch (e: any) {
    console.error("[RESERVATION CREATE] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "error" },
      { status: 500 }
    );
  }
}

// ------------------------
// PATCH /api/reservations
// 2) Actualizar draft + recalcular importes
// Body:
// { reservationId, guardianEmail?, guardianName?, childrenHours? }
// ------------------------
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as UpdateBody;
    const { reservationId, guardianEmail, guardianName, childrenHours } =
      body || {};

    if (!reservationId) {
      return NextResponse.json(
        { ok: false, error: "reservationId requerido" },
        { status: 400 }
      );
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guardian: true },
    });

    if (!reservation) {
      return NextResponse.json(
        { ok: false, error: "Reserva no encontrada" },
        { status: 404 }
      );
    }

    // Permitir actualizar datos del guardian (simple)
    let guardianId = reservation.guardianId;
    if (guardianEmail || guardianName) {
      const guardian = await ensureGuardian(
        guardianEmail ?? reservation.guardian.email,
        guardianName ?? reservation.guardian.name ?? undefined
      );
      guardianId = guardian.id;
    }

    // Recalcular totales si llega childrenHours
    const cfg = {
      hourlyRate: reservation.hourlyRate,
      depositPct: reservation.depositPct,
    };
    const { hourlyRate, depositPct } = cfg;
    const totals =
      typeof childrenHours === "number"
        ? computeTotals(childrenHours, hourlyRate, depositPct)
        : {
            totalHours: reservation.totalHours,
            totalAmount: reservation.totalAmount,
            depositAmount: reservation.depositAmount,
            remainingAmount: reservation.remainingAmount,
          };

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        guardianId,
        ...(typeof childrenHours === "number"
          ? { totalHours: totals.totalHours }
          : {}),
        totalAmount: totals.totalAmount,
        depositAmount: totals.depositAmount,
        remainingAmount: totals.remainingAmount,
        // status permanece "draft" en esta fase
      },
    });

    return NextResponse.json({ ok: true, reservation: updated });
  } catch (err) {
    console.error("PATCH /reservations error:", err);
    return NextResponse.json(
      { ok: false, error: "Error al actualizar la reserva" },
      { status: 500 }
    );
  }
}

// ------------------------
// PUT /api/reservations
// 3) Pasar a pending_payment antes de ir al checkout
// Body: { reservationId }
// ------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ToPendingBody;
    const { reservationId } = body || {};
    if (!reservationId) {
      return NextResponse.json(
        { ok: false, error: "reservationId requerido" },
        { status: 400 }
      );
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      return NextResponse.json(
        { ok: false, error: "Reserva no encontrada" },
        { status: 404 }
      );
    }

    // Validación mínima: no pases a pending si no hay monto para seña
    if (reservation.depositAmount <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No hay depósito calculado. Actualizá childrenHours antes de continuar.",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: "pending_payment" },
    });

    return NextResponse.json({ ok: true, reservation: updated });
  } catch (err) {
    console.error("PUT /reservations error:", err);
    return NextResponse.json(
      { ok: false, error: "Error al cambiar estado" },
      { status: 500 }
    );
  }
}
