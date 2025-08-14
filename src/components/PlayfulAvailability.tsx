"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type HourSlot = { time: string; remaining: number };
type AvResponse = { ok: boolean; date: string; max: number; hours: HourSlot[] };

const TODAY = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function monthMatrix(year: number, monthIndex0: number) {
  // Devuelve una matriz 6x7 de fechas (siendo null cuando corresponde a días fuera del mes)
  const first = new Date(year, monthIndex0, 1);
  const startDay = (first.getDay() + 6) % 7; // semana L-D
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();

  const grid: (Date | null)[][] = [];
  let current = 1 - startDay;

  for (let r = 0; r < 6; r++) {
    const row: (Date | null)[] = [];
    for (let c = 0; c < 7; c++) {
      const date = new Date(year, monthIndex0, current);
      if (current < 1 || current > daysInMonth) row.push(null);
      else row.push(date);
      current++;
    }
    grid.push(row);
  }
  return grid;
}

export default function PlayfulAvailability() {
  const router = useRouter();

  const [refMonth, setRefMonth] = useState<Date>(
    new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)
  );
  const [selectedDay, setSelectedDay] = useState<string>(ymd(TODAY));
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState<HourSlot[]>([]);
  const [max, setMax] = useState<number>(10);
  const [error, setError] = useState<string | null>(null);

  const matrix = useMemo(
    () => monthMatrix(refMonth.getFullYear(), refMonth.getMonth()),
    [refMonth]
  );

  // Cargar disponibilidad cuando cambia el día seleccionado
  useEffect(() => {
    let abort = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/availability?date=${selectedDay}`, {
          cache: "no-store",
        });
        const data: AvResponse = await res.json();
        if (abort) return;
        if (!res.ok || !data?.ok)
          throw new Error(
            (data as any)?.error || "No se pudo cargar disponibilidad."
          );
        setHours(data.hours || []);
        setMax(data.max || 10);
      } catch (e: any) {
        setError(e?.message || "Error al cargar disponibilidad.");
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [selectedDay]);

  const monthName = refMonth.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
  const weekDays = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

  const isToday = (d: Date | null): boolean => !!d && ymd(d) === ymd(TODAY);
  const isSelected = (d: Date | null): boolean => !!d && ymd(d) === selectedDay;
  const isPast = (d: Date | null): boolean => !!d && ymd(d) < ymd(TODAY);

  const handleDayClick = (d: Date | null) => {
    if (!d) return;
    const s = ymd(d);
    if (s < ymd(TODAY)) return; // no permitir días pasados
    setSelectedDay(s);
  };

  const handleHourClick = (hhmm: string) => {
    localStorage.setItem("reserva:fecha", selectedDay);
    localStorage.setItem("reserva:hora", hhmm);
    router.push("/reserva");
  };

  return (
    <div className="playful-card shadow-lg border-0 rounded-4 overflow-hidden">
      <div className="playful-card-header d-flex align-items-center justify-content-between p-3">
        <button
          className="btn btn-light btn-sm rounded-circle"
          aria-label="Mes anterior"
          onClick={() =>
            setRefMonth(
              new Date(refMonth.getFullYear(), refMonth.getMonth() - 1, 1)
            )
          }
        >
          ‹
        </button>
        <div className="font-kids fs-4">{monthName}</div>
        <button
          className="btn btn-light btn-sm rounded-circle"
          aria-label="Mes siguiente"
          onClick={() =>
            setRefMonth(
              new Date(refMonth.getFullYear(), refMonth.getMonth() + 1, 1)
            )
          }
        >
          ›
        </button>
      </div>

      <div className="p-3">
        {/* Calendario */}
        <div className="calendar mb-4">
          <div className="calendar-row calendar-head text-uppercase small">
            {weekDays.map((w) => (
              <div
                key={w}
                className="calendar-cell text-center fw-semibold text-secondary"
              >
                {w}
              </div>
            ))}
          </div>

          {matrix.map((row, i) => (
            <div key={i} className="calendar-row">
              {row.map((d, j) => {
                const disabled = !d || isPast(d); // <- ahora es boolean
                const sel = isSelected(d);
                const today = isToday(d);
                return (
                  <button
                    key={j}
                    type="button"
                    className={`calendar-cell btn ${
                      disabled
                        ? "btn-outline-light disabled text-muted"
                        : sel
                        ? "btn-primary text-white"
                        : "btn-outline-primary"
                    } ${today && !sel ? "calendar-today" : ""}`}
                    onClick={() => handleDayClick(d)}
                    disabled={disabled}
                    title={d ? d.toLocaleDateString("es-AR") : ""}
                  >
                    {d ? d.getDate() : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Info de cupos */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="text-muted small">Cupo por hora</span>
          <span className="badge rounded-pill text-bg-secondary">
            máx. {max} niños
          </span>
        </div>

        {loading && (
          <div className="alert alert-info mb-0">Cargando disponibilidad…</div>
        )}
        {error && !loading && (
          <div className="alert alert-danger mb-0">{error}</div>
        )}

        {!loading && !error && (
          <div className="row row-cols-2 row-cols-sm-3 row-cols-md-4 g-3">
            {hours.map((h) => {
              const noCupo = h.remaining <= 0;
              return (
                <div className="col" key={h.time}>
                  <button
                    className={`hour-btn btn w-100 ${
                      noCupo ? "btn-outline-secondary" : "btn-outline-success"
                    }`}
                    disabled={noCupo}
                    onClick={() => handleHourClick(h.time)}
                  >
                    <div className="fw-semibold">{h.time}</div>
                    <div className={`small ${noCupo ? "text-muted" : ""}`}>
                      {noCupo ? "Agotado" : `Quedan ${h.remaining}`}
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
