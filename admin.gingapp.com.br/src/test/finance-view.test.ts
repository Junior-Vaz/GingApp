import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FinanceView from '@/views/FinanceView.vue'
import { entry, month, preview, publishedMonth, settings } from './finance-fixtures'
import { flushPromises, makeUser, mockFetch, mountView, type Call, type MockReply } from './helpers'
import { listReply } from './sponsors-fixtures'

const SENTINEL = 'SEGREDO-FORNECEDOR'
const nonSuper = () => makeUser({ id: 2, name: 'Ana Suporte', isSuperAdmin: false })
const memberSuper = () => makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true })

const t = (w: VueWrapper, id: string) => w.get(`[data-testid="${id}"]`).text()
const has = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).exists()
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const sel = (w: VueWrapper, css: string) => w.find(css).exists()

interface Overrides {
  months?: unknown[]
  entries?: unknown[]
  total?: number
  settings?: unknown
  preview?: unknown
  csv?: MockReply
  /** Resposta a qualquer chamada que não seja GET (criar/editar/publicar...). */
  write?: (call: Call) => MockReply | undefined
}

function handler(over: Overrides = {}) {
  return (call: Call): MockReply | undefined => {
    if (call.method !== 'GET') {
      const custom = over.write?.(call)
      if (custom) return custom
      return call.method === 'DELETE' || call.path.endsWith('/unpublish') ? { status: 204 } : { status: call.method === 'POST' ? 201 : 200, body: entry() }
    }
    if (call.path === '/platform-finance/months') return { body: { items: over.months ?? [month(), publishedMonth()] } }
    if (call.path === '/platform-finance/entries.csv') return over.csv ?? { body: 'data;tipo;valor' }
    if (call.path === '/platform-finance/entries') return listReply(over.entries ?? [entry()], over.total)
    if (call.path === '/platform-finance/settings') return { body: over.settings ?? settings() }
    if (call.path === '/platform-finance/preview') return { body: over.preview ?? preview() }
    return undefined
  }
}

async function mountFinance(over: Overrides = {}, user = makeUser()) {
  const { calls } = mockFetch(handler(over))
  const mounted = await mountView(FinanceView, user)
  return { ...mounted, calls }
}

async function goTo(wrapper: VueWrapper, tab: 'months' | 'entries' | 'settings' | 'preview') {
  await wrapper.get(`[data-testid="tab-${tab}"]`).trigger('click')
  await flushPromises()
}

function stubDownload() {
  const created: Blob[] = []
  const clicked: Array<{ download: string }> = []
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (b: Blob) => (created.push(b), 'blob:csv-1') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download })
  })
  return { created, clicked }
}

