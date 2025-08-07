"use client";

import { useEffect } from "react";

export default function PagoPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const iniciarPago = async () => {
    try {
      const res = await fetch("/api/mercadopago", {
        method: "POST",
      });

      const data = await res.json();

      if (data.init_point) {
        window.location.href = data.init_point; // redirigir a Mercado Pago
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
        En caso de no concurrir, la seña quedará como crédito para una próxima
        visita.
      </p>

      <button className="btn btn-success btn-lg mt-4" onClick={iniciarPago}>
        Pagar con Mercado Pago
      </button>
    </div>
  );
}
