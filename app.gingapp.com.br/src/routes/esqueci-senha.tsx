import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordPage } from "@/components/gingapp/password-reset";

// Pública (sem login): pede o link de redefinição de senha por e-mail.
export const Route = createFileRoute("/esqueci-senha")({
  head: () => ({ meta: [{ title: "Esqueci minha senha — GingApp" }] }),
  component: ForgotPasswordPage,
});
