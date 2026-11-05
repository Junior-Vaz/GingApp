/**
 * Patrocinadores e campanhas (Frente A, piloto): tipos, listas fixas, formatação e VALIDAÇÕES do contrato
 * (docs/CONTRATO_PATROCINADORES.md). O servidor continua sendo a validação de verdade; aqui só se evita ir à rede à toa
 * e se dá a mensagem em português ao vivo.
 */
import { ApiError, API_URL } from '@/utils/api'

// ---------------------------------------------------------------- limites do contrato (§3)

export const SPONSOR_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  notesMax: 1000,
  titleMin: 2,
  titleMax: 60,
  textMin: 2,
  textMax: 90,
  ctaMin: 2,
  ctaMax: 24,
  urlMax: 500,
  weightMin: 1,
  weightMax: 10,
  windowMaxDays: 366,
  /** Limite informativo (não consta do contrato): observação de cobrança, só admin. */
  billingNoteMax: 1000,
} as const

export const DEFAULT_CTA_LABEL = 'Conhecer'

/** Peso final máximo da imagem/logo (contrato §4.3: reprocessar/recusar acima). Enviar já menor evita a recusa. */
export const SPONSOR_IMAGE_MAX_BYTES = 250 * 1024
export const SPONSOR_IMAGE_RECOMMENDED = { width: 1200, height: 630 } as const
export const SPONSOR_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

// ---------------------------------------------------------------- categorias (lista branca, §2.5)

export type SponsorCategory =
  | 'INSTRUMENTOS'
  | 'VESTUARIO'
  | 'SAUDE'
  | 'EDUCACAO'
  | 'EVENTOS_TURISMO'
  | 'ALIMENTACAO'
  | 'ESPORTES'

export const SPONSOR_CATEGORIES: ReadonlyArray<{ value: SponsorCategory; label: string }> = [
  { value: 'INSTRUMENTOS', label: 'Instrumentos' },
  { value: 'VESTUARIO', label: 'Vestuário' },
  { value: 'SAUDE', label: 'Saúde' },
  { value: 'EDUCACAO', label: 'Educação' },
  { value: 'EVENTOS_TURISMO', label: 'Eventos e turismo' },
  { value: 'ALIMENTACAO', label: 'Alimentação' },
  { value: 'ESPORTES', label: 'Esportes' },
]

export function categoryLabel(value: string): string {
  return SPONSOR_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

// ---------------------------------------------------------------- UFs

export const BRAZIL_STATES: ReadonlyArray<{ uf: string; name: string }> = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
]

const UF_SET = new Set(BRAZIL_STATES.map((s) => s.uf))

export function isValidUf(value: string): boolean {
  return UF_SET.has(value)
}

/** "Brasil todo" quando vazio; senão as UFs separadas por vírgula. */
export function statesLabel(states: readonly string[] | null | undefined): string {
  return states && states.length > 0 ? states.join(', ') : 'Brasil todo'
}

/** Nome da UF para a tabela do relatório; '' = a região não pôde ser identificada. */
export function stateReportLabel(state: string): string {
  if (!state) return 'Não identificada'
  const found = BRAZIL_STATES.find((s) => s.uf === state)
  return found ? `${found.uf} — ${found.name}` : state
}

// ---------------------------------------------------------------- status

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED'
export type EffectiveStatus = 'DRAFT' | 'PAUSED' | 'SCHEDULED' | 'ACTIVE_NOW' | 'ENDED'

/** Rótulo escrito + cores (texto sempre visível: a cor nunca é a única informação). Contraste AA em todas. */
export const EFFECTIVE_STATUS_META: Record<EffectiveStatus, { label: string; classes: string; hint: string }> = {
  DRAFT: { label: 'Rascunho', classes: 'bg-slate-100 text-slate-700 ring-slate-300', hint: 'Ainda não foi ativada: não aparece no app.' },
  PAUSED: { label: 'Pausada', classes: 'bg-amber-100 text-amber-900 ring-amber-300', hint: 'Pausada: não aparece no app.' },
  SCHEDULED: { label: 'Agendada', classes: 'bg-sky-100 text-sky-900 ring-sky-300', hint: 'Ativada, mas ainda não chegou a data de início.' },
  ACTIVE_NOW: { label: 'No ar agora', classes: 'bg-emerald-100 text-emerald-900 ring-emerald-300', hint: 'Aparecendo no app neste momento.' },
  ENDED: { label: 'Encerrada', classes: 'bg-zinc-200 text-zinc-800 ring-zinc-400', hint: 'A data de fim já passou.' },
}

