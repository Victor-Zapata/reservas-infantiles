"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type HourSlot = { time: string; remaining: number };

const TODAY_STR = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export default function AvailabilityWidget() {
  const router = useRouter();
  const [date, setDate] = useState<string>(TODAY_STR());
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<HourSlot[]>([]);
  const [max, setMax] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);

  // Carga inicial y cuando cambia la fecha
  useEffect(() => {
    let abort = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/availability?date=${date}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (abort) return;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "No se pudo cargar disponibilidad.");
        }
        setHours(data.hours || []);
        setMax(data.max || 10);
      } catch (e: any) {
        setError(e?.message || "Error al cargar disponibilidad.");
      } finally {
        if (!abort) setLoading(false);
      }
    }
    load();
    return () => {
      abort = true;
    };
  }, [date]);

  const handleSelectHour = (hhmm: string) => {
    // Guardamos selección mínima para integrarla con tu flujo actual
    localStorage.setItem("reserva:fecha", date);
    localStorage.setItem("reserva:hora", hhmm);
    // Tip: Podés pre-completar el paso /reserva con esta info
    router.push("/reserva");
  };

  const dayFormatted = useMemo(() => {
    try {
      const [y, m, d] = date.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      });
    } catch {
      return "";
    }
  }, [date]);

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <h5 className="card-title mb-3">Elegí día y hora</h5>

        <div className="row g-3 align-items-end">
          <div className="col-md-5">
            <label className="form-label">Día</label>
            <input
              type="date"
              className="form-control"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={TODAY_STR()}
            />
            <div className="form-text text-capitalize">{dayFormatted}</div>
          </div>
        </div>

        <hr className="my-4" />

        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="text-muted">Cupo por hora</span>
          <span className="badge text-bg-secondary">máx. {max} niños</span>
        </div>

        {loading && (
          <div className="alert alert-info">Cargando disponibilidad…</div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}

        {!loading && !error && (
          <div className="row row-cols-2 row-cols-sm-3 row-cols-md-4 g-3">
            {hours.map((h) => {
              const disabled = h.remaining <= 0;
              return (
                <div className="col" key={h.time}>
                  <button
                    className={`btn w-100 ${
                      disabled ? "btn-outline-secondary" : "btn-outline-primary"
                    }`}
                    disabled={disabled}
                    onClick={() => handleSelectHour(h.time)}
                    title={disabled ? "Sin cupos" : "Seleccionar"}
                  >
                    <div className="fw-semibold">{h.time}</div>
                    <div className={`small ${disabled ? "text-muted" : ""}`}>
                      {disabled ? "Sin cupos" : `Quedan ${h.remaining}`}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 small text-muted">
          * El cupo se confirma al completar la reserva y abonar la seña.
        </div>
      </div>
    </div>
  );
}
