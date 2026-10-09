import { createFileRoute } from "@tanstack/react-router";
import { ConfiguracoesPage } from "@/modules/configuracoes/configuracoes-page";

export const Route = createFileRoute("/_app/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — Painel GingApp" }] }),
  component: ConfiguracoesPage,
});
