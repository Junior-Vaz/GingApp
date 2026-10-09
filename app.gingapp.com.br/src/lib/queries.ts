import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmt, startOfToday } from "@/lib/format";
import { getUser, useSessionUser } from "@/lib/session";
import rodaImage from "@/assets/capoeira-roda.jpg";
import communityImage from "@/assets/capoeira-community.jpg";

/* ---------- Tipos do contrato real da API ---------- */

export interface SocialLinks {
  instagram?: string;
  youtube?: string;
  tiktok?: string;
  facebook?: string;
  whatsapp?: string;
}

export interface Student {
  id: number;
  userId: number | null;
  unitId: number | null;
  name: string;
  photo: string | null;
  coverPhoto: string | null;
  socialLinks: SocialLinks | null;
  joinedAt: string | null;
}

export interface GraduationLevel {
  id: number;
  name: string;
  order: number;
  color: string | null;
}

export interface StudentGraduation {
  id: number;
  graduatedAt: string;
  notes: string | null;
  graduationLevel: GraduationLevel;
}

export interface Certificate {
  id: number;
  title: string;
  issuedAt: string | null;
  verificationCode: string;
}

export interface Passport {
  student: { id: number; name: string };
  organization: { name: string };
  unit: { name: string } | null;
  currentGraduation: { name: string } | null;
  stats: { aulas: number; rodas: number; eventos: number; graduacoes: number; certificados: number };
  publicProfile: { isPublished: boolean; publicCode: string } | null;
  /** O que ESTE usuário pode fazer com o passaporte (só em /passport/me; o público não traz). */
  viewer?: {
    isGuardian: boolean;
    isMinor: boolean;
    hasConsent: boolean | null;
    canPublish: boolean;
    canConsent: boolean;
  };
}

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

export interface ClassItem {
  id: number;
  name: string;
  description: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  unitId: number | null;
}

export interface AttendanceRecord {
  id: number;
  lessonId: number;
  present: boolean;
  justification: string | null;
  lesson: { date: string; classId: number };
}

export interface AttendanceResponse {
  /** Página dos registros (mais recentes primeiro), no período pedido. */
  records: AttendanceRecord[];
  /** Calculado pelo servidor sobre TODO o histórico (não sobre `records`). */
  last30dPercent: number | null;
  /** Presenças seguidas, calculadas pelo servidor sobre todo o histórico (ausente em backend antigo). */
  currentStreak?: number;
  /** Registros que casam com o período (header X-Total-Count); null se o servidor não informou. */
  total: number | null;
}

/** Totais do "meu financeiro" agregados NO BANCO (GET /finance/me/summary), em centavos. */
export interface FinanceSummary {
  openCents: number;
  openCount: number;
  overdueCents: number;
  overdueCount: number;
  paidCents: number;
  paidCount: number;
  /** Menor vencimento entre os lançamentos em aberto (ISO, dia civil em UTC) ou null. */
  oldestOpenDueDate: string | null;
}

export type FinanceStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

export interface FinancialRecord {
  id: number;
  description: string;
  amountCents: number;
  type: string;
  dueDate: string;
  paidAt: string | null;
  status: FinanceStatus;
}

export interface EventDto {
  id: number;
  title: string;
  type: string;
  description: string | null;
  date: string;
  location: string | null;
  imageUrl: string | null;
  isPublic: boolean;
}

export interface CalendarItem {
  id: number;
  source: "RODA" | "EVENTO";
  type: string;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  imageUrl: string | null;
  state: { id: number; name: string; uf: string } | null;
  city: { id: number; name: string } | null;
}

export interface Participant {
  id: number;
  userId: number | null;
  studentId: number | null;
  guestName: string | null;
  status: string;
  user?: { id: number; name: string } | null;
  student?: { id: number; name: string } | null;
}

