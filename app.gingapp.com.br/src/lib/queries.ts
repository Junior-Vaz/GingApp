import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, errorMessage } from "@/lib/api";
import { pickEventInfo, type EncounterInfo, type EventInfoFields } from "@/lib/event-info";
import { fmt, startOfToday } from "@/lib/format";
import { isStaffRole, normalizeBadges, toBadge, type Badge } from "@/lib/roles";
import { getUser, setStoredStudentId, useSessionUser, useStoredStudentId, type StaffRole } from "@/lib/session";
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
  /** Estilo da corda (só em backend novo; sem ele o app desenha a cor única `color`). */
  style?: "SOLID" | "SPLIT" | "BRAIDED";
  /** 1..3 cores hex da corda (SPLIT = faixas verticais iguais; BRAIDED = listras diagonais). */
  colors?: string[];
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
  /** `id` e `photo` só em backend novo (opcionais: o app funciona sem eles). */
  unit: { name: string; id?: number; photo?: string | null } | null;
  currentGraduation: { name: string; color?: string | null; style?: GraduationLevel["style"]; colors?: string[] } | null;
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

/** Referência leve com foto (campos novos do backend; sempre opcionais no app). */
export interface PhotoRef {
  id: number;
  name: string;
  photo?: string | null;
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
  /** Turma, unidade e professor com foto (GET /lessons/me em backend novo). */
  class?: PhotoRef | null;
  unit?: PhotoRef | null;
  teacher?: PhotoRef | null;
}