describe('FinanceView — estrutura e travas por papel', () => {
  it('tem as 4 abas e abre em Meses', async () => {
    const { wrapper } = await mountFinance()
    expect(wrapper.get('h1').text()).toBe('Financeiro')
    const tabs = wrapper.findAll('[role="tab"]').map((b) => b.text())
    expect(tabs).toEqual(['Meses', 'Lançamentos', 'Configurações', 'Prévia'])
    expect(wrapper.get('[data-testid="tab-months"]').attributes('aria-selected')).toBe('true')
    expect(has(wrapper, 'months-tab')).toBe(true)
  })

  it('super admin PLATFORM: vê Publicar/Despublicar, Novo lançamento e salvar configurações; sem aviso de somente leitura', async () => {
    const { wrapper } = await mountFinance()
    expect(has(wrapper, 'read-only-banner')).toBe(false)
    expect(sel(wrapper, '[data-testid="month-2026-10"] [data-action="publish"]')).toBe(true)
    expect(sel(wrapper, '[data-testid="month-2026-09"] [data-action="unpublish"]')).toBe(true)
    await goTo(wrapper, 'entries')
    expect(has(wrapper, 'new-entry')).toBe(true)
    expect(sel(wrapper, '[data-testid="entry-1"] [data-action="edit"]')).toBe(true)
    expect(sel(wrapper, '[data-testid="entry-1"] [data-action="delete"]')).toBe(true)
    await goTo(wrapper, 'settings')
    expect(has(wrapper, 'settings-save')).toBe(true)
  })

  it.each([
    ['PLATFORM comum (não super)', nonSuper],
    ['MEMBER com isSuperAdmin=true (só PLATFORM conta)', memberSuper],
  ])('%s: lê tudo, mas NENHUM botão de escrita', async (_name, user) => {
    const { wrapper, calls } = await mountFinance({}, user())
    expect(has(wrapper, 'read-only-banner')).toBe(true)
    // meses: dá para abrir, não para publicar/despublicar
    expect(sel(wrapper, '[data-action="open"]')).toBe(true)
    expect(sel(wrapper, '[data-action="publish"]')).toBe(false)
    expect(sel(wrapper, '[data-action="unpublish"]')).toBe(false)

    await goTo(wrapper, 'entries')
    expect(has(wrapper, 'new-entry')).toBe(false)
    expect(sel(wrapper, '[data-action="edit"]')).toBe(false)
    expect(sel(wrapper, '[data-action="delete"]')).toBe(false)
    expect(has(wrapper, 'export-csv')).toBe(true) // CSV é leitura

    await goTo(wrapper, 'settings')
    expect(has(wrapper, 'settings-save')).toBe(false)
    expect(has(wrapper, 'read-only-hint')).toBe(true)
    expect(wrapper.get('[data-testid="field-monthlyGoal"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="field-introText"]').attributes('disabled')).toBeDefined()

    await goTo(wrapper, 'preview')
    expect(has(wrapper, 'preview-body')).toBe(true)
    expect(nonGet(calls)).toHaveLength(0)
  })
})

