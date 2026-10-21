import { createFileRoute } from "@tanstack/react-router";
import { FeedPage } from "@/components/gingapp/feed/feed-page";

export const Route = createFileRoute("/_app/feed")({
  head: () => ({ meta: [{ title: "Grupo — GingApp" }] }),
  component: FeedPage,
});
