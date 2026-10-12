import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RopeStyle } from "@/lib/rope";
import type { StudentStatus } from "./schema";

/** Contrato de GET /students/:id/ficha (ficha única do capoeirista; staff do grupo). */
export interface StudentFicha {
  person: {
    id: number;
    gingappCode: string;
    name: string;
    nickname: string | null;
    birthDate: string | null;
    photo: string | null;
    /** CPF mascarado pelo servidor (ex.: `***.***.***-25`); o painel nunca recebe o número completo. */
    documentMasked: string | null;
    documentKind: "CPF" | "GUARDIAN_CPF" | "PASSPORT" | null;
  };
  enrollments: {
    studentId: number;
    organization: { id: number; name: string; logoUrl: string | null };
    unit: { id: number; name: string } | null;
    status: StudentStatus;
    since: string;
    until: string | null;
    isCurrent: boolean;
  }[];
  graduations: {
    id: number;
    studentId: number;
    organization: { id: number; name: string };
    graduatedAt: string;
    level: { id: number; name: string; order: number; color?: string | null; style?: RopeStyle | null; colors?: string[] | null };
    system: { id: number; name: string };
  }[];
  attendanceByGroup: { organization: { id: number; name: string }; present: number; absent: number; total: number }[];
  certificates: {
    id: number;
    title: string;
    issuedAt: string;
    verificationCode: string;
    organization: { id: number; name: string };
  }[];
  sharedFromOtherGroups: unknown[];
  scope: "OWN_GROUP" | "SELF";
}

export const DOCUMENT_KIND_LABEL: Record<NonNullable<StudentFicha["person"]["documentKind"]>, string> = {
  CPF: "CPF",
  GUARDIAN_CPF: "CPF do responsável",
  PASSPORT: "Passaporte",
};

export const studentFichaKey = (studentId: number) => ["student-ficha", studentId] as const;

/** GET /students/:id/ficha; só roda com um aluno escolhido. Sem retry: erro de permissão/rota aparece de imediato. */
export function useStudentFicha(studentId: number | undefined) {
  return useQuery({
    queryKey: studentFichaKey(studentId ?? 0),
    queryFn: () => api.get<StudentFicha>(`/students/${studentId}/ficha`),
    enabled: studentId !== undefined,
    retry: false,
  });
}
