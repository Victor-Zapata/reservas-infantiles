import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "fs/promises";
import path from "path";

const DATA_PATH = path.resolve(process.cwd(), "data", "reservas.json");

type Reserva = {
  niños: any[];
  adulto: any;
  autorizaciones: any;
  fecha: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reserva: Reserva = {
      ...body,
      fecha: new Date().toISOString(),
    };

    // Asegurarse de que el archivo y carpeta existen
    const dataPrev = await readFile(DATA_PATH, "utf8").catch(() => "[]");
    const reservas = JSON.parse(dataPrev);
    reservas.push(reserva);

    await writeFile(DATA_PATH, JSON.stringify(reservas, null, 2));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error al guardar reserva:", error);
    return NextResponse.json(
      { ok: false, error: "Error al guardar" },
      { status: 500 }
    );
  }
}
