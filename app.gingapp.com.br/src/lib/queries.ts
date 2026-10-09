import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmt, startOfToday } from "@/lib/format";
import { getUser, setStoredStudentId, useSessionUser, useStoredStudentId } from "@/lib/session";
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
  /** Aluno dono do certificado (GET /certificates/me agrega os dependentes; o app filtra pelo ativo). */
  studentId: number;
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
  /** Total de inscrições, agregado no servidor (GET /events). Ausente em backend antigo. */
  participantsCount?: number;
  /** Inscrição do PRÓPRIO usuário/dependente (GET /events); null = não inscrito. */
  myParticipation?: MyParticipation | null;
}

/** Resumo da inscrição do usuário num evento/roda — o `id` basta para cancelar sem listar ninguém. */
export interface MyParticipation {
  id: number;
  studentId: number | null;
  status: string;
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

/**
 * Item de GET .../participants. Para ALUNO/RESPONSAVEL o servidor anonimiza os terceiros (ids e nomes
 * viram null): só a própria inscrição vem identificada — por isso o app só usa a lista como contagem
 * (`length`) e para achar a própria inscrição, nunca para exibir quem mais vai.
 */
export interface Participant {
  id: number;
  userId: number | null;
  studentId: number | null;
  guestName: string | null;
  status: string;
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
  /**
   * Resumo de participação vindo da própria listagem (GET /events). `undefined` = a fonte (GET /calendar)
   * não traz esse resumo: o card só consulta /participants quando o usuário abre os detalhes.
   */
  participantsCount?: number;
  myParticipation?: MyParticipation | null;
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
    // Backend antigo (sem o resumo) => campos ausentes => o card cai no fluxo sob demanda.
    ...(event.participantsCount === undefined
      ? {}
      : { participantsCount: event.participantsCount, myParticipation: event.myParticipation ?? null }),
  };
}

/* ---------- Hooks de leitura ---------- */

const noRetry = { retry: false } as const;

export const useStudents = () =>
  useQuery({ queryKey: ["students", "me"], queryFn: () => api.get<Student[]>("/students/me") });

/** Ordem DETERMINÍSTICA dos alunos ligados à conta: nome (pt-BR, sem distinguir caixa) e, no empate, id. */
export function sortStudents(students: Student[]): Student[] {
  return [...students].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) || a.id - b.id);
}

/**
 * Aluno ATIVO do app (SSOT de "qual aluno as telas mostram"): a escolha guardada (se ainda for um
 * aluno ligado à conta); senão o PRÓPRIO Student do usuário; senão o primeiro por nome/id. Um aluno
 * guardado que deixou de existir/ser vinculado é ignorado (nunca fica preso num id inválido).
 */
export function resolveActiveStudent(
  students: Student[] | undefined,
  userId: number | undefined,
  storedId: number | null = null,
): Student | null {
  if (!students || students.length === 0) return null;
  const sorted = sortStudents(students);
  return (
    (storedId !== null ? sorted.find((s) => s.id === storedId) : undefined) ??
    sorted.find((s) => s.userId !== null && s.userId === userId) ??
    sorted[0] ??
    null
  );
}

/**
 * Aluno ativo + lista (ordenada) para o seletor. ALUNO (um vínculo) e responsável com 1 dependente
 * têm `students.length === 1` => sem seletor. `selectStudent` persiste a escolha (por usuário).
 */
export function useMyStudent() {
  const user = useSessionUser();
  const query = useStudents();
  const stored = useStoredStudentId(user?.id);
  const students = useMemo(() => sortStudents(query.data ?? []), [query.data]);
  const student = useMemo(() => resolveActiveStudent(query.data, user?.id, stored), [query.data, user?.id, stored]);
  const userId = user?.id;
  const selectStudent = useCallback((id: number) => setStoredStudentId(userId, id), [userId]);
  return { ...query, students, student, selectStudent };
}

