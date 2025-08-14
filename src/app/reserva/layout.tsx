"use client";

import { usePathname } from "next/navigation";
import Stepper from "@/components/Stepper";

const steps = ["Niños", "Adulto", "Pago", "Éxito"];
const order = [
  "/reserva",
  "/reserva/adulto",
  "/reserva/pago",
  "/reserva/exito",
];

export default function ReservaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = Math.max(
    0,
    order.findIndex((p) => pathname?.startsWith(p))
  );

  return (
    <div className="playful-scope">
      {/* Hero chico */}
      <section className="kids-hero-small py-3">
        <div className="container">
          <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between">
            <div className="mb-2 mb-md-0">
              <h2 className="kids-hero-title h3 mb-0">ME RE QUETÉ</h2>
              <div className="text-muted small">
                Reservá tu turno en 3 pasos
              </div>
            </div>
          </div>
          <Stepper steps={steps} current={current === -1 ? 0 : current} />
        </div>
      </section>

      {/* Contenido de cada pantalla */}
      <main className="container py-4">{children}</main>
    </div>
  );
}
