import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { canAccessRoute, homeFor, ROUTE_FORBIDDEN_MESSAGE } from "@/lib/nav";
import { getUser } from "@/lib/session";
import { FormEditorPage, LeaveGuard } from "@/modules/formularios";

// /formularios/:formId - editor do formulário. O "_" depois de "formularios" tira a rota de dentro de /formularios (que é
// uma página sem <Outlet>): ela abre sozinha, não dentro da lista (mesmo padrão de /turmas/:classId).
export const Route = createFileRoute("/_app/formularios_/$formId")({
  beforeLoad: () => {
    if (!canAccessRoute(getUser()?.role, "/formularios")) {
      toast.error(ROUTE_FORBIDDEN_MESSAGE);
      throw redirect({ to: homeFor(getUser()?.role) });
    }
  },
  head: () => ({ meta: [{ title: "Formulário de inscrição — Painel GingApp" }] }),
  component: FormRoute,
});

function FormRoute() {
  const { formId } = Route.useParams();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  if (!formId.trim()) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        Endereço de formulário inválido.
      </p>
    );
  }
  return (
    <>
      <FormEditorPage
        formId={formId}
        onBack={() => void navigate({ to: "/formularios" })}
        onDirtyChange={setDirty}
      />
      <LeaveGuard dirty={dirty} />
    </>
  );
}
