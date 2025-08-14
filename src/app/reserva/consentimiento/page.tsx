"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ConsentimientoPage() {
  const router = useRouter();

  const [consentimiento, setConsentimiento] = useState(false);
  const [usoImagen, setUsoImagen] = useState<"si" | "no" | "">("");
  const [terminos, setTerminos] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const datosNiños = localStorage.getItem("datosNiños");
    const datosAdulto = localStorage.getItem("datosAdulto");
    if (!datosNiños || !datosAdulto) {
      router.push("/reserva");
    }
  }, [router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!consentimiento || usoImagen === "" || !terminos) {
      setError(
        "Por favor completá todos los campos obligatorios para continuar."
      );
      return;
    }

    setError("");
    // Guardar autorizaciones
    const autorizaciones = { consentimiento, usoImagen, terminos };
    localStorage.setItem("autorizaciones", JSON.stringify(autorizaciones));

    // Redirigir al siguiente paso (ej: pago)
    router.push("/reserva/confirmacion");
  };

  return (
    <div className="kids-form">
      <div className="container my-5">
        <h2 className="mb-4 text-primary">Autorizaciones</h2>

        <form onSubmit={handleSubmit}>
          {/* 1. Consentimiento informado */}
          <div className="mb-4 border rounded p-4">
            <h5 className="text-success">Consentimiento informado</h5>
            <p className="small text-muted">
              Aquí irá el texto legal que describe el consentimiento informado,
              la asunción de riesgo y el deslinde de responsabilidad. El cliente
              debe aceptar este consentimiento para continuar.
            </p>

            <div className="form-check mt-2">
              <input
                className="form-check-input"
                type="checkbox"
                checked={consentimiento}
                onChange={(e) => setConsentimiento(e.target.checked)}
                id="consentimientoCheck"
              />
              <label className="form-check-label" htmlFor="consentimientoCheck">
                Acepto el consentimiento informado.
              </label>
            </div>
          </div>

          {/* 2. Uso de imagen */}
          <div className="mb-4 border rounded p-4">
            <h5 className="text-success">Autorización para uso de imagen</h5>
            <p className="small text-muted">
              ¿Autorizás a que tomemos fotos o videos del niño/a con fines
              promocionales internos?
            </p>

            <div className="form-check">
              <input
                className="form-check-input"
                type="radio"
                name="imagen"
                id="imagenSi"
                value="si"
                checked={usoImagen === "si"}
                onChange={(e) => setUsoImagen(e.target.value as "si")}
              />
              <label className="form-check-label" htmlFor="imagenSi">
                Sí, autorizo el uso de imagen.
              </label>
            </div>

            <div className="form-check">
              <input
                className="form-check-input"
                type="radio"
                name="imagen"
                id="imagenNo"
                value="no"
                checked={usoImagen === "no"}
                onChange={(e) => setUsoImagen(e.target.value as "no")}
              />
              <label className="form-check-label" htmlFor="imagenNo">
                No autorizo el uso de imagen.
              </label>
            </div>
          </div>

          {/* 3. Términos y condiciones */}
          <div className="mb-4 border rounded p-4">
            <h5 className="text-success">Aceptación de términos</h5>
            <p className="small text-muted">
              Aquí irá el texto sobre términos y condiciones de uso del
              servicio, normas de convivencia, política de cancelación, etc.
            </p>

            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                checked={terminos}
                onChange={(e) => setTerminos(e.target.checked)}
                id="terminosCheck"
              />
              <label className="form-check-label" htmlFor="terminosCheck">
                Acepto los términos y condiciones.
              </label>
            </div>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <button type="submit" className="btn btn-kids-outline">
            Continuar
          </button>
        </form>
      </div>
    </div>
  );
}
