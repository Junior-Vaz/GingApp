import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "@/components/chaveamento/live-page";
import { parseLiveSearch } from "@/lib/chaveamento/live-search";
import { parseTvSearch } from "@/lib/chaveamento/search";

// Pública (sem login, fora do layout `_app`): telão ao vivo do chaveamento de um campeonato (docs/CONTRATO_CHAVEAMENTO.md, seção 7).
// O token vai só no caminho; a página não envia nada para analytics e pede aos navegadores para não repassar o endereço (referrer)
// a imagens de terceiros, nem indexar.
// `?tv=1` é validado aqui (entra no pacote principal do app); `?categoria=<id>` e `?q=<texto>` (links profundos) são lidos
// pelo componente, que vem no pacote do telão: o roteador não reescreve a URL e o pacote principal não cresce.
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
    // Valores inválidos somem em silêncio (id que não existe no campeonato é ignorado pela página).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const deep = useMemo(() => parseLiveSearch(Object.fromEntries(new URLSearchParams(window.location.search))), [token]);
    return <LivePage token={token} tv={search.tv === 1} categoryId={deep.categoria ?? null} initialQuery={deep.q ?? ""} />;
  },
});
