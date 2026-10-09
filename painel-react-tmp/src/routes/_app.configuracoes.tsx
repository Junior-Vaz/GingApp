import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/configuracoes/).
export const Route = createFileRoute("/_app/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Configurações" />,
});
