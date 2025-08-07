'use client';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="text-center mt-5">
      <h1 className="display-4 text-success fw-bold">¡Bienvenido a Me Requeté!</h1>
      <p className="lead text-secondary">
        Reservá un turno para el cuidado de niños en nuestro espacio seguro y divertido.
      </p>
      <Link href="/reserva" className="btn btn-warning btn-lg mt-4">
        Reservar Turno
      </Link>
    </div>
  );
}
