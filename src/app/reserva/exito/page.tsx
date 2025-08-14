"use client";

import { useEffect } from "react";

type Niño = {
  nombre: string;
  dni: string;
  edad: number;
  condiciones: string;
  tieneCondiciones: boolean;
  horas: number;
};

const addHoursToHHmm = (hhmm: string, add: number): string | null => {
  const base = Number(String(hhmm).slice(0, 2));
  if (!Number.isFinite(base)) return null;
  const h = base + add;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, "0")}:00`;
};

export default function ExitoPage() {
  useEffect(() => {
    (async () => {
      try {
        const fecha = localStorage.getItem("reserva:fecha"); // YYYY-MM-DD
        const horaInicio = localStorage.getItem("reserva:hora"); // "HH:00"
        const raw = localStorage.getItem("datosNiños");

        if (!fecha || !horaInicio || !raw) return;

        const niños: Niño[] = JSON.parse(raw) || [];
        if (!Array.isArray(niños) || !niños.length) return;

        // Evitar doble descuento en refresh:
        const dedupeKey = `cupo-descontado:${fecha}|${horaInicio}`;
        if (localStorage.getItem(dedupeKey)) return;

        // Para cada bloque i, descontar la cantidad de niños que siguen presentes en ese bloque:
        const maxHoras = niños.reduce(
          (m, n) => Math.max(m, Number(n.horas) || 0),
          0
        );

        for (let i = 0; i < maxHoras; i++) {
          // cuántos niños tienen horas > i (siguen en el cuidado a esta hora)
          const count = niños.filter((n) => (Number(n.horas) || 0) > i).length;
          if (count <= 0) continue;

          const hhmm = addHoursToHHmm(horaInicio, i);
          if (!hhmm) continue;

          const res = await fetch("/api/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: fecha, hour: hhmm, count }),
          });

          // Si no hay cupo suficiente en ese bloque, el endpoint responde 409:
          if (!res.ok && res.status !== 409) {
            const msg = await res.text();
            console.warn("No se pudo descontar cupo", fecha, hhmm, count, msg);
          }
        }

        // Marcamos que ya descontamos
        localStorage.setItem(dedupeKey, "1");
      } catch (e) {
        console.error("Error descontando cupo:", e);
      }
    })();
  }, []);

  // Tu UI actual de éxito puede seguir igual; muestro algo mínimo por si no la tenés:
  return (
    <div className="container py-5 text-center">
      <h2 className="mb-3">¡Pago confirmado! 🎉</h2>
      <p className="text-muted">Tu seña quedó registrada. ¡Te esperamos!</p>
    </div>
  );
}
