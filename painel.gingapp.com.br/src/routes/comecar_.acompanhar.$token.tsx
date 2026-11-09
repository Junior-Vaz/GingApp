import { createFileRoute } from "@tanstack/react-router";
import { ApplicationStatusPage } from "@/components/painel/group-application-pages";

// Pública (sem login): andamento do pedido. O token de acompanhamento vive só no PATH; a página não é indexada
// e não repassa o endereço como referrer.
export const Route = createFileRoute("/comecar_/acompanhar/$token")({
  head: () => ({
    meta: [
      { title: "Acompanhar pedido — GingApp" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: function ApplicationStatus() {
    const { token } = Route.useParams();
    return <ApplicationStatusPage token={token} />;
  },
});
