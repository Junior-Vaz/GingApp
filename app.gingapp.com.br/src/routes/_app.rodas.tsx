import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage } from "@/components/gingapp/discovery";

export const Route = createFileRoute("/_app/rodas")({
  head: () => ({ meta: [{ title: "Rodas de capoeira — GingApp" }] }),
  component: () => <DiscoveryPage mode="rodas" />,
});
