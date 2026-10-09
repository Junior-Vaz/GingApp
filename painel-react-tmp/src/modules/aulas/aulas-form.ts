import { z } from "zod";
import { isoDay, type Lesson, type LessonInput } from "./aulas-api";

export const lessonSchema = z
  .object({
    classId: z.string().min(1, "Selecione a turma."),
    date: z.string().min(1, "Informe a data da aula."),
    startTime: z.string(),
    endTime: z.string(),
    teacherUserId: z.string(),
    notes: z.string(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
  })
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    path: ["endTime"],
    message: "O fim deve ser depois do início.",
  });
export type LessonFormValues = z.infer<typeof lessonSchema>;

export const emptyValues: LessonFormValues = {
  classId: "",
  date: "",
  startTime: "",
  endTime: "",
  teacherUserId: "",
  notes: "",
  status: "ACTIVE",
};

export function toFormValues(lesson: Lesson): LessonFormValues {
  return {
    classId: String(lesson.classId),
    date: isoDay(lesson.date),
    startTime: lesson.startTime ?? "",
    endTime: lesson.endTime ?? "",
    teacherUserId: lesson.teacherUserId ? String(lesson.teacherUserId) : "",
    notes: lesson.notes ?? "",
    status: lesson.status,
  };
}

/** Criação omite o que está vazio; edição manda `null` para limpar o campo no banco. */
export function toPayload(values: LessonFormValues, editing: boolean): LessonInput {
  const blank = editing ? null : undefined;
  return {
    classId: Number(values.classId),
    date: values.date,
    startTime: values.startTime || blank,
    endTime: values.endTime || blank,
    teacherUserId: values.teacherUserId ? Number(values.teacherUserId) : blank,
    notes: values.notes.trim() || blank,
    ...(editing ? { status: values.status } : {}),
  };
}
