import { describe, expect, it } from 'vitest'
import DashboardView from '@/views/DashboardView.vue'
import { flushPromises, mockFetch, mountView } from './helpers'

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-10-09T15:00:00.000Z',
    organizations: { total: 7, active: 5, inactive: 2 },
    newOrganizationsLast30Days: 3,
    students: { active: 1234 },
    subscriptions: {
      byStatus: { TRIALING: 1, ACTIVE: 4, PAST_DUE: 2, CANCELED: 3, EXPIRED: 0 },
      byPlan: [
        { planId: 10, code: 'PRO', name: 'Plano Pro', count: 3 },
        { planId: 11, code: 'BASIC', name: 'Plano Básico', count: 2 },
      ],
    },
    mrrCents: 123456,
    mrrIgnoredSubscriptions: 0,
    recentOrganizations: [
      {
        id: 42,
        name: 'Grupo Capoeira Um',
        slug: 'grupo-um',
        createdAt: '2026-10-08T12:00:00.000Z',
        currentPlan: { id: 10, code: 'PRO', name: 'Plano Pro', subscriptionStatus: 'ACTIVE' },
      },
      { id: 43, name: 'Grupo Sem Plano', slug: 'sem-plano', createdAt: '2026-10-07T12:00:00.000Z', currentPlan: null },
    ],
    ...overrides,
  }
}

describe('DashboardView', () => {
  it('renderiza cartões, assinaturas por status, por plano e grupos recentes', async () => {
    const { calls } = mockFetch(() => ({ body: dashboard() }))
    const { wrapper } = await mountView(DashboardView)

    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('/platform-dashboard')
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')

    const text = (id: string) => norm(wrapper.get(`[data-testid="${id}"]`).text())
    expect(text('card-orgs-active')).toBe('5')
    expect(text('card-orgs-inactive')).toBe('2')
    expect(text('card-orgs-new')).toBe('3')
    expect(text('card-students')).toBe('1.234')
    expect(text('card-mrr')).toBe('R$ 1.234,56')
    expect(norm(wrapper.get('[data-testid="status-ACTIVE"]').text())).toBe('Ativas4')
    expect(norm(wrapper.get('[data-testid="status-TRIALING"]').text())).toBe('Em teste1')
    expect(norm(wrapper.get('[data-testid="status-PAST_DUE"]').text())).toBe('Em atraso2')
    expect(norm(wrapper.get('[data-testid="status-CANCELED"]').text())).toBe('Canceladas3')
    expect(norm(wrapper.get('[data-testid="status-EXPIRED"]').text())).toBe('Expiradas0')

    const planRows = wrapper.get('[data-testid="by-plan-table"]').findAll('tbody tr')
    expect(planRows).toHaveLength(2)
    expect(norm(planRows[0].text())).toBe('Plano ProPRO3')

    const link = wrapper.get('[data-testid="recent-table"] a')
    expect(link.attributes('href')).toBe('/organizations/42')
    expect(wrapper.get('[data-testid="recent-table"]').text()).toContain('Sem plano')
    expect(wrapper.text()).not.toContain('Em construção')
  })

  it('mostra aviso discreto só quando mrrIgnoredSubscriptions > 0', async () => {
    mockFetch(() => ({ body: dashboard() }))
    const first = await mountView(DashboardView)
    expect(first.wrapper.find('[data-testid="mrr-ignored"]').exists()).toBe(false)
    first.wrapper.unmount()

    mockFetch(() => ({ body: dashboard({ mrrIgnoredSubscriptions: 2 }) }))
    const second = await mountView(DashboardView)
    expect(norm(second.wrapper.get('[data-testid="mrr-ignored"]').text())).toContain('2 assinaturas ativas ficaram fora do cálculo do MRR')
  })

  it('estado carregando enquanto a requisição não termina', async () => {
    let release: (() => void) | undefined
    mockFetch(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ body: dashboard() })
        }),
    )
    const { wrapper } = await mountView(DashboardView)
    expect(wrapper.text()).toContain('Carregando…')
    expect(wrapper.find('[data-testid="card-mrr"]').exists()).toBe(false)
    release!()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Carregando…')
    expect(wrapper.find('[data-testid="card-mrr"]').exists()).toBe(true)
  })

  it('estados vazios: sem planos em uso e sem grupos', async () => {
    mockFetch(() =>
      ({
        body: dashboard({
          organizations: { total: 0, active: 0, inactive: 0 },
          subscriptions: { byStatus: { TRIALING: 0, ACTIVE: 0, PAST_DUE: 0, CANCELED: 0, EXPIRED: 0 }, byPlan: [] },
          mrrCents: 0,
          recentOrganizations: [],
        }),
      }),
    )
    const { wrapper } = await mountView(DashboardView)
    expect(norm(wrapper.get('[data-testid="card-mrr"]').text())).toBe('R$ 0,00')
    expect(wrapper.text()).toContain('Nenhuma assinatura em uso.')
    expect(wrapper.text()).toContain('Nenhum grupo cadastrado ainda.')
  })

  it('exibe a mensagem do backend em caso de erro e permite tentar de novo', async () => {
    let attempt = 0
    const { calls } = mockFetch(() => {
      attempt += 1
      return attempt === 1 ? { status: 403, body: { message: 'Acesso restrito à equipe da plataforma GingApp.' } } : { body: dashboard() }
    })
    const { wrapper } = await mountView(DashboardView)
    expect(wrapper.get('[role="alert"]').text()).toContain('Acesso restrito à equipe da plataforma GingApp.')
    expect(wrapper.find('[data-testid="card-mrr"]').exists()).toBe(false)

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(calls).toHaveLength(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="card-mrr"]').exists()).toBe(true)
  })

  it('mensagem em array do Nest é exibida unida', async () => {
    mockFetch(() => ({ status: 400, body: { message: ['a falhou', 'b falhou'] } }))
    const { wrapper } = await mountView(DashboardView)
    expect(wrapper.get('[role="alert"]').text()).toContain('a falhou b falhou')
  })
})
