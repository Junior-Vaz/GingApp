import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/components/gingapp/discovery";

export const Route = createFileRoute("/_app/comunidade")({
  head: () => ({ meta: [{ title: "Comunidade — GingApp" }] }),
  component: () => <DiscoveryPage mode="community" />,
});
