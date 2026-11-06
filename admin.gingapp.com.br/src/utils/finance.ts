/**
 * Financeiro / Transparência (Frente B, fase 1): tipos, categorias, máscara de reais<->centavos, validações e
 * mensagens do contrato (docs/CONTRATO_TRANSPARENCIA.md §2, §3, §5).
 *
 * REGRAS: valores são sempre CENTAVOS INTEIROS (nada de float: a conversão é por texto/inteiros), e o mês
 * ("2026-10") é escrito por extenso por cálculo de string, sem `new Date` (independe de fuso do aparelho).
 * O servidor continua sendo a validação de verdade; aqui só se evita ir à rede à toa e se dá a mensagem ao vivo.
 */
import { ApiError } from '@/utils/api'
import { serverFieldErrors } from '@/utils/sponsors'

// ---------------------------------------------------------------- limites do contrato (§2)

export const FINANCE_LIMITS = {
  /** `amountCents` de um lançamento: 1..1_000_000_000. */
  amountMinCents: 1,
  amountMaxCents: 1_000_000_000,
  descriptionMin: 1,
  descriptionMax: 300,
  /** Configurações: meta e reserva 0..1_000_000_000. */
  settingMaxCents: 1_000_000_000,
  noteMax: 500,
  entityNameMax: 120,
  introTextMax: 600,
  surplusTextMax: 600,
} as const

// ---------------------------------------------------------------- tipos e categorias (§2.1)

export type LedgerType = 'RECEITA' | 'DESPESA'

export const LEDGER_TYPES: ReadonlyArray<{ value: LedgerType; label: string }> = [
  { value: 'RECEITA', label: 'Receita (entrada)' },
  { value: 'DESPESA', label: 'Despesa (saída)' },
]

export function ledgerTypeLabel(type: string): string {
  return type === 'RECEITA' ? 'Receita' : type === 'DESPESA' ? 'Despesa' : type
}

export interface CategoryOption {
  value: string
  label: string
}

/**
 * Lista fechada de categorias por tipo. O contrato diz que os rótulos em português são do servidor (SSOT) e vão
 * nas respostas (`categoryLabel`, `{category,label,cents}`); esta lista só serve para montar o <select> do formulário
 * e o filtro (o servidor valida o par tipo×categoria). Na tela, o rótulo mostrado é sempre o que o servidor mandou.
 */
export const CATEGORIES_BY_TYPE: Record<LedgerType, ReadonlyArray<CategoryOption>> = {
  DESPESA: [
    { value: 'HOSPEDAGEM', label: 'Hospedagem e servidores' },
    { value: 'MAPAS', label: 'Mapas' },
    { value: 'ARMAZENAMENTO_BACKUP', label: 'Armazenamento e backup' },
    { value: 'NOTIFICACOES', label: 'Notificações' },
    { value: 'EMAIL', label: 'E-mail' },
    { value: 'DOMINIO', label: 'Domínio' },
    { value: 'FERRAMENTAS', label: 'Ferramentas' },
    { value: 'PESSOAS_SUPORTE', label: 'Pessoas e suporte' },
    { value: 'IMPOSTOS_TARIFAS', label: 'Impostos e tarifas' },
    { value: 'OUTROS_DESPESA', label: 'Outras despesas' },
  ],
  RECEITA: [
    { value: 'APOIO', label: 'Apoio de usuários' },
    { value: 'PATROCINIO', label: 'Patrocínios' },
    { value: 'EDITAIS_OUTROS', label: 'Editais e outras receitas' },
  ],
}

export const ALL_CATEGORIES: ReadonlyArray<CategoryOption & { type: LedgerType }> = [
  ...CATEGORIES_BY_TYPE.DESPESA.map((c) => ({ ...c, type: 'DESPESA' as const })),
  ...CATEGORIES_BY_TYPE.RECEITA.map((c) => ({ ...c, type: 'RECEITA' as const })),
]

export function isCategoryOfType(type: string, category: string): boolean {
  const list = CATEGORIES_BY_TYPE[type as LedgerType]
  return !!list && list.some((c) => c.value === category)
}

// ---------------------------------------------------------------- formatos de resposta (§3, §4)

export interface CategoryTotal {
  category: string
  label: string
  cents: number
}