describe('FinanceView — aba Meses', () => {
  it('tabela: mês por extenso, situação, valores em reais, alunos (ao vivo x retrato) e observação pública', async () => {
    const { wrapper, calls } = await mountFinance()
    expect(calls[0].path).toBe('/platform-finance/months')
    const open = wrapper.get('[data-testid="month-2026-10"]').text()
    expect(open).toContain('outubro de 2026')
    expect(open).toContain('3 lançamentos')
    expect(open).toContain('Não publicado')
    expect(open).toContain('R$ 2.800,00')
    expect(open).toContain('R$ 2.500,00')
    expect(open).toContain('R$ 300,00')
    expect(open).toContain('1.200 (ao vivo)')
    const done = wrapper.get('[data-testid="month-2026-09"]').text()
    expect(done).toContain('setembro de 2026')
    expect(done).toContain('Publicado')
    expect(done).toContain('1.100') // retrato, não o ao vivo
    expect(done).not.toContain('ao vivo')
    expect(t(wrapper, 'month-note-2026-09')).toContain('Mês de lançamento do patrocínio.')
  })

  it('saldo negativo em reais com sinal; lista vazia e erro de carga com "Tentar de novo"', async () => {
    const neg = await mountFinance({ months: [month({ balanceCents: -123456, revenueCents: 0, expenseCents: 123456 })] })
    expect(neg.wrapper.get('[data-testid="month-2026-10"]').text()).toContain('-R$ 1.234,56')
    neg.wrapper.unmount()

    const empty = await mountFinance({ months: [] })
    expect(t(empty.wrapper, 'empty')).toContain('Nenhum mês com lançamento')
    empty.wrapper.unmount()

    let fail = true
    mockFetch((call) => (fail ? { status: 500, body: { message: 'Falha no servidor.' } } : handler()(call)))
    const { wrapper } = await mountView(FinanceView, makeUser())
    expect(t(wrapper, 'list-error')).toContain('Falha no servidor.')
    fail = false
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(has(wrapper, 'list-error')).toBe(false)
    expect(has(wrapper, 'month-2026-10')).toBe(true)
  })

  it('Publicar: o diálogo avisa que fica PÚBLICO e que o mês TRAVA, e nada é enviado antes de confirmar', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    const dialog = t(wrapper, 'confirm-dialog')
    expect(dialog).toContain('Publicar este mês?')
    expect(dialog).toContain('outubro de 2026')
    expect(t(wrapper, 'publish-warning')).toContain('PÚBLICOS')
    expect(t(wrapper, 'publish-warning')).toContain('TRAVA')
    expect(t(wrapper, 'publish-warning')).toContain('alunos e grupos ativos')
    expect(nonGet(calls)).toHaveLength(0)

    // cancelar não envia nada
    await wrapper.get('[data-cancel]').trigger('click')
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('Publicar com observação: POST /months/2026-10/publish { note }, aviso de sucesso e recarrega a lista', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    await wrapper.get('[data-testid="publish-note"]').setValue('  Mês tranquilo  ')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    const post = nonGet(calls)
    expect(post).toHaveLength(1)
    expect(`${post[0].method} ${post[0].path}`).toBe('POST /platform-finance/months/2026-10/publish')
    expect(post[0].body).toEqual({ note: 'Mês tranquilo' })
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(t(wrapper, 'notice')).toContain('Outubro de 2026 publicado')
    expect(calls.filter((c) => c.path === '/platform-finance/months')).toHaveLength(2)
  })

  it('Publicar sem observação manda {}', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)[0].body).toEqual({})
  })

  it('observação longa demais é barrada no cliente (nada vai ao servidor)', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    await wrapper.get('[data-testid="publish-note"]').setValue('x'.repeat(501))
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'confirm-error')).toContain('500')
    expect(nonGet(calls)).toHaveLength(0)
  })

  it.each([
    ['MONTH_NOT_CLOSED', 400, 'Só dá para publicar um mês já encerrado'],
    ['MONTH_EMPTY', 400, 'nenhum lançamento'],
    ['MONTH_PUBLISHED', 409, 'já está publicado'],
  ])('erro %s ao publicar: mensagem em português no diálogo, que continua aberto', async (code, status, text) => {
    const { wrapper } = await mountFinance({ write: () => ({ status, body: { statusCode: status, code, message: 'msg crua do servidor' } }) })
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    expect(t(wrapper, 'confirm-error')).toContain(text)
    expect(t(wrapper, 'confirm-error')).not.toContain('msg crua')
  })

  it('409 sem code (corrida de duas publicações) também vira "já está publicado"', async () => {
    const { wrapper } = await mountFinance({ write: () => ({ status: 409, body: { statusCode: 409, message: 'Conflict' } }) })
    await wrapper.get('[data-testid="month-2026-10"] [data-action="publish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'confirm-error')).toContain('já está publicado')
  })

  it('Despublicar: confirma, POST /unpublish sem corpo, avisa e recarrega', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-09"] [data-action="unpublish"]').trigger('click')
    expect(t(wrapper, 'confirm-dialog')).toContain('Despublicar este mês?')
    expect(t(wrapper, 'unpublish-warning')).toContain('deixa de aparecer na página pública')
    expect(nonGet(calls)).toHaveLength(0)
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    const post = nonGet(calls)
    expect(`${post[0].method} ${post[0].path}`).toBe('POST /platform-finance/months/2026-09/unpublish')
    expect(post[0].body).toBeUndefined()
    expect(t(wrapper, 'notice')).toContain('Setembro de 2026 despublicado')
  })

  it('"Ver lançamentos" abre a aba Lançamentos já filtrada pelo mês', async () => {
    const { wrapper, calls } = await mountFinance()
    await wrapper.get('[data-testid="month-2026-09"] [data-action="open"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="tab-entries"]').attributes('aria-selected')).toBe('true')
    const list = calls.filter((c) => c.path === '/platform-finance/entries')
    expect(list).toHaveLength(1)
    expect(list[0].query.get('month')).toBe('2026-09')
    expect((wrapper.get('[data-testid="filter-month"]').element as HTMLInputElement).value).toBe('2026-09')
  })
})

