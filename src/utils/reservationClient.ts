// utils/reservationClient.ts
export async function createDraftReservation(params: {
  date: string;         // "YYYY-MM-DD"
  hourHHmm: string;     // "HH:00"
  guardianEmail?: string;
  guardianName?: string;
}) {
  const { date, hourHHmm, guardianEmail, guardianName } = params;
  const hour = Number(String(hourHHmm).slice(0, 2));

  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, hour, guardianEmail, guardianName }),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudo crear la reserva");
  }

  const reservationId = data.reservation?.id as string;
  // guardamos para los siguientes pasos del flujo
  localStorage.setItem("reservationId", reservationId);
  localStorage.setItem("reserva:fecha", date);
  localStorage.setItem("reserva:hora", hourHHmm);

  return reservationId;
}