export interface Announcement {
  id: number;
  unitId: number | null;
  title: string;
  body: string;
  publishedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface NotificationDto {
  id: number;
  title: string;
  body: string;
  type: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Reference {
  id: number;
  name: string;
}

/* ---------- Encontro unificado (card de roda/evento) ---------- */

export const TYPE_LABEL: Record<string, string> = {
  RODA: "Roda",
  BATIZADO: "Batizado",
  WORKSHOP: "Workshop",
  CAMPEONATO: "Campeonato",
  FESTIVAL: "Festival",
  ENCONTRO: "Encontro",
  FORMATURA: "Formatura",
  VIAGEM: "Viagem",
  AULA_ESPECIAL: "Aula especial",
  OUTRO: "Outro",
};

export interface Encounter {
  key: string;
  source: "RODA" | "EVENTO";
  id: number;
  title: string;
  type: string;
  typeLabel: string;
  date: string;
  place: string | null;
  city: string | null;
  image: string;
  description: string | null;
}

export function fromCalendar(item: CalendarItem): Encounter {
  return {
    key: `${item.source}-${item.id}`,
    source: item.source,
    id: item.id,
    title: item.title,
    type: item.type,
    typeLabel: TYPE_LABEL[item.type] ?? item.type,
    date: item.date,
    place: item.location,
    city: [item.city?.name, item.state?.uf].filter(Boolean).join(", ") || null,
    image: item.imageUrl ?? (item.source === "RODA" ? rodaImage : communityImage),
    description: item.description,
  };
}

export function fromEvent(event: EventDto): Encounter {
  return {
    key: `EVENTO-${event.id}`,
    source: "EVENTO",
    id: event.id,
    title: event.title,
    type: event.type,
    typeLabel: TYPE_LABEL[event.type] ?? event.type,
    date: event.date,
    place: event.location,
    city: null,
    image: event.imageUrl ?? communityImage,
    description: event.description,
  };
}

/* ---------- Hooks de leitura ---------- */

const noRetry = { retry: false } as const;

export const useStudents = () =>
  useQuery({ queryKey: ["students", "me"], queryFn: () => api.get<Student[]>("/students/me") });

/** "Meu" Student: o de userId igual ao logado; senão o primeiro dependente. */
export function pickMyStudent(students: Student[] | undefined, userId: number | undefined) {
  if (!students || students.length === 0) return null;
  return students.find((s) => s.userId === userId) ?? students[0] ?? null;
}

export function useMyStudent() {
  const user = useSessionUser();
  const query = useStudents();
  return { ...query, student: pickMyStudent(query.data, user?.id) };
}

export const useGraduations = (studentId: number | undefined) =>
  useQuery({
    queryKey: ["graduations", studentId],
    queryFn: () => api.get<StudentGraduation[]>(`/graduations/students/${studentId}`),
    enabled: studentId !== undefined,
  });

export const useCertificates = () =>
  useQuery({ queryKey: ["certificates", "me"], queryFn: () => api.get<Certificate[]>("/certificates/me") });

export const usePassport = () =>
  useQuery({ queryKey: ["passport", "me"], queryFn: () => api.get<Passport | null>("/passport/me") });

/* ---------- Listagens paginadas (limit/offset + X-Total-Count) ----------
 * Os endpoints "/me", /events, /calendar e /notifications devolvem 50 por padrão (teto 200) e o
 * total real no header X-Total-Count. NUNCA calcule totais/contagens em cima da lista carregada:
 * ela pode estar truncada — use um endpoint agregado (ex.: /finance/me/summary) ou carregue o
 * período inteiro e confira `total`. */

export const PAGE_SIZE = 50;

type QueryParams = Record<string, string | number | undefined>;

/** `path?a=1&b=2` ignorando valores vazios/indefinidos. */
export function withQuery(path: string, params: QueryParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/** Data local de hoje em yyyy-MM-dd (o servidor compara o dia civil da aula). */
export const todayParam = (): string => fmt(startOfToday(), "yyyy-MM-dd");

/** Lista paginada que acumula as páginas ("Carregar mais"); `total` é o do servidor (ou null). */
export function usePagedList<T>(
  key: readonly unknown[],
  path: string,
  params: QueryParams = {},
  options: { pageSize?: number; enabled?: boolean } = {},
) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const query = useInfiniteQuery({
    queryKey: [...key, params, pageSize],
    enabled: options.enabled ?? true,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.getPage<T>(withQuery(path, { ...params, limit: pageSize, offset: pageParam })),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      if (last.items.length === 0) return undefined;
      const hasMore = last.total !== null ? loaded < last.total : last.items.length >= pageSize;
      return hasMore ? loaded : undefined;
    },
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? null;
  return {
    items,
    total,
    isLoading: query.isLoading,
    error: query.error,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

/** Aulas de hoje em diante (a mais próxima primeiro). */
export const useUpcomingLessons = () =>
  usePagedList<Lesson>(["lessons", "me", "upcoming"], "/lessons/me", { from: todayParam(), order: "asc" });

/** Aulas anteriores a hoje (a mais recente primeiro), 10 por vez. */
export const usePastLessons = () => {
  const yesterday = fmt(new Date(startOfToday().getTime() - 1), "yyyy-MM-dd");
  return usePagedList<Lesson>(["lessons", "me", "past"], "/lessons/me", { to: yesterday, order: "desc" }, { pageSize: 10 });
};

/** Só a próxima aula ATIVA (a partir de hoje) — independe de quantas aulas a turma já tem. */
export const useNextLessons = () => {
  const from = todayParam();
  return useQuery({
    queryKey: ["lessons", "me", "next", from],
    queryFn: () => api.get<Lesson[]>(withQuery("/lessons/me", { from, status: "ACTIVE", order: "asc", limit: 1 })),
  });
};

export const useClasses = () =>
  useQuery({ queryKey: ["classes", "me"], queryFn: () => api.get<ClassItem[]>("/classes/me") });

export interface AttendanceRange {
  /** yyyy-MM-dd (data da aula, inclusivo). */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Frequência do período (`records`, até 200) + indicadores do servidor sobre todo o histórico
 * (last30dPercent, currentStreak). Sem período: só a primeira página e os indicadores.
 */
export const useAttendance = (range: AttendanceRange = {}) =>
  useQuery({
    queryKey: ["attendance", "me", range.from ?? null, range.to ?? null, range.limit ?? null],
    queryFn: async (): Promise<AttendanceResponse> => {
      const { data, total } = await api.getWithTotal<Omit<AttendanceResponse, "total">>(
        withQuery("/attendance/me", { from: range.from, to: range.to, limit: range.limit }),
      );
      return { ...data, total };
    },
  });

/** Lançamentos do aluno, paginados (vencimento mais recente primeiro). */
export const useFinance = () => usePagedList<FinancialRecord>(["finance", "me", "list"], "/finance/me");

/** Totais "em aberto"/atrasado/pago agregados no banco — é DAQUI que sai o valor do banner. */
export const useFinanceSummary = () =>
  useQuery({
    queryKey: ["finance", "me", "summary"],
    queryFn: () => api.get<FinanceSummary>("/finance/me/summary"),
  });

export const useEvents = (enabled = true) => usePagedList<EventDto>(["events"], "/events", {}, { enabled });

export interface CalendarFilters {
  scope?: string;
  stateId?: string;
  cityId?: string;
  type?: string;
}

export function useCalendar(filters: CalendarFilters = {}, options: { pageSize?: number; enabled?: boolean } = {}) {
  return usePagedList<CalendarItem>(["calendar"], "/calendar", { ...filters }, options);
}

export const useStates = () =>
  useQuery({
    queryKey: ["states"],
    queryFn: () => api.get<Reference[]>("/rodas/reference/states"),
    staleTime: Infinity,
  });

export const useCities = (stateId: string) =>
  useQuery({
    queryKey: ["cities", stateId],
    queryFn: () => api.get<Reference[]>(`/rodas/reference/cities?stateId=${stateId}`),
    enabled: !!stateId,
    staleTime: Infinity,
  });

export const useAnnouncements = () =>
  useQuery({
    queryKey: ["announcements"],
    queryFn: () => api.get<Announcement[]>("/announcements"),
    ...noRetry,
  });

/** Notificações do usuário, paginadas (mais recentes primeiro). */
export const useNotifications = () => usePagedList<NotificationDto>(["notifications", "list"], "/notifications");

/** Não lidas contadas no banco — nunca pela lista carregada (que pode estar truncada). */
export const useUnreadCount = () =>
  useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => (await api.get<{ count: number }>("/notifications/unread-count")).count,
  });

/* ---------- Participação (eventos e rodas) ---------- */

const participantsPath = (source: "RODA" | "EVENTO", id: number) =>
  source === "RODA" ? `/rodas/${id}/participants` : `/events/${id}/participants`;

export function useParticipants(source: "RODA" | "EVENTO", id: number) {
  return useQuery({
    queryKey: ["participants", source, id],
    queryFn: () => api.get<Participant[]>(participantsPath(source, id)),
    ...noRetry,
  });
}

export function participantName(p: Participant): string {
  return p.student?.name ?? p.user?.name ?? p.guestName ?? "Capoeirista";
}

export function findMyParticipant(
  list: Participant[] | undefined,
  source: "RODA" | "EVENTO",
  myStudentId: number | null,
): Participant | null {
  const user = getUser();
  if (!list || !user) return null;
  if (source === "RODA") return list.find((p) => p.userId === user.id) ?? null;
  if (myStudentId !== null) return list.find((p) => p.studentId === myStudentId) ?? null;
  return list.find((p) => p.guestName === user.name) ?? null;
}

export function useToggleParticipation(source: "RODA" | "EVENTO", id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { mine: Participant | null; myStudentId: number | null }) => {
      const base = participantsPath(source, id);
      if (args.mine) return api.delete(`${base}/${args.mine.id}`);
      if (source === "RODA") return api.post(base);
      const user = getUser();
      return api.post(
        base,
        args.myStudentId !== null ? { studentId: args.myStudentId } : { guestName: user?.name },
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["participants", source, id] }),
  });
}
