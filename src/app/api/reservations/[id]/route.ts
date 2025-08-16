import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reservations/:id
 * Devuelve la reserva con guardian, niños+horas y pagos.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params; // 👈 FIX: await params

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        guardian: true,
        children: { include: { child: true } }, // ReservationChild + Child
        payments: true,
      },
    });

    if (!reservation) {
      return NextResponse.json({ ok: false, error: "Reserva no encontrada" }, { status: 404 });
    }

    const hourHHmm = `${String(reservation.hour).padStart(2, "0")}:00`;
    const items = reservation.children.map((rc:any) => ({
      id: rc.id,
      fullName: rc.child.fullName,
      ageYears: rc.child.ageYears,
      hours: rc.hours,
      hasConditions: rc.child.hasConditions,
      conditions: rc.child.conditions,
      dni: rc.child.dni,
    }));

    const data = {
      id: reservation.id,
      status: reservation.status,
      date: reservation.date,
      hour: reservation.hour,
      hourHHmm,
      guardian: {
        name: reservation.guardian.name,
        email: reservation.guardian.email,
        phone: reservation.guardian.phone,
        docNumber: reservation.guardian.docNumber,
      },
      totals: {
        hourlyRate: reservation.hourlyRate,
        depositPct: reservation.depositPct,
        totalHours: reservation.totalHours,
        totalAmount: reservation.totalAmount,
        depositAmount: reservation.depositAmount,
        remainingAmount: reservation.remainingAmount,
      },
      children: items,
      payments: reservation.payments.map((p:any) => ({
        id: p.id,
        provider: p.provider,
        providerId: p.providerId,
        amount: p.amount,
        kind: p.kind,
        status: p.status,
        createdAt: p.createdAt,
      })),
    };

    return NextResponse.json({ ok: true, reservation: data });
  } catch (e: any) {
    console.error("[RESERVATION GET] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}

/**
 * PATCH /api/reservations/:id
 * Actualiza niños/horas y recalcula totales; deja la reserva en pending_payment.
 * Body:
 * {
 *   "children": [
 *     { "fullName": "Lola", "ageYears": 5, "hasConditions": false, "conditions": "", "hours": 2, "dni": "123" }
 *   ],
 *   "guardian": { "phone": "...", "docNumber": "..." } // opcional
 * }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params; // 👈 FIX: await params

    const body = await req.json().catch(() => ({}));
    const children: any[] = Array.isArray(body?.children) ? body.children : [];
    const guardianPatch: { phone?: string; docNumber?: string } | undefined = body?.guardian;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { guardian: true, children: true },
    });
    if (!reservation) {
      return NextResponse.json({ ok: false, error: "Reserva no encontrada" }, { status: 404 });
    }

    if (guardianPatch && (guardianPatch.phone || guardianPatch.docNumber)) {
      await prisma.guardian.update({
        where: { id: reservation.guardianId },
        data: {
          phone: guardianPatch.phone || undefined,
          docNumber: guardianPatch.docNumber || undefined,
        },
      });
    }

    const cfg = await prisma.appConfig.findUnique({ where: { id: 1 } });
    const hourlyRate = reservation.hourlyRate || cfg?.hourlyRate || 14000;
    const depositPct = reservation.depositPct || cfg?.depositPct || 50;

    await prisma.reservationChild.deleteMany({ where: { reservationId: id } });

    const knownChildren = await prisma.child.findMany({
      where: { guardianId: reservation.guardianId },
    });

    let totalHoras = 0;

    for (const c of children) {
      const fullName = String(c?.fullName || "").trim();
      const ageYears = Number(c?.ageYears) || 0;
      const hasConditions = Boolean(c?.hasConditions);
      const conditions = c?.conditions ? String(c.conditions) : null;
      const horas = Number(c?.hours) || 0;
      const dni = c?.dni ? String(c.dni) : null;

      if (!fullName) continue;
      totalHoras += horas;

      let child =
        (dni ? knownChildren.find((k:any) => k.dni && k.dni === dni) : undefined) ||
        knownChildren.find((k:any) => k.fullName === fullName && k.ageYears === ageYears);

      if (!child) {
        child = await prisma.child.create({
          data: {
            guardianId: reservation.guardianId,
            fullName,
            ageYears,
            hasConditions,
            conditions,
            dni,
          },
        });
      } else {
        await prisma.child.update({
          where: { id: child.id },
          data: { hasConditions, conditions, dni: dni || child.dni || undefined },
        });
      }

      await prisma.reservationChild.create({
        data: { reservationId: id, childId: child.id, hours: horas },
      });
    }

    const totalAmount = totalHoras * hourlyRate;
    const depositAmount = Math.round(totalAmount * (depositPct / 100));
    const remainingAmount = totalAmount - depositAmount;

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        totalHours: totalHoras,
        hourlyRate,
        depositPct,
        totalAmount,
        depositAmount,
        remainingAmount,
        status: "pending_payment",
      },
      include: { children: { include: { child: true } }, guardian: true },
    });

    return NextResponse.json({ ok: true, reservation: updated });
  } catch (e: any) {
    console.error("[RESERVATION UPDATE] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
