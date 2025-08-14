import PlayfulAvailability from "@/components/PlayfulAvailability";
import Image from "next/image";

export default function HomePage() {
  return (
    <main>
      <section className="kids-hero py-5">
        <div className="container text-center">
          <div className="d-flex justify-content-center">
            <Image
              src="/merequete-logo.png" // o .png si preferís
              width={380} // mitad del original (640x640)
              height={380}
              alt="ME RE QUETÉ"
              priority
            />
          </div>

          <p className="lead text-muted mb-4">
            Elegí el día y la hora para reservar tu turno.
          </p>
        </div>
      </section>

      <section className="py-4">
        <div className="container">
          <PlayfulAvailability />
          <p className="text-center text-muted mt-3 small">
            Al seleccionar el horario, vas a completar los datos en el paso
            siguiente.
          </p>
        </div>
      </section>
    </main>
  );
}
