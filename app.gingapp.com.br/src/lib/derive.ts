import { dayOnly, startOfToday } from "@/lib/format";
import type { AttendanceRecord, Lesson } from "@/lib/queries";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function weekdayLabel(weekday: number): string {
  return WEEKDAYS[weekday] ?? "";
}

/** Próxima aula ativa a partir de hoje (lessons/me já vem em ordem crescente de data). */
export function nextLesson(lessons: Lesson[]): Lesson | null {
  const today = startOfToday().getTime();
  return (
    [...lessons]
      .filter((l) => l.status === "ACTIVE" && dayOnly(l.date).getTime() >= today)
      .sort((a, b) => dayOnly(a.date).getTime() - dayOnly(b.date).getTime())[0] ?? null
  );
}

export function recordsInMonth(records: AttendanceRecord[], reference: Date): AttendanceRecord[] {
  return records.filter((r) => {
    const d = dayOnly(r.lesson.date);
    return d.getFullYear() === reference.getFullYear() && d.getMonth() === reference.getMonth();
  });
}

export function monthStats(records: AttendanceRecord[], reference: Date) {
  const inMonth = recordsInMonth(records, reference);
  const present = inMonth.filter((r) => r.present).length;
  const total = inMonth.length;
  return { present, total, percent: total > 0 ? Math.round((present / total) * 100) : 0 };
}

/** Presenças seguidas, da aula mais recente para trás (para na primeira falta). */
export function currentStreak(records: AttendanceRecord[]): number {
  const sorted = [...records].sort(
    (a, b) => dayOnly(b.lesson.date).getTime() - dayOnly(a.lesson.date).getTime(),
  );
  let streak = 0;
  for (const r of sorted) {
    if (!r.present) break;
    streak++;
  }
  return streak;
}
