import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const AUDIENCE_SCOPES = ["GROUP", "UNIT", "CLASS", "ROLE", "STUDENTS"] as const;
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];

export const SCOPE_LABEL: Record<AudienceScope, string> = {
  GROUP: "Todo o grupo",
  UNIT: "Unidade",
  CLASS: "Turma",
  ROLE: "Perfil",
  STUDENTS: "Alunos específicos",
};

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const BODY_MIN = 2;
export const BODY_MAX = 280;

/** Corpo de POST /notifications/send. */
export interface NoticeAudience {
  scope: AudienceScope;
  unitId?: number;
  classId?: number;
  audienceRole?: string;
  studentIds?: number[];
}
export interface SendNoticeInput {
  title: string;
  body: string;
  audience: NoticeAudience;
  alsoPublish?: boolean;
}
export interface SendNoticeResult {
  sent: number;
  announcementId: number | null;
}

/** Monta o `audience` do POST /notifications/send; `null` = falta escolher o alvo do alcance. */
export function buildAudience(form: {
  scope: AudienceScope;
  unitId: string;
  classId: string;
  role: string;
  students: { id: number }[];
}): NoticeAudience | null {
  switch (form.scope) {
    case "GROUP":
      return { scope: "GROUP" };
    case "UNIT":
      return form.unitId ? { scope: "UNIT", unitId: Number(form.unitId) } : null;
    case "CLASS":
      return form.classId ? { scope: "CLASS", classId: Number(form.classId) } : null;
    case "ROLE":
      return form.role ? { scope: "ROLE", audienceRole: form.role } : null;
    case "STUDENTS":
      return form.students.length > 0 ? { scope: "STUDENTS", studentIds: form.students.map((s) => s.id) } : null;
  }
}

/** GET /notifications/audiences: opções para os alcances Unidade/Turma/Perfil. */
export interface Audiences {
  units: { id: number; name: string }[];
  classes: { id: number; name: string; unitId: number | null }[];
  /** O backend manda `{value,label}`; aceita-se texto simples por compatibilidade. */
  roles: (string | { value: string; label: string })[];
  /** false = professor restrito a unidades: não pode enviar para o grupo inteiro. */
  groupWide?: boolean;
}

export const AUDIENCES_KEY = ["notifications", "audiences"] as const;

export function useAudiences(enabled = true) {
  return useQuery({
    queryKey: AUDIENCES_KEY,
    queryFn: () => api.get<Audiences>("/notifications/audiences"),
    enabled,
    staleTime: 60_000,
  });
}

/** POST /notifications/send. Com `alsoPublish`, o comunicado criado entra na lista do mural (invalida /announcements). */
export function useSendNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendNoticeInput) => api.post<SendNoticeResult>("/notifications/send", input),
    onSuccess: (result) => {
      if (result?.announcementId) void queryClient.invalidateQueries({ queryKey: ["crud", "/announcements"] });
    },
  });
}
