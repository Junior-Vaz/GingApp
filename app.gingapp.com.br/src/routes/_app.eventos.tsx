import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/components/gingapp/discovery";

export const Route = createFileRoute("/_app/eventos")({
  head: () => ({ meta: [{ title: "Eventos da capoeira — GingApp" }] }),
  component: () => <DiscoveryPage mode="events" />,
});
