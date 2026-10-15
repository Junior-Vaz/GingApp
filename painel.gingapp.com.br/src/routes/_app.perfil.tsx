import { createFileRoute } from "@tanstack/react-router";
import { PerfilPage } from "@/modules/perfil/perfil-page";

// "Meu perfil" fica fora do menu (NAV_ITEMS) e é livre para TODOS os papéis do painel; o guard de /_app já exige sessão.
export const Route = createFileRoute("/_app/perfil")({
  head: () => ({ meta: [{ title: "Meu perfil — Painel GingApp" }] }),
  component: PerfilPage,
});
