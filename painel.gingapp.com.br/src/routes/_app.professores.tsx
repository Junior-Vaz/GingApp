import { createFileRoute } from "@tanstack/react-router";
import { ProfessoresPage } from "@/modules/professores/professores-page";

export const Route = createFileRoute("/_app/professores")({
  head: () => ({ meta: [{ title: "Professores — Painel GingApp" }] }),
  component: ProfessoresPage,
});