export interface LedgerEntry {
  id: number
  type: LedgerType
  category: string
  categoryLabel: string
  amountCents: number
  /** "YYYY-MM-DD". */
  occurredOn: string
  /** "YYYY-MM". */
  month: string
  /** Texto PRIVADO do admin (nunca vai ao público). */
  description: string
  /** Mês publicado: o lançamento está travado. */
  locked: boolean
  createdAt: string
}

export interface MonthSnapshot {
  activeStudents: number
  activeGroups: number
  goalCents: number
}

export interface FinanceMonth {
  month: string
  published: boolean
  publishedAt: string | null
  note: string | null
  revenueCents: number
  expenseCents: number
  balanceCents: number
  entries: number
  expensesByCategory: CategoryTotal[]
  revenueByCategory: CategoryTotal[]
  liveActiveStudents: number | null
  liveActiveGroups: number | null
  snapshot: MonthSnapshot | null
}

export interface FinanceSettings {
  monthlyGoalCents: number
  openingReserveCents: number
  entityName: string | null
  introText: string | null
  surplusText: string | null
  updatedAt?: string | null
}

/** Mês de `GET /transparency` (e de `/platform-finance/preview`, que devolve o mesmo corpo). */
export interface PublicMonth {
  month: string
  publishedAt: string
  note: string | null
  revenueCents: number
  expenseCents: number
  balanceCents: number
  revenueBySource: CategoryTotal[]
  expensesByCategory: CategoryTotal[]
  activeStudents: number
  activeGroups: number
  costPerActiveStudentCents: number | null
  goalCents: number
  goalCoveragePct: number | null
}

export interface TransparencyBody {
  generatedAt: string
  entityName: string | null
  introText: string | null
  surplusText: string | null
  monthlyGoalCents: number
  reserveCents: number
  months: PublicMonth[]
}

// ---------------------------------------------------------------- centavos <-> reais (sem float)

const GROUPED_REAIS = /^\d{1,3}(\.\d{3})+$/

function groupThousands(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.'
    out += digits[i]
  }
  return out
}

/**
 * Centavos inteiros -> "1.234,56" (sem "R$"; é o que vai no campo de digitação). Negativo vira "-1.234,56".
 * Aritmética inteira e texto: nenhum float envolvido. Valor que não é inteiro seguro devolve ''.
 */
export function centsToReaisText(cents: number): string {
  if (!Number.isSafeInteger(cents)) return ''
  const negative = cents < 0
  const abs = Math.abs(cents)
  const reais = Math.trunc(abs / 100)
  const rest = abs - reais * 100
  const body = `${groupThousands(String(reais))},${String(rest).padStart(2, '0')}`
  return negative ? `-${body}` : body
}

/** Centavos -> "R$ 1.234,56" (e "-R$ 1.234,56" para negativo). Espaço comum, não NBSP: texto estável em teste. */
export function formatCents(cents: number): string {
  const text = centsToReaisText(cents)
  if (text === '') return '—'
  return text.startsWith('-') ? `-R$ ${text.slice(1)}` : `R$ ${text}`
}

/** Inteiro com ponto de milhar pt-BR ("1.200"), sem depender de Intl. */
export function formatCount(value: number): string {
  if (!Number.isSafeInteger(value)) return '—'
  const text = groupThousands(String(Math.abs(value)))
  return value < 0 ? `-${text}` : text
}

/**
 * Texto digitado em reais -> centavos inteiros. `null` = entrada inválida (nunca "0" por engano).
 *
 * Aceita: "1234", "1.234", "1.234,56", "1234,5" (= 1234,50), "0,05", ",50", "R$ 12,00", "12,".
 * Rejeita: vazio, negativo, letras, mais de 2 casas decimais ("1,234"), mais de uma vírgula, e ponto fora do
 * padrão de milhar ("1.5", "12.34", "1.23.456") — em pt-BR o ponto é milhar, nunca decimal. Só dígitos e texto:
 * não passa por `parseFloat`, então não há erro de arredondamento. Não limita ao teto do contrato (isso é validação).
 */
