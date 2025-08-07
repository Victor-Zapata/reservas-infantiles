"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Niño = {
  nombre: string;
  dni: string;
  edad: number;
  condiciones: string;
  tieneCondiciones: boolean;
  horas: number;
};

export default function ReservaPage() {
  const [niños, setNiños] = useState<Niño[]>([
    {
      nombre: "",
      dni: "",
      edad: 1,
      condiciones: "",
      tieneCondiciones: false,
      horas: 1,
    },
  ]);

  const router = useRouter();
  const puedeAgregarOtro = niños.length < 3;

  const handleChange = <K extends keyof Niño>(
    index: number,
    campo: K,
    valor: Niño[K]
  ) => {
    const actualizados = [...niños];
    actualizados[index][campo] = valor;
    setNiños(actualizados);
  };

  const agregarNiño = () => {
    if (puedeAgregarOtro) {
      setNiños([
        ...niños,
        {
          nombre: "",
          dni: "",
          edad: 1,
          condiciones: "",
          tieneCondiciones: false,
          horas: 1,
        },
      ]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guardar datos en localStorage
    localStorage.setItem("datosNiños", JSON.stringify(niños));
    // Redirigir a la siguiente pantalla
    router.push("/reserva/adulto");
  };

  return (
    <div className="container my-5">
      <h2 className="mb-4 text-success">Datos del/los niño(s)</h2>
      <form onSubmit={handleSubmit}>
        {niños.map((niño, index) => (
          <div key={index} className="border rounded p-4 mb-4">
            <h5 className="mb-3">Niño/a #{index + 1}</h5>

            <div className="mb-3">
              <label className="form-label">Nombre y Apellido</label>
              <input
                type="text"
                className="form-control"
                required
                value={niño.nombre}
                onChange={(e) => handleChange(index, "nombre", e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">DNI</label>
              <input
                type="text"
                className="form-control"
                required
                value={niño.dni}
                onChange={(e) => handleChange(index, "dni", e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">Edad (1 a 9 años)</label>
              <input
                type="number"
                className="form-control"
                min={1}
                max={9}
                required
                value={niño.edad}
                onChange={(e) =>
                  handleChange(index, "edad", parseInt(e.target.value))
                }
              />
            </div>

            <div className="mb-3 form-check">
              <input
                className="form-check-input"
                type="checkbox"
                checked={niño.tieneCondiciones}
                onChange={(e) =>
                  handleChange(index, "tieneCondiciones", e.target.checked)
                }
                id={`condicionCheck-${index}`}
              />
              <label
                className="form-check-label"
                htmlFor={`condicionCheck-${index}`}
              >
                ¿Tiene alguna condición que debamos saber?
              </label>
            </div>

            {niño.tieneCondiciones && (
              <div className="mb-3">
                <label className="form-label">Detalle de la condición</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={niño.condiciones}
                  onChange={(e) =>
                    handleChange(index, "condiciones", e.target.value)
                  }
                />
              </div>
            )}

            <div className="mb-3">
              <label className="form-label">¿Cuántas horas se quedará?</label>
              <select
                className="form-select"
                value={niño.horas}
                onChange={(e) =>
                  handleChange(index, "horas", parseInt(e.target.value))
                }
              >
                <option value={1}>1 hora</option>
                <option value={2}>2 horas</option>
              </select>
            </div>
          </div>
        ))}

        {puedeAgregarOtro && (
          <button
            type="button"
            className="btn btn-outline-primary mb-4"
            onClick={agregarNiño}
          >
            + Agregar otro niño/a
          </button>
        )}

        <button type="submit" className="btn btn-warning">
          Continuar
        </button>
      </form>
    </div>
  );
}
