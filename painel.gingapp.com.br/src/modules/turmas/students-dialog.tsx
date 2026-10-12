import { useState } from "react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { StudentPicker } from "@/components/painel/student-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import {
  useClassStudents,
  useEnrollStudent,
  useUnenrollStudent,
  type ClassStudent,
} from "@/lib/class-students";
import { useCan } from "@/lib/session";
import type { ClassItem } from "./schema";

/** Alunos da turma: listar matriculados, matricular (busca no servidor) e remover. */
export function ClassStudentsDialog({ turma, onClose }: { turma: ClassItem | null; onClose: () => void }) {
  const canEdit = useCan("classes", "edit");
  const list = useClassStudents(turma?.id);
  const enroll = useEnrollStudent(turma?.id);
  const unenroll = useUnenrollStudent(turma?.id);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ClassStudent | null>(null);

  const enrolledIds = (list.data ?? []).map((s) => s.studentId);

  function add() {
    if (studentId === null) return;
    enroll.mutate(studentId, { onSuccess: () => setStudentId(null) });
  }

  return (
    <>
      <Dialog open={turma !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Alunos da turma</DialogTitle>
            <DialogDescription>{turma?.name}</DialogDescription>
          </DialogHeader>

          {canEdit && (
            <div className="space-y-2">
              <StudentPicker
                value={studentId}
                onChange={(s) => setStudentId(s?.id ?? null)}
                excludeIds={enrolledIds}
              />
              <Button onClick={add} disabled={studentId === null || enroll.isPending}>
                Adicionar aluno
              </Button>
            </div>
          )}

          {list.isLoading ? (
            <Skeleton className="h-16 w-full" data-testid="class-students-loading" />
          ) : list.error ? (
            <div className="space-y-2 text-center">
              <p className="text-sm text-destructive">
                {errorMessage(list.error, "Não foi possível carregar os alunos da turma.")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : list.data?.length ? (
            <ul className="divide-y rounded-md border">
              {list.data.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                    <StudentAvatar name={s.name} photo={s.photo} />
                    {s.name}
                    {s.studentStatus === "INACTIVE" && (
                      <Badge variant="secondary" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(s)}
                      aria-label={`Remover ${s.name}`}
                    >
                      Remover
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum aluno matriculado ainda.</p>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover aluno da turma?"
        description={removing ? `Remover "${removing.name}" desta turma?` : undefined}
        confirmLabel="Remover"
        onConfirm={() => unenroll.mutateAsync(removing!.studentId)}
      />
    </>
  );
}
