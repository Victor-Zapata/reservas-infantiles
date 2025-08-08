// app/reserva/exito/page.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ExitoPage() {
  useEffect(() => {
    // Limpio datos locales si aún existen
    try {
      localStorage.removeItem("datosNiños");
      localStorage.removeItem("datosAdulto");
      localStorage.removeItem("autorizaciones");
    } catch {}
  }, []);

  return (
    <div className="container my-5 text-center">
      <h2 className="text-success mb-3">¡Pago confirmado!</h2>
      <p className="lead">
        Tu seña de <strong>$5000 ARS</strong> fue registrada con éxito. En caso
        de no asistir, quedará como crédito para una próxima visita.
      </p>

      <Link href="/" className="btn btn-primary mt-4">
        Volver al inicio
      </Link>
    </div>
  );
}
