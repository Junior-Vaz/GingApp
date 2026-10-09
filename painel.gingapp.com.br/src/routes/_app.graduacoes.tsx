import { createFileRoute } from "@tanstack/react-router";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";

export const Route = createFileRoute("/_app/graduacoes")({
  head: () => ({ meta: [{ title: "Graduações — Painel GingApp" }] }),
  component: GraduacoesPage,
});
