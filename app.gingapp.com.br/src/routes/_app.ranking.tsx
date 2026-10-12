import { createFileRoute } from "@tanstack/react-router";
import { RankingPage } from "@/components/gingapp/ranking";

export const Route = createFileRoute("/_app/ranking")({
  head: () => ({ meta: [{ title: "Ginga Rank — GingApp" }] }),
  component: RankingPage,
});