describe('FinanceView — aba Lançamentos', () => {
  it('lista: data, tipo, categoria (rótulo do servidor), descrição privada e valor; consulta paginada', async () => {
    const { wrapper, calls } = await mountFinance({ entries: [entry(), entry({ id: 2, type: 'RECEITA', category: 'PATROCINIO', categoryLabel: 'Patrocínios', amountCents: 280000, description: 'Casa do Berimbau' })] })
    await goTo(wrapper, 'entries')
    const list = calls.filter((c) => c.path === '/platform-finance/entries')
    expect(list[0].query.get('limit')).toBe('20')
    expect(list[0].query.get('offset')).toBe('0')
    expect(list[0].query.has('month')).toBe(false)
    const row1 = wrapper.get('[data-testid="entry-1"]').text()
    expect(row1).toContain('05/10/2026')
    expect(row1).toContain('Despesa')
    expect(row1).toContain('Hospedagem e servidores')
    expect(row1).toContain(SENTINEL) // a descrição é do admin: aparece aqui
    expect(row1).toContain('− R$ 1.500,00')
    const row2 = wrapper.get('[data-testid="entry-2"]').text()
    expect(row2).toContain('Receita')
    expect(row2).toContain('Patrocínios')
    expect(row2).toContain('+ R$ 2.800,00')
    expect(t(wrapper, 'page-range')).toBe('1–2 de 2')
  })

  it('travado: lançamento de mês publicado mostra cadeado com a dica de despublicar e SEM editar/excluir', async () => {
    const { wrapper } = await mountFinance({ entries: [entry({ id: 1, locked: true }), entry({ id: 2, locked: false })] })
    await goTo(wrapper, 'entries')
    const locked = wrapper.get('[data-testid="entry-1"]')
    expect(locked.find('[data-locked-entry="1"]').exists()).toBe(true)
    expect(locked.text()).toContain('Travado')
    expect(locked.get('[data-locked-entry="1"]').attributes('title')).toContain('Despublique o mês')
    expect(locked.find('[data-action="edit"]').exists()).toBe(false)
    expect(locked.find('[data-action="delete"]').exists()).toBe(false)
    const free = wrapper.get('[data-testid="entry-2"]')
    expect(free.find('[data-locked-entry]').exists()).toBe(false)
    expect(free.find('[data-action="edit"]').exists()).toBe(true)
    expect(t(wrapper, 'locked-hint')).toContain('Despublique o mês')
  })

  it('filtros: mês, tipo, categoria e busca vão na query; trocar o tipo limpa categoria incompatível', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="filter-month"]').setValue('2026-10')
    await flushPromises()
    await wrapper.get('[data-testid="filter-type"]').setValue('DESPESA')
    await flushPromises()
    await wrapper.get('[data-testid="filter-category"]').setValue('HOSPEDAGEM')
    await flushPromises()
    await wrapper.get('[data-testid="filter-q"]').setValue('servidor')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    const last = calls.filter((c) => c.path === '/platform-finance/entries').at(-1)!
    expect(Object.fromEntries(last.query)).toEqual({ month: '2026-10', type: 'DESPESA', category: 'HOSPEDAGEM', q: 'servidor', limit: '20', offset: '0' })
    // as categorias do filtro de DESPESA não incluem as de RECEITA
    const options = wrapper.get('[data-testid="filter-category"]').findAll('option').map((o) => o.element.getAttribute('value'))
    expect(options).toContain('HOSPEDAGEM')
    expect(options).not.toContain('PATROCINIO')
    // trocar para RECEITA limpa HOSPEDAGEM (não pertence ao tipo)
    await wrapper.get('[data-testid="filter-type"]').setValue('RECEITA')
    await flushPromises()
    expect((wrapper.get('[data-testid="filter-category"]').element as HTMLSelectElement).value).toBe('')
    expect(calls.filter((c) => c.path === '/platform-finance/entries').at(-1)!.query.has('category')).toBe(false)
  })

  it('vazio com e sem filtro: mensagens diferentes', async () => {
    const { wrapper } = await mountFinance({ entries: [] })
    await goTo(wrapper, 'entries')
    expect(t(wrapper, 'empty')).toContain('Nenhum lançamento ainda')
    await wrapper.get('[data-testid="filter-month"]').setValue('2026-10')
    await flushPromises()
    expect(t(wrapper, 'empty')).toContain('Nenhum lançamento encontrado para esses filtros')
  })

  it('criar: valor digitado em reais vira amountCents inteiro no corpo do POST', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    // data padrão = hoje (America/Sao_Paulo)
    expect((wrapper.get('[data-testid="field-occurredOn"]').element as HTMLInputElement).value).toBe('2026-11-05')
    await wrapper.get('[data-testid="field-type"]').setValue('DESPESA')
    await wrapper.get('[data-testid="field-category"]').setValue('HOSPEDAGEM')
    await wrapper.get('[data-testid="field-amount"]').setValue('1.234,56')
    await wrapper.get('[data-testid="field-occurredOn"]').setValue('2026-10-05')
    await wrapper.get('[data-testid="field-description"]').setValue('  Servidor de outubro  ')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    const post = nonGet(calls)
    expect(post).toHaveLength(1)
    expect(`${post[0].method} ${post[0].path}`).toBe('POST /platform-finance/entries')
    expect(post[0].body).toEqual({ type: 'DESPESA', category: 'HOSPEDAGEM', amountCents: 123456, occurredOn: '2026-10-05', description: 'Servidor de outubro' })
    expect(has(wrapper, 'entry-form')).toBe(false)
    expect(t(wrapper, 'notice')).toBe('Lançamento criado.')
  })

  it('máscara: sai do campo e "1.000" vira "1.000,00"; mostra "= R$ 1.000,00" ao vivo; letras e sinal são descartados', async () => {
    const { wrapper } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    const input = wrapper.get('[data-testid="field-amount"]')
    await input.setValue('R$ -1.000abc')
    expect((input.element as HTMLInputElement).value).toBe('1.000')
    // "1.000" em pt-BR é MIL reais (o ponto é milhar), não um real
    expect(t(wrapper, 'field-amount-understood')).toBe('= R$ 1.000,00')
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('1.000,00')
    await input.setValue('0,05')
    expect(t(wrapper, 'field-amount-understood')).toBe('= R$ 0,05')
    await input.setValue('1,234')
    expect(has(wrapper, 'field-amount-understood')).toBe(false) // inválido: não "entende" nada
  })

  it('validação no cliente: nada vai à rede; erros por campo em português', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'en-category-error')).toContain('categoria')
    expect(t(wrapper, 'en-amount-error')).toContain('Informe o valor')
    expect(t(wrapper, 'en-description-error')).toContain('Descreva')

    await wrapper.get('[data-testid="field-category"]').setValue('HOSPEDAGEM')
    await wrapper.get('[data-testid="field-amount"]').setValue('0')
    await wrapper.get('[data-testid="field-occurredOn"]').setValue('2026-12-01')
    await wrapper.get('[data-testid="field-description"]').setValue('x')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'en-amount-error')).toContain('maior que zero')
    expect(t(wrapper, 'en-date-error')).toContain('depois do fim do mês atual')
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('trocar o tipo limpa a categoria que não pertence a ele e troca as opções', async () => {
    const { wrapper } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    await wrapper.get('[data-testid="field-category"]').setValue('HOSPEDAGEM')
    await wrapper.get('[data-testid="field-type"]').setValue('RECEITA')
    expect((wrapper.get('[data-testid="field-category"]').element as HTMLSelectElement).value).toBe('')
    const options = wrapper.get('[data-testid="field-category"]').findAll('option').map((o) => o.element.getAttribute('value'))
    expect(options).toEqual(['', 'APOIO', 'PATROCINIO', 'EDITAIS_OUTROS'])
  })

  it('criar em mês publicado: 409 MONTH_PUBLISHED -> mensagem clara no formulário, que fica aberto, e a lista é recarregada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    const { wrapper, calls } = await mountFinance({ write: () => ({ status: 409, body: { statusCode: 409, code: 'MONTH_PUBLISHED', message: 'crua' } }) })
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    await wrapper.get('[data-testid="field-category"]').setValue('HOSPEDAGEM')
    await wrapper.get('[data-testid="field-amount"]').setValue('10')
    await wrapper.get('[data-testid="field-description"]').setValue('Teste')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    expect(has(wrapper, 'entry-form')).toBe(true)
    expect(t(wrapper, 'form-errors')).toContain('publicado e travado')
    expect(t(wrapper, 'form-errors')).toContain('Despublique')
    expect(calls.filter((c) => c.path === '/platform-finance/entries' && c.method === 'GET').length).toBeGreaterThanOrEqual(2)
  })

  it('400 do servidor: o erro do campo amountCents aparece no campo Valor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    const { wrapper } = await mountFinance({ write: () => ({ status: 400, body: { statusCode: 400, message: ['amountCents must not be greater than 1000000000'] } }) })
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="new-entry"]').trigger('click')
    await wrapper.get('[data-testid="field-category"]').setValue('HOSPEDAGEM')
    await wrapper.get('[data-testid="field-amount"]').setValue('10')
    await wrapper.get('[data-testid="field-description"]').setValue('Teste')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'en-amount-error')).toContain('amountCents')
  })

  it('editar: formulário preenchido (valor em reais), PATCH com os campos e centavos inteiros', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    const { wrapper, calls } = await mountFinance({ entries: [entry({ id: 7, amountCents: 123456, description: 'Servidor' })] })
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="entry-7"] [data-action="edit"]').trigger('click')
    expect(wrapper.get('#entry-form-title').text()).toBe('Editar lançamento')
    expect((wrapper.get('[data-testid="field-amount"]').element as HTMLInputElement).value).toBe('1.234,56')
    expect((wrapper.get('[data-testid="field-occurredOn"]').element as HTMLInputElement).value).toBe('2026-10-05')
    await wrapper.get('[data-testid="field-amount"]').setValue('1.234,57')
    await wrapper.get('[data-testid="entry-form"] form').trigger('submit')
    await flushPromises()
    const patch = nonGet(calls)[0]
    expect(`${patch.method} ${patch.path}`).toBe('PATCH /platform-finance/entries/7')
    expect(patch.body).toEqual({ type: 'DESPESA', category: 'HOSPEDAGEM', amountCents: 123457, occurredOn: '2026-10-05', description: 'Servidor' })
    expect(t(wrapper, 'notice')).toBe('Lançamento atualizado.')
  })

  it('excluir: confirmação, DELETE e aviso; 409 MONTH_PUBLISHED mostra a mensagem clara no diálogo', async () => {
    const ok = await mountFinance()
    await goTo(ok.wrapper, 'entries')
    await ok.wrapper.get('[data-testid="entry-1"] [data-action="delete"]').trigger('click')
    expect(t(ok.wrapper, 'confirm-dialog')).toContain('R$ 1.500,00')
    expect(nonGet(ok.calls)).toHaveLength(0)
    await ok.wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(`${nonGet(ok.calls)[0].method} ${nonGet(ok.calls)[0].path}`).toBe('DELETE /platform-finance/entries/1')
    expect(t(ok.wrapper, 'notice')).toBe('Lançamento excluído.')
    ok.wrapper.unmount()

    const locked = await mountFinance({ write: () => ({ status: 409, body: { statusCode: 409, code: 'MONTH_PUBLISHED', message: 'crua' } }) })
    await goTo(locked.wrapper, 'entries')
    await locked.wrapper.get('[data-testid="entry-1"] [data-action="delete"]').trigger('click')
    await locked.wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(has(locked.wrapper, 'confirm-dialog')).toBe(true)
    expect(t(locked.wrapper, 'confirm-error')).toContain('publicado e travado')
  })

  it('CSV: baixa entries.csv do mês filtrado com nome de arquivo claro (e sem filtro, "todos")', async () => {
    const { clicked, created } = stubDownload()
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="filter-month"]').setValue('2026-10')
    await flushPromises()
    await wrapper.get('[data-testid="export-csv"]').trigger('click')
    await flushPromises()
    const csv = calls.find((c) => c.path === '/platform-finance/entries.csv')!
    expect(csv.query.get('month')).toBe('2026-10')
    expect(created).toHaveLength(1)
    expect(clicked[0].download).toBe('lancamentos-2026-10.csv')

    await wrapper.get('[data-testid="filter-month"]').setValue('')
    await flushPromises()
    await wrapper.get('[data-testid="export-csv"]').trigger('click')
    await flushPromises()
    expect(clicked[1].download).toBe('lancamentos-todos.csv')
    expect(calls.filter((c) => c.path === '/platform-finance/entries.csv').at(-1)!.query.has('month')).toBe(false)
  })

  it('CSV com erro: mensagem, sem arquivo', async () => {
    const { clicked } = stubDownload()
    const { wrapper } = await mountFinance({ csv: { status: 403, body: { statusCode: 403, message: 'Sem permissão.' } } })
    await goTo(wrapper, 'entries')
    await wrapper.get('[data-testid="export-csv"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'csv-error')).toContain('Sem permissão.')
    expect(clicked).toHaveLength(0)
  })

  it('erro de carga da lista com "Tentar de novo"', async () => {
    let fail = true
    mockFetch((call) => (fail && call.path === '/platform-finance/entries' ? { status: 500, body: { message: 'Falha no servidor.' } } : handler()(call)))
    const { wrapper } = await mountView(FinanceView, makeUser())
    await goTo(wrapper, 'entries')
    expect(t(wrapper, 'list-error')).toContain('Falha no servidor.')
    fail = false
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(has(wrapper, 'entry-1')).toBe(true)
  })
})

