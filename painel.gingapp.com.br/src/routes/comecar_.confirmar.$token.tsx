import { createFileRoute } from "@tanstack/react-router";
import { ConfirmEmailPage } from "@/components/painel/group-application-pages";

// Pública (sem login): confirmação do e-mail do pedido de cadastro. O token de confirmação vive só no PATH; a página não é
// indexada, não repassa o endereço como referrer e NUNCA confirma ao abrir (só o clique no botão faz o POST).
export const Route = createFileRoute("/comecar_/confirmar/$token")({
  head: () => ({
    meta: [
      { title: "Confirmar e-mail — GingApp" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: function ConfirmEmail() {
    const { token } = Route.useParams();
    return <ConfirmEmailPage token={token} />;
  },
});
