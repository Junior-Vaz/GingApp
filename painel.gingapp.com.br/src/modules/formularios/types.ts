import {
  AlignLeft,
  Calendar,
  CheckSquare,
  CircleDot,
  FileUp,
  Hash,
  IdCard,
  Info,
  ListChecks,
  Mail,
  Phone,
  ScrollText,
  Type,
  type LucideIcon,
} from "lucide-react";

/** Os ids do backend podem vir como número ou texto; na URL e nos caminhos viram texto do mesmo jeito. */
export type Id = string | number;

export type FormStatus = "DRAFT" | "OPEN" | "CLOSED" | "ARCHIVED";

export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  DRAFT: "Rascunho",
  OPEN: "Aberto",
  CLOSED: "Encerrado",
  ARCHIVED: "Arquivado",
};

export const FORM_STATUS_VARIANT: Record<
  FormStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  OPEN: "default",
  CLOSED: "secondary",
  ARCHIVED: "secondary",
};

export type PaymentMode = "NONE" | "PIX_MANUAL" | "PIX_AUTO";
export type PixKeyType = "PHONE" | "EMAIL" | "CPF" | "CNPJ" | "RANDOM";

export const PIX_KEY_TYPE_LABEL: Record<PixKeyType, string> = {
  PHONE: "Telefone",
  EMAIL: "E-mail",
  CPF: "CPF",
  CNPJ: "CNPJ",
  RANDOM: "Chave aleatória",
};

export type FieldType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "EMAIL"
  | "PHONE"
  | "CPF"
  | "DATE"
  | "SINGLE_CHOICE"
  | "MULTI_CHOICE"
  | "SELECT"
  | "CONSENT"
  | "FILE"
  | "INFO";

export interface FieldTypeInfo {
  type: FieldType;
  label: string;
  icon: LucideIcon;
}

/** Menu "Adicionar campo": ícone + nome em português, na ordem em que aparece. */
export const FIELD_TYPES: readonly FieldTypeInfo[] = [
  { type: "SHORT_TEXT", label: "Texto curto", icon: Type },
  { type: "LONG_TEXT", label: "Texto longo", icon: AlignLeft },
  { type: "NUMBER", label: "Número", icon: Hash },
  { type: "EMAIL", label: "E-mail", icon: Mail },
  { type: "PHONE", label: "Telefone", icon: Phone },
  { type: "CPF", label: "CPF", icon: IdCard },
  { type: "DATE", label: "Data", icon: Calendar },
  { type: "SINGLE_CHOICE", label: "Escolha única", icon: CircleDot },
  { type: "MULTI_CHOICE", label: "Múltipla escolha", icon: ListChecks },
  { type: "SELECT", label: "Lista suspensa", icon: ScrollText },
  { type: "CONSENT", label: "Aceite de termo", icon: CheckSquare },
  { type: "FILE", label: "Envio de arquivo", icon: FileUp },
  { type: "INFO", label: "Texto informativo", icon: Info },
];

export const FIELD_TYPE_INFO: Record<FieldType, FieldTypeInfo> = Object.fromEntries(
  FIELD_TYPES.map((info) => [info.type, info]),
) as Record<FieldType, FieldTypeInfo>;

export const CHOICE_TYPES: readonly FieldType[] = ["SINGLE_CHOICE", "MULTI_CHOICE", "SELECT"];
export const isChoiceType = (type: FieldType): boolean => CHOICE_TYPES.includes(type);

export type MapsTo =
  | "name"
  | "nickname"
  | "birthDate"
  | "document"
  | "phone"
  | "email"
  | "city"
  | "group"
  | "teacher"
  | "cord";

/** "Este campo é: …" (a ordem do select; "Nenhum" = sem mapeamento). */
export const MAPS_TO_OPTIONS: readonly { value: MapsTo; label: string }[] = [
  { value: "name", label: "Nome" },
  { value: "nickname", label: "Apelido" },
  { value: "birthDate", label: "Nascimento" },
  { value: "document", label: "CPF" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "city", label: "Cidade" },
  { value: "group", label: "Grupo" },
  { value: "teacher", label: "Professor" },
  { value: "cord", label: "Graduação" },
];

