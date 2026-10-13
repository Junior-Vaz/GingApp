import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { createCrud } from "@/lib/crud";
import type { StaffRole } from "@/lib/staff-roles";

/** Aula. `date` chega como meia-noite UTC (use dayOnly de @/lib/format para exibir). */
export interface Lesson {
  id: number;
  classId: number;
  unitId: number | null;
  teacherUserId: number | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  /** Turma/unidade/professor já resolvidos pelo servidor (nome + foto) para as listas; ausentes em respostas antigas. */
  class?: { id: number; name: string; photo?: string | null };
  unit?: { id: number; name: string; photo?: string | null } | null;
  teacher?: { id: number; name: string; photo?: string | null } | null;
}

export interface ClassOption {
  id: number;
  name: string;
  photo?: string | null;
  /** Professor responsável da turma (as aulas geradas dela herdam este professor). */
  teacherUserId?: number | null;
}

export interface TeacherMembership {
  id: number;
  role: StaffRole;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null; photo?: string | null };
}

/**
 * Corpo de POST/PATCH /lessons. Na edição, campos limpos vão como `null` (o backend limpa a coluna):
 * unitId, teacherUserId, startTime, endTime e notes. classId, date e status NUNCA vão `null` (400).
 * O painel ainda não tem campo de unidade na aula (unitId não é enviado).
 */
export interface LessonInput {
  classId: number;
  date: string;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  teacherUserId?: number | null | undefined;
  notes?: string | null | undefined;
  status?: Lesson["status"];
}

export const STATUS_LABEL: Record<Lesson["status"], string> = {
  ACTIVE: "Ativa",
  INACTIVE: "Cancelada",
};

/** DELETE /lessons/:id NÃO apaga: o backend marca status = INACTIVE (aula cancelada). */
export const lessons = createCrud<Lesson, LessonInput>("/lessons", {
  created: "Aula criada.",
  updated: "Aula atualizada.",
  removed: "Aula cancelada.",
});

/** Selects auxiliares vêm de listas paginadas: pedimos o máximo do servidor (200) e avisamos se passar. */
export const OPTIONS_LIMIT = 200;

/** Turmas para os selects (primeiras 200; `data.total` > 200 => lista parcial). */
export function useClassOptions() {
  return useQuery({
    queryKey: ["aulas", "classes"],
    queryFn: () => api.getPage<ClassOption>("/classes", { limit: OPTIONS_LIMIT }),
  });
}

/** Professores para os selects (primeiros 200; `data.total` > 200 => lista parcial). */
export function useTeacherOptions() {
  return useQuery({
    queryKey: ["aulas", "teachers"],
    queryFn: () => api.getPage<TeacherMembership>("/teachers", { limit: OPTIONS_LIMIT }),
  });
}

/** "2026-03-05T00:00:00.000Z" -> "2026-03-05" (valor de <input type="date">). */
export const isoDay = (iso: string): string => iso.slice(0, 10);

/** Rótulo de horário: "18:00 – 19:30", "18:00 – —" ou "—". */
export function timeRange(lesson: Pick<Lesson, "startTime" | "endTime">): string {
  if (!lesson.startTime && !lesson.endTime) return "—";
  return `${lesson.startTime || "—"} – ${lesson.endTime || "—"}`;
}
