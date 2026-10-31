import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { CertificadosTabs } from "@/modules/certificados/certificados-tabs";
import { TemplatesPage } from "@/modules/certificados/modelos";

// /certificados/modelos - aba "Modelos". O "_" depois de "certificados" tira a rota de dentro de /certificados (página sem
// <Outlet>): abre sozinha (mesmo padrão de /formularios/:formId). Ver a lista segue a regra do menu (certificates:view).
export const Route = createFileRoute("/_app/certificados_/modelos")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/certificados")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Modelos de certificado — Painel GingApp" }] }),
  component: ModelosRoute,
});

function ModelosRoute() {
  const navigate = useNavigate();
  return (
    <>
      <CertificadosTabs active="modelos" />
      <TemplatesPage onOpen={(id) => void navigate({ to: "/certificados/modelos/$id", params: { id: String(id) } })} />
    </>
  );
}
