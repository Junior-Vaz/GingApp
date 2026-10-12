import { createFileRoute } from "@tanstack/react-router";
import { CheckinPage } from "@/components/gingapp/checkin";

// /checkin?token=E12-K7QXM3PA2B — o QR impresso no painel abre esta rota. A presenca so e registrada
// depois que a pessoa toca em "Confirmar presença" (abrir o link nunca confirma sozinho).
export const Route = createFileRoute("/_app/checkin")({
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Check-in — GingApp" }] }),
  component: function Checkin() {
    const { token } = Route.useSearch();
    return <CheckinPage initialToken={token ?? ""} />;
  },
});
