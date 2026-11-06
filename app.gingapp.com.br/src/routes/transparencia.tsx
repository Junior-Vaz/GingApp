import { createFileRoute } from "@tanstack/react-router";
import { TransparencyPage } from "@/components/gingapp/transparency";

// Pública (sem login, fora de _app): totais por mês publicados pela equipe, servidos por GET /api/transparency.
export const Route = createFileRoute("/transparencia")({
  head: () => ({ meta: [{ title: "Transparência — GingApp" }] }),
  component: TransparencyPage,
});
