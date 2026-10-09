import { createFileRoute } from "@tanstack/react-router";
import { RelatoriosPage } from "@/modules/relatorios/relatorios-page";

export const Route = createFileRoute("/_app/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — Painel GingApp" }] }),
  component: RelatoriosPage,
});
