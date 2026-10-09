import { createFileRoute } from "@tanstack/react-router";
import { CertificadosPage } from "@/modules/certificados/certificados-page";

export const Route = createFileRoute("/_app/certificados")({
  head: () => ({ meta: [{ title: "Certificados — Painel GingApp" }] }),
  component: CertificadosPage,
});