export interface ClassItem {
  id: number;
  name: string;
  description: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  unitId: number | null;
  /** Foto da turma, unidade e professor (GET /classes/me em backend novo). */
  photo?: string | null;
  unit?: PhotoRef | null;
  teacher?: PhotoRef | null;
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

/** Parte de GET /organizations (o grupo do usuário) usada no app: "Como pagar" do financeiro (E07). */
export interface OwnOrganization {
  id: number;
  name: string;
  /** Logo do grupo (URL http(s) ou caminho de upload `/api/uploads/...`); null = sem logo. */
  logo?: string | null;
  paymentInstructions: string | null;
}

/** Instruções de pagamento do grupo (texto livre do MESTRE). Falha silenciosa: o bloco só some. */
export function useOwnOrganization() {
  return useQuery({
    queryKey: ["organizations", "own"],
    queryFn: async () => {
      const data = await api.get<OwnOrganization | OwnOrganization[] | null>("/organizations");
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Identidade visual de quem está logado: nome, FOTO (do aluno ligado à própria conta, /students/me) e o GRUPO
 * (nome + logo, GET /organizations). Alimenta o avatar do topbar, do menu, do perfil e do ranking.
 */
export function useMyIdentity() {
  const user = useSessionUser();
  const students = useStudents();
  const organization = useOwnOrganization();
  const own = students.data?.find((s) => s.userId === user?.id) ?? null;
  return {
    name: user?.name ?? "",
    photo: own?.photo ?? null,
    groupName: organization.data?.name ?? null,
    groupLogoUrl: organization.data?.logo ?? null,
  };
}

export interface FinancialRecord {
  id: number;
  description: string;
  amountCents: number;
  type: string;
  dueDate: string;
  paidAt: string | null;
  status: FinanceStatus;
}

export interface EventDto extends EventInfoFields {
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

export interface CalendarItem extends EventInfoFields {
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
  /** Total de inscrições (agregado no servidor). Ausente em backend antigo. */
  participantsCount?: number;
  /** Inscrição do usuário do token (null = anônimo/não inscrito). Ausente em backend antigo. */
  myParticipation?: MyParticipation | null;
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

export interface Encounter extends EncounterInfo {
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
   * Resumo de participação vindo da própria listagem (GET /events ou GET /calendar). `undefined` = backend
   * antigo sem esse resumo: o card só consulta /participants quando o usuário abre os detalhes.
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
    // Backend antigo (sem o resumo) => campos ausentes => o card cai no fluxo sob demanda.
    ...(item.participantsCount === undefined
      ? {}
      : { participantsCount: item.participantsCount, myParticipation: item.myParticipation ?? null }),
    ...pickEventInfo(item),
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
    ...pickEventInfo(event),
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

/* ---------- Hierarquia do grupo (GET /graduations/hierarchy) ---------- */

export interface HierarchyPerson {
  id: number;
  displayName: string;
  photo: string | null;
  level: GraduationLevel | null;
}

export interface HierarchyTeacher extends HierarchyPerson {
  /** Professor do aluno ativo (recebe o selo "Seu professor"). */
  isMyTeacher: boolean;
}

export interface HierarchyLevelStudent {
  studentId: number;
  displayName: string;
  photo: string | null;
  isMe: boolean;
}

export interface HierarchyLevel extends GraduationLevel {
  count: number;
  isMine: boolean;
  /** Até 12 alunos do nível (o resto vem só em `count`). */
  students: HierarchyLevelStudent[];
}

/** Um cargo do grupo (ex.: Contramestre) com as pessoas que o têm como cargo MAIS ALTO. */
export interface HierarchyStaffGroup {
  groupRole: Badge;
  people: HierarchyTeacher[];
}

export interface Hierarchy {
  group: { id: number; name: string; logoUrl: string | null };
  system: { id: number; name: string } | null;
  /** Equipe por cargo do grupo, do maior rank para o menor. Ausente/vazio em backend antigo: cai em masters/teachers. */
  staff?: HierarchyStaffGroup[];
  /** Legado (derivado): quem tem acesso MESTRE. */
  masters: HierarchyPerson[];
  /** Legado (derivado): os demais da equipe, com `isMyTeacher`. */
  teachers: HierarchyTeacher[];
  /** Do nível MAIS ALTO para o mais baixo. */
  levels: HierarchyLevel[];
  me: { studentId: number; displayName: string; photo: string | null; level: GraduationLevel | null; order: number | null } | null;
  higherCount: number;
  totalStudents: number;
}

/** `staff` fora do contrato (ausente, malformado) vira lista vazia; cargos ficam do maior rank para o menor. */
export function normalizeStaff(value: unknown): HierarchyStaffGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: HierarchyStaffGroup[] = [];
  for (const item of value) {
    const badge = toBadge((item as { groupRole?: unknown } | null)?.groupRole);
    const people = (item as { people?: unknown } | null)?.people;
    if (!badge || !Array.isArray(people)) continue;
    groups.push({ groupRole: badge, people: people as HierarchyTeacher[] });
  }
  return groups.sort((a, b) => b.groupRole.rank - a.groupRole.rank);
}

/** Árvore de cordas do grupo do aluno ATIVO (espera o aluno ser conhecido: senão iria sem `studentId`). */
export function useHierarchy(enabled = true) {
  const scope = useStudentScope();
  const query = useQuery({
    queryKey: ["graduations", "hierarchy", scope.studentId ?? null],
    queryFn: () => api.get<Hierarchy>(withQuery("/graduations/hierarchy", { studentId: scope.studentId })),
    enabled: enabled && scope.ready,
    // Resposta fora do contrato (backend antigo/parcial) vira "sem cordas" em vez de quebrar a tela.
    select: (data): Hierarchy => ({
      ...data,
      levels: data?.levels ?? [],
      masters: data?.masters ?? [],
      teachers: data?.teachers ?? [],
      staff: normalizeStaff(data?.staff),
    }),
  });
  return scoped(query, scope);
}

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

/* ---------- Ficha única do capoeirista (GET /people/me/code e /people/me/ficha) ---------- */

export interface PersonCode {
  personId: number;
  /** Ex.: 'GING-7K3Q-9XPM'. */
  gingappCode: string;
  /** data:image/png;base64,... do QR do código. */
  qrDataUrl: string;
}

/** Código único da ficha do aluno ATIVO. 404 PERSON_NOT_FOUND (sem ficha) é erro e NÃO deve ser repetido. */
export function usePersonCode() {
  const scope = useStudentScope();
  return useQuery({
    queryKey: ["people", "me", "code", scope.studentId ?? null],
    queryFn: () => api.get<PersonCode>(withQuery("/people/me/code", { studentId: scope.studentId })),
    enabled: scope.ready,
    retry: false,
  });
}

export interface FichaEnrollment {
  studentId: number;
  organization: { id: number; name: string; logoUrl: string | null };
  unit: { id: number; name: string } | null;
  status: string;
  since: string | null;
  until: string | null;
  isCurrent: boolean;
  /** Cargos do grupo nesta matrícula (maior rank primeiro). Backend antigo manda string[]: use `normalizeBadges`. */
  roles?: (Badge | StaffRole)[];
  /** Slugs dos cargos (os 4 padrão: mestre/professor/instrutor/monitor). */
  roleKeys?: string[];
}

/** Cargo que a pessoa tem em um grupo: `role` é o papel de ACESSO; `groupRole` é o cargo do grupo (nome/cor/ícone). */
export interface StaffRoleInfo {
  organization: { id: number; name: string };
  role: StaffRole;
  groupRole?: Badge;
  grantedAt: string;
}

/** Graduação da ficha única: traz o grupo de origem e se foi reconhecida pelo grupo atual. */
export interface FichaGraduation {
  id: number;
  studentId: number;
  organization: { id: number; name: string };
  graduatedAt: string;
  level: GraduationLevel;
  system?: { id: number; name: string };
  /** Preenchido quando o grupo atual reconheceu a corda vinda de outro grupo (Fase 4). */
  recognizedFromLevelId?: number | null;
}

export interface Ficha {
  person: {
    id: number;
    gingappCode: string;
    name: string;
    nickname: string | null;
    birthDate: string | null;
    photo: string | null;
    documentMasked: string | null;
    documentKind: string | null;
  };
  enrollments: FichaEnrollment[];
  /** Cargos da pessoa em todos os grupos (Fase 3). Ausente em backend antigo. */
  roles?: StaffRoleInfo[];
  /** Graduações de todos os grupos pelos quais a pessoa passou (Fase 4). Ausente/vazio em backend antigo. */
  graduations: FichaGraduation[];
  attendanceByGroup: { organization: { id: number; name: string }; present: number; absent: number; total: number }[];
  certificates: unknown[];
  sharedFromOtherGroups: unknown[];
  scope: "SELF" | string;
}

/** Ficha única do aluno ATIVO. */
export function useFicha(enabled = true) {
  const scope = useStudentScope();
  return useQuery({
    queryKey: ["people", "me", "ficha", scope.studentId ?? null],
    queryFn: () => api.get<Ficha>(withQuery("/people/me/ficha", { studentId: scope.studentId })),
    enabled: enabled && scope.ready,
    retry: false,
  });
}

/* ---------- Transferência entre grupos (Ficha única, Fase 2) ---------- */

export type TransferStatus = "PENDING_PERSON" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED" | "COMPLETED";
export type TransferContestReason = "PENDING_PAYMENT" | "EQUIPMENT" | "OTHER";
export type TransferShared = "ATTENDANCE" | "GRADUATIONS" | "CERTIFICATES";

export interface TransferOrganization {
  id: number;
  name: string;
  logoUrl: string | null;
}

export interface PersonTransferView {
  id: number;
  status: TransferStatus;
  person: { id: number; name: string; photo: string | null };
  fromOrganization: TransferOrganization;
  toOrganization: TransferOrganization;
  toUnit: { id: number; name: string } | null;
  requestedAt: string;
  expiresAt: string;
  contestUntil: string;
  decidedAt: string | null;
  note: string | null;
  contests: {
    id: number;
    reason: TransferContestReason;
    note: string | null;
    createdAt: string;
    organization: { id: number; name: string };
  }[];
  /** true quando ESTE usuário pode aprovar/recusar agora (adulto por si; menor só o responsável). */
  canDecide: boolean;
  decidingAs: "SELF" | "GUARDIAN" | null;
  sharedOnApproval: TransferShared[];
}

/** Tipos de notificação que levam à tela de pedidos de transferência. */
export const isTransferNotification = (type: string | null | undefined): boolean => !!type && type.startsWith("TRANSFER_");

/** Avisos de cargo (ROLE_GRANTED/ROLE_REVOKED/ROLE_SUGGESTION): tocar leva ao Perfil. */
export const isRoleNotification = (type: string | null | undefined): boolean => !!type && type.startsWith("ROLE_");

/**
 * Pedidos de transferência da própria pessoa e dos dependentes do responsável (sem filtro de aluno
 * ativo: o servidor já devolve tudo o que o usuário enxerga). Erro (ex.: backend antigo) não é repetido.
 */
export function useTransfers() {
  return useQuery({
    queryKey: ["people", "me", "transfers"],
    queryFn: () => api.get<PersonTransferView[]>("/people/me/transfers"),
    retry: false,
  });
}

/** Pedidos que ESTE usuário ainda precisa decidir (alimenta selos do Perfil e do menu). */
export const pendingTransfersOf = (list: PersonTransferView[] | undefined): PersonTransferView[] =>
  (list ?? []).filter((t) => t.status === "PENDING_PERSON" && t.canDecide);

export function usePendingTransferCount(): number {
  const { data } = useTransfers();
  return pendingTransfersOf(data).length;
}

/* ---------- Ocorrências registradas pelos grupos (Ficha única, Fase 5) ---------- */

export type OccurrenceKind = "ADVERTENCIA" | "SUSPENSAO" | "EXPULSAO" | "OUTRA";
export type OccurrenceStatus = "ACTIVE" | "CONTESTED" | "RETRACTED";

export interface PersonOccurrenceView {
  id: number;
  kind: OccurrenceKind;
  occurredAt: string;
  /** Fim da suspensão (só faz sentido em SUSPENSAO). */
  endsAt: string | null;
  reason: string;
  status: OccurrenceStatus;
  organization: { id: number; name: string; logoUrl: string | null };
  person: { id: number; name: string };
  contestedAt: string | null;
  contestNote: string | null;
  retractedAt: string | null;
  /** true quando ESTE usuário pode contestar agora (adulto por si; menor só o responsável). */
  canContest: boolean;
  decidingAs: "SELF" | "GUARDIAN" | null;
}

/** Aviso de nova ocorrência registrada por um grupo: tocar leva a "Minhas ocorrências". */
export const isOccurrenceNotification = (type: string | null | undefined): boolean => type === "OCCURRENCE_REGISTERED";

/**
 * Ocorrências sobre a própria pessoa e os dependentes do responsável (sem filtro de aluno ativo: o
 * servidor devolve tudo o que o usuário enxerga). Erro (ex.: backend antigo) não é repetido.
 */
export function useOccurrences() {
  return useQuery({
    queryKey: ["people", "me", "occurrences"],
    queryFn: () => api.get<PersonOccurrenceView[]>("/people/me/occurrences"),
    retry: false,
  });
}

/**
 * Cargos do grupo do usuário no grupo do token (maior rank primeiro). Fonte: GET /auth/me (`roles: Badge[]`);
 * enquanto carrega, ou se o servidor for antigo/falhar, cai no que a sessão já sabe (`roles` do login ou o `role`
 * de equipe, convertido em Badge). Nunca lança: sem cargo devolve lista vazia e o app segue como aluno.
 */
export function useMyRoles(): Badge[] {
  const user = useSessionUser();
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api.get<{ roles?: unknown }>("/auth/me"),
    enabled: !!user,
    retry: false,
  });
  if (me.data && Array.isArray(me.data.roles)) return normalizeBadges(me.data.roles);
  return normalizeBadges(user?.roles ?? (isStaffRole(user?.role) ? [user?.role] : []));
}

/** Atualiza a ficha do aluno (PATCH /people/me): apelido, telefone etc. */
export interface FichaPatch {
  name?: string;
  nickname?: string | null;
  photo?: string | null;
  phone?: string;
  email?: string;
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

/**
 * Unidade do aluno com foto: o passaporte traz o nome (e a foto, em backend novo); sem foto ali, usa a da turma
 * que pertence à mesma unidade. Sem unidade = null.
 */
export function useMyUnit(): { name: string; photo: string | null } | null {
  const passport = usePassport();
  const classes = useClasses();
  const unit = passport.data?.unit;
  if (!unit) return null;
  const fromClass = classes.data?.find((c) => c.unit && (c.unit.id === unit.id || c.unit.name === unit.name))?.unit;
  return { name: unit.name, photo: unit.photo || fromClass?.photo || null };
}

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

/** Eventos do grupo de hoje em diante, o mais próximo primeiro. Sem `order=asc&from=hoje` o servidor
 * devolve por id desc, e o "Carregar mais" trazia páginas de uma ordem diferente da exibida. */
export const useEvents = (enabled = true) =>
  usePagedList<EventDto>(["events"], "/events", { from: todayParam(), order: "asc" }, { enabled });

/** Valores aceitos por GET /calendar?scope= (o backend responde 400 para qualquer outro). */
export type CalendarScope = "today" | "week" | "month";

export interface CalendarFilters {
  scope?: CalendarScope;
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

/** Recados do grupo: limit explícito (50) e `total` do X-Total-Count para avisar se houver mais do que o carregado. */
export const ANNOUNCEMENTS_LIMIT = 50;

export function useAnnouncements() {
  const query = useQuery({
    queryKey: ["announcements"],
    queryFn: () => api.getPage<Announcement>(withQuery("/announcements", { limit: ANNOUNCEMENTS_LIMIT })),
    ...noRetry,
  });
  return {
    ...query,
    data: query.data?.items,
    total: query.data?.total ?? null,
  };
}

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
 * Itens com `participantsCount`/`myParticipation` (GET /events, GET /calendar) não precisam dela.
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
 * SSOT do estado de participação de UM encontro (card da lista e cartão do mapa usam o mesmo): contagem,
 * "já estou inscrito", se pode se inscrever e `join()` (inscreve/cancela com toast). Contagem e "inscrito" vêm
 * do resumo da própria listagem quando existe (zero chamadas); sem resumo, a lista só é consultada quando
 * `detailsOpen` (usuário abriu os detalhes). Sem aluno vinculado (inscrição como convidado, que o resumo não
 * enxerga) também precisa da lista. O resumo traz UMA inscrição da conta: com vários dependentes só vale para
 * o aluno ATIVO se for a dele (ou se ninguém inscreveu); se for de OUTRO dependente consulta a lista — nunca
 * mostra "Confirmado"/cancela a inscrição do irmão.
 */
export function useEncounterParticipation(
  event: Pick<Encounter, "source" | "id" | "participantsCount" | "myParticipation" | "spotsLeft">,
  detailsOpen: boolean,
) {
  const [offerWaitlist, setOfferWaitlist] = useState(false);
  const { student, isLoading: studentLoading } = useMyStudent();
  const toggle = useToggleParticipation(event.source, event.id);
  const myStudentId = student?.id ?? null;
  const hasSummary = event.participantsCount !== undefined;
  const guestMode = event.source === "EVENTO" && !studentLoading && myStudentId === null;
  const summaryOwn = event.myParticipation ?? null;
  const summaryFits = hasSummary && (studentLoading || summaryOwn === null || summaryOwn.studentId === myStudentId);
  const participants = useParticipants(
    event.source,
    event.id,
    (detailsOpen && (!hasSummary || guestMode)) || (hasSummary && !summaryFits),
  );
  const count = hasSummary ? event.participantsCount : participants.data?.length;
  const canJoin = summaryFits ? !guestMode || participants.isSuccess : participants.isSuccess;
  const mine = (summaryFits ? summaryOwn : null) ?? findMyParticipant(participants.data, event.source, myStudentId);
  const joined = mine !== null;
  // Lista de espera: a inscricao existe (`joined`) mas NAO ocupa vaga; cancelar = sair da fila.
  const waitlisted = mine?.status === "WAITLIST";
  // Lotado: pelo resumo da listagem (spotsLeft === 0) ou porque o servidor respondeu 409 EVENT_FULL.
  const full = !joined && (offerWaitlist || (event.source === "EVENTO" && event.spotsLeft === 0));

  async function run(joinWaitlist: boolean) {
    try {
      await toggle.mutateAsync({ mine, myStudentId, joinWaitlist });
      setOfferWaitlist(false);
      toast.success(
        joined
          ? waitlisted
            ? "Você saiu da lista de espera."
            : "Participação cancelada."
          : joinWaitlist
            ? "Você entrou na lista de espera. Avisaremos se abrir uma vaga."
            : "Você está na roda! Participação confirmada.",
      );
    } catch (error) {
      // Evento lotado: mostra a mensagem do servidor e passa a oferecer a fila (botao "Entrar na lista de espera").
      if (error instanceof ApiError && error.status === 409 && error.code === "EVENT_FULL") setOfferWaitlist(true);
      toast.error(errorMessage(error, "Não foi possível atualizar sua participação."));
    }
  }

  return {
    count,
    canJoin,
    joined,
    waitlisted,
    full,
    /** Inscreve (ou cancela/sai da fila, se ja inscrito). */
    join: () => run(false),
    /** Entra na lista de espera de um evento lotado (POST com joinWaitlist: true). */
    joinWaitlist: () => run(true),
    pending: toggle.isPending,
  };
}

/**
 * Inscrever / cancelar. O cancelamento usa o `id` da própria inscrição (`mine`), sem listar ninguém.
 * Depois invalida o que mostra a participação: a lista do encontro (fontes lazy), `["events"]` (as
 * páginas de /events trazem contagem + minha inscrição) e, nas rodas, o Passaporte (conta rodas).
 */
export function useToggleParticipation(source: "RODA" | "EVENTO", id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { mine: MyParticipation | null; myStudentId: number | null; joinWaitlist?: boolean }) => {
      const base = participantsPath(source, id);
      if (args.mine) return api.delete(`${base}/${args.mine.id}`);
      if (source === "RODA") return api.post(base);
      const user = getUser();
      const who = args.myStudentId !== null ? { studentId: args.myStudentId } : { guestName: user?.name };
      return api.post(base, args.joinWaitlist ? { ...who, joinWaitlist: true } : who);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["participants", source, id] }),
        source === "EVENTO" ? queryClient.invalidateQueries({ queryKey: ["events"] }) : undefined,
        // GET /calendar também traz contagem + minha inscrição por item.
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        source === "RODA" ? queryClient.invalidateQueries({ queryKey: ["passport"] }) : undefined,
      ]),
  });
}
