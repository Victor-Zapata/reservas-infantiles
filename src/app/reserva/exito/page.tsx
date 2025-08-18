"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Payment = {
  id: string;
  provider: string;
  providerId: string | null;
  amount: number;
  kind: "deposit" | "remainder" | "full" | "other";
  status: "pending" | "approved" | "rejected" | "cancelled" | "refunded";
  createdAt: string;
};

type ReservationDTO = {
  id: string;
  status: string;
  date: string; // YYYY-MM-DD
  hour: number; // 0..23
  hourHHmm: string; // "HH:00"
  guardian: {
    name: string;
    email: string;
    phone?: string | null;
    docNumber?: string | null;
  };
  totals: {
    hourlyRate: number;
    depositPct: number;
    totalHours: number;
    totalAmount: number;
    depositAmount: number;
    remainingAmount: number;
  };
  children: Array<{
    id: string;
    fullName: string;
    ageYears: number;
    hours: number;
    hasConditions: boolean;
    conditions?: string | null;
    dni?: string | null;
  }>;
  payments: Payment[];
};

const currency = (v: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(v);

export default function ExitoPage() {
  const sp = useSearchParams();
  const resId = sp.get("res");

  // IDs que trae MP en la URL de retorno
  const qPaymentId =
    sp.get("payment_id") || sp.get("collection_id") || null;
  const qMerchantOrderId =
    sp.get("merchant_order_id") || sp.get("merchant_order") || null;
  const qStatus = (
    sp.get("status") || sp.get("collection_status") || ""
  ).toLowerCase();

  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resv, setResv] = useState<ReservationDTO | null>(null);
  const [justReconciled, setJustReconciled] = useState(false);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const fetchReservation = async (id: string) => {
    const r = await fetch(`/api/reservations/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j?.ok)
      throw new Error(j?.error || "No pudimos cargar la reserva.");
    return j.reservation as ReservationDTO;
  };

  // Cargar reserva
  useEffect(() => {
    (async () => {
      try {
        const id = resId || localStorage.getItem("reservationId") || "";
        if (!id) {
          setError("No encontramos la reserva.");
          setLoading(false);
          return;
        }
        const data = await fetchReservation(id);
        if (cancelledRef.current) return;
        setResv(data);
        setLoading(false);
      } catch (e: any) {
        if (cancelledRef.current) return;
        setError(e?.message || "Error inesperado");
        setLoading(false);
      }
    })();
  }, [resId]);

  const approved = useMemo(
    () => (resv?.payments || []).filter((p) => p.status === "approved"),
    [resv]
  );

  // 🔁 Finalizar (reconciliar) si:
  //  - hay resId (id de reserva)
  //  - hay payment_id o merchant_order_id en la URL
  //  - y aún no hay pagos approved en la reserva
  useEffect(() => {
    (async () => {
      const id = resId || localStorage.getItem("reservationId") || "";
      if (!id) return;

      const qPaymentId =
        sp.get("payment_id") || sp.get("collection_id") || null;
      const qMerchantOrderId =
        sp.get("merchant_order_id") || sp.get("merchant_order") || null;
      const qStatus =
        (sp.get("status") || sp.get("collection_status") || "").toLowerCase();

      // 👉 ya NO exigimos qStatus===approved
      if (!qPaymentId && !qMerchantOrderId) {
        console.log("[EXITO] no hay payment_id ni merchant_order_id en la URL, no finalizo");
        return;
      }
      if (approved.length > 0) {
        console.log("[EXITO] ya hay pagos approved, no finalizo");
        return;
      }

      const maxAttempts = 12; // ~18s con 1.5s de espera
      const delayMs = 1500;

      const run = async (attempt = 1): Promise<void> => {
        if (cancelledRef.current) return;
        setReconciling(true);
        try {
          console.log("[EXITO] FINALIZE attempt", attempt, {
            id, qPaymentId, qMerchantOrderId, qStatus
          });

          const r = await fetch(`/api/payments/finalize?res=${encodeURIComponent(id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paymentId: qPaymentId,
              merchantOrderId: qMerchantOrderId,
              reservationId: id,
              statusFromReturn: qStatus, // se usa en el fallback de staging
            }),
          });

          const j = await r.json().catch(() => ({} as any));
          console.log("[EXITO] FINALIZE resp", r.status, j);

          if (r.status === 200 && j?.ok) {
            const data = await fetchReservation(id);
            if (cancelledRef.current) return;
            setResv(data);
            setJustReconciled(true);
            setReconciling(false);
            return;
          }

          if ((r.status === 202 || j?.retry) && attempt < maxAttempts) {
            setTimeout(() => run(attempt + 1), delayMs);
            return;
          }

          setReconciling(false);
        } catch (e) {
          console.warn("[EXITO] FINALIZE error", e);
          if (attempt < maxAttempts) {
            setTimeout(() => run(attempt + 1), delayMs);
            return;
          }
          setReconciling(false);
        }
      };

      run(1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resId, approved.length]);



  return (
    <div className="kids-form">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <div className="text-center mb-4">
            <h1 className="kids-heading">¡Reserva confirmada!</h1>
            <p className="kids-subheading">
              Te enviamos el detalle a{" "}
              <strong>{resv?.guardian.email || "-"}</strong>
            </p>
          </div>

          {loading && (
            <div className="alert alert-info">
              Cargando los detalles de tu reserva…
            </div>
          )}
          {error && <div className="alert alert-danger">{error}</div>}

          {reconciling && !loading && (
            <div className="alert alert-warning">
              Validando el pago con Mercado Pago…
            </div>
          )}

          {justReconciled && (
            <div className="alert alert-success">
              ¡Pago validado! Actualizamos tu reserva.
            </div>
          )}

          {resv && (
            <div className="card shadow-sm">
              <div className="card-body">
                <h5 className="card-title">Resumen del turno</h5>

                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="kids-section-title mb-1">Fecha y hora</div>
                    <div>
                      {resv.date} — {resv.hourHHmm} hs
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="kids-section-title mb-1">Estado</div>
                    <span className="kids-pill">{resv.status}</span>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="kids-section-title mb-2">Niños/as</div>
                  <ul className="list-group">
                    {resv.children.map((c) => (
                      <li
                        key={c.id}
                        className="list-group-item d-flex justify-content-between"
                      >
                        <div>
                          <strong>{c.fullName}</strong>{" "}
                          <span className="text-muted">
                            ({c.ageYears} años)
                          </span>
                          {c.hasConditions && c.conditions ? (
                            <div className="small text-muted">
                              Condiciones: {c.conditions}
                            </div>
                          ) : null}
                        </div>
                        <div className="fw-bold">{c.hours} h</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4">
                  <div className="kids-section-title mb-2">Costos</div>
                  <ul className="list-group">
                    <li className="list-group-item d-flex justify-content-between">
                      <span>Valor por hora</span>
                      <strong>{currency(resv.totals.hourlyRate)}</strong>
                    </li>
                    <li className="list-group-item d-flex justify-content-between">
                      <span>Horas totales</span>
                      <strong>{resv.totals.totalHours}</strong>
                    </li>
                    <li className="list-group-item d-flex justify-content-between">
                      <span>Total</span>
                      <strong>{currency(resv.totals.totalAmount)}</strong>
                    </li>
                    <li className="list-group-item d-flex justify-content-between">
                      <span>Seña ({resv.totals.depositPct}%) — abonada</span>
                      <strong className="text-success">
                        {currency(resv.totals.depositAmount)}
                      </strong>
                    </li>
                    <li className="list-group-item d-flex justify-content-between">
                      <span>Resto a abonar al momento del servicio</span>
                      <strong className="text-muted">
                        {currency(resv.totals.remainingAmount)}
                      </strong>
                    </li>
                  </ul>
                </div>

                <div className="mt-4">
                  <div className="kids-section-title mb-2">Pagos</div>
                  {approved.length === 0 ? (
                    <div className="alert alert-warning mb-0">
                      Aún no registramos pagos aprobados. Si ya pagaste, se
                      actualizará en breve{reconciling ? "…" : "."}
                    </div>
                  ) : (
                    <ul className="list-group">
                      {approved.map((p) => (
                        <li
                          key={p.id}
                          className="list-group-item d-flex justify-content-between"
                        >
                          <div>
                            <div className="fw-bold">
                              {p.kind === "deposit"
                                ? "Seña"
                                : p.kind === "remainder"
                                ? "Resto"
                                : "Pago"}
                            </div>
                            <div className="small text-muted">
                              {new Date(p.createdAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="fw-bold">{currency(p.amount)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="text-center mt-4">
                  <a className="btn btn-kids" href="/">
                    Volver al inicio
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
