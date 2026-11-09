/**
 * Pedidos de adesão de grupos (docs/CONTRATO_ADESAO_GRUPOS.md §4 e §8): tipos do contrato, rótulos em português,
 * validações dos diálogos de decisão e mensagens de erro (409 NOT_PENDING / EMAIL_TAKEN / slug em uso, 403, 404).
 *
 * REGRAS: a senha do solicitante NUNCA existe nas respostas desta API (nem aqui); o `claimedRole` é só informação
 * para a equipe (cargo informado), não concede papel nenhum; o `rejectionReason` é mostrado AO SOLICITANTE (não é
 * nota interna) e o `internalNote` é só da equipe. O servidor continua sendo a validação de verdade.
 */
import { ApiError } from '@/utils/api'
import { serverFieldErrors } from '@/utils/sponsors'

// ---------------------------------------------------------------- limites do contrato (§2, §4)

export const APPLICATION_LIMITS = {
  /** `slug` opcional na aprovação: mesma regra do cadastro de grupo (2..60, minúsculas, números e hífens). */
  slugMin: 2,
  slugMax: 60,
  /** `reason` da rejeição: 3..300, obrigatório. */
  reasonMin: 3,
  reasonMax: 300,
  /** `internalNote`: até 500. */
  internalNoteMax: 500,
} as const

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ---------------------------------------------------------------- status e cargo

/**
 * `UNVERIFIED` = pedido criado, e-mail do solicitante ainda não confirmado (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md §1).
 * Só vira `PENDING` quando ele confirma; vence em 3 dias. Não conta no contador de pendentes e não pode ser aprovado.
 */
export type GroupApplicationStatus = 'UNVERIFIED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'

/** Situação da confirmação do e-mail: `SKIPPED` = envio de e-mails desligado no servidor (nunca confirmado). */
export type EmailVerification = 'VERIFIED' | 'PENDING' | 'SKIPPED'

export type ApplicantRole = 'MESTRE' | 'CONTRAMESTRE' | 'PROFESSOR' | 'INSTRUTOR' | 'MONITOR' | 'OUTRO'

/** Mesmos tons do `StatusChip` (components/ui). */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusMeta {
  label: string
  /** Aba/filtro da lista (plural). */
  tabLabel: string
  hint: string
  tone: StatusTone
}

export const STATUS_META: Record<GroupApplicationStatus, StatusMeta> = {
  UNVERIFIED: {
    label: 'Aguardando e-mail',
    tabLabel: 'Aguardando e-mail',
    hint: 'O solicitante ainda não confirmou o e-mail. Se não confirmar em 3 dias, o pedido expira.',
    tone: 'info',
  },
  PENDING: {
    label: 'Pendente',
    tabLabel: 'Pendentes',
    hint: 'Aguardando a decisão da equipe.',
    tone: 'warning',
  },
  APPROVED: {
    label: 'Aprovado',
    tabLabel: 'Aprovados',
    hint: 'O grupo e a conta do administrador foram criados.',
    tone: 'success',
  },
  REJECTED: {
    label: 'Não aprovado',
    tabLabel: 'Não aprovados',
    hint: 'A equipe não aprovou este pedido; o motivo foi mostrado ao solicitante.',
    tone: 'danger',
  },
  EXPIRED: {
    label: 'Expirado',
    tabLabel: 'Expirados',
    hint: 'Ficou sem confirmação do e-mail (3 dias) ou sem decisão (60 dias) e foi encerrado automaticamente.',
    tone: 'neutral',
  },
}

/** Abas da tela: Pendentes é a padrão; "Aguardando e-mail" fica logo depois dela. */
export const STATUS_TABS: ReadonlyArray<{ key: GroupApplicationStatus; label: string }> = (
  ['PENDING', 'UNVERIFIED', 'APPROVED', 'REJECTED', 'EXPIRED'] as const
).map((key) => ({ key, label: STATUS_META[key].tabLabel }))

