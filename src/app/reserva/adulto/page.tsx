"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Contacto = {
  nombre: string;
  dni: string;
  telefono: string;
};

type DatosAdulto = {
  nombre: string;
  dni: string;
  telefono: string;
  retiraElMismo: boolean;
  contactoAlternativo: Contacto;
};

export default function AdultoPage() {
  const router = useRouter();
  const [adulto, setAdulto] = useState<DatosAdulto>({
    nombre: "",
    dni: "",
    telefono: "",
    retiraElMismo: true,
    contactoAlternativo: {
      nombre: "",
      dni: "",
      telefono: "",
    },
  });

  useEffect(() => {
    const datosNiños = localStorage.getItem("datosNiños");
    if (!datosNiños) {
      router.push("/reserva");
    }
  }, [router]);

  const handleChange = <K extends keyof DatosAdulto>(
    campo: K,
    valor: DatosAdulto[K]
  ) => {
    setAdulto((prev) => ({ ...prev, [campo]: valor }));
  };

  const handleContactoChange = <K extends keyof Contacto>(
    campo: K,
    valor: Contacto[K]
  ) => {
    setAdulto((prev) => ({
      ...prev,
      contactoAlternativo: { ...prev.contactoAlternativo, [campo]: valor },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guardar en localStorage para el próximo paso
    localStorage.setItem("datosAdulto", JSON.stringify(adulto));
    router.push("/reserva/consentimiento");
  };

  return (
    <div className="kids-form">
      <div className="container my-5">
        <h2 className="mb-4 text-primary">Datos del Adulto Responsable</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label">Nombre y Apellido</label>
            <input
              type="text"
              className="form-control"
              required
              value={adulto.nombre}
              onChange={(e) => handleChange("nombre", e.target.value)}
            />
          </div>

          <div className="mb-3">
            <label className="form-label">DNI</label>
            <input
              type="text"
              className="form-control"
              required
              value={adulto.dni}
              onChange={(e) => handleChange("dni", e.target.value)}
            />
          </div>

          <div className="mb-3">
            <label className="form-label">Teléfono de contacto</label>
            <input
              type="tel"
              className="form-control"
              required
              value={adulto.telefono}
              onChange={(e) => handleChange("telefono", e.target.value)}
            />
          </div>

          <div className="form-check mb-3">
            <input
              className="form-check-input"
              type="checkbox"
              id="retira"
              checked={adulto.retiraElMismo}
              onChange={(e) => handleChange("retiraElMismo", e.target.checked)}
            />
            <label className="form-check-label" htmlFor="retira">
              ¿Usted retira al niño?
            </label>
          </div>

          {!adulto.retiraElMismo && (
            <div className="border rounded p-3 mb-3">
              <h5 className="text-secondary mb-3">Persona que retira</h5>

              <div className="mb-2">
                <label className="form-label">Nombre y Apellido</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={adulto.contactoAlternativo.nombre}
                  onChange={(e) =>
                    handleContactoChange("nombre", e.target.value)
                  }
                />
              </div>

              <div className="mb-2">
                <label className="form-label">DNI</label>
                <input
                  type="text"
                  className="form-control"
                  required
                  value={adulto.contactoAlternativo.dni}
                  onChange={(e) => handleContactoChange("dni", e.target.value)}
                />
              </div>

              <div className="mb-2">
                <label className="form-label">Teléfono</label>
                <input
                  type="tel"
                  className="form-control"
                  required
                  value={adulto.contactoAlternativo.telefono}
                  onChange={(e) =>
                    handleContactoChange("telefono", e.target.value)
                  }
                />
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-kids-outline">
            Continuar
          </button>
        </form>
      </div>
    </div>
  );
}
