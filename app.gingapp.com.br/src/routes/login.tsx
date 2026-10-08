import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/components/gingapp/login";
import { isAuthenticated } from "@/lib/session";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  beforeLoad: () => {
    if (isAuthenticated()) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Entrar — GingApp" }] }),
  component: function Login() {
    const { redirect: target } = Route.useSearch();
    return <LoginPage redirect={target} />;
  },
});