// ---------------------------------------------------------------- confirmação do e-mail (contrato do e-mail §1)

export interface VerificationMeta {
  label: string
  hint: string
  tone: StatusTone
}

export const EMAIL_VERIFICATION_META: Record<EmailVerification, VerificationMeta> = {
  VERIFIED: { label: 'E-mail confirmado', hint: 'O solicitante abriu o link enviado para o e-mail dele.', tone: 'success' },
  SKIPPED: {
    label: 'E-mail não confirmado (envio desligado)',
    hint: 'O envio de e-mails estava desligado quando o pedido foi feito, então não houve confirmação. Confira o pedido com mais cuidado.',
    tone: 'warning',
  },
  PENDING: { label: 'Aguardando confirmação', hint: 'O solicitante ainda não abriu o link de confirmação.', tone: 'info' },
}

/** Selo de verificação do e-mail; valor ausente/desconhecido (servidor antigo) = sem selo. */
export function emailVerificationMeta(value: string | null | undefined): VerificationMeta | null {
  return value && Object.hasOwn(EMAIL_VERIFICATION_META, value) ? EMAIL_VERIFICATION_META[value as EmailVerification] : null
}

/** Dica do botão Aprovar desabilitado quando o e-mail ainda não foi confirmado. */
export const APPROVE_BLOCKED_HINT = 'Disponível depois que o solicitante confirmar o e-mail.'

/** Aviso do detalhe: o e-mail confirmado só prova que o solicitante recebe mensagens nele, não que o grupo existe. */
export const INSTAGRAM_CHECK_HINT = 'Confira o perfil antes de aprovar: o e-mail só prova que o solicitante recebe mensagens nele.'

/** Pedido ainda sem e-mail confirmado: o servidor recusa a aprovação (409 EMAIL_NOT_VERIFIED). */
export function isAwaitingEmail(app: Pick<GroupApplication, 'status'>): boolean {
  return app.status === 'UNVERIFIED'
}

// ---------------------------------------------------------------- Instagram (contrato do e-mail §7)

/** Handle já normalizado pelo servidor: minúsculas, números, ponto e sublinhado, 1..30. */
export const INSTAGRAM_HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/

/** Handle válido para virar link: o padrão do contrato, sem `..` seguidos e sem terminar em `.` (regras do servidor). */
export function isInstagramHandle(value: unknown): value is string {
  return typeof value === 'string' && INSTAGRAM_HANDLE_PATTERN.test(value) && !value.includes('..') && !value.endsWith('.')
}

/**
 * Link do perfil montado SÓ a partir do handle validado aqui no cliente (o texto do servidor nunca vira `href`).
 * Qualquer outra coisa (vazio, `@x`, URL, `javascript:`, espaços) devolve `null`: a tela mostra o texto, sem link.
 */
export function instagramUrl(handle: unknown): string | null {
  return isInstagramHandle(handle) ? `https://www.instagram.com/${handle}/` : null
}

export function statusLabel(status: string): string {
  return STATUS_META[status as GroupApplicationStatus]?.label ?? status
}

export const ROLE_LABELS: Record<ApplicantRole, string> = {
  MESTRE: 'Mestre',
  CONTRAMESTRE: 'Contramestre',
  PROFESSOR: 'Professor',
  INSTRUTOR: 'Instrutor',
  MONITOR: 'Monitor',
  OUTRO: 'Outro cargo',
}

/** Cargo informado: usa o rótulo do servidor (`claimedRoleLabel`) e cai no nosso se faltar. */
export function claimedRoleText(app: Pick<GroupApplication, 'claimedRole' | 'claimedRoleLabel'>): string {
  return app.claimedRoleLabel || ROLE_LABELS[app.claimedRole] || app.claimedRole
}

// ---------------------------------------------------------------- formato da resposta (§4)

