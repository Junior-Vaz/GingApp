import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { createCrud } from "@/lib/crud";

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
}

export interface ClassOption {
  id: number;
  name: string;
}

export interface TeacherMembership {
  id: number;
  role: "MESTRE" | "PROFESSOR";
  status: string;
  user: { id: number; name: string; email: string; phone: string | null };
}

/**
 * Corpo de POST/PATCH /lessons. Na edição, campos limpos vão como `null` (o DTO usa
 * @IsOptional, que aceita null) para realmente apagar o valor no banco.
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

export function useClassOptions() {
  return useQuery({ queryKey: ["aulas", "classes"], queryFn: () => api.get<ClassOption[]>("/classes") });
}

export function useTeacherOptions() {
  return useQuery({ queryKey: ["aulas", "teachers"], queryFn: () => api.get<TeacherMembership[]>("/teachers") });
}

/** "2026-03-05T00:00:00.000Z" -> "2026-03-05" (valor de <input type="date">). */
export const isoDay = (iso: string): string => iso.slice(0, 10);

/** Rótulo de horário: "18:00 – 19:30", "18:00 – —" ou "—". */
export function timeRange(lesson: Pick<Lesson, "startTime" | "endTime">): string {
  if (!lesson.startTime && !lesson.endTime) return "—";
  return `${lesson.startTime || "—"} – ${lesson.endTime || "—"}`;
}