/**
 * Escopo de aluno de TODAS as consultas que dependem de um aluno ("/me": passaporte, financeiro,
 * frequência, aulas...). REGRA ÚNICA: tudo segue o aluno ativo — lista e banner/resumo usam o mesmo
 * `studentId`, nunca um agregado de dependentes. As consultas só disparam depois que /students/me
 * respondeu (`ready`): senão a 1ª chamada iria sem aluno e traria o agregado de todos os dependentes.
 * Sem nenhum aluno ligado, `studentId` é undefined e o servidor devolve vazio.
 */
export interface StudentScope {
  studentId: number | undefined;
  ready: boolean;
  loading: boolean;
  error: Error | null;
}

export function useStudentScope(): StudentScope {
  const { student, isSuccess, isLoading, error } = useMyStudent();
  return { studentId: student?.id, ready: isSuccess, loading: isLoading, error };
}

/** Enquanto o aluno ativo não é conhecido a consulta ainda não rodou: conta como "carregando"; erro de /students/me vira erro da tela. */
function scoped<T extends { isLoading: boolean; error: unknown }>(result: T, scope: StudentScope): T {
  return { ...result, isLoading: result.isLoading || scope.loading, error: result.error ?? scope.error };
}

export const useGraduations = (studentId: number | undefined) =>
  useQuery({
    queryKey: ["graduations", studentId],
    queryFn: () => api.get<StudentGraduation[]>(`/graduations/students/${studentId}`),
    enabled: studentId !== undefined,
  });

/** Certificados do aluno ATIVO (o servidor devolve os de todos os dependentes; filtra-se por studentId). */
export function useCertificates() {
  const scope = useStudentScope();
  const query = useQuery({
    queryKey: ["certificates", "me"],
    queryFn: () => api.get<Certificate[]>("/certificates/me"),
    enabled: scope.ready,
    select: (list) => (scope.studentId === undefined ? list : list.filter((c) => c.studentId === scope.studentId)),
  });
  return scoped(query, scope);
}

export function usePassport() {
  const scope = useStudentScope();
  const query = useQuery({
    queryKey: ["passport", "me", scope.studentId ?? null],
    queryFn: () => api.get<Passport | null>(withQuery("/passport/me", { studentId: scope.studentId })),
    enabled: scope.ready,
  });
  return scoped(query, scope);
}

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

/** Aulas de hoje em diante do aluno ativo (a mais próxima primeiro). */
export function useUpcomingLessons() {
  const scope = useStudentScope();
  const list = usePagedList<Lesson>(
    ["lessons", "me", "upcoming"],
    "/lessons/me",
    { from: todayParam(), order: "asc", studentId: scope.studentId },
    { enabled: scope.ready },
  );
  return scoped(list, scope);
}

/** Aulas do aluno ativo anteriores a hoje (a mais recente primeiro), 10 por vez. */
export function usePastLessons() {
  const scope = useStudentScope();
  const yesterday = fmt(new Date(startOfToday().getTime() - 1), "yyyy-MM-dd");
  const list = usePagedList<Lesson>(
    ["lessons", "me", "past"],
    "/lessons/me",
    { to: yesterday, order: "desc", studentId: scope.studentId },
    { pageSize: 10, enabled: scope.ready },
  );
  return scoped(list, scope);
}

/** Só a próxima aula ATIVA (a partir de hoje) do aluno ativo — independe de quantas aulas a turma já tem. */
export function useNextLessons() {
  const scope = useStudentScope();
  const from = todayParam();
  const query = useQuery({
    queryKey: ["lessons", "me", "next", from, scope.studentId ?? null],
    queryFn: () =>
      api.get<Lesson[]>(
        withQuery("/lessons/me", { from, status: "ACTIVE", order: "asc", limit: 1, studentId: scope.studentId }),
      ),
    enabled: scope.ready,
  });
  return scoped(query, scope);
}

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
export function useAttendance(range: AttendanceRange = {}) {
  const scope = useStudentScope();
  const query = useQuery({
    queryKey: ["attendance", "me", scope.studentId ?? null, range.from ?? null, range.to ?? null, range.limit ?? null],
    queryFn: async (): Promise<AttendanceResponse> => {
      const { data, total } = await api.getWithTotal<Omit<AttendanceResponse, "total">>(
        withQuery("/attendance/me", { from: range.from, to: range.to, limit: range.limit, studentId: scope.studentId }),
      );
      return { ...data, total };
    },
    enabled: scope.ready,
  });
  return scoped(query, scope);
}

