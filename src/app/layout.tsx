import 'bootstrap/dist/css/bootstrap.min.css';

export const metadata = {
  title: 'Me Requeté',
  description: 'Reserva de turnos para cuidado infantil',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <main className="container py-4">{children}</main>
      </body>
    </html>
  );
}

