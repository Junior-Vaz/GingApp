import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { studentFichaKey } from "./ficha";

export type OccurrenceKind = "ADVERTENCIA" | "SUSPENSAO" | "EXPULSAO" | "OUTRA";
export type OccurrenceStatus = "ACTIVE" | "CONTESTED" | "RETRACTED";

export const OCCURRENCE_KIND_LABEL: Record<OccurrenceKind, string> = {
  ADVERTENCIA: "Advertência",
  SUSPENSAO: "Suspensão",
  EXPULSAO: "Expulsão",
  OUTRA: "Outra",
};

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  ACTIVE: "Ativa",
  CONTESTED: "Contestada",
  RETRACTED: "Retratada",
};

export const OCCURRENCE_REASON_MAX = 280;

/** Contrato de GET /students/:id/occurrences (dado sensível: só o MESTRE do grupo). */
export interface OccurrenceView {
  id: number;
  kind: OccurrenceKind;
  occurredAt: string;
  endsAt: string | null;
  reason: string;
  status: OccurrenceStatus;
  expelledEnrollment: boolean;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  contestedAt: string | null;
  contestNote: string | null;
  retractedAt: string | null;
  retractNote: string | null;
}

export interface OccurrenceInput {
  kind: OccurrenceKind;
  /** yyyy-MM-dd. */
  occurredAt: string;
  reason: string;
  /** yyyy-MM-dd; só para suspensão. */
  endsAt?: string | undefined;
  /** Só com kind EXPULSAO: encerra a matrícula (a pessoa vira ex-aluna). */
  expel?: boolean | undefined;
}

/** Monta o corpo do POST: `endsAt` só para suspensão; `expel` só para expulsão (e só quando marcado). */
export function occurrenceBody(input: {
  kind: OccurrenceKind;
  occurredAt: string;
  reason: string;
  endsAt: string;
  expel: boolean;
}): OccurrenceInput {
  const body: OccurrenceInput = { kind: input.kind, occurredAt: input.occurredAt, reason: input.reason.trim() };
  if (input.kind === "SUSPENSAO" && input.endsAt) body.endsAt = input.endsAt;
  if (input.kind === "EXPULSAO" && input.expel) body.expel = true;
  return body;
}

export const occurrencesKey = (studentId: number) => ["student-occurrences", studentId] as const;

/** GET /students/:id/occurrences. `enabled` = só o MESTRE consulta (os demais papéis recebem 403). */
export function useOccurrences(studentId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: occurrencesKey(studentId ?? 0),
    queryFn: () => api.get<OccurrenceView[]>(`/students/${studentId}/occurrences`),
    enabled: enabled && studentId !== undefined,
    retry: false,
  });
}

/** POST /students/:id/occurrences. Com expulsão a matrícula acaba: atualiza ficha e lista de alunos. */
export function useCreateOccurrence(studentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OccurrenceInput) => api.post<OccurrenceView>(`/students/${studentId}/occurrences`, data),
    onSuccess: (_created, variables) => {
      void queryClient.invalidateQueries({ queryKey: occurrencesKey(studentId) });
      if (variables.expel) {
        void queryClient.invalidateQueries({ queryKey: studentFichaKey(studentId) });
        void queryClient.invalidateQueries({ queryKey: ["crud", "/students"] });
      }
    },
  });
}

/** PATCH /students/:id/occurrences/:occurrenceId/retract (só o MESTRE; nota opcional). */
export function useRetractOccurrence(studentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string | undefined }) =>
      api.patch<OccurrenceView>(`/students/${studentId}/occurrences/${id}/retract`, note ? { note } : {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: occurrencesKey(studentId) }),
  });
}

const OCCURRENCE_ERROR_MESSAGE: Record<string, string> = {
  EXPEL_ONLY_FOR_EXPULSION: "Só uma ocorrência do tipo Expulsão pode encerrar a matrícula.",
  OCCURRENCE_ALREADY_RETRACTED: "Esta ocorrência já foi retratada; atualize a lista.",
};

export function occurrenceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return (error.code && OCCURRENCE_ERROR_MESSAGE[error.code]) || error.message || fallback;
  return fallback;
}
