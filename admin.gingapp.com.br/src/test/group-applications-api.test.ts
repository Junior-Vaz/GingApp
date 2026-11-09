import { describe, expect, it } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import router, { routes } from '@/router'
import { ApiError } from '@/utils/api'
import { GROUP_APPLICATIONS_PATH, fetchPendingCount, groupApplicationsApi } from '@/utils/groupApplicationsApi'
import { application, approveResult, rejected } from './group-applications-fixtures'
import { loginAs, makeUser, mockFetch, mountView, flushPromises, type Call, type MockReply } from './helpers'
import { listReply } from './sponsors-fixtures'

describe('groupApplicationsApi — prefixo e rotas do contrato §4', () => {
  it('prefixo único /platform-group-applications', () => {
    expect(GROUP_APPLICATIONS_PATH).toBe('/platform-group-applications')
  })

  it('lista: GET com status/q/limit/offset na query e total no X-Total-Count; filtros vazios omitidos', async () => {
    const { calls } = mockFetch(() => listReply([application(), application({ id: 6 })], 33))
    loginAs()
    const page = await groupApplicationsApi.list({ status: 'PENDING', q: ' cerrado ', limit: 20, offset: 40 })
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/platform-group-applications')
    expect(Object.fromEntries(calls[0].query)).toEqual({ status: 'PENDING', q: 'cerrado', limit: '20', offset: '40' })
    expect(page.total).toBe(33)
    expect(page.items.map((a) => a.id)).toEqual([5, 6])
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')

    await groupApplicationsApi.list({ status: '', q: '', limit: 20, offset: 0 })
    expect(Object.fromEntries(calls[1].query)).toEqual({ limit: '20', offset: '0' })
  })

  it('contador e detalhe: GET /pending-count e GET /:id', async () => {
    const { calls } = mockFetch((call) => (call.path.endsWith('/pending-count') ? { body: { count: 3 } } : { body: application({ id: 9 }) }))
    loginAs()
    await expect(groupApplicationsApi.pendingCount()).resolves.toEqual({ count: 3 })
    await expect(groupApplicationsApi.get(9)).resolves.toMatchObject({ id: 9 })
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /platform-group-applications/pending-count', 'GET /platform-group-applications/9'])
  })

  it('aprovar: POST /:id/approve com { slug?, internalNote? } (vazio vai {}) e devolve application + organization', async () => {
    const { calls } = mockFetch(() => ({ status: 201, body: approveResult() }))
    loginAs()
    const result = await groupApplicationsApi.approve(5, { slug: 'meu-grupo', internalNote: 'ok' })
    await groupApplicationsApi.approve(5)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/platform-group-applications/5/approve')
    expect(calls[0].body).toEqual({ slug: 'meu-grupo', internalNote: 'ok' })
    expect(calls[1].body).toEqual({})
    expect(result.organization.slug).toBe('nucleo-raizes-do-cerrado')
    expect(result.application.status).toBe('APPROVED')
  })

  it('não aprovar: POST /:id/reject com { reason, internalNote? }', async () => {
    const { calls } = mockFetch(() => ({ status: 200, body: rejected({ id: 5 }) }))
    loginAs()
    await groupApplicationsApi.reject(5, { reason: 'Sem informações', internalNote: 'duplicado' })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/platform-group-applications/5/reject')
    expect(calls[0].body).toEqual({ reason: 'Sem informações', internalNote: 'duplicado' })
  })

  it('409 NOT_PENDING / EMAIL_TAKEN chegam como ApiError com o code do servidor', async () => {
    mockFetch(() => ({ status: 409, body: { statusCode: 409, code: 'NOT_PENDING', message: 'Pedido já decidido.' } }))
    loginAs()
    const error = await groupApplicationsApi.approve(5).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe('NOT_PENDING')
  })

  it('nenhuma rota toca em senha: o corpo enviado nunca tem password', async () => {
    const { calls } = mockFetch(() => ({ status: 201, body: approveResult() }))
    loginAs()
    await groupApplicationsApi.approve(5, { slug: 'x-y' })
    expect(JSON.stringify(calls[0].body)).not.toMatch(/pass/i)
  })
})

