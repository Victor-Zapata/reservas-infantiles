// src/app/page.tsx
import AvailabilityWidget from "@/components/AvailabilityWidget";

export default function HomePage() {
  return (
    <main className="container py-5">
      <div className="mb-5 text-center">
        <h1 className="display-5 fw-bold">ME RE QUETÉ</h1>
        <p className="lead">Reservá tu turno para el cuidado de tu hijo/a.</p>
      </div>

      <AvailabilityWidget />

      <div className="mt-4 text-center">
        <p className="text-muted small">
          Elegí el día y la hora; vas a completar los datos en el siguiente
          paso.
        </p>
      </div>
    </main>
  );
}
