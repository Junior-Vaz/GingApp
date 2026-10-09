import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/financeiro/).
export const Route = createFileRoute("/_app/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Financeiro" />,
});
