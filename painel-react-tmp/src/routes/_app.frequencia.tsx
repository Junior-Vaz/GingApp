import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/frequencia/).
export const Route = createFileRoute("/_app/frequencia")({
  head: () => ({ meta: [{ title: "Frequência — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Frequência" />,
});