export const EFFECTIVE_STATUS_ORDER: EffectiveStatus[] = ['ACTIVE_NOW', 'SCHEDULED', 'DRAFT', 'PAUSED', 'ENDED']

export function effectiveStatusLabel(status: string): string {
  return EFFECTIVE_STATUS_META[status as EffectiveStatus]?.label ?? status
}

// ---------------------------------------------------------------- modelos de resposta (formatos do contrato)

export interface Sponsor {
  id: number
  name: string
  logo: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  document: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** Opcional: o contrato não promete este contador; usado só se vier. */
  campaignsCount?: number
}

export interface SponsorCampaign {
  id: number
  sponsorId: number
  /** O contrato não define como o nome do patrocinador vem na campanha: aceitamos `sponsor` OU `sponsorName`. */
  sponsor?: { id: number; name: string; logo?: string | null } | null
  sponsorName?: string
  title: string
  text: string
  imageRef: string | null
  ctaLabel: string
  destinationUrl: string
  destinationHost?: string
  category: SponsorCategory
  startsAt: string
  endsAt: string
  status: CampaignStatus
  effectiveStatus: EffectiveStatus
  weight: number
  states: string[]
  priceCents: number | null
  billingNote: string | null
  approvedByUserId: number | null
  approvedAt: string | null
  /** O contrato só traz o id do aprovador; aceitamos também o nome (`approvedBy` ou `approvedByName`) quando o backend mandar. */
  approvedBy?: { id: number; name: string } | null
  approvedByName?: string | null
  createdAt: string
  updatedAt: string
}

export interface CampaignReport {
  campaign: { id: number; title: string; sponsorName: string; startsAt: string; endsAt: string; status: string }
  totals: { impressions: number; clicks: number; ctr: number }
  byDay: Array<{ day: string; impressions: number; clicks: number }>
  byState: Array<{ state: string; impressions: number; clicks: number }>
}

/** Nome do patrocinador de uma campanha (aceita os dois formatos; `fallback` = lista de patrocinadores já carregada). */
export function campaignSponsorName(campaign: SponsorCampaign, fallback?: readonly Sponsor[]): string {
  return (
    campaign.sponsor?.name ??
    campaign.sponsorName ??
    fallback?.find((s) => s.id === campaign.sponsorId)?.name ??
    `Patrocinador #${campaign.sponsorId}`
  )
}

/** "aprovada por <usuário> em <data>" ou '' quando ainda não foi aprovada. */
export function approvalText(campaign: SponsorCampaign, formatDateTime: (v: string) => string): string {
  if (!campaign.approvedAt && campaign.approvedByUserId == null) return ''
  const who = campaign.approvedBy?.name ?? campaign.approvedByName ?? (campaign.approvedByUserId != null ? `usuário #${campaign.approvedByUserId}` : 'usuário da plataforma')
  return campaign.approvedAt ? `Aprovada por ${who} em ${formatDateTime(campaign.approvedAt)}` : `Aprovada por ${who}`
}

// ---------------------------------------------------------------- URL de destino (§2.6) — validação ao vivo

export interface UrlCheck {
  /** Impede salvar. */
  error: string | null
  /** Aviso que não impede de digitar (mostrado junto do erro quando o endereço não é https). */
  warning: string | null
}

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.home.arpa']

function isIpHost(hostname: string): boolean {
  if (hostname.startsWith('[') || hostname.includes(':')) return true // IPv6
  if (/^\d+(\.\d+){0,3}$/.test(hostname)) return true // IPv4 (o parser já normaliza formas como 2130706433)
  return /^0x[0-9a-f]+(\.|$)/i.test(hostname)
}

