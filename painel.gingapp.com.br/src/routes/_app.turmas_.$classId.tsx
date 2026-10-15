import { createFileRoute } from "@tanstack/react-router";
import { TurmaDetailPage } from "@/modules/turmas/turma-detail-page";

// /turmas/:classId - detalhe da turma (dados, próxima aula e alunos com foto). O "_" depois de "turmas" tira a rota de
// dentro de /turmas (que é uma página sem <Outlet>): ela abre sozinha, não dentro da lista.
export const Route = createFileRoute("/_app/turmas_/$classId")({
  head: () => ({ meta: [{ title: "Turma — Painel GingApp" }] }),
  component: TurmaRoute,
});

function TurmaRoute() {
  const { classId } = Route.useParams();
  const id = Number(classId);
  if (!Number.isInteger(id) || id <= 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Endereço de turma inválido.</p>;
  }
  return <TurmaDetailPage classId={id} />;
}
