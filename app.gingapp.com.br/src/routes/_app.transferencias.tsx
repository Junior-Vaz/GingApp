import { createFileRoute } from "@tanstack/react-router";
import { TransfersPage } from "@/components/gingapp/transfers";

export const Route = createFileRoute("/_app/transferencias")({
  head: () => ({ meta: [{ title: "Pedidos de transferência — GingApp" }] }),
  component: TransfersPage,
});
