import { createFileRoute } from "@tanstack/react-router";
import { OccurrencesPage } from "@/components/gingapp/occurrences";

export const Route = createFileRoute("/_app/ocorrencias")({
  head: () => ({ meta: [{ title: "Minhas ocorrências — GingApp" }] }),
  component: OccurrencesPage,
});
