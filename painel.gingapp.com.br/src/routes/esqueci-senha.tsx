import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "@/components/painel/password-reset-pages";

// Pública (sem login): pede o link de redefinição de senha por e-mail.
export const Route = createFileRoute("/esqueci-senha")({
  head: () => ({ meta: [{ title: "Esqueci minha senha — Painel GingApp" }] }),
  component: ForgotPasswordPage,
});
