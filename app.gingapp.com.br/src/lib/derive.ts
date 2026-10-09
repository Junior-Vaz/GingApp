import { dayOnly, startOfToday } from "@/lib/format";
import type { AttendanceRecord, Lesson, Passport } from "@/lib/queries";

/**
 * Que ações de compartilhamento do passaporte a tela deve oferecer. Espelha as regras do
 * backend (LGPD, PLANO §3.4): menor não publica sozinho, só um responsável cadastrado, e este
 * antes precisa autorizar. Sem `viewer` (backend antigo) mantém o comportamento anterior e quem
 * decide é o backend.
 */
export function passportActions(viewer: Passport["viewer"], role: string | undefined) {
  if (!viewer) {
    return { canPublish: true, canConsent: role === "RESPONSAVEL", showMinorNote: false };
  }
  return {
    canPublish: viewer.canPublish,
    // Quem já pode publicar não precisa do atalho "autorizar e publicar".
    canConsent: viewer.canConsent && !viewer.canPublish,
    showMinorNote: !viewer.canPublish && !viewer.canConsent,
  };
}

const SOCIAL_KEYS = ["instagram", "youtube", "tiktok", "facebook", "whatsapp"] as const;

export type ProfileFormValues = { photo: string; coverPhoto: string } & Record<(typeof SOCIAL_KEYS)[number], string>;

/**
 * Corpo do PATCH /students/me/profile a partir do formulário (que sempre reenvia tudo).
 * Campo esvaziado => `null` (o backend LIMPA a coluna; `undefined`/omitido deixaria o valor
 * antigo). Redes: o objeto vai SEM as chaves esvaziadas (o backend substitui por inteiro) e,
 * se nenhuma sobrou, `null` (limpa todas).
 */
export function buildProfilePayload(form: ProfileFormValues) {
  const orNull = (value: string) => value.trim() || null;
  const socialLinks: Record<string, string> = {};
  for (const key of SOCIAL_KEYS) {
    const value = form[key].trim();
    if (value) socialLinks[key] = value;
  }
  return {
    photo: orNull(form.photo),
    coverPhoto: orNull(form.coverPhoto),
    socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : null,
  };
}

const WEEKDAYS =["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

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
