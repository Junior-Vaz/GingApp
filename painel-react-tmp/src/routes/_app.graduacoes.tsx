import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/graduacoes/).
export const Route = createFileRoute("/_app/graduacoes")({
  head: () => ({ meta: [{ title: "Graduações — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Graduações" />,
});
