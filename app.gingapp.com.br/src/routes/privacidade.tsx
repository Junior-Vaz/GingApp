import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/gingapp/legal";

// Pública (sem login): Política de Privacidade, texto servido por GET /api/legal/privacy.
export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Política de Privacidade — GingApp" }] }),
  component: () => <LegalPage type="privacy" />,
});