/** Limites do contrato (o servidor valida de novo). */
export const LIMITS = { fields: 60, sections: 12, options: 40, files: 5 } as const;

export type TemplateKey = "CAMPEONATO" | "BATIZADO" | "CURSO" | "RODA" | "SIMPLES";

export interface FormTemplate {
  key: TemplateKey;
  name: string;
  description: string;
}

/** Cartões de modelo do "Novo formulário". Usado como padrão enquanto GET /event-forms/templates carrega/falha. */
export const FALLBACK_TEMPLATES: readonly FormTemplate[] = [
  {
    key: "CAMPEONATO",
    name: "Campeonato",
    description: "Dados do competidor, graduação, grupo, categoria, termo e pagamento.",
  },
  {
    key: "BATIZADO",
    name: "Batizado / troca de corda",
    description: "Dados do aluno, graduação atual e termo de participação.",
  },
  {
    key: "CURSO",
    name: "Curso / oficina",
    description: "Dados básicos, experiência e forma de pagamento.",
  },
  { key: "RODA", name: "Roda / encontro", description: "Nome, contato e confirmação de presença." },
  { key: "SIMPLES", name: "Inscrição simples", description: "Só nome, telefone e e-mail." },
];

/**
 * Item de GET /event-forms (corpo = array + `X-Total-Count`). Confirmado contra o backend real:
 * `priceCents` é `null` quando gratuito; datas são ISO.
 */
export interface FormListItem {
  id: Id;
  slug: string;
  title: string;
  eventId: Id | null;
  eventTitle: string | null;
  status: FormStatus;
  paymentMode: PaymentMode;
  priceCents: number | null;
  submissionsCount: number;
  pendingCount: number;
  confirmedCount: number;
  opensAt: string | null;
  closesAt: string | null;
  /** `null` até o formulário ser publicado (o slug definitivo nasce na 1ª publicação). */
  publicUrl: string | null;
  createdAt: string;
}

/** `equals` é sempre texto no painel (o backend aceita texto, número ou booleano e devolve como foi salvo). */
export interface ShowIf {
  fieldKey: string;
  equals: string;
}

export interface ServerSection {
  id: Id;
  order?: number;
  title: string;
  description: string | null;
}

export interface ServerField {
  id?: Id;
  key: string;
  sectionId: Id | null;
  order?: number;
  type: FieldType;
  label: string;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
  validation: Record<string, unknown> | null;
  showIf: ShowIf | null;
  mapsTo: MapsTo | null;
  /** Só vem com `?includeArchived=true` (campo removido que já tem respostas). */
  archived?: boolean;
}

/**
 * Definição completa devolvida por GET/PUT /event-forms/:id e pelas ações (open/close/archive/duplicate).
 * `slug` é PROVISÓRIO enquanto `slugLocked` é `false` (rascunho): a 1ª publicação gera o slug definitivo.
 */
export interface FormDefinition {
  id: Id;
  slug: string;
  slugLocked?: boolean;
  title: string;
  intro: string | null;
  bannerUrl: string | null;
  status: FormStatus;
  eventId: Id | null;
  eventTitle: string | null;
  opensAt: string | null;
  closesAt: string | null;
  maxSubmissions: number | null;
  allowWaitlist: boolean;
  paymentMode: PaymentMode;
  /** `null` quando gratuito. */
  priceCents: number | null;
  pixKey: string | null;
  pixKeyType: PixKeyType | null;
  pixBeneficiary: string | null;
  requireApproval: boolean;
  confirmationMessage: string | null;
  consentText: string | null;
  /** Texto de consentimento vigente (o do formulário ou o padrão LGPD do servidor). */
  consentEffectiveText?: string;
  /** Número inteiro; sobe sozinho quando o texto muda (o PUT aceita e ignora o que o painel devolver). */
  consentVersion: number | null;
  retentionMonths: number | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  archivedAt?: string | null;
  submissionsCount?: number;
  /** `null` até o formulário ser publicado: sem link para copiar, QR Code nem página pública. */
  publicUrl: string | null;
  sections: ServerSection[];
  fields: ServerField[];
}

/** Link ainda provisório: o servidor só devolve `publicUrl` depois da 1ª publicação (antes disso vem `null`). */
export const isLinkProvisional = (form: { publicUrl?: string | null | undefined }): boolean =>
  !form.publicUrl?.trim();

