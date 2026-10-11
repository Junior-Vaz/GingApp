import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";

/** Aluno matriculado em uma turma (GET /classes/:id/students — só matrículas ativas). */
export interface ClassStudent {
  id: number;
  studentId: number;
  name: string;
  studentStatus: "ACTIVE" | "INACTIVE";
  enrolledAt: string;
}

const classStudentsKey = (classId: number | undefined) => ["classes", "students", classId];

/** Alunos matriculados da turma. `classId` indefinido = desligado (diálogo fechado). */
export function useClassStudents(classId: number | undefined) {
  return useQuery({
    queryKey: classStudentsKey(classId),
    queryFn: () => api.get<ClassStudent[]>(`/classes/${String(classId)}/students`),
    enabled: classId !== undefined,
  });
}

/** POST /classes/:id/students { studentId } (idempotente). Invalida a lista da turma e avisa por toast. */
export function useEnrollStudent(classId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: number) =>
      api.post<unknown>(`/classes/${String(classId)}/students`, { studentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classStudentsKey(classId) });
      toast.success("Aluno matriculado.");
    },
    onError: (error) => notifyError(error, "Não foi possível matricular o aluno."),
  });
}

/** DELETE /classes/:id/students/:studentId (desmatricula). Invalida a lista da turma e avisa por toast. */
export function useUnenrollStudent(classId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: number) =>
      api.delete<void>(`/classes/${String(classId)}/students/${String(studentId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classStudentsKey(classId) });
      toast.success("Aluno removido da turma.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover o aluno."),
  });
}
