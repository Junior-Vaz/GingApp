import { createFileRoute } from "@tanstack/react-router";
import { FrequenciaPage } from "@/modules/frequencia/frequencia-page";

export const Route = createFileRoute("/_app/frequencia")({
  head: () => ({ meta: [{ title: "Frequência — Painel GingApp" }] }),
  component: FrequenciaPage,
});
