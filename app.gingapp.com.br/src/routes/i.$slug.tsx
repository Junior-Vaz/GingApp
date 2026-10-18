import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PublicRegistrationPage } from "@/components/gingapp/inscricao-publica";

// Pública (sem login, fora do layout `_app`): inscrição num evento/campeonato. `?consultar=1` abre a consulta por protocolo.
export const Route = createFileRoute("/i/$slug")({
  validateSearch: (search: Record<string, unknown>): { consultar?: 1 } => (search["consultar"] === 1 || search["consultar"] === "1" ? { consultar: 1 } : {}),
  head: () => ({
    meta: [{ title: "Inscrição — GingApp" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: function RegistrationRoute() {
    const { slug } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate();
    return (
      <PublicRegistrationPage
        slug={slug}
        initialView={search.consultar === 1 ? "consult" : "form"}
        onViewChange={(view) =>
          void navigate({ to: "/i/$slug", params: { slug }, search: view === "consult" ? { consultar: 1 } : {}, replace: true })
        }
      />
    );
  },
});
