import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, Preference } from "mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const accessToken = process.env.MP_ACCESS_TOKEN!;
    const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    const { origin } = new URL(req.url);
    const baseUrl = envUrl || origin || "http://localhost:3000";

    const client = new MercadoPagoConfig({
      accessToken,
      options: { integratorId: process.env.MP_INTEGRATOR_ID },
    });
    const preference = new Preference(client);

    const back_urls = {
      success: `${baseUrl}/reserva/exito`,
      failure: `${baseUrl}/reserva/pago?estado=failure`,
      pending: `${baseUrl}/reserva/pago?estado=pending`,
    };

    const result = await preference.create({
      body: {
        items: [
          {
            id: "senia-reserva",
            title: "Seña de reserva - Me Requeté",
            description:
              "Seña de $5000 ARS. Si no concurrís, queda como crédito para una futura visita.",
            quantity: 1,
            currency_id: "ARS",
            unit_price: 5000,
          },
        ],
        back_urls,
        // auto_return: 'approved', // ⬅️ comentar en local
        external_reference: crypto.randomUUID(),
        statement_descriptor: "ME REQUETE",
        // payer: { email: process.env.MP_TEST_BUYER_EMAIL },
      },
    });

    const initPoint =
      (result as any)?.init_point || (result as any)?.sandbox_init_point;
    if (!initPoint) {
      return NextResponse.json(
        { ok: false, error: "MP no devolvió init_point" },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, init_point: initPoint });
  } catch (err: any) {
    console.error("Error MP:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Error MP" },
      { status: 500 }
    );
  }
}
