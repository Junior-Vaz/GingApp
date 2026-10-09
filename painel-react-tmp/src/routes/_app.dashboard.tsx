import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/modules/dashboard/dashboard-page";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Painel GingApp" }] }),
  component: DashboardPage,
});
