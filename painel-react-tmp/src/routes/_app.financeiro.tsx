import { createFileRoute } from "@tanstack/react-router";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";

export const Route = createFileRoute("/_app/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — Painel GingApp" }] }),
  component: FinanceiroPage,
});