import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/painel/app-shell";
import { MustChangePasswordScreen, TermsGate } from "@/components/painel/legal";
import { FloatingActions } from "@/components/painel/floating-actions";
import { QuickNotice } from "@/modules/avisos/aviso-rapido";
import { QuickAttendance } from "@/modules/frequencia/chamada-rapida";
import { clearSession, isAuthenticated, useSessionUser } from "@/lib/session";

// Guard: sem sessão de gestão válida (token + papel MESTRE/PROFESSOR) -> /login?redirect=...
// A autorização real continua sendo validada pelo backend (CanAccessGuard).
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => {
    if (!isAuthenticated()) {
      clearSession(); // token órfão ou de papel sem acesso ao painel
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const user = useSessionUser();
  // Senha provisória definida por outra pessoa: o servidor barra todas as rotas (403 MUST_CHANGE_PASSWORD) até a troca.
  if (user?.mustChangePassword) return <MustChangePasswordScreen />;
  return (
    <AppShell>
      <Outlet />
      <TermsGate />
      <FloatingActions>
        <QuickAttendance />
        <QuickNotice />
      </FloatingActions>
    </AppShell>
  );
}
