import { createFileRoute } from "@tanstack/react-router";
import { GroupApplicationPage } from "@/components/painel/group-application-pages";

// Pública (sem login): pedido de cadastro de grupo. A equipe da plataforma confere e aprova (docs/CONTRATO_ADESAO_GRUPOS.md).
export const Route = createFileRoute("/comecar")({
  head: () => ({ meta: [{ title: "Leve seu grupo para o GingApp — é gratuito" }] }),
  component: GroupApplicationPage,
});
