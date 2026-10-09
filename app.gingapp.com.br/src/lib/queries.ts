import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
  records: AttendanceRecord[];
  last30dPercent: number | null;
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

export interface RodaDto {
  id: number;
  title: string;
  description: string | null;
  date: string;
  location: string | null;
  imageUrl: string | null;
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

export function fromRoda(roda: RodaDto): Encounter {
  return {
    key: `RODA-${roda.id}`,
    source: "RODA",
    id: roda.id,
    title: roda.title,
    type: "RODA",
    typeLabel: "Roda",
    date: roda.date,
    place: roda.location,
    city: null,
    image: roda.imageUrl ?? rodaImage,
    description: roda.description,
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

export const useLessons = () =>
  useQuery({ queryKey: ["lessons", "me"], queryFn: () => api.get<Lesson[]>("/lessons/me") });

export const useClasses = () =>
  useQuery({ queryKey: ["classes", "me"], queryFn: () => api.get<ClassItem[]>("/classes/me") });

export const useAttendance = () =>
  useQuery({
    queryKey: ["attendance", "me"],
    queryFn: () => api.get<AttendanceResponse>("/attendance/me"),
  });

export const useFinance = () =>
  useQuery({ queryKey: ["finance", "me"], queryFn: () => api.get<FinancialRecord[]>("/finance/me") });

export const useEvents = () =>
  useQuery({ queryKey: ["events"], queryFn: () => api.get<EventDto[]>("/events") });

export const useRodas = () =>
  useQuery({ queryKey: ["rodas"], queryFn: () => api.get<RodaDto[]>("/rodas") });

export interface CalendarFilters {
  scope?: string;
  stateId?: string;
  cityId?: string;
  type?: string;
}

export function useCalendar(filters: CalendarFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const query = params.toString();
  return useQuery({
    queryKey: ["calendar", query],
    queryFn: () => api.get<CalendarItem[]>(`/calendar${query ? `?${query}` : ""}`),
  });
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

export const useNotifications = () =>
  useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationDto[]>("/notifications"),
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
