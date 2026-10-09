import { createFileRoute } from "@tanstack/react-router";
import { TurmasPage } from "@/modules/turmas/turmas-page";

export const Route = createFileRoute("/_app/turmas")({
  head: () => ({ meta: [{ title: "Turmas — Painel GingApp" }] }),
  component: TurmasPage,
});
