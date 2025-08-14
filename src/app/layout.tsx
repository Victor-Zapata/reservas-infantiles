import "bootstrap/dist/css/bootstrap.min.css";   
import "@/styles/theme.css";    

export const metadata = { title: "ME RE QUETÉ" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* Tipos infantiles y redondeados */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Fredoka:wght@600;700&family=Quicksand:wght@500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

