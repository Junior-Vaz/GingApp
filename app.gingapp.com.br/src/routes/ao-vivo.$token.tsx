import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "@/components/chaveamento/live-page";
import { parseTvSearch } from "@/lib/chaveamento/search";

// Pública (sem login, fora do layout `_app`): telão ao vivo do chaveamento de um campeonato (docs/CONTRATO_CHAVEAMENTO.md, seção 7).
// O token vai só no caminho; a página não envia nada para analytics e pede aos navegadores para não repassar o endereço (referrer)
// a imagens de terceiros, nem indexar.
export const Route = createFileRoute("/ao-vivo/$token")({
  validateSearch: parseTvSearch,
  head: () => ({
    meta: [
      { title: "Chaveamento ao vivo — GingApp" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: function LiveRoute() {
    const { token } = Route.useParams();
    const search = Route.useSearch();
    return <LivePage token={token} tv={search.tv === 1} />;
  },
});
