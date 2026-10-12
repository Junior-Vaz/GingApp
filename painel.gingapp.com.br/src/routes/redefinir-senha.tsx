import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/painel/password-reset-pages";

// Pública (sem login): o link do e-mail traz ?token=...; a página o remove da URL logo ao abrir.
export const Route = createFileRoute("/redefinir-senha")({
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search["token"] === "string" && search["token"] !== "" ? search["token"] : undefined,
  }),
  // O token está na URL: nunca vazar pelo cabeçalho Referer.
  head: () => ({
    meta: [{ title: "Redefinir senha — Painel GingApp" }, { name: "referrer", content: "no-referrer" }],
  }),
  component: function RedefinirSenha() {
    const { token } = Route.useSearch();
    return <ResetPasswordPage token={token} />;
  },
});