export interface GroupApplication {
  id: number
  status: GroupApplicationStatus
  applicantName: string
  email: string
  phone: string | null
  claimedRole: ApplicantRole
  claimedRoleLabel: string
  groupName: string
  city: string
  /** UF (2 letras maiúsculas). */
  state: string
  estimatedStudents: number | null
  /** Texto livre do solicitante (até 500). */
  message: string | null
  /** Confirmação do e-mail do solicitante (aprovar exige `VERIFIED` ou `SKIPPED`). */
  emailVerification: EmailVerification
  emailVerifiedAt: string | null
  /** Handle do Instagram já normalizado pelo servidor (sem `@`), ou null. SÓ a equipe vê; nunca é URL digitada. */
  instagram: string | null
  createdAt: string
  decidedAt: string | null
  decidedBy: { id: number; name: string } | null
  /** Motivo da rejeição: foi mostrado AO SOLICITANTE. */
  rejectionReason: string | null
  /** Nota interna: só a equipe vê. */
  internalNote: string | null
  organization: { id: number; name: string; slug: string } | null
}

export interface ApproveResult {
  application: GroupApplication
  organization: { id: number; name: string; slug: string }
}

export function isGroupApplicationStatus(value: string): value is GroupApplicationStatus {
  return value in STATUS_META
}

/** "62999990000" -> "(62) 99999-0000". Fora do padrão volta como veio (o servidor guarda no formato dele). */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return phone
}

// ---------------------------------------------------------------- validação dos diálogos

/** Slug opcional: vazio é válido (o servidor gera a partir do nome). */
export function slugError(slug: string): string | null {
  const value = slug.trim()
  if (value === '') return null
  if (value.length < APPLICATION_LIMITS.slugMin || value.length > APPLICATION_LIMITS.slugMax || !SLUG_PATTERN.test(value)) {
    return `O endereço deve ter de ${APPLICATION_LIMITS.slugMin} a ${APPLICATION_LIMITS.slugMax} caracteres: letras minúsculas, números e hífens (ex.: grupo-ginga).`
  }
  return null
}

export function internalNoteError(note: string): string | null {
  return note.trim().length > APPLICATION_LIMITS.internalNoteMax ? `No máximo ${APPLICATION_LIMITS.internalNoteMax} caracteres.` : null
}

/** Motivo da rejeição: obrigatório, 3..300 (depois de aparar). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length
  if (length < APPLICATION_LIMITS.reasonMin) return `Informe o motivo (no mínimo ${APPLICATION_LIMITS.reasonMin} caracteres). Ele será mostrado ao solicitante.`
  if (length > APPLICATION_LIMITS.reasonMax) return `No máximo ${APPLICATION_LIMITS.reasonMax} caracteres.`
  return null
}

export interface ApproveForm {
  slug: string
  internalNote: string
}

export type ApproveFieldErrors = Partial<Record<keyof ApproveForm, string>>

export function validateApproveForm(form: ApproveForm): ApproveFieldErrors {
  const errors: ApproveFieldErrors = {}
  const slug = slugError(form.slug)
  if (slug) errors.slug = slug
  const note = internalNoteError(form.internalNote)
  if (note) errors.internalNote = note
  return errors
}

/** Corpo do POST de aprovar: campos vazios são omitidos (slug gerado pelo servidor). Sem nada, vai `{}`. */
export function approvePayload(form: ApproveForm): { slug?: string; internalNote?: string } {
  const body: { slug?: string; internalNote?: string } = {}
  if (form.slug.trim()) body.slug = form.slug.trim()
  if (form.internalNote.trim()) body.internalNote = form.internalNote.trim()
  return body
}

export interface RejectForm {
  reason: string
  internalNote: string
}

export type RejectFieldErrors = Partial<Record<keyof RejectForm, string>>

export function validateRejectForm(form: RejectForm): RejectFieldErrors {
  const errors: RejectFieldErrors = {}
  const reason = reasonError(form.reason)
  if (reason) errors.reason = reason
  const note = internalNoteError(form.internalNote)
  if (note) errors.internalNote = note
  return errors
}

