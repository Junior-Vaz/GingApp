import { createFileRoute } from "@tanstack/react-router";
import { RodasPage } from "@/modules/rodas";

export const Route = createFileRoute("/_app/rodas")({
  head: () => ({ meta: [{ title: "Rodas — Painel GingApp" }] }),
  component: RodasPage,
});