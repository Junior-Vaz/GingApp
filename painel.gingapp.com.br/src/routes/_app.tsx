import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/painel/app-shell";
import { clearSession, isAuthenticated } from "@/lib/session";

// Guard: sem sessão de gestão válida (token + papel MESTRE/PROFESSOR) -> /login?redirect=...
// A autorização real continua sendo validada pelo backend (CanAccessGuard).
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      clearSession(); // token órfão ou de papel sem acesso ao painel
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
