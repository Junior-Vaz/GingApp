const DISPLAY_TIME_ZONE = 'America/Sao_Paulo'

/** Data e hora no fuso de São Paulo (determinístico, independe do fuso do navegador). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    timeZone: DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Só a data, no fuso de São Paulo. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { timeZone: DISPLAY_TIME_ZONE })
}

/** Centavos -> "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Inteiro com separador de milhar pt-BR. */
export function formatInt(value: number): string {
  return value.toLocaleString('pt-BR')
}

/** Rótulo em português do tipo de organização (valor da API inalterado: GROUP, SYSTEM). */
export function organizationTypeLabel(type: string): string {
  const labels: Record<string, string> = { GROUP: 'Grupo', SYSTEM: 'Sistema' }
  return labels[type] ?? type
}

/** Rótulo em português do status de uma organização/vínculo (valor da API inalterado). */
export function entityStatusLabel(status: string): string {
  const labels: Record<string, string> = { ACTIVE: 'Ativo', INACTIVE: 'Inativo' }
  return labels[status] ?? status
}
