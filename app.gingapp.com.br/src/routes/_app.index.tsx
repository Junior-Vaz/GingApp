import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/components/gingapp/home";

export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Meu GingApp — Sua capoeira em movimento" }] }),
  component: HomePage,
});
