import { describe, expect, it } from 'vitest'
import FinanceView from '@/views/FinanceView.vue'
import { CATEGORIES_BY_TYPE } from '@/utils/finance'
import { REAL_MONTHS, REAL_PUBLIC } from './real-contract-transparency'
import { flushPromises, mockFetch, mountView } from './helpers'

/** Conformidade com o backend REAL: GET /platform-finance/months e /transparency capturados do e2e. */
const months = (REAL_MONTHS as { items: Array<Record<string, unknown>> }).items

describe('financeiro: resposta real do backend', () => {
  it('cada mês real tem exatamente as chaves que o admin lê', () => {
    for (const m of months) {
      expect(Object.keys(m).sort()).toEqual(
        [
          'balanceCents', 'entries', 'expenseCents', 'expensesByCategory', 'liveActiveGroups', 'liveActiveStudents', 'month',
          'note', 'published', 'publishedAt', 'revenueByCategory', 'revenueCents', 'snapshot',
        ].sort(),
      )
    }
  })

  it('os rótulos do servidor batem com a lista do formulário (SSOT: mesmo código, mesmo texto)', () => {
    const form = new Map<string, string>()
    for (const list of Object.values(CATEGORIES_BY_TYPE)) for (const c of list) form.set(c.value, c.label)
    for (const m of months) {
      for (const c of [...(m.expensesByCategory as Array<{ category: string; label: string }>), ...(m.revenueByCategory as Array<{ category: string; label: string }>)]) {
        expect(form.get(c.category), c.category).toBe(c.label)
      }
    }
  })

  it('a aba Meses e a Prévia montam com o corpo real (mês por extenso, sem erro)', async () => {
    mockFetch((call) => {
      if (call.path === '/platform-finance/months') return { body: REAL_MONTHS }
      if (call.path === '/platform-finance/preview') return { body: REAL_PUBLIC }
      if (call.path === '/platform-finance/settings') return { body: { monthlyGoalCents: 300000, openingReserveCents: 0, entityName: null, introText: null, surplusText: null, updatedAt: null, updatedByUserId: null } }
      if (call.path === '/platform-finance/entries') return { body: [], headers: { 'x-total-count': '0' } }
      return undefined
    })
    const { wrapper } = await mountView(FinanceView)
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('outubro de 2026')
    expect(text).toContain('setembro de 2026')
  })
})
