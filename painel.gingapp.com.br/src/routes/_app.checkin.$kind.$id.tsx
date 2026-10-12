import { createFileRoute } from "@tanstack/react-router";
import { CheckinQrPage } from "@/modules/checkin/checkin-page";
import { isCheckinKind } from "@/modules/checkin/checkin-api";

// /checkin/evento/:id e /checkin/aula/:id - QR de check-in/presença para projetar ou imprimir.
// Rota fora do menu (aberta pelos botões "QR de check-in" de Eventos e "QR de presença" da Frequência).
export const Route = createFileRoute("/_app/checkin/$kind/$id")({
  head: () => ({ meta: [{ title: "QR de check-in — Painel GingApp" }] }),
  component: CheckinRoute,
});

function CheckinRoute() {
  const { kind, id } = Route.useParams();
  const numericId = Number(id);
  if (!isCheckinKind(kind) || !Number.isInteger(numericId) || numericId <= 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Endereço de check-in inválido.</p>;
  }
  return <CheckinQrPage kind={kind} id={numericId} />;
}
