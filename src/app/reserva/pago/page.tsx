// reserva/pago/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Niño = {
  nombre: string;
  dni: string;
  edad: number;
  condiciones: string;
  tieneCondiciones: boolean;
  horas: number;
};

const HOURLY_RATE = 14000; // ARS por hora

export default function PagoPage() {
  const searchParams = useSearchParams();
  const estado = searchParams.get("estado"); // failure | pending

  const [ninos, setNinos] = useState<Niño[]>([]);

  useEffect(() => {
    window.scrollTo(0, 0);
    // ⬇️ leemos los datos que ya guarda tu flujo previo
    try {
      const raw = localStorage.getItem("datosNiños"); // misma clave que venías usando
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

  // --- Helpers de validación de cupo ---
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
    // Si no hay horas a reservar, no tiene sentido validar
    if (totalHoras <= 0) {
      return { ok: false, msg: "No hay horas seleccionadas para reservar." };
    }

    const fecha = localStorage.getItem("reserva:fecha"); // YYYY-MM-DD
    const horaInicio = localStorage.getItem("reserva:hora"); // "HH:00"

    if (!fecha || !horaInicio) {
      // Si no venís del widget de disponibilidad, podés optar por permitir el flujo:
      // return { ok: true };
      // Pero como pediste validación, mostramos un aviso claro:
      return {
        ok: false,
        msg: "Seleccioná día y hora en el paso anterior para validar el cupo.",
      };
    }

    // Traemos disponibilidad del día
    const res = await fetch(`/api/availability?date=${fecha}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok || !Array.isArray(data?.hours)) {
      return {
        ok: false,
        msg: "No se pudo validar la disponibilidad. Intentá nuevamente.",
      };
    }

    // Validamos bloques consecutivos según totalHoras
    for (let i = 0; i < totalHoras; i++) {
      const slotTime = addHoursToHHmm(horaInicio, i);
      if (!slotTime) {
        return {
          ok: false,
          msg: "La selección excede el horario disponible del día.",
        };
      }
      const slot = data.hours.find((s: any) => s?.time === slotTime);
      if (!slot) {
        return {
          ok: false,
          msg: `No encontramos el bloque ${slotTime} para ese día.`,
        };
      }
      if (slot.remaining <= 0) {
        return {
          ok: false,
          msg: `Sin cupos para las ${slotTime}. Elegí otro horario.`,
        };
      }
    }

    return { ok: true };
  };

  const iniciarPago = async () => {
    try {
      // ✅ Validación de cupo justo antes de pagar
      const valid = await validarCupoAntesDePagar();
      if (!valid.ok) {
        alert(valid.msg);
        return;
      }

      const res = await fetch("/api/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⬇️ enviamos SOLO la SEÑA
        body: JSON.stringify({
          amount: sena,
          description: "Seña 50% - Me Requeté",
          metadata: {
            total,
            totalHoras,
            hourlyRate: HOURLY_RATE,
            sena,
            restante,
          },
        }),
      });
      const data = await res.json();

      console.log("API mercadopago response:", data);

      if (data?.checkoutUrl) {
        // debe ser sandbox.mercadopago.com.ar en modo test
        console.log("Redirecting to:", data.checkoutUrl);
        window.location.href = data.checkoutUrl;
      } else {
        alert("No se pudo iniciar el pago. Intente nuevamente.");
        console.error("Respuesta MP inválida:", data);
      }
    } catch (err) {
      console.error("Error al iniciar el pago:", err);
      alert("Error inesperado al conectar con Mercado Pago.");
    }
  };

  return (
    <div className="container my-5">
      <h2 className="text-primary mb-4 text-center">Reserva tu lugar</h2>

      {/* ⬇️ Resumen claro para el usuario */}
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
              className="btn btn-success btn-lg mt-4"
              onClick={iniciarPago}
              disabled={totalHoras <= 0} // evita pagar si no hay horas seleccionadas
            >
              Pagar con Mercado Pago
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