describe('FinanceView — aba Configurações', () => {
  it('carrega e mostra em reais; salvar manda PUT com centavos inteiros e textos vazios como null', async () => {
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'settings')
    expect((wrapper.get('[data-testid="field-monthlyGoal"]').element as HTMLInputElement).value).toBe('3.000,00')
    expect((wrapper.get('[data-testid="field-openingReserve"]').element as HTMLInputElement).value).toBe('1.234,00')
    expect((wrapper.get('[data-testid="field-entityName"]').element as HTMLInputElement).value).toBe('Associação X')

    await wrapper.get('[data-testid="field-monthlyGoal"]').setValue('3.500,50')
    await wrapper.get('[data-testid="field-openingReserve"]').setValue('0')
    await wrapper.get('[data-testid="field-entityName"]').setValue('   ')
    await wrapper.get('[data-testid="field-surplusText"]').setValue('')
    await wrapper.get('[data-testid="settings-form"]').trigger('submit')
    await flushPromises()
    const put = nonGet(calls)[0]
    expect(`${put.method} ${put.path}`).toBe('PUT /platform-finance/settings')
    expect(put.body).toEqual({ monthlyGoalCents: 350050, openingReserveCents: 0, entityName: null, introText: 'A plataforma é gratuita.', surplusText: null })
    expect(t(wrapper, 'notice')).toContain('Configurações salvas')
    expect(t(wrapper, 'notice')).toContain('não mudam')
  })

  it('valor inválido: erro no campo e nada enviado', async () => {
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'settings')
    await wrapper.get('[data-testid="field-monthlyGoal"]').setValue('1,234')
    await wrapper.get('[data-testid="settings-form"]').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'st-goal-error')).toContain('Valor inválido')
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('erro ao carregar: sem formulário (salvar vazio zeraria a meta) e com "Tentar de novo"', async () => {
    let fail = true
    mockFetch((call) => (fail && call.path === '/platform-finance/settings' ? { status: 500, body: { message: 'Falha.' } } : handler()(call)))
    const { wrapper } = await mountView(FinanceView, makeUser())
    await goTo(wrapper, 'settings')
    expect(t(wrapper, 'load-error')).toContain('Falha.')
    expect(has(wrapper, 'settings-form')).toBe(false)
    fail = false
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(has(wrapper, 'settings-form')).toBe(true)
  })

  it('403 ao salvar (servidor barra): mensagem de super admin', async () => {
    const { wrapper } = await mountFinance({ write: () => ({ status: 403, body: { statusCode: 403, message: 'Forbidden' } }) })
    await goTo(wrapper, 'settings')
    await wrapper.get('[data-testid="settings-form"]').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'form-errors')).toContain('super admin')
  })
})

