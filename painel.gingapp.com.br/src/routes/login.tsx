import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/components/painel/login-page";
import { isAuthenticated } from "@/lib/session";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  beforeLoad: () => {
    if (isAuthenticated()) throw redirect({ to: "/dashboard" });
  },
  head: () => ({ meta: [{ title: "Entrar — Painel GingApp" }] }),
  component: function Login() {
    const { redirect: target } = Route.useSearch();
    return <LoginPage redirect={target} />;
  },
});
