// app/api/mercadopago/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Falta MP_ACCESS_TOKEN" },
        { status: 500 }
      );
    }

    // Chequeo del modo real del token (dejalo por ahora)
    const who = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await who.json();
    console.log("users/me CHECK:", {
      id: me.id,
      email: me.email,
      live_mode: me.live_mode, // false = sandbox, true = prod
      site_id: me.site_id,
    });

    const base =
      (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "") ||
      "http://localhost:3000";
    const back_urls = {
      success: `${base}/reserva/exito`,
      failure: `${base}/reserva/pago?estado=failure`,
      pending: `${base}/reserva/pago?estado=pending`,
    };

    const buyer = process.env.MP_TEST_BUYER_EMAIL;
    const payer = buyer && buyer.includes("@") ? { email: buyer } : undefined;
    const prefBody = {
      items: [
        {
          id: "senia-reserva",
          title: "Seña de reserva - Me Requeté",
          quantity: 1,
          currency_id: "ARS",
          unit_price: 5000,
        },
      ],
      back_urls,
      external_reference: crypto.randomUUID(),
      statement_descriptor: "ME REQUETE",
      payer, // quitalo si vas a usar producción real
    };

    const resp = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prefBody),
      }
    );
    const data = await resp.json();

    console.log("MP pref status:", resp.status);
    console.log("MP pref json keys:", Object.keys(data)); // no log completo para no ensuciar

    if (!resp.ok)
      return NextResponse.json({ ok: false, error: data }, { status: 502 });

    // *** ELECCIÓN DEL CHECKOUT URL ***
    const hasSandbox = Boolean(data.sandbox_init_point);
    const checkoutUrl = hasSandbox ? data.sandbox_init_point : data.init_point; // <-- priorizamos sandbox si existe

    console.log("checkoutUrl elegido:", checkoutUrl);

    if (!checkoutUrl) {
      return NextResponse.json(
        { ok: false, error: "Sin checkout URL" },
        { status: 500 }
      );
    }

    // devolvemos la URL elegida de forma explícita
    return NextResponse.json({ ok: true, checkoutUrl });
  } catch (e: any) {
    console.error("Error MP:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Error" },
      { status: 500 }
    );
  }
}
