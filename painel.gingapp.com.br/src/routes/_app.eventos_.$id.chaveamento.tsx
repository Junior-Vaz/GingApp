import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { ChaveamentoPage } from "@/modules/chaveamento";

// /eventos/:id/chaveamento - chave ao vivo do campeonato (operador). O "_" depois de "eventos" tira a rota de dentro de
// /eventos (página sem <Outlet>): abre sozinha. Fora do menu: o acesso é o botão "Chaveamento" das linhas de campeonato.
export const Route = createFileRoute("/_app/eventos_/$id/chaveamento")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/eventos")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Chaveamento — Painel GingApp" }] }),
  component: ChaveamentoRoute,
});

function ChaveamentoRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Endereço de chaveamento inválido.</p>;
  }
  return <ChaveamentoPage eventId={eventId} onBack={() => void navigate({ to: "/eventos" })} />;
}
