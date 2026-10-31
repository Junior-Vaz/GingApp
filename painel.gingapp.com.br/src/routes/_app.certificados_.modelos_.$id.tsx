import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { LeaveGuard } from "@/modules/formularios";
import { TemplateEditorPage, canManageTemplatesRole } from "@/modules/certificados/modelos";

// /certificados/modelos/:id - editor visual do modelo (Mestre e Professor). Os "_" tiram a rota de dentro da lista.
export const Route = createFileRoute("/_app/certificados_/modelos_/$id")({
  beforeLoad: () => {
    const role = getUser()?.role;
    if (!canAccessRoute(role, "/certificados")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(role) });
    }
    // Quem só lê (Instrutor) não edita modelos: volta para a lista. O backend também responde 403.
    if (!canManageTemplatesRole(role)) {
      toast.error("Somente o Mestre e o Professor editam modelos de certificado.");
      throw redirect({ to: "/certificados/modelos" });
    }
  },
  head: () => ({ meta: [{ title: "Editar modelo de certificado — Painel GingApp" }] }),
  component: ModeloRoute,
});

function ModeloRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  if (!/^\d+$/.test(id)) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Endereço de modelo inválido.</p>;
  }
  return (
    <>
      <TemplateEditorPage
        templateId={id}
        onBack={() => void navigate({ to: "/certificados/modelos" })}
        onDirtyChange={setDirty}
      />
      <LeaveGuard
        dirty={dirty}
        description="Você tem alterações no modelo de certificado que ainda não foram salvas. Se sair agora, elas serão perdidas."
      />
    </>
  );
}
