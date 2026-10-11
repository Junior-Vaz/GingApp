import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/gingapp/legal";

// Pública (sem login): Termos de Uso, texto servido por GET /api/legal/terms.
export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de Uso — GingApp" }] }),
  component: () => <LegalPage type="terms" />,
});
