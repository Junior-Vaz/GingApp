import { createFileRoute } from "@tanstack/react-router";
import { EmConstrucao } from "@/components/painel/em-construcao";

// Fase 2b: substitua EmConstrucao pela página do módulo (src/modules/alunos/).
export const Route = createFileRoute("/_app/alunos")({
  head: () => ({ meta: [{ title: "Alunos — Painel GingApp" }] }),
  component: () => <EmConstrucao title="Alunos" />,
});
