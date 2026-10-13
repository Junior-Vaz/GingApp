import { createFileRoute, redirect } from "@tanstack/react-router";
import { homeFor } from "@/lib/nav";
import { getUser } from "@/lib/session";

// "/" -> tela inicial do papel (/dashboard; /alunos para o MONITOR). O guard de /_app cuida de mandar para o login se não houver sessão.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: homeFor(getUser()?.role) });
  },
});