/** Analisa o endereço digitado. Regras: só https, sem usuário/senha, host por NOME (nada de IP/localhost/rede privada), até 500. */
export function checkDestinationUrl(raw: string): UrlCheck {
  const value = raw.trim()
  if (!value) return { error: 'Informe o endereço de destino (link do patrocinador).', warning: null }
  if (value.length > SPONSOR_LIMITS.urlMax) {
    return { error: `O endereço pode ter no máximo ${SPONSOR_LIMITS.urlMax} caracteres (tem ${value.length}).`, warning: null }
  }
  if (/\s/.test(value)) return { error: 'O endereço não pode ter espaços.', warning: null }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return {
      error: /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
        ? 'Endereço inválido. Confira se está completo (ex.: https://www.loja.com.br/pagina).'
        : 'Comece o endereço com https:// (ex.: https://www.loja.com.br/pagina).',
      warning: null,
    }
  }

  if (url.protocol === 'http:') {
    return {
      error: 'Só aceitamos links seguros (https://). Peça ao patrocinador o endereço com https.',
      warning: 'Este link não é seguro (http): o navegador do aluno avisaria "não seguro". Use a versão https.',
    }
  }
  if (url.protocol !== 'https:') {
    return {
      error: 'Só aceitamos links que começam com https://.',
      warning: 'Este link não usa https.',
    }
  }
  if (url.username || url.password) {
    return { error: 'O endereço não pode conter usuário ou senha (ex.: https://usuario:senha@site.com).', warning: null }
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isIpHost(host)) {
    return { error: 'Use o endereço pelo nome do site (ex.: www.loja.com.br). Endereços numéricos (IP) não são aceitos.', warning: null }
  }
  if (host === 'localhost' || !host.includes('.') || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return { error: 'Use um site público na internet: endereços locais ou de rede interna (localhost, .local, .internal…) não são aceitos.', warning: null }
  }
  return { error: null, warning: null }
}

export function validateDestinationUrl(raw: string): string | null {
  return checkDestinationUrl(raw).error
}

// ---------------------------------------------------------------- datas (fuso de São Paulo, UTC-3 fixo, sem horário de verão)

