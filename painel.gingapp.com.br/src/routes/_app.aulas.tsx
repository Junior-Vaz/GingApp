import { createFileRoute } from "@tanstack/react-router";
import { AulasPage } from "@/modules/aulas/aulas-page";

export const Route = createFileRoute("/_app/aulas")({
  head: () => ({ meta: [{ title: "Aulas — Painel GingApp" }] }),
  component: AulasPage,
});
