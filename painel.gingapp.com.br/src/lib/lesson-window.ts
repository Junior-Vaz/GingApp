import { addDays, format } from "date-fns";

/** Janela padrão das aulas: de hoje-7 dias até hoje+30 dias. */
export const LESSON_WINDOW_PAST_DAYS = 7;
export const LESSON_WINDOW_FUTURE_DAYS = 30;

/** "yyyy-MM-dd" do dia CIVIL local (nunca toISOString/UTC, que desloca o dia à noite). */
export const civilDay = (date: Date): string => format(date, "yyyy-MM-dd");

export interface LessonWindow {
  from: string;
  to: string;
}

/** Período atual de aulas (`from`/`to` em yyyy-MM-dd) a partir de um "hoje" injetável. */
export function currentLessonWindow(today: Date = new Date()): LessonWindow {
  return {
    from: civilDay(addDays(today, -LESSON_WINDOW_PAST_DAYS)),
    to: civilDay(addDays(today, LESSON_WINDOW_FUTURE_DAYS)),
  };
}

/**
 * Parâmetros de GET /lessons para o período: "current" = janela atual; "all" = sem from/to.
 * Sempre `order=nearest` (hoje e futuras em ordem crescente, depois as passadas da mais recente à mais antiga).
 */
export function lessonPeriodParams(
  period: "current" | "all",
  today: Date = new Date(),
): { order: "nearest"; from?: string; to?: string } {
  return period === "all" ? { order: "nearest" } : { order: "nearest", ...currentLessonWindow(today) };
}