describe('FinanceView — aba Prévia', () => {
  it('renderiza o corpo de /platform-finance/preview: entidade, meta, reserva, mês por extenso, custo por aluno, % da meta e barras com texto', async () => {
    const { wrapper, calls } = await mountFinance()
    await goTo(wrapper, 'preview')
    expect(calls.some((c) => c.path === '/platform-finance/preview')).toBe(true)
    expect(t(wrapper, 'preview-entity')).toBe('Associação X')
    expect(t(wrapper, 'preview-goal')).toBe('R$ 3.000,00')
    expect(t(wrapper, 'preview-reserve')).toBe('R$ 1.234,00')
    const m = wrapper.get('[data-testid="preview-month-2026-10"]')
    expect(m.text()).toContain('outubro de 2026')
    expect(m.text()).toContain('Mês tranquilo.')
    expect(m.get('[data-testid="preview-revenue"]').text()).toBe('R$ 2.800,00')
    expect(m.get('[data-testid="preview-expense"]').text()).toBe('R$ 2.500,00')
    expect(m.get('[data-testid="preview-balance"]').text()).toBe('R$ 300,00')
    expect(m.get('[data-testid="preview-cost"]').text()).toBe('R$ 2,08')
    expect(m.get('[data-testid="preview-people"]').text()).toBe('1.200 alunos ativos em 30 grupos.')
    expect(m.get('[data-testid="preview-coverage"]').text()).toContain('93% da meta de R$ 3.000,00 coberta')
    expect(m.get('[data-testid="preview-expenses"]').text()).toContain('Hospedagem e servidores')
    expect(m.get('[data-testid="preview-expenses"]').text()).toContain('R$ 1.500,00 · 60%')
    expect(m.get('[data-testid="preview-revenues"]').text()).toContain('Patrocínios')
    expect(m.get('[data-testid="preview-revenues"]').text()).toContain('100%')
  })

  it('sem mês publicado: estado vazio amigável, nunca erro', async () => {
    const { wrapper } = await mountFinance({ preview: preview({ months: [], reserveCents: 0 }) })
    await goTo(wrapper, 'preview')
    expect(t(wrapper, 'preview-empty')).toContain('Ainda não publicamos o primeiro mês')
    expect(has(wrapper, 'load-error')).toBe(false)
  })

  it('casos de borda: custo por aluno null, sem meta, cobertura acima de 100% (barra limitada), reserva negativa, sem despesas', async () => {
    const base = preview().months[0]!
    const body = preview({
      reserveCents: -50000,
      monthlyGoalCents: 0,
      entityName: null,
      introText: null,
      surplusText: null,
      months: [
        { ...base, month: '2026-10', costPerActiveStudentCents: null, activeStudents: 0, goalCoveragePct: 125, expensesByCategory: [] },
        { ...base, month: '2026-09', goalCents: 0, goalCoveragePct: null, note: null },
      ],
    })
    const { wrapper } = await mountFinance({ preview: body })
    await goTo(wrapper, 'preview')
    expect(t(wrapper, 'preview-goal')).toBe('Sem meta definida')
    expect(t(wrapper, 'preview-reserve')).toBe('-R$ 500,00')
    expect(has(wrapper, 'preview-entity')).toBe(false)
    const oct = wrapper.get('[data-testid="preview-month-2026-10"]')
    expect(oct.get('[data-testid="preview-cost"]').text()).toBe('Sem alunos ativos')
    expect(oct.get('[data-testid="preview-people"]').text()).toContain('0 alunos ativos')
    expect(oct.get('[data-testid="preview-coverage"]').text()).toContain('125% da meta')
    expect(oct.get('[data-testid="preview-coverage"]').get('[role="presentation"] > div').attributes('style')).toContain('width: 100%')
    expect(oct.text()).toContain('Sem despesas no mês.')
    const sep = wrapper.get('[data-testid="preview-month-2026-09"]')
    expect(sep.get('[data-testid="preview-coverage"]').text()).toContain('Sem meta definida neste mês.')
  })

  it('a prévia não tem nada além do que o servidor mandou: a descrição privada de um lançamento não aparece', async () => {
    const { wrapper } = await mountFinance()
    await goTo(wrapper, 'preview')
    expect(wrapper.text()).not.toContain(SENTINEL)
  })

  it('erro de carga da prévia com "Tentar de novo"', async () => {
    let fail = true
    mockFetch((call) => (fail && call.path === '/platform-finance/preview' ? { status: 500, body: { message: 'Falha.' } } : handler()(call)))
    const { wrapper } = await mountView(FinanceView, makeUser())
    await goTo(wrapper, 'preview')
    expect(t(wrapper, 'load-error')).toContain('Falha.')
    fail = false
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(has(wrapper, 'preview-body')).toBe(true)
  })
})
