// app/reserva/pago/page.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function PagoPage() {
  const searchParams = useSearchParams();
  const estado = searchParams.get("estado"); // failure | pending

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const iniciarPago = async () => {
    try {
      const res = await fetch("/api/mercadopago", { method: "POST" });
      const data = await res.json();

      if (data?.init_point) {
        window.location.href = data.init_point;
      } else {
        alert("No se pudo iniciar el pago. Intente nuevamente.");
      }
    } catch (err) {
      console.error("Error al iniciar el pago:", err);
      alert("Error inesperado al conectar con Mercado Pago.");
    }
  };

  return (
    <div className="container my-5 text-center">
      <h2 className="text-primary mb-4">Reserva tu lugar</h2>
      <p className="lead">
        Para confirmar tu turno, aboná una seña de <strong>$5000 ARS</strong>.
      </p>
      <p className="text-muted">
        Si no asistís por cualquier motivo, la seña queda como crédito para una
        próxima visita.
      </p>

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

      <button className="btn btn-success btn-lg mt-4" onClick={iniciarPago}>
        Pagar con Mercado Pago
      </button>
    </div>
  );
}
