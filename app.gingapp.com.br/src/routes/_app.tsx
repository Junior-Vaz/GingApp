import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/gingapp/app-shell";
import { TermsGate } from "@/components/gingapp/legal";
import { PushBridge } from "@/components/gingapp/push-bridge";
import { getUser, isAuthenticated } from "@/lib/session";

// Guard: sem token -> /login (com redirect de volta). A autorização real é sempre validada no backend.
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    // Senha provisória definida pelo Mestre/Professor: só o perfil (troca de senha) fica acessível até trocá-la.
    if (getUser()?.mustChangePassword && !location.pathname.startsWith("/perfil")) {
      throw redirect({ to: "/perfil" });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
      <TermsGate />
      <PushBridge />
    </AppShell>
  ),
});