describe('fetchPendingCount', () => {
  it('devolve o número do servidor', async () => {
    mockFetch(() => ({ body: { count: 7 } }))
    loginAs()
    await expect(fetchPendingCount()).resolves.toBe(7)
  })

  it.each<[string, MockReply]>([
    ['erro 500', { status: 500, body: { message: 'boom' } }],
    ['403', { status: 403, body: { message: 'Forbidden' } }],
    ['corpo sem count', { body: { twoFactorEnabled: true } }],
    ['count negativo', { body: { count: -1 } }],
    ['count não inteiro', { body: { count: '3' } }],
  ])('falha (%s) devolve null, sem lançar', async (_name, reply) => {
    mockFetch(() => reply)
    loginAs()
    await expect(fetchPendingCount()).resolves.toBeNull()
  })
})

describe('menu e rota "Pedidos de adesão"', () => {
  it('rota /pedidos-de-adesao só para PLATFORM, com o rótulo do menu', () => {
    const route = routes.find((r) => r.path === '/pedidos-de-adesao')
    expect(route?.name).toBe('group-applications')
    expect(route?.meta?.navLabel).toBe('Pedidos de adesão')
    expect(route?.meta?.platformOnly).toBe(true)
    expect(route?.meta?.requiresAuth).toBe(true)
    expect(router.resolve('/pedidos-de-adesao').name).toBe('group-applications')
  })

  const pendingCountCalls = (calls: Call[]) => calls.filter((c) => c.path === '/platform-group-applications/pending-count')

  it('PLATFORM (super ou não): item no menu com o contador de pendentes, carregado ao abrir o admin', async () => {
    const { calls } = mockFetch((call) => (call.path.endsWith('/pending-count') ? { body: { count: 4 } } : { body: { twoFactorEnabled: true } }))
    const { wrapper } = await mountView(SidebarLayout, makeUser({ userType: 'PLATFORM' }))
    expect(wrapper.find('nav').text()).toContain('Pedidos de adesão')
    expect(wrapper.get('[data-testid="pending-applications-badge"]').text()).toContain('4')
    expect(pendingCountCalls(calls)).toHaveLength(1)
    expect(pendingCountCalls(calls)[0].method).toBe('GET')
    wrapper.unmount()

    const plain = mockFetch((call) => (call.path.endsWith('/pending-count') ? { body: { count: 1 } } : { body: { twoFactorEnabled: true } }))
    const second = await mountView(SidebarLayout, makeUser({ id: 2, userType: 'PLATFORM', isSuperAdmin: false }))
    expect(second.wrapper.find('nav').text()).toContain('Pedidos de adesão')
    expect(second.wrapper.get('[data-testid="pending-applications-badge"]').text()).toContain('1')
    expect(pendingCountCalls(plain.calls)).toHaveLength(1)
  })

  it('zero pendentes: o item aparece sem selo', async () => {
    mockFetch((call) => (call.path.endsWith('/pending-count') ? { body: { count: 0 } } : { body: { twoFactorEnabled: true } }))
    const { wrapper } = await mountView(SidebarLayout, makeUser())
    expect(wrapper.find('nav').text()).toContain('Pedidos de adesão')
    expect(wrapper.find('[data-testid="pending-applications-badge"]').exists()).toBe(false)
  })

  it('falha na contagem (500) NÃO quebra o menu: item presente, sem selo, resto do layout intacto', async () => {
    mockFetch((call) => (call.path.endsWith('/pending-count') ? { status: 500, body: { message: 'boom' } } : { body: { twoFactorEnabled: true } }))
    const { wrapper } = await mountView(SidebarLayout, makeUser())
    await flushPromises()
    expect(wrapper.find('nav').text()).toContain('Pedidos de adesão')
    expect(wrapper.find('nav').text()).toContain('Financeiro')
    expect(wrapper.find('[data-testid="pending-applications-badge"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="two-factor"]').exists()).toBe(true)
  })

  it('MEMBER: sem o item e sem chamar a contagem', async () => {
    const { calls } = mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const { wrapper } = await mountView(SidebarLayout, makeUser({ userType: 'MEMBER' }))
    expect(wrapper.find('nav').text()).not.toContain('Pedidos de adesão')
    expect(pendingCountCalls(calls)).toHaveLength(0)
  })
})