export function parseReaisToCents(input: string): number | null {
  let text = input.replace(/R\$/gi, '').replace(/\s+/g, '')
  if (text === '' || text === ',' || text === '.') return null
  if (!/^[\d.,]+$/.test(text)) return null
  const commaParts = text.split(',')
  if (commaParts.length > 2) return null
  const intPartRaw = commaParts[0]!
  const fracRaw = commaParts[1] ?? ''
  if (fracRaw.length > 2) return null
  let intPart = intPartRaw
  if (intPart.includes('.')) {
    if (!GROUPED_REAIS.test(intPart)) return null
    intPart = intPart.replace(/\./g, '')
  }
  if (intPart === '' && fracRaw === '') return null
  if (intPart.length > 13) return null // acima de qualquer valor aceito; evita perder precisão inteira
  text = `${intPart === '' ? '0' : intPart}${fracRaw.padEnd(2, '0')}`
  const cents = Number(text)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Remove do que foi digitado tudo que não faz parte de um valor em reais (letras, símbolos, sinal negativo). */
export function sanitizeMoneyInput(input: string): string {
  return input.replace(/[^\d.,]/g, '')
}

/** Ao sair do campo: reescreve o valor válido no formato canônico ("1.000" -> "1.000,00"); inválido fica como está. */
export function normalizeMoneyText(input: string): string {
  const cents = parseReaisToCents(input)
  return cents === null ? input : centsToReaisText(cents)
}

// ---------------------------------------------------------------- meses ("YYYY-MM") sem Date

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const

const MONTH_RE = /^(\d{4})-(\d{2})$/
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isMonthKey(value: string): boolean {
  const m = MONTH_RE.exec(value)
  if (!m) return false
  const month = Number(m[2])
  return month >= 1 && month <= 12
}

/** "2026-10" -> "outubro de 2026". Valor inválido volta como veio. SEM `new Date` (por cálculo). */
export function monthLabel(month: string): string {
  const m = MONTH_RE.exec(month)
  if (!m) return month
  const index = Number(m[2]) - 1
  const name = MONTH_NAMES[index]
  return name ? `${name} de ${m[1]}` : month
}

/** "2026-10" -> "out/2026" (rótulo curto para tabelas estreitas). */
export function monthShortLabel(month: string): string {
  const m = MONTH_RE.exec(month)
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined
  return m && name ? `${name.slice(0, 3)}/${m[1]}` : month
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Data de calendário real "YYYY-MM-DD" (rejeita 2026-02-30). Por cálculo, sem `new Date`. */
export function isValidDay(value: string): boolean {
  const m = DAY_RE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** "2026-10-05" -> "05/10/2026". */
export function formatDay(value: string): string {
  const m = DAY_RE.exec(value)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

/** "YYYY-MM-DD" -> "YYYY-MM". */
export function monthOfDay(day: string): string {
  return day.slice(0, 7)
}

// ---------------------------------------------------------------- mensagens

/** Aviso mostrado ao publicar um mês (diálogo de confirmação). */
export const PUBLISH_WARNING = {
  title: 'Publicar este mês?',
  public: 'Ao publicar, os números do mês ficam PÚBLICOS na página de transparência (totais por categoria, sem os textos dos lançamentos).',
  locked: 'O mês também TRAVA: não será mais possível criar, editar ou excluir lançamentos dele, a não ser despublicando antes.',
  snapshot: 'Neste momento também ficam gravados o número de alunos e grupos ativos e a meta do mês; eles não mudam depois.',
} as const

export const LOCKED_HINT = 'Mês publicado: o lançamento está travado. Despublique o mês (aba Meses) para poder alterar.'

export const UNPUBLISH_WARNING =
  'O mês deixa de aparecer na página pública e volta a aceitar lançamentos. Os números públicos mudam enquanto você edita; publique de novo quando terminar.'

export const WRITE_ONLY_SUPER_HINT = 'Só o super admin pode lançar, publicar ou alterar a configuração. Você pode consultar tudo.'

export type FinanceErrorContext = 'publish' | 'unpublish' | 'entry' | 'delete' | 'settings' | 'load'

const ERROR_FALLBACKS: Record<FinanceErrorContext, string> = {
  publish: 'Não foi possível publicar o mês.',
  unpublish: 'Não foi possível despublicar o mês.',
  entry: 'Não foi possível salvar o lançamento.',
  delete: 'Não foi possível excluir o lançamento.',
  settings: 'Não foi possível salvar as configurações.',
  load: 'Não foi possível carregar os dados financeiros.',
}

/** Mensagem em português para um erro das rotas de `/platform-finance` (409 com `code` do contrato -> texto claro). */
export function financeErrorText(error: unknown, context: FinanceErrorContext): string {
  if (error instanceof ApiError) {
    if (error.code === 'MONTH_PUBLISHED') {
      return context === 'publish'
        ? 'Este mês já está publicado.'
        : 'Este mês está publicado e travado: não dá para criar, editar ou excluir lançamentos dele. Despublique o mês (aba Meses) e tente de novo.'
    }
    if (error.code === 'MONTH_NOT_CLOSED') {
      return 'Só dá para publicar um mês já encerrado. Espere o mês virar (o mês corrente ainda está aberto).'
    }
    if (error.code === 'MONTH_EMPTY') {
      return 'Este mês não tem nenhum lançamento. Lance ao menos uma receita ou despesa antes de publicar.'
    }
    if (error.status === 409 && context === 'publish') return 'Este mês já está publicado (talvez outra pessoa tenha acabado de publicar).'
    if (error.status === 403) return 'Só o super admin pode fazer essa alteração.'
    if (error.status === 404) {
      return context === 'delete' || context === 'entry' ? 'Esse lançamento não existe mais (outra pessoa pode tê-lo excluído). Atualize a lista.' : error.message
    }
    return error.message || ERROR_FALLBACKS[context]
  }
  return ERROR_FALLBACKS[context]
}

// ---------------------------------------------------------------- formulário de lançamento

export interface EntryFormState {
  type: LedgerType
  category: string
  /** Valor digitado em reais ("1.234,56"). */
  amount: string
  /** "YYYY-MM-DD". */
  occurredOn: string
  description: string
}

export type EntryFieldErrors = Partial<Record<keyof EntryFormState, string>>

export function emptyEntryForm(today: string): EntryFormState {
  return { type: 'DESPESA', category: '', amount: '', occurredOn: today, description: '' }
}

export function entryToForm(entry: LedgerEntry): EntryFormState {
  return {
    type: entry.type,
    category: entry.category,
    amount: centsToReaisText(entry.amountCents),
    occurredOn: entry.occurredOn,
    description: entry.description,
  }
}

/** `currentMonth` = "YYYY-MM" do mês corrente (America/Sao_Paulo); data além do fim dele é recusada (contrato §3). */
export function validateEntryForm(form: EntryFormState, currentMonth: string): EntryFieldErrors {
  const errors: EntryFieldErrors = {}
  if (form.type !== 'RECEITA' && form.type !== 'DESPESA') errors.type = 'Escolha receita ou despesa.'
  if (!form.category) errors.category = 'Escolha a categoria.'
  else if (!isCategoryOfType(form.type, form.category)) errors.category = 'Essa categoria não existe para esse tipo. Escolha outra.'

  const cents = parseReaisToCents(form.amount)
  if (form.amount.trim() === '') errors.amount = 'Informe o valor em reais.'
  else if (cents === null) errors.amount = 'Valor inválido. Use o formato 1.234,56 (vírgula nos centavos, no máximo 2 casas).'
  else if (cents < FINANCE_LIMITS.amountMinCents) errors.amount = 'O valor precisa ser maior que zero.'
  else if (cents > FINANCE_LIMITS.amountMaxCents) errors.amount = `O valor máximo é ${formatCents(FINANCE_LIMITS.amountMaxCents)}.`

  if (!isValidDay(form.occurredOn)) errors.occurredOn = 'Informe uma data válida.'
  else if (isMonthKey(currentMonth) && monthOfDay(form.occurredOn) > currentMonth) errors.occurredOn = 'A data não pode ser depois do fim do mês atual.'

  const description = form.description.trim()
  if (description.length < FINANCE_LIMITS.descriptionMin) errors.description = 'Descreva o lançamento (só a equipe vê este texto).'
  else if (description.length > FINANCE_LIMITS.descriptionMax) errors.description = `No máximo ${FINANCE_LIMITS.descriptionMax} caracteres.`
  return errors
}

export interface EntryPayload {
  type: LedgerType
  category: string
  amountCents: number
  occurredOn: string
  description: string
}

/** Corpo de POST/PATCH (já validado). Valor em CENTAVOS INTEIROS. */
export function entryPayload(form: EntryFormState): EntryPayload {
  return {
    type: form.type,
    category: form.category,
    amountCents: parseReaisToCents(form.amount) ?? 0,
    occurredOn: form.occurredOn,
    description: form.description.trim(),
  }
}

const ENTRY_FIELDS = ['type', 'category', 'amountCents', 'occurredOn', 'description'] as const

/** 400 do servidor -> erros por campo (o campo do valor no servidor é `amountCents`, na tela é `amount`) + gerais. */
export function entryServerErrors(error: unknown): { fields: EntryFieldErrors; general: string[] } {
  const server = serverFieldErrors(error, ENTRY_FIELDS)
  const fields: EntryFieldErrors = {}
  for (const [key, message] of Object.entries(server.fields)) {
    fields[(key === 'amountCents' ? 'amount' : key) as keyof EntryFormState] = message
  }
  return { fields, general: server.general }
}

// ---------------------------------------------------------------- formulário de configurações

export interface SettingsFormState {
  monthlyGoal: string
  openingReserve: string
  entityName: string
  introText: string
  surplusText: string
}

export type SettingsFieldErrors = Partial<Record<keyof SettingsFormState, string>>

export function settingsToForm(settings: FinanceSettings): SettingsFormState {
  return {
    monthlyGoal: centsToReaisText(settings.monthlyGoalCents),
    openingReserve: centsToReaisText(settings.openingReserveCents),
    entityName: settings.entityName ?? '',
    introText: settings.introText ?? '',
    surplusText: settings.surplusText ?? '',
  }
}

function validateMoneySetting(text: string, label: string): string | undefined {
  const cents = parseReaisToCents(text)
  if (text.trim() === '') return `Informe ${label} (use 0,00 se não houver).`
  if (cents === null) return 'Valor inválido. Use o formato 1.234,56 (vírgula nos centavos, no máximo 2 casas).'
  if (cents > FINANCE_LIMITS.settingMaxCents) return `O valor máximo é ${formatCents(FINANCE_LIMITS.settingMaxCents)}.`
  return undefined
}

export function validateSettingsForm(form: SettingsFormState): SettingsFieldErrors {
  const errors: SettingsFieldErrors = {}
  const goal = validateMoneySetting(form.monthlyGoal, 'a meta mensal')
  if (goal) errors.monthlyGoal = goal
  const reserve = validateMoneySetting(form.openingReserve, 'a reserva inicial')
  if (reserve) errors.openingReserve = reserve
  if (form.entityName.trim().length > FINANCE_LIMITS.entityNameMax) errors.entityName = `No máximo ${FINANCE_LIMITS.entityNameMax} caracteres.`
  if (form.introText.trim().length > FINANCE_LIMITS.introTextMax) errors.introText = `No máximo ${FINANCE_LIMITS.introTextMax} caracteres.`
  if (form.surplusText.trim().length > FINANCE_LIMITS.surplusTextMax) errors.surplusText = `No máximo ${FINANCE_LIMITS.surplusTextMax} caracteres.`
  return errors
}

export interface SettingsPayload {
  monthlyGoalCents: number
  openingReserveCents: number
  entityName: string | null
  introText: string | null
  surplusText: string | null
}

/** Corpo do PUT (já validado). Texto vazio vai como `null` (contrato §3). */
export function settingsPayload(form: SettingsFormState): SettingsPayload {
  const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())
  return {
    monthlyGoalCents: parseReaisToCents(form.monthlyGoal) ?? 0,
    openingReserveCents: parseReaisToCents(form.openingReserve) ?? 0,
    entityName: orNull(form.entityName),
    introText: orNull(form.introText),
    surplusText: orNull(form.surplusText),
  }
}

const SETTINGS_FIELDS = ['monthlyGoalCents', 'openingReserveCents', 'entityName', 'introText', 'surplusText'] as const

export function settingsServerErrors(error: unknown): { fields: SettingsFieldErrors; general: string[] } {
  const server = serverFieldErrors(error, SETTINGS_FIELDS)
  const fields: SettingsFieldErrors = {}
  const rename: Record<string, keyof SettingsFormState> = { monthlyGoalCents: 'monthlyGoal', openingReserveCents: 'openingReserve' }
  for (const [key, message] of Object.entries(server.fields)) {
    fields[rename[key] ?? (key as keyof SettingsFormState)] = message
  }
  return { fields, general: server.general }
}

// ---------------------------------------------------------------- publicação

/** Observação pública do mês: vazia vira ausente. */
export function validateNote(note: string): string | null {
  return note.trim().length > FINANCE_LIMITS.noteMax ? `No máximo ${FINANCE_LIMITS.noteMax} caracteres.` : null
}

/** Texto de "situação" do mês para a tabela. */
export function monthStatusLabel(month: Pick<FinanceMonth, 'published'>): string {
  return month.published ? 'Publicado' : 'Não publicado'
}
