import { describe, expect, it } from 'vitest'
import { ApiError } from '@/utils/api'
import {
  centsToReaisText,
  emptyEntryForm,
  entryPayload,
  entryServerErrors,
  financeErrorText,
  formatCents,
  formatCount,
  formatDay,
  isCategoryOfType,
  isMonthKey,
  isValidDay,
  monthLabel,
  monthShortLabel,
  normalizeMoneyText,
  parseReaisToCents,
  PUBLISH_WARNING,
  sanitizeMoneyInput,
  settingsPayload,
  settingsServerErrors,
  settingsToForm,
  validateEntryForm,
  validateSettingsForm,
  type EntryFormState,
} from '@/utils/finance'

describe('parseReaisToCents — reais digitados -> centavos inteiros', () => {
  it.each([
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['r$1.234,56', 123456],
    ['1234,56', 123456],
    ['0,05', 5],
    ['0,5', 50],
    [',50', 50],
    ['12,', 1200],
    ['12', 1200],
    ['0', 0],
    ['0,00', 0],
    ['1.000', 100000], // ponto é MILHAR em pt-BR: mil reais, não um real
    ['1.000.000', 100000000],
    ['1.000.000,01', 100000001],
    ['10.000.000,00', 1_000_000_000], // o teto do contrato
    ['  7,10  ', 710],
    ['007', 700],
  ])('%j -> %i', (text, cents) => {
    expect(parseReaisToCents(text)).toBe(cents)
  })

  it.each([
    [''],
    ['   '],
    [','],
    ['.'],
    ['abc'],
    ['12a'],
    ['1,234'], // 3 casas decimais
    ['1,2,3'], // duas vírgulas
    ['1.5'], // ponto fora do padrão de milhar (decimal "à americana")
    ['12.34'],
    ['1.23.456'],
    ['1..000'],
    ['1.'],
    ['-5'],
    ['-0,05'],
    ['R$'],
    ['1e3'],
    ['9999999999999999,99'], // além da precisão inteira segura
  ])('entrada inválida %j -> null (nunca 0 por engano)', (text) => {
    expect(parseReaisToCents(text)).toBeNull()
  })

  it('não usa float: valores que quebrariam parseFloat*100 saem exatos', () => {
    // 1.005 * 100 = 100.49999999999999 e 0.29 * 100 = 28.999999999999996 em ponto flutuante
    expect(parseReaisToCents('1,005')).toBeNull()
    expect(parseReaisToCents('0,29')).toBe(29)
    expect(parseReaisToCents('1,15')).toBe(115)
    expect(parseReaisToCents('4,35')).toBe(435)
    expect(parseReaisToCents('8,2')).toBe(820)
    expect(parseReaisToCents('19,99')).toBe(1999)
    expect(parseReaisToCents('9.007.199.254.740,91')).toBe(900719925474091) // 15 dígitos: ainda exato
    expect(parseReaisToCents('90.071.992.547.409,91')).toBeNull() // acima de qualquer valor aceito: recusa em vez de perder precisão
  })

  it('o resultado é sempre inteiro seguro', () => {
    for (const text of ['0,01', '1,1', '123,45', '99.999,99', '1.000.000.000,00']) {
      expect(Number.isSafeInteger(parseReaisToCents(text))).toBe(true)
    }
  })
})

describe('centsToReaisText / formatCents — centavos -> texto', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [50, '0,50'],
    [100, '1,00'],
    [99999, '999,99'],
    [100000, '1.000,00'],
    [123456, '1.234,56'],
    [123456789, '1.234.567,89'],
    [1_000_000_000, '10.000.000,00'],
    [-5, '-0,05'],
    [-123456, '-1.234,56'],
  ])('%i -> %j', (cents, text) => {
    expect(centsToReaisText(cents)).toBe(text)
  })

  it('formatCents põe o R$ e o sinal na frente; valor não inteiro vira traço', () => {
    expect(formatCents(123456)).toBe('R$ 1.234,56')
    expect(formatCents(5)).toBe('R$ 0,05')
    expect(formatCents(-123456)).toBe('-R$ 1.234,56')
    expect(formatCents(0)).toBe('R$ 0,00')
    expect(formatCents(10.5)).toBe('—')
    expect(formatCents(Number.NaN)).toBe('—')
  })

  it('ida e volta: texto -> centavos -> texto é estável', () => {
    for (const text of ['0,01', '0,05', '1,00', '999,99', '1.000,00', '12.345,67', '10.000.000,00']) {
      expect(centsToReaisText(parseReaisToCents(text) as number)).toBe(text)
    }
  })

  it('formatCount: milhar com ponto, sem Intl', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1200)).toBe('1.200')
    expect(formatCount(1234567)).toBe('1.234.567')
    expect(formatCount(1.5)).toBe('—')
  })
})