export interface CreateFormPayload {
  title: string;
  eventId?: Id;
  template?: TemplateKey;
}

// ---------------------------------------------------------------- Inscrições

export type SubmissionStatus = "PENDING" | "CONFIRMED" | "WAITLIST" | "REJECTED" | "CANCELLED";
export type PaymentStatus = "NOT_REQUIRED" | "PENDING" | "CONFIRMED";

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmada",
  WAITLIST: "Lista de espera",
  REJECTED: "Recusada",
  CANCELLED: "Cancelada",
};

export const SUBMISSION_STATUS_VARIANT: Record<
  SubmissionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  CONFIRMED: "default",
  WAITLIST: "secondary",
  REJECTED: "destructive",
  CANCELLED: "secondary",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  NOT_REQUIRED: "Sem pagamento",
  PENDING: "Pagamento pendente",
  CONFIRMED: "Pago",
};

/** Limpeza automática de dados (LGPD): `dry-run` = só simula, ainda não apaga nada neste servidor. */
export interface RetentionInfo {
  mode: "dry-run" | "true" | "false";
  months: number;
}

export interface FormSummary {
  total: number;
  byStatus: Record<SubmissionStatus, number>;
  paymentPending: number;
  paymentConfirmed: number;
  paidCents: number;
  /** `null` = vagas ilimitadas. */
  spotsLeft: number | null;
  /** Modo da limpeza automática (ausente em servidores antigos). */
  retention?: RetentionInfo;
}

/**
 * Item de GET /event-forms/:id/submissions. O corpo dessa rota é `{ items, total, limit, offset }` (+ header
 * `X-Total-Count`), diferente das demais listas (array). `phone` vem só com dígitos ("62999991001").
 */
export interface SubmissionListItem {
  id: Id;
  protocol: string;
  status: SubmissionStatus;
  paymentStatus: PaymentStatus;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  hasFiles: boolean;
  summary: string | null;
}

/** Corpo REAL de GET /event-forms/:id/submissions. */
export interface SubmissionsPage {
  items: SubmissionListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Resposta de FILE: lista de anexos `{ fileId, originalName, mimeType }`; CPF vem mascarado; vazio = `null`. */
export interface SubmissionFileRef {
  fileId: Id;
  originalName: string;
  mimeType: string;
}

export interface SubmissionAnswer {
  fieldKey: string;
  label: string;
  type: FieldType;
  /** Campo removido do formulário depois de já ter respostas. */
  archived?: boolean;
  value: unknown;
}

export interface SubmissionFile {
  id: Id;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

/** `action`: SUBMITTED, PAYMENT_CONFIRMED, APPROVED, REJECTED, CANCELLED, WAITLISTED, PROMOTED, NOTE_UPDATED. */
export interface SubmissionTimelineEntry {
  at: string;
  action: string;
  by: string | null;
  userId?: Id | null;
}

export interface SubmissionDetail {
  id: Id;
  formId?: Id;
  protocol: string;
  status: SubmissionStatus;
  paymentStatus: PaymentStatus;
  name: string;
  email: string | null;
  phone: string | null;
  /** Já mascarado pelo servidor ("***.***.***-25"). */
  document: string | null;
  consentAt?: string | null;
  consentVersion?: number | null;
  reviewedAt?: string | null;
  /** Preenchido quando a inscrição foi anonimizada (dados pessoais removidos; protocolo e contagem ficam). */
  anonymizedAt?: string | null;
  /** Aluno do grupo com o mesmo CPF (só para quem pode vincular); `null` = não há. */
  suggestedStudent?: { id: Id; name: string } | null;
  /** `true` para quem não é Mestre: `files` vem vazio (comprovantes são só do Mestre). */
  filesRestricted?: boolean;
  createdAt: string;
  updatedAt?: string;
  reviewNote: string | null;
  internalNote: string | null;
  answers: SubmissionAnswer[];
  files: SubmissionFile[];
  timeline: SubmissionTimelineEntry[];
}

export type SubmissionAction =
  "confirm-payment" | "approve" | "reject" | "cancel" | "waitlist" | "promote";
