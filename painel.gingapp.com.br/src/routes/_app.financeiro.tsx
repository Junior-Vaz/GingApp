import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";

export const Route = createFileRoute("/_app/financeiro")({
  // Financeiro é só do MESTRE. O PROFESSOR continua com sessão válida no painel (o guard de /_app
  // já passou), então é levado ao /dashboard com aviso, em vez de ser deslogado. O backend também
  // responde 403 (CanAccessGuard) - isto é só a barreira de UX.
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/financeiro")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Financeiro — Painel GingApp" }] }),
  component: FinanceiroPage,
});
