import { createFileRoute } from "@tanstack/react-router";
import { AlunosPage } from "@/modules/alunos/alunos-page";

export const Route = createFileRoute("/_app/alunos")({
  head: () => ({ meta: [{ title: "Alunos — Painel GingApp" }] }),
  component: AlunosPage,
});
