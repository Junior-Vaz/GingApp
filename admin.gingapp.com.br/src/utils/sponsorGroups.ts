/**
 * Patrocínio local dos GRUPOS visto pela PLATAFORMA (docs/CONTRATO_PATROCINADORES_GRUPO.md §4 e §7): tipos, textos e
 * validações da supervisão (suspender campanha, bloquear grupo). O conteúdo é do Mestre: aqui tudo é SOMENTE LEITURA,
 * exceto suspender/levantar e bloquear/liberar. Contato, documento, observações, preço e nota de cobrança do Mestre são
 * privados do grupo e NUNCA são exibidos (mesmo que a resposta os traga).
 */
import { ApiError } from '@/utils/api'
import type { SponsorCampaign } from '@/utils/sponsors'

// ---------------------------------------------------------------- modelos de resposta (formato do contrato §4)

/** Linha de `GET /platform-sponsor-groups`. */
export interface SponsorGroupRow {
  organizationId: number
  name: string
  sponsors: number
  campaigns: number
  activeNow: number
  blocked: boolean
  termsAcceptedAt: string | null

  // O contrato não lista quem/quando/por que bloqueou: aceitamos estes nomes quando o backend mandar.
  blockedAt?: string | null
  blockedReason?: string | null
  blockedBy?: { id: number; name: string } | null
  blockedByName?: string | null
  blockedByUserId?: number | null
  /** Nomes das colunas de `Organization` (contrato §1), caso o backend as devolva como estão. */
  sponsorsBlockedAt?: string | null
  sponsorsBlockedReason?: string | null
}

/** Patrocinador de um grupo, SÓ o que a supervisão enxerga (nome e logo). */
export interface GroupSponsorView {
  id: number
  name: string
  logo: string | null
}

// ---------------------------------------------------------------- motivo (suspensão 3..300, contrato §4; bloqueio: mesmo teto, ver relatório)

export const REASON_LIMITS = { min: 3, max: 300 } as const

/** Mensagem em português para um motivo inválido; '' = válido. */
export function reasonError(value: string): string {
  const length = value.trim().length
  if (length === 0) return 'Informe o motivo.'
  if (length < REASON_LIMITS.min) return `O motivo deve ter pelo menos ${REASON_LIMITS.min} caracteres.`
  if (length > REASON_LIMITS.max) return `O motivo pode ter no máximo ${REASON_LIMITS.max} caracteres.`
  return ''
}

// ---------------------------------------------------------------- quem fez / quando / por quê

function actor(by: { name?: string } | null | undefined, byName: string | null | undefined, byUserId: number | null | undefined): string {
  return by?.name || byName || (byUserId != null ? `usuário #${byUserId}` : '')
}

export function isCampaignSuspended(c: Pick<SponsorCampaign, 'platformSuspended' | 'platformSuspendedAt'>): boolean {
  return c.platformSuspended === true || Boolean(c.platformSuspendedAt)
}

/** "Suspensa por Ana em 02/11/2026, 10:00" (cada parte só se a resposta trouxer). Sempre começa por "Suspensa pela plataforma". */
export function suspensionText(c: SponsorCampaign, formatDateTime: (v: string) => string): string {
  const who = actor(c.platformSuspendedBy, c.platformSuspendedByName, c.platformSuspendedByUserId)
  let text = 'Suspensa pela plataforma'
  if (who) text += ` por ${who}`
  if (c.platformSuspendedAt) text += ` em ${formatDateTime(c.platformSuspendedAt)}`
  return text
}

export function blockedReasonOf(g: SponsorGroupRow): string {
  return g.blockedReason ?? g.sponsorsBlockedReason ?? ''
}

/** "Bloqueado por Ana em 02/11/2026, 10:00" (partes só se vierem). */
export function blockText(g: SponsorGroupRow, formatDateTime: (v: string) => string): string {
  const who = actor(g.blockedBy, g.blockedByName, g.blockedByUserId)
  const at = g.blockedAt ?? g.sponsorsBlockedAt ?? null
  let text = 'Bloqueado pela plataforma'
  if (who) text += ` por ${who}`
  if (at) text += ` em ${formatDateTime(at)}`
  return text
}

// ---------------------------------------------------------------- busca local (sem acento, sem caixa)

export function normalizeSearch(value: string): string {
  const accents = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')
  return value.normalize('NFD').replace(accents, '').toLowerCase().trim()
}

export function filterGroups(groups: readonly SponsorGroupRow[], query: string): SponsorGroupRow[] {
  const q = normalizeSearch(query)
  return q ? groups.filter((g) => normalizeSearch(g.name).includes(q)) : [...groups]
}

// ---------------------------------------------------------------- erros do servidor

/** Mensagens-padrão em inglês do Nest: não servem para o usuário, trocamos por texto claro. */
const GENERIC_SERVER_MESSAGES = new Set(['forbidden', 'forbidden resource', 'not found', 'bad request', 'unauthorized', 'conflict'])

function isGeneric(message: string): boolean {
  const text = message.trim().toLowerCase()
  return !text || GENERIC_SERVER_MESSAGES.has(text) || /^erro na requisi[cç][aã]o \(\d+\)\.?$/.test(text)
}

/**
 * Texto claro para os erros 403/404/400 das ações e leituras de supervisão. A mensagem do servidor (em português) vence;
 * sem ela (ou com a frase padrão em inglês do Nest) usamos um texto nosso. Erro de rede cai no `fallback`.
 */
export function supervisionError(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback
  if (e.status === 403) {
    return isGeneric(e.message) ? 'Você não tem permissão para esta ação. Levantar suspensão e bloquear ou liberar grupos é só do super admin.' : e.message
  }
  if (e.status === 404) {
    return isGeneric(e.message) ? 'Não encontrado: a campanha ou o grupo não existe mais ou não é de patrocínio local. Atualize a tela.' : e.message
  }
  if (e.status === 400) {
    return isGeneric(e.message) ? 'Os dados enviados não foram aceitos. Confira o motivo informado e tente de novo.' : e.message
  }
  return isGeneric(e.message) ? fallback : e.message
}
