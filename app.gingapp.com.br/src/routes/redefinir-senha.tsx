import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/gingapp/password-reset";

// Pública (sem login): o link do e-mail traz ?token=...; a tela guarda o token em memória e o remove da URL.
export const Route = createFileRoute("/redefinir-senha")({
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  // Sem Referer: o token (mesmo removido da URL) não vaza para links/recursos externos.
  head: () => ({ meta: [{ title: "Redefinir senha — GingApp" }, { name: "referrer", content: "no-referrer" }] }),
  component: function ResetPassword() {
    const { token } = Route.useSearch();
    return <ResetPasswordPage token={token} />;
  },
});