export function rejectPayload(form: RejectForm): { reason: string; internalNote?: string } {
  const body: { reason: string; internalNote?: string } = { reason: form.reason.trim() }
  if (form.internalNote.trim()) body.internalNote = form.internalNote.trim()
  return body
}

/** 400 do servidor -> erros por campo + gerais (os campos do formulário têm o mesmo nome do corpo). */
export function decisionServerErrors(error: unknown, fields: readonly string[]): { fields: Record<string, string>; general: string[] } {
  return serverFieldErrors(error, fields)
}

// ---------------------------------------------------------------- mensagens

export const DECISION_ONLY_SUPER_HINT = 'Só o super admin pode aprovar ou não aprovar pedidos. Você pode consultar tudo.'

export const APPROVE_WARNING =
  'Aprovar cria o grupo e a conta de administrador do solicitante (com a senha que ele mesmo escolheu) e avisa por e-mail, se o envio de e-mails estiver ligado.'

export const REJECT_WARNING = 'Não aprovar encerra o pedido. O motivo abaixo será mostrado ao solicitante na página de acompanhamento e enviado por e-mail, se o envio estiver ligado.'

export type DecisionContext = 'approve' | 'reject' | 'load'

const FALLBACKS: Record<DecisionContext, string> = {
  approve: 'Não foi possível aprovar o pedido.',
  reject: 'Não foi possível registrar a decisão.',
  load: 'Não foi possível carregar os pedidos de adesão.',
}

/** Códigos de conflito conhecidos de slug em uso (o contrato diz só "slug em uso = 409"; aceitamos variações). */
function isSlugConflict(error: ApiError): boolean {
  return /slug/i.test(error.code ?? '') || /slug/i.test(error.message)
}

/**
 * Mensagem em português para um erro das rotas de `/platform-group-applications`.
 * `slugSent` = a aprovação enviou um slug (um 409 sem código reconhecido, nesse caso, é tratado como slug em uso).
 */
export function applicationErrorText(error: unknown, context: DecisionContext, slugSent = false): string {
  if (!(error instanceof ApiError)) return FALLBACKS[context]
  // O servidor pode mandar o código em `code` ou repeti-lo em `message`.
  const code =
    error.code ?? (error.message === 'NOT_PENDING' || error.message === 'EMAIL_TAKEN' || error.message === 'EMAIL_NOT_VERIFIED' ? error.message : undefined)
  if (code === 'EMAIL_NOT_VERIFIED') {
    return 'O solicitante ainda não confirmou o e-mail, então o pedido não pode ser aprovado. Aguarde a confirmação (o link vale 24 horas); se ele não confirmar em 3 dias, o pedido expira sozinho.'
  }
  if (code === 'NOT_PENDING') {
    return 'Este pedido já foi decidido (talvez por outra pessoa da equipe) ou expirou. Atualize a lista para ver a situação atual.'
  }
  if (code === 'EMAIL_TAKEN') {
    return 'O e-mail do solicitante já virou uma conta no GingApp depois do pedido, então o grupo não pôde ser criado. Entre em contato com ele; se não houver outra saída, use "Não aprovar" explicando o motivo.'
  }
  if (error.status === 409) {
    if (context === 'approve' && (isSlugConflict(error) || slugSent)) {
      return 'Esse endereço (slug) já está em uso por outro grupo. Escolha outro ou deixe em branco para gerar automaticamente.'
    }
    return error.message && error.message !== code ? error.message : 'Conflito ao processar o pedido. Atualize a lista e tente de novo.'
  }
  if (error.status === 403) return 'Só o super admin pode aprovar ou não aprovar pedidos.'
  if (error.status === 404) return 'Esse pedido não existe mais. Atualize a lista.'
  return error.message || FALLBACKS[context]
}

/** Erros que indicam que a lista está desatualizada (outra pessoa decidiu / pedido sumiu): recarregar. */
export function isStaleListError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 404)
}
