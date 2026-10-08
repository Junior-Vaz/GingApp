import { createFileRoute } from "@tanstack/react-router";
import { FinancialPage } from "@/components/gingapp/pages";

export const Route = createFileRoute("/_app/financeiro")({
  head: () => ({ meta: [{ title: "Meu financeiro — GingApp" }] }),
  component: FinancialPage,
});
