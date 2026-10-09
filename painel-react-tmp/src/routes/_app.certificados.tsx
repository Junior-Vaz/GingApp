import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/certificados/).
export const Route = createFileRoute("/_app/certificados")({
  head: () => ({ meta: [{ title: "Certificados — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Certificados" />,
});
