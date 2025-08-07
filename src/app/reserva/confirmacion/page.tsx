"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Niño = {
  nombre: string;
  dni: string;
  edad: number;
  condiciones: string;
  tieneCondiciones: boolean;
  horas: number;
};

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

type Autorizaciones = {
  consentimiento: boolean;
  usoImagen: "si" | "no";
  terminos: boolean;
};

export default function ConfirmacionPage() {
  const router = useRouter();

  const [niños, setNiños] = useState<Niño[]>([]);
  const [adulto, setAdulto] = useState<DatosAdulto | null>(null);
  const [autorizaciones, setAutorizaciones] = useState<Autorizaciones | null>(
    null
  );

  useEffect(() => {
    const datosNiños = localStorage.getItem("datosNiños");
    const datosAdulto = localStorage.getItem("datosAdulto");
    const datosAutorizaciones = localStorage.getItem("autorizaciones");

    if (!datosNiños || !datosAdulto || !datosAutorizaciones) {
      router.push("/reserva");
      return;
    }

    setNiños(JSON.parse(datosNiños));
    setAdulto(JSON.parse(datosAdulto));
    setAutorizaciones(JSON.parse(datosAutorizaciones));
  }, [router]);

  const handleFinalizar = async () => {
    const datos = {
      niños,
      adulto,
      autorizaciones,
    };

    try {
      const res = await fetch("/api/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });

      if (!res.ok) throw new Error("Error en el backend");

      // Guardado OK: ir al pago
      router.push("/reserva/pago");
    } catch (err) {
      console.error("Error al guardar reserva:", err);
      alert("Ocurrió un error al guardar la reserva. Intente nuevamente.");
    }
  };

  if (!niños.length || !adulto || !autorizaciones) {
    return <div className="container mt-5">Cargando resumen...</div>;
  }

  return (
    <div className="container my-5">
      <h2 className="mb-4 text-primary">Confirmación de Reserva</h2>

      <h4 className="text-success mb-3">Niños/as registrados</h4>
      {niños.map((n, i) => (
        <div key={i} className="mb-3 border rounded p-3">
          <strong>#{i + 1}</strong> {n.nombre} - DNI: {n.dni} - Edad: {n.edad}{" "}
          años
          <br />
          Horas: {n.horas} hora(s)
          <br />
          {n.tieneCondiciones && <em>Condición: {n.condiciones}</em>}
        </div>
      ))}

      <h4 className="text-success mb-3 mt-4">Adulto responsable</h4>
      <div className="border rounded p-3 mb-3">
        <p>
          <strong>Nombre:</strong> {adulto.nombre}
          <br />
          <strong>DNI:</strong> {adulto.dni}
          <br />
          <strong>Teléfono:</strong> {adulto.telefono}
        </p>
        {!adulto.retiraElMismo && (
          <>
            <h6 className="text-secondary mt-3">
              Persona autorizada a retirar
            </h6>
            <p>
              <strong>Nombre:</strong> {adulto.contactoAlternativo.nombre}
              <br />
              <strong>DNI:</strong> {adulto.contactoAlternativo.dni}
              <br />
              <strong>Teléfono:</strong> {adulto.contactoAlternativo.telefono}
            </p>
          </>
        )}
      </div>

      <h4 className="text-success mb-3 mt-4">Autorizaciones</h4>
      <ul>
        <li>
          Consentimiento informado:{" "}
          {autorizaciones.consentimiento ? "✅ Aceptado" : "❌ No aceptado"}
        </li>
        <li>
          Uso de imagen:{" "}
          {autorizaciones.usoImagen === "si"
            ? "✅ Autorizado"
            : "🚫 No autorizado"}
        </li>
        <li>
          Términos y condiciones:{" "}
          {autorizaciones.terminos ? "✅ Aceptados" : "❌ No aceptados"}
        </li>
      </ul>

      <div className="mt-4">
        <button className="btn btn-success btn-lg" onClick={handleFinalizar}>
          Finalizar Reserva
        </button>
      </div>
    </div>
  );
}