describe('máscara do campo de valor', () => {
  it('sanitizeMoneyInput tira tudo que não é dígito, ponto ou vírgula (inclusive o sinal negativo)', () => {
    expect(sanitizeMoneyInput('R$ 1.234,56')).toBe('1.234,56')
    expect(sanitizeMoneyInput('-12a,3b')).toBe('12,3')
    expect(sanitizeMoneyInput('abc')).toBe('')
  })

  it('normalizeMoneyText reescreve o válido no formato canônico e deixa o inválido como está', () => {
    expect(normalizeMoneyText('1.000')).toBe('1.000,00')
    expect(normalizeMoneyText('5')).toBe('5,00')
    expect(normalizeMoneyText('0,5')).toBe('0,50')
    expect(normalizeMoneyText('1234,5')).toBe('1.234,50')
    expect(normalizeMoneyText('1,234')).toBe('1,234')
    expect(normalizeMoneyText('')).toBe('')
  })
})

describe('mês por extenso, sem Date', () => {
  it('"2026-10" -> "outubro de 2026" nos 12 meses', () => {
    const names = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
    names.forEach((name, i) => expect(monthLabel(`2026-${String(i + 1).padStart(2, '0')}`)).toBe(`${name} de 2026`))
  })

  it('valor inválido volta como veio', () => {
    expect(monthLabel('2026-13')).toBe('2026-13')
    expect(monthLabel('2026-00')).toBe('2026-00')
    expect(monthLabel('abc')).toBe('abc')
    expect(monthLabel('')).toBe('')
  })

  it('independe do fuso/Date: nem toca em Date', () => {
    const RealDate = globalThis.Date
    // qualquer `new Date(...)`/`Date(...)` durante o bloco é falha do teste
    globalThis.Date = new Proxy(RealDate, {
      construct() {
        throw new Error('Date usado')
      },
      apply() {
        throw new Error('Date usado')
      },
    })
    try {
      expect(monthLabel('2026-10')).toBe('outubro de 2026')
      expect(monthShortLabel('2026-10')).toBe('out/2026')
      expect(isValidDay('2026-02-29')).toBe(false)
      expect(formatDay('2026-10-05')).toBe('05/10/2026')
    } finally {
      globalThis.Date = RealDate
    }
  })

  it('isMonthKey / isValidDay / formatDay', () => {
    expect(isMonthKey('2026-10')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-1')).toBe(false)
    expect(isValidDay('2026-10-31')).toBe(true)
    expect(isValidDay('2026-11-31')).toBe(false)
    expect(isValidDay('2024-02-29')).toBe(true)
    expect(isValidDay('2100-02-29')).toBe(false)
    expect(isValidDay('2000-02-29')).toBe(true)
    expect(isValidDay('')).toBe(false)
    expect(formatDay('2026-10-05')).toBe('05/10/2026')
    expect(formatDay('lixo')).toBe('lixo')
  })
})

describe('categorias por tipo (contrato §2.1)', () => {
  it('par tipo×categoria', () => {
    expect(isCategoryOfType('DESPESA', 'HOSPEDAGEM')).toBe(true)
    expect(isCategoryOfType('RECEITA', 'PATROCINIO')).toBe(true)
    expect(isCategoryOfType('RECEITA', 'HOSPEDAGEM')).toBe(false)
    expect(isCategoryOfType('DESPESA', 'APOIO')).toBe(false)
    expect(isCategoryOfType('OUTRO', 'APOIO')).toBe(false)
  })
})

const goodForm = (over: Partial<EntryFormState> = {}): EntryFormState => ({
  type: 'DESPESA',
  category: 'HOSPEDAGEM',
  amount: '1.500,00',
  occurredOn: '2026-10-05',
  description: 'Servidor',
  ...over,
})

describe('validateEntryForm', () => {
  it('lançamento válido não tem erro', () => {
    expect(validateEntryForm(goodForm(), '2026-11')).toEqual({})
  })

  it('exige categoria e recusa par inválido', () => {
    expect(validateEntryForm(goodForm({ category: '' }), '2026-11').category).toContain('categoria')
    expect(validateEntryForm(goodForm({ type: 'RECEITA' }), '2026-11').category).toContain('não existe para esse tipo')
  })

  it('valor: vazio, inválido, zero e acima do teto', () => {
    expect(validateEntryForm(goodForm({ amount: '' }), '2026-11').amount).toContain('Informe o valor')
    expect(validateEntryForm(goodForm({ amount: '1,234' }), '2026-11').amount).toContain('Valor inválido')
    expect(validateEntryForm(goodForm({ amount: '0,00' }), '2026-11').amount).toContain('maior que zero')
    expect(validateEntryForm(goodForm({ amount: '0,01' }), '2026-11').amount).toBeUndefined()
    expect(validateEntryForm(goodForm({ amount: '10.000.000,00' }), '2026-11').amount).toBeUndefined()
    expect(validateEntryForm(goodForm({ amount: '10.000.000,01' }), '2026-11').amount).toContain('valor máximo é R$ 10.000.000,00')
  })

  it('data: inválida e futura além do fim do mês corrente; o mês corrente inteiro vale', () => {
    expect(validateEntryForm(goodForm({ occurredOn: '' }), '2026-11').occurredOn).toContain('data válida')
    expect(validateEntryForm(goodForm({ occurredOn: '2026-02-30' }), '2026-11').occurredOn).toContain('data válida')
    expect(validateEntryForm(goodForm({ occurredOn: '2026-12-01' }), '2026-11').occurredOn).toContain('depois do fim do mês atual')
    expect(validateEntryForm(goodForm({ occurredOn: '2026-11-30' }), '2026-11').occurredOn).toBeUndefined()
    expect(validateEntryForm(goodForm({ occurredOn: '2020-01-01' }), '2026-11').occurredOn).toBeUndefined()
  })

  it('descrição: obrigatória e até 300 (conta sem espaços nas pontas)', () => {
    expect(validateEntryForm(goodForm({ description: '   ' }), '2026-11').description).toContain('Descreva')
    expect(validateEntryForm(goodForm({ description: 'x'.repeat(300) }), '2026-11').description).toBeUndefined()
    expect(validateEntryForm(goodForm({ description: 'x'.repeat(301) }), '2026-11').description).toContain('300')
    expect(validateEntryForm(goodForm({ description: `  ${'x'.repeat(300)}  ` }), '2026-11').description).toBeUndefined()
  })
})

describe('entryPayload / settingsPayload — formato do corpo do contrato', () => {
  it('lançamento: amountCents inteiro, descrição aparada, só os 5 campos do contrato', () => {
    const body = entryPayload(goodForm({ amount: '1.234,56', description: '  Servidor  ' }))
    expect(body).toEqual({ type: 'DESPESA', category: 'HOSPEDAGEM', amountCents: 123456, occurredOn: '2026-10-05', description: 'Servidor' })
    expect(Number.isInteger(body.amountCents)).toBe(true)
  })

  it('formulário vazio de lançamento usa a data de hoje informada', () => {
    expect(emptyEntryForm('2026-11-05')).toMatchObject({ type: 'DESPESA', category: '', amount: '', occurredOn: '2026-11-05', description: '' })
  })

  it('configurações: centavos inteiros e texto vazio vira null', () => {
    const form = { monthlyGoal: '3.000,00', openingReserve: '0,00', entityName: '  ', introText: ' Olá ', surplusText: '' }
    expect(validateSettingsForm(form)).toEqual({})
    expect(settingsPayload(form)).toEqual({ monthlyGoalCents: 300000, openingReserveCents: 0, entityName: null, introText: 'Olá', surplusText: null })
  })

  it('configurações: ida e volta do formulário', () => {
    const form = settingsToForm({ monthlyGoalCents: 300000, openingReserveCents: 123400, entityName: null, introText: 'a', surplusText: null })
    expect(form).toEqual({ monthlyGoal: '3.000,00', openingReserve: '1.234,00', entityName: '', introText: 'a', surplusText: '' })
  })

  it('configurações: validação de valores (nunca negativo, teto) e limites de texto', () => {
    const base = { monthlyGoal: '0,00', openingReserve: '0,00', entityName: '', introText: '', surplusText: '' }
    expect(validateSettingsForm({ ...base, monthlyGoal: '' }).monthlyGoal).toContain('Informe a meta mensal')
    expect(validateSettingsForm({ ...base, openingReserve: '-1' }).openingReserve).toContain('Valor inválido')
    expect(validateSettingsForm({ ...base, monthlyGoal: '10.000.000,01' }).monthlyGoal).toContain('valor máximo')
    expect(validateSettingsForm({ ...base, entityName: 'x'.repeat(121) }).entityName).toContain('120')
    expect(validateSettingsForm({ ...base, introText: 'x'.repeat(601) }).introText).toContain('600')
    expect(validateSettingsForm({ ...base, surplusText: 'x'.repeat(601) }).surplusText).toContain('600')
    expect(validateSettingsForm({ ...base, introText: 'x'.repeat(600), entityName: 'x'.repeat(120) })).toEqual({})
  })
})

describe('erros do servidor', () => {
  const err = (status: number, body: Record<string, unknown>) => new ApiError(String(body.message ?? 'erro'), status, body)

  it('409 MONTH_PUBLISHED ao salvar/excluir: manda despublicar o mês', () => {
    for (const ctx of ['entry', 'delete'] as const) {
      const text = financeErrorText(err(409, { statusCode: 409, code: 'MONTH_PUBLISHED', message: 'x' }), ctx)
      expect(text).toContain('publicado e travado')
      expect(text).toContain('Despublique')
    }
  })

  it('MONTH_PUBLISHED ao publicar = "já está publicado"', () => {
    expect(financeErrorText(err(409, { code: 'MONTH_PUBLISHED', message: 'x' }), 'publish')).toBe('Este mês já está publicado.')
  })

  it('409 sem code ao publicar (publicação dupla/concorrente) também diz "já publicado"', () => {
    expect(financeErrorText(err(409, { message: 'Conflict' }), 'publish')).toContain('já está publicado')
  })

  it('400 MONTH_NOT_CLOSED e MONTH_EMPTY: mensagens claras', () => {
    expect(financeErrorText(err(400, { code: 'MONTH_NOT_CLOSED', message: 'x' }), 'publish')).toContain('mês já encerrado')
    expect(financeErrorText(err(400, { code: 'MONTH_EMPTY', message: 'x' }), 'publish')).toContain('nenhum lançamento')
  })

  it('403 = só super admin; 404 ao excluir = lançamento sumiu; outros usam a mensagem do servidor; não-ApiError usa o texto padrão', () => {
    expect(financeErrorText(err(403, { message: 'Forbidden' }), 'entry')).toContain('super admin')
    expect(financeErrorText(err(404, { message: 'Not Found' }), 'delete')).toContain('não existe mais')
    expect(financeErrorText(err(500, { message: 'Falha no servidor.' }), 'entry')).toBe('Falha no servidor.')
    expect(financeErrorText(new Error('boom'), 'entry')).toBe('Não foi possível salvar o lançamento.')
    expect(financeErrorText(new Error('boom'), 'publish')).toBe('Não foi possível publicar o mês.')
    expect(financeErrorText(new Error('boom'), 'unpublish')).toBe('Não foi possível despublicar o mês.')
    expect(financeErrorText(new Error('boom'), 'settings')).toBe('Não foi possível salvar as configurações.')
  })

  it('400 de validação do servidor: campo do corpo (amountCents) vira o campo da tela (amount)', () => {
    const e = err(400, { message: ['amountCents must not be greater than 1000000000', 'category must be one of the following values'] })
    const parsed = entryServerErrors(e)
    expect(parsed.fields.amount).toContain('amountCents')
    expect(parsed.fields.category).toContain('category')
    expect(parsed.general).toEqual([])
    const s = settingsServerErrors(err(400, { message: ['monthlyGoalCents must be a positive number'] }))
    expect(s.fields.monthlyGoal).toContain('monthlyGoalCents')
  })

  it('aviso de publicação diz que fica público e que o mês trava', () => {
    expect(PUBLISH_WARNING.public).toContain('PÚBLICOS')
    expect(PUBLISH_WARNING.locked).toContain('TRAVA')
  })
})
