import { createFileRoute } from "@tanstack/react-router";
import { JourneyPage } from "@/components/gingapp/journey";

export const Route = createFileRoute("/_app/jornada")({
  head: () => ({ meta: [{ title: "Minha jornada — GingApp" }] }),
  component: JourneyPage,
});
