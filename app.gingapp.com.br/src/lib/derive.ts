import { dayOnly, fmt, startOfToday } from "@/lib/format";
import type {
  AttendanceRecord,
  ClassItem,
  Ficha,
  FinanceStatus,
  FinancialRecord,
  Lesson,
  Passport,
  StudentGraduation,
} from "@/lib/queries";

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

/** Quantos dias uma aula cancelada continua visível ao aluno (mesma regra do backend). */
export const CANCELLED_LESSON_VISIBLE_DAYS = 2;

/**
 * A aula deve aparecer para o aluno? Ativa: sempre. Cancelada (INACTIVE): só por 2 dias — depois do cancelamento
 * (`cancelledAt`, quando o backend informa) E depois da data da aula (dia civil; a data vem como meia-noite UTC).
 * Defesa no cliente para backend antigo que ainda devolve canceladas velhas (ex.: de professor inativo).
 */
export function isLessonVisible(lesson: Pick<Lesson, "status" | "date" | "cancelledAt">, now: Date = new Date()): boolean {
  if (lesson.status !== "INACTIVE") return true;
  const limitDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - CANCELLED_LESSON_VISIBLE_DAYS);
  if (dayOnly(lesson.date).getTime() < limitDay.getTime()) return false;
  if (lesson.cancelledAt) {
    const cancelled = new Date(lesson.cancelledAt).getTime();
    if (!Number.isNaN(cancelled) && cancelled < now.getTime() - CANCELLED_LESSON_VISIBLE_DAYS * 86_400_000) return false;
  }
  return true;
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

export interface ClassInfo {
  name: string;
  photo: string | null;
  /** Unidade da aula/turma (ou a do aluno, se o backend não informou); foto opcional. */
  unit: { name: string; photo: string | null } | null;
  teacher: { name: string; photo: string | null } | null;
  /** "19:00 – 20:30" (horário da aula, senão o da turma). */
  time: string;
}

/**
 * Tudo que o cartão de uma aula mostra, juntando a aula (`/lessons/me`) e a turma (`/classes/me`). Os campos de foto,
 * unidade e professor são opcionais (backend antigo): sem eles o cartão continua igual ao de antes.
 */
export function resolveClassInfo(
  lesson: Pick<Lesson, "classId" | "startTime" | "endTime" | "class" | "unit" | "teacher"> | null,
  classes: ClassItem[] | undefined,
  fallbackUnit?: { name: string; photo?: string | null } | null,
): ClassInfo {
  const cls = lesson ? classes?.find((c) => c.id === lesson.classId) : undefined;
  const rawUnit = lesson?.unit ?? cls?.unit ?? fallbackUnit ?? null;
  const unit = rawUnit?.name?.trim() ? rawUnit : null;
  const rawTeacher = lesson?.teacher ?? cls?.teacher ?? null;
  // Professor inativo/removido pode vir sem nome: nunca mostrar linha vazia.
  const teacher = rawTeacher?.name?.trim() ? rawTeacher : null;
  const time = [lesson?.startTime ?? cls?.startTime, lesson?.endTime ?? cls?.endTime].filter(Boolean).join(" – ");
  return {
    name: lesson?.class?.name || cls?.name || "Aula",
    photo: lesson?.class?.photo || cls?.photo || null,
    unit: unit ? { name: unit.name, photo: unit.photo || (fallbackUnit?.name === unit.name ? fallbackUnit.photo : null) || null } : null,
    teacher: teacher ? { name: teacher.name, photo: teacher.photo || null } : null,
    time,
  };
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

/** Presenças seguidas: o valor do SERVIDOR (todo o histórico) quando existe; senão, o da lista local. */
export function streakOf(data: { currentStreak?: number; records: AttendanceRecord[] } | undefined): number {
  if (!data) return 0;
  return data.currentStreak ?? currentStreak(data.records);
}

/** Intervalo yyyy-MM-dd (primeiro e último dia) do mês da data de referência. */
export function monthRange(reference: Date): { from: string; to: string } {
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const last = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  return { from: fmt(first, "yyyy-MM-dd"), to: fmt(last, "yyyy-MM-dd") };
}

/** Chaves yyyy-MM dos últimos `count` meses (o atual primeiro). */
export function recentMonths(count: number, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => fmt(new Date(now.getFullYear(), now.getMonth() - i, 1), "yyyy-MM"));
}

/**
 * Situação exibida de um lançamento: PENDING com vencimento em dia anterior a hoje é ATRASADO
 * (mesma regra do servidor, que decide os totais; vence hoje NÃO é atrasado).
 */
export function effectiveFinanceStatus(
  record: Pick<FinancialRecord, "status" | "dueDate">,
  today: Date = startOfToday(),
): FinanceStatus {
  if (record.status === "PENDING" && dayOnly(record.dueDate).getTime() < today.getTime()) return "OVERDUE";
  return record.status;
}

/** Graduação da linha do tempo da Jornada, com a origem (outro grupo) e o reconhecimento (Ficha única, Fase 4). */
export interface TimelineGraduation extends StudentGraduation {
  /** Nome do grupo de origem quando a corda foi dada por OUTRO grupo que não o atual. */
  originGroup: string | null;
  /** true quando o grupo atual reconheceu a corda vinda de outro grupo. */
  recognized: boolean;
}

/**
 * Junta as graduações do aluno ativo com as da ficha única: marca as de outro grupo (organização
 * diferente da matrícula atual) e as reconhecidas pelo grupo, e inclui as que só a ficha conhece
 * (cordas de grupos anteriores). Sem ficha (carregando, erro, backend antigo) devolve a lista como veio.
 */
export function buildTimeline(list: StudentGraduation[], ficha: Ficha | undefined | null): TimelineGraduation[] {
  const fichaGraduations = Array.isArray(ficha?.graduations) ? ficha.graduations : [];
  if (fichaGraduations.length === 0) return list.map((item) => ({ ...item, originGroup: null, recognized: false }));
  const currentOrgId = ficha?.enrollments?.find((e) => e.isCurrent)?.organization.id ?? null;
  const byId = new Map(fichaGraduations.map((g) => [g.id, g]));
  const origin = (orgId: number, name: string) => (currentOrgId !== null && orgId !== currentOrgId ? name : null);

  const merged: TimelineGraduation[] = list.map((item) => {
    const f = byId.get(item.id);
    return {
      ...item,
      originGroup: f ? origin(f.organization.id, f.organization.name) : null,
      recognized: f?.recognizedFromLevelId != null,
    };
  });
  const known = new Set(list.map((item) => item.id));
  const extras = fichaGraduations
    .filter((g) => !known.has(g.id))
    .map<TimelineGraduation>((g) => ({
      id: g.id,
      graduatedAt: g.graduatedAt,
      notes: null,
      graduationLevel: g.level,
      originGroup: origin(g.organization.id, g.organization.name),
      recognized: g.recognizedFromLevelId != null,
    }));
  if (extras.length === 0) return merged;
  return [...merged, ...extras].sort((a, b) => b.graduatedAt.localeCompare(a.graduatedAt));
}

/**
 * Rótulo do cartão de graduação: "Minha graduação" quando o aluno ativo é o PRÓPRIO usuário (ou não há
 * aluno); "Graduação de <primeiro nome>" quando é um dependente selecionado ("Acompanhando X").
 */
export function graduationCardLabel(student: { userId: number | null; name: string } | null | undefined, userId: number | undefined): string {
  if (!student || (userId !== undefined && student.userId === userId)) return "Minha graduação";
  const first = student.name.trim().split(/\s+/)[0];
  return first ? `Graduação de ${first}` : "Minha graduação";
}