/** Lançamentos do aluno ativo, paginados (vencimento mais recente primeiro). */
export function useFinance() {
  const scope = useStudentScope();
  const list = usePagedList<FinancialRecord>(
    ["finance", "me", "list"],
    "/finance/me",
    { studentId: scope.studentId },
    { enabled: scope.ready },
  );
  return scoped(list, scope);
}

/** Totais "em aberto"/atrasado/pago agregados no banco — é DAQUI que sai o valor do banner. MESMO
 * escopo (aluno ativo) da lista: banner e linhas nunca falam de alunos diferentes. */
export function useFinanceSummary() {
  const scope = useStudentScope();
  const query = useQuery({
    queryKey: ["finance", "me", "summary", scope.studentId ?? null],
    queryFn: () => api.get<FinanceSummary>(withQuery("/finance/me/summary", { studentId: scope.studentId })),
    enabled: scope.ready,
  });
  return scoped(query, scope);
}

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

/**
 * Lista de participantes de UM encontro — nunca uma por card (era o N+1: 52 chamadas e 109 respostas 429
 * numa página). Só roda sob demanda (`enabled`): fontes sem resumo (GET /calendar) ao abrir os detalhes.
 * Itens com `participantsCount`/`myParticipation` (GET /events) não precisam dela.
 */
export function useParticipants(source: "RODA" | "EVENTO", id: number, enabled = true) {
  return useQuery({
    queryKey: ["participants", source, id],
    queryFn: () => api.get<Participant[]>(participantsPath(source, id)),
    enabled,
    ...noRetry,
  });
}

/** Acha a PRÓPRIA inscrição numa lista de participantes (os terceiros chegam anonimizados). */
export function findMyParticipant(
  list: Participant[] | undefined,
  source: "RODA" | "EVENTO",
  myStudentId: number | null,
): MyParticipation | null {
  const user = getUser();
  if (!list || !user) return null;
  const own =
    source === "RODA"
      ? list.find((p) => p.userId === user.id)
      : myStudentId !== null
        ? list.find((p) => p.studentId === myStudentId)
        : list.find((p) => p.guestName === user.name);
  return own ? { id: own.id, studentId: own.studentId, status: own.status } : null;
}

/**
 * Inscrever / cancelar. O cancelamento usa o `id` da própria inscrição (`mine`), sem listar ninguém.
 * Depois invalida o que mostra a participação: a lista do encontro (fontes lazy), `["events"]` (as
 * páginas de /events trazem contagem + minha inscrição) e, nas rodas, o Passaporte (conta rodas).
 */
export function useToggleParticipation(source: "RODA" | "EVENTO", id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { mine: MyParticipation | null; myStudentId: number | null }) => {
      const base = participantsPath(source, id);
      if (args.mine) return api.delete(`${base}/${args.mine.id}`);
      if (source === "RODA") return api.post(base);
      const user = getUser();
      return api.post(
        base,
        args.myStudentId !== null ? { studentId: args.myStudentId } : { guestName: user?.name },
      );
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["participants", source, id] }),
        source === "EVENTO" ? queryClient.invalidateQueries({ queryKey: ["events"] }) : undefined,
        source === "RODA" ? queryClient.invalidateQueries({ queryKey: ["passport"] }) : undefined,
      ]),
  });
}