const SP_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** "2026-11-10T08:00" (campo datetime-local, hora de Brasília) -> ISO UTC. null se inválido. */
export function localToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = new Date(`${local}:00-03:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO UTC -> "YYYY-MM-DDTHH:mm" em hora de Brasília (valor de campo datetime-local). */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  return new Date(ms - SP_OFFSET_MS).toISOString().slice(0, 16)
}

/** Dia civil (YYYY-MM-DD) em São Paulo de um instante. */
export function spDay(value: Date | string): string {
  const ms = (value instanceof Date ? value : new Date(value)).getTime()
  return new Date(ms - SP_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS)
}

/** "2026-11-04" -> "04/11". */
export function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  return `${date}/${month}`
}

/** "2026-11-04" -> "04/11/2026". */
export function longDay(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

// ---------------------------------------------------------------- dinheiro

/** "1.234,56" | "1234.56" | "R$ 10" -> centavos. '' -> null (sem preço). Inválido -> 'invalid'. */
export function reaisToCents(text: string): number | null | 'invalid' {
  const clean = text.replace(/R\$/gi, '').replace(/\s/g, '')
  if (clean === '') return null
  let normalized: string
  if (clean.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(clean)) return 'invalid'
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+\.\d{1,2}$/.test(clean)) {
    normalized = clean
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, '')
  } else if (/^\d+$/.test(clean)) {
    normalized = clean
  } else {
    return 'invalid'
  }
  const [whole, decimals = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : 'invalid'
}

export function centsToReaisText(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

const INT_MAX = 2_147_483_647

// ---------------------------------------------------------------- formulário de campanha

export interface CampaignFormState {
  sponsorId: string
  title: string
  text: string
  imageRef: string
  ctaLabel: string
  destinationUrl: string
  category: string
  startsAt: string
  endsAt: string
  weight: string
  states: string[]
  price: string
  billingNote: string
}

export function emptyCampaignForm(): CampaignFormState {
  return {
    sponsorId: '',
    title: '',
    text: '',
    imageRef: '',
    ctaLabel: DEFAULT_CTA_LABEL,
    destinationUrl: '',
    category: '',
    startsAt: '',
    endsAt: '',
    weight: '1',
    states: [],
    price: '',
    billingNote: '',
  }
}

export function campaignToForm(c: SponsorCampaign): CampaignFormState {
  return {
    sponsorId: String(c.sponsorId),
    title: c.title,
    text: c.text,
    imageRef: c.imageRef ?? '',
    ctaLabel: c.ctaLabel,
    destinationUrl: c.destinationUrl,
    category: c.category,
    startsAt: isoToLocal(c.startsAt),
    endsAt: isoToLocal(c.endsAt),
    weight: String(c.weight),
    states: [...c.states],
    price: centsToReaisText(c.priceCents),
    billingNote: c.billingNote ?? '',
  }
}

export type CampaignFieldErrors = Partial<Record<keyof CampaignFormState, string>>

/** Valida o formulário inteiro (mesmas regras do contrato). Objeto vazio = válido. */
export function validateCampaignForm(form: CampaignFormState): CampaignFieldErrors {
  const errors: CampaignFieldErrors = {}
  const L = SPONSOR_LIMITS

  if (!form.sponsorId) errors.sponsorId = 'Escolha o patrocinador.'

  const title = form.title.trim()
  if (title.length < L.titleMin || title.length > L.titleMax) errors.title = `O título deve ter de ${L.titleMin} a ${L.titleMax} caracteres.`
  const text = form.text.trim()
  if (text.length < L.textMin || text.length > L.textMax) errors.text = `O texto deve ter de ${L.textMin} a ${L.textMax} caracteres.`
  const cta = form.ctaLabel.trim()
  if (cta.length < L.ctaMin || cta.length > L.ctaMax) errors.ctaLabel = `O texto do botão deve ter de ${L.ctaMin} a ${L.ctaMax} caracteres.`

  const urlError = validateDestinationUrl(form.destinationUrl)
  if (urlError) errors.destinationUrl = urlError

  if (!SPONSOR_CATEGORIES.some((c) => c.value === form.category)) errors.category = 'Escolha uma categoria da lista.'

  const start = localToIso(form.startsAt)
  const end = localToIso(form.endsAt)
  if (!start) errors.startsAt = 'Informe a data e hora de início.'
  if (!end) errors.endsAt = 'Informe a data e hora de fim.'
  if (start && end) {
    const span = Date.parse(end) - Date.parse(start)
    if (span <= 0) errors.endsAt = 'O fim deve ser depois do início.'
    else if (span > L.windowMaxDays * DAY_MS) errors.endsAt = `A campanha pode durar no máximo ${L.windowMaxDays} dias.`
  }

  // <input type="number" v-model> entrega número (não texto) em runtime: normaliza antes de validar.
  const weightText = String(form.weight ?? '').trim()
  const weight = Number(weightText)
  if (weightText === '' ||!Number.isInteger(weight) || weight < L.weightMin || weight > L.weightMax) {
    errors.weight = `O peso deve ser um número inteiro de ${L.weightMin} a ${L.weightMax}.`
  }

  if (form.states.some((uf) => !isValidUf(uf))) errors.states = 'Há uma UF inválida na seleção.'

  const cents = reaisToCents(form.price)
  if (cents === 'invalid') errors.price = 'Valor inválido. Use o formato 1.500,00.'
  else if (cents !== null && cents > INT_MAX) errors.price = 'Valor alto demais.'

  if (form.billingNote.length > L.billingNoteMax) errors.billingNote = `A observação pode ter no máximo ${L.billingNoteMax} caracteres.`

  return errors
}

/** Corpo do POST/PATCH da campanha (formato do contrato §3). Chamar só com o formulário válido. */
export function campaignPayload(form: CampaignFormState) {
  const cents = reaisToCents(form.price)
  return {
    sponsorId: Number(form.sponsorId),
    title: form.title.trim(),
    text: form.text.trim(),
    imageRef: form.imageRef.trim() || null,
    ctaLabel: form.ctaLabel.trim(),
    destinationUrl: form.destinationUrl.trim(),
    category: form.category,
    startsAt: localToIso(form.startsAt),
    endsAt: localToIso(form.endsAt),
    weight: Number(form.weight),
    states: [...form.states].sort(),
    priceCents: cents === 'invalid' ? null : cents,
    billingNote: form.billingNote.trim() || null,
  }
}

/** Campos de CONTEÚDO: mudar qualquer um numa campanha ATIVA a devolve a rascunho (contrato §3). */
export const CONTENT_FIELDS = ['sponsorId', 'title', 'text', 'imageRef', 'ctaLabel', 'destinationUrl', 'category'] as const

export function contentChanged(original: CampaignFormState, current: CampaignFormState): boolean {
  return CONTENT_FIELDS.some((field) => original[field].trim() !== current[field].trim())
}

// ---------------------------------------------------------------- formulário de patrocinador

export interface SponsorFormState {
  name: string
  logo: string
  contactName: string
  contactEmail: string
  contactPhone: string
  document: string
  notes: string
}

export function emptySponsorForm(): SponsorFormState {
  return { name: '', logo: '', contactName: '', contactEmail: '', contactPhone: '', document: '', notes: '' }
}

export function sponsorToForm(s: Sponsor): SponsorFormState {
  return {
    name: s.name,
    logo: s.logo ?? '',
    contactName: s.contactName ?? '',
    contactEmail: s.contactEmail ?? '',
    contactPhone: s.contactPhone ?? '',
    document: s.document ?? '',
    notes: s.notes ?? '',
  }
}

export type SponsorFieldErrors = Partial<Record<keyof SponsorFormState, string>>

export function validateSponsorForm(form: SponsorFormState): SponsorFieldErrors {
  const errors: SponsorFieldErrors = {}
  const name = form.name.trim()
  if (name.length < SPONSOR_LIMITS.nameMin || name.length > SPONSOR_LIMITS.nameMax) {
    errors.name = `O nome deve ter de ${SPONSOR_LIMITS.nameMin} a ${SPONSOR_LIMITS.nameMax} caracteres.`
  }
  const email = form.contactEmail.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.contactEmail = 'Informe um e-mail válido.'
  if (form.notes.length > SPONSOR_LIMITS.notesMax) errors.notes = `As observações podem ter no máximo ${SPONSOR_LIMITS.notesMax} caracteres.`
  return errors
}

/** Corpo do POST/PATCH do patrocinador: campos vazios viram null (limpam o valor no PATCH). */
export function sponsorPayload(form: SponsorFormState) {
  const orNull = (v: string) => v.trim() || null
  return {
    name: form.name.trim(),
    logo: orNull(form.logo),
    contactName: orNull(form.contactName),
    contactEmail: orNull(form.contactEmail),
    contactPhone: orNull(form.contactPhone),
    document: orNull(form.document),
    notes: orNull(form.notes),
  }
}

// ---------------------------------------------------------------- erros 400 do servidor por campo

export interface ServerErrors {
  /** campo -> mensagem (o servidor começa a frase com o nome do campo, ex.: "title deve ter…"). */
  fields: Record<string, string>
  /** mensagens que não citam um campo conhecido: mostradas em bloco. */
  general: string[]
}

/**
 * Separa as mensagens de um 400 (class-validator: `message` é uma lista; cada frase começa com o nome do campo, às vezes
 * com índice: `states.0`). Aceita também `{ field, message }`. O que não casa com um campo conhecido vai para `general`.
 */
export function serverFieldErrors(error: unknown, knownFields: readonly string[]): ServerErrors {
  const result: ServerErrors = { fields: {}, general: [] }
  if (!(error instanceof ApiError)) return result
  const body = (error.body ?? {}) as { message?: unknown; field?: unknown }
  const messages: string[] = Array.isArray(body.message)
    ? body.message.filter((m): m is string => typeof m === 'string')
    : typeof body.message === 'string'
      ? [body.message]
      : []
  if (messages.length === 0) {
    if (error.message) result.general.push(error.message)
    return result
  }
  for (const message of messages) {
    const explicit = typeof body.field === 'string' && knownFields.includes(body.field) && messages.length === 1 ? body.field : null
    const lead = /^([A-Za-z_]\w*)(?:[.[]\S*?)?:?\s/.exec(message)?.[1]
    const field = explicit ?? (lead && knownFields.includes(lead) ? lead : null)
    if (field) result.fields[field] = result.fields[field] ? `${result.fields[field]} ${message}` : message
    else result.general.push(message)
  }
  return result
}

// ---------------------------------------------------------------- imagens

/** Erro (pt-BR) de um arquivo de imagem antes de enviar; null = ok. Peso máximo = contrato (250 KB). */
export function validateImageFile(file: { type: string; size: number; name?: string }): string | null {
  if (!(SPONSOR_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Formato não aceito: envie uma imagem JPEG, PNG ou WebP.'
  if (file.size === 0) return 'O arquivo está vazio.'
  if (file.size > SPONSOR_IMAGE_MAX_BYTES) {
    return `A imagem tem ${Math.ceil(file.size / 1024)} KB e o limite é ${SPONSOR_IMAGE_MAX_BYTES / 1024} KB. Reduza o tamanho ou a qualidade (recomendado ${SPONSOR_IMAGE_RECOMMENDED.width}×${SPONSOR_IMAGE_RECOMMENDED.height} px, WebP ou JPEG).`
  }
  return null
}

const UPLOAD_PATH = /^\/api\/uploads\/[0-9a-f-]{36}\.(webp|jpg|png)$/

/** Referência guardada (`/api/uploads/<arquivo>` ou URL) -> `src` do <img>. Em desenvolvimento a API fica em outra origem. */
export function imageSrc(ref: string | null | undefined): string {
  if (!ref) return ''
  if (!UPLOAD_PATH.test(ref)) return ref
  return `${API_URL.replace(/\/api\/?$/, '')}${ref}`
}

// ---------------------------------------------------------------- relatório

export function formatPercent(value: number): string {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

/** CTR em % com 2 casas (0 sem impressões) — usado quando a linha não traz o valor pronto. */
export function computeCtr(clicks: number, impressions: number): number {
  return impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0
}

/** Completa com zeros os dias sem dado entre `from` e `to` (inclusive) para o gráfico ficar contínuo. Máx. 400 dias. */
export function fillDays(
  rows: ReadonlyArray<{ day: string; impressions: number; clicks: number }>,
  from: string,
  to: string,
): Array<{ day: string; impressions: number; clicks: number }> {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const total = daysBetween(from, to)
  if (!Number.isFinite(total) || total < 0 || total > 400) return [...rows].sort((a, b) => a.day.localeCompare(b.day))
  const out: Array<{ day: string; impressions: number; clicks: number }> = []
  for (let i = 0; i <= total; i++) {
    const day = addDays(from, i)
    out.push(byDay.get(day) ?? { day, impressions: 0, clicks: 0 })
  }
  return out
}

/** Período padrão do relatório: últimos 30 dias, limitados à vigência (nunca antes do início nem depois do fim/hoje). */
export function defaultReportRange(startsAt: string, endsAt: string, now: Date = new Date()): { from: string; to: string } {
  const today = spDay(now)
  const startDay = spDay(startsAt)
  const lastDay = spDay(new Date(Date.parse(endsAt) - 1)) // endsAt é exclusivo
  let to = today < lastDay ? today : lastDay
  if (to < startDay) to = startDay
  let from = addDays(to, -29)
  if (from < startDay) from = startDay
  return { from, to }
}

/** Baixa um Blob como arquivo (cria um link temporário). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
