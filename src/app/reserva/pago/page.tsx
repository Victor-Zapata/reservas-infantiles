// src/app/reserva/pago/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Niño = {
  nombre: string;
  dni?: string;
  edad: number;
  condiciones?: string;
  tieneCondiciones: boolean;
  horas: number;
};

type PrefResp = { ok: boolean; checkoutUrl?: string; error?: unknown };
type CreateResResp = { ok: boolean; reservation?: { id: string }; error?: unknown };
type UpdateResResp = { ok: boolean; reservation?: any; error?: unknown };

const HOURLY_RATE = 14000; // ARS por hora

export default function PagoPage() {
  const searchParams = useSearchParams();
  const estado = searchParams.get("estado"); // failure | pending

  const [ninos, setNinos] = useState<Niño[]>([]);

  useEffect(() => {
    window.scrollTo(0, 0);
    try {
      const raw = localStorage.getItem("datosNiños");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setNinos(parsed);
      }
    } catch {}
  }, []);

  const { totalHoras, total, sena, restante } = useMemo(() => {
    const horas = Array.isArray(ninos)
      ? ninos.reduce((acc, n) => acc + (Number(n?.horas) || 0), 0)
      : 0;
    const t = horas * HOURLY_RATE;
    const s = Math.round(t * 0.5); // 50%
    const r = t - s;
    return { totalHoras: horas, total: t, sena: s, restante: r };
  }, [ninos]);

  const currency = (v: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(v);

  // --- Helpers de cupo (ya los venías usando) ---
  const addHoursToHHmm = (hhmm: string, add: number): string | null => {
    const base = Number(String(hhmm).slice(0, 2));
    if (!Number.isFinite(base)) return null;
    const h = base + add;
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  };

  const validarCupoAntesDePagar = async (): Promise<
    { ok: true } | { ok: false; msg: string }
  > => {
    if (totalHoras <= 0) {
      return { ok: false, msg: "No hay horas seleccionadas para reservar." };
    }

    const fecha = localStorage.getItem("reserva:fecha"); // YYYY-MM-DD
    const horaInicio = localStorage.getItem("reserva:hora"); // "HH:00"
    if (!fecha || !horaInicio) {
      return { ok: false, msg: "Seleccioná día y hora para validar el cupo." };
    }

    const res = await fetch(`/api/availability?date=${fecha}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !Array.isArray(data?.hours)) {
      return { ok: false, msg: "No se pudo validar la disponibilidad. Intentá de nuevo." };
    }

    for (let i = 0; i < totalHoras; i++) {
      const slotTime = addHoursToHHmm(horaInicio, i);
      if (!slotTime) return { ok: false, msg: "La selección excede el horario disponible." };
      const slot = data.hours.find((s: any) => s?.time === slotTime);
      if (!slot) return { ok: false, msg: `No encontramos el bloque ${slotTime}.` };
      if (slot.remaining <= 0) return { ok: false, msg: `Sin cupos para las ${slotTime}.` };
    }

    return { ok: true };
  };

  // --- NUEVO: asegurar reserva en DB y sincronizar niños/horas ---
  const ensureReservationId = async (): Promise<string> => {
    let reservationId = localStorage.getItem("reservationId") || "";

    if (reservationId) return reservationId;

    const fecha = localStorage.getItem("reserva:fecha") || "";
    const horaHHmm = localStorage.getItem("reserva:hora") || "";
    if (!fecha || !horaHHmm) {
      throw new Error("No encontramos tu reserva. Volvé un paso atrás y seleccioná día/hora.");
    }

    const hour = Number(horaHHmm.slice(0, 2));
    // opcional: si guardaste datos del adulto:
    const guardianEmail = localStorage.getItem("adulto:email") || undefined;
    const guardianName = localStorage.getItem("adulto:nombre") || undefined;

    const cre = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: fecha, hour, guardianEmail, guardianName }),
    });
    const cj: CreateResResp = await cre.json();
    if (!cre.ok || !cj?.ok || !cj.reservation?.id) {
      throw new Error("No pudimos crear la reserva. Intentá nuevamente.");
    }

    reservationId = cj.reservation.id;
    localStorage.setItem("reservationId", reservationId);
    return reservationId;
  };

  const patchReservationWithChildren = async (reservationId: string) => {
    // mapeo a la forma esperada por el endpoint PATCH
    const children = (ninos || []).map((n) => ({
      fullName: n.nombre,
      ageYears: Number(n.edad) || 0,
      hasConditions: Boolean(n.tieneCondiciones),
      conditions: n.condiciones || "",
      hours: Number(n.horas) || 0,
      dni: n.dni || undefined,
    }));

    const upd = await fetch(`/api/reservations/${reservationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ children }),
    });
    const uj: UpdateResResp = await upd.json();
    if (!upd.ok || !uj?.ok) {
      throw new Error(uj?.error as string || "No pudimos actualizar la reserva.");
    }
  };

  const iniciarPago = async () => {
    try {
      // 1) Validación de cupo
      const valid = await validarCupoAntesDePagar();
      if (!valid.ok) {
        alert(valid.msg);
        return;
      }

      // 2) Asegurar reserva y sincronizar niños/horas en DB
      const reservationId = await ensureReservationId();
      await patchReservationWithChildren(reservationId);

      // 3) Pedir preferencia (seña) y redirigir
      const res = await fetch("/api/payments/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId }),
      });
      const data: PrefResp = await res.json();

      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        console.error("Respuesta MP inválida:", data);
        alert("No se pudo iniciar el pago. Intente nuevamente.");
      }
    } catch (err: any) {
      console.error("Error al iniciar el pago:", err);
      alert(err?.message || "Error inesperado al conectar con Mercado Pago.");
    }
  };

  return (
    <div className="container my-5">
      <h2 className="kids-heading mb-4 text-center">Reserva tu lugar</h2>

      {/* Resumen claro para el usuario */}
      <div className="row justify-content-center">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <h5 className="card-title mb-3">Resumen de costos</h5>
              <ul className="list-group list-group-flush">
                <li className="list-group-item d-flex justify-content-between">
                  <span>Valor por hora</span>
                  <strong>{currency(HOURLY_RATE)}</strong>
                </li>
                <li className="list-group-item d-flex justify-content-between">
                  <span>Horas totales</span>
                  <strong>{totalHoras}</strong>
                </li>
                <li className="list-group-item d-flex justify-content-between">
                  <span>Total</span>
                  <strong>{currency(total)}</strong>
                </li>
                <li className="list-group-item d-flex justify-content-between">
                  <span>Seña (50%) — abonás ahora</span>
                  <strong className="text-success">{currency(sena)}</strong>
                </li>
                <li className="list-group-item d-flex justify-content-between">
                  <span>Resto a abonar al momento del servicio</span>
                  <strong className="text-muted">{currency(restante)}</strong>
                </li>
              </ul>
            </div>
          </div>

          {estado === "failure" && (
            <div className="alert alert-danger mt-3">
              No pudimos procesar el pago. Probá nuevamente.
            </div>
          )}
          {estado === "pending" && (
            <div className="alert alert-warning mt-3">
              Tu pago está pendiente. Te avisaremos cuando se acredite.
            </div>
          )}

          <div className="text-center">
            <button
              className="btn btn-kids btn-lg mt-4"
              onClick={iniciarPago}
              disabled={totalHoras <= 0}
            >
              Pagar con Mercado Pago
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
