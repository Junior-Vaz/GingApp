import { afterEach, describe, expect, it, vi } from 'vitest'
import DataDeletionRequestsView from '@/views/DataDeletionRequestsView.vue'
import { flushPromises, makeUser, mockFetch, mountView, type Call } from './helpers'

const REQUEST = {
  id: 5,
  status: 'PENDING',
  reason: 'quero sair',
  requestedAt: '2026-10-09T15:00:00.000Z',
  resolvedAt: null,
  resolutionNote: null,
  userId: 9,
  userName: 'Ana Aluna',
  userEmail: 'ana@grupo.com',
  organizationId: 3,
  organizationName: 'Grupo Capoeira Um',
}

function handler(call: Call) {
  if (call.path === '/organizations') return { body: [{ id: 3, name: 'Grupo Capoeira Um' }] }
  if (call.path === '/data-deletion-requests' && call.method === 'GET') {
    return { body: [REQUEST], headers: { 'X-Total-Count': '1' } }
  }
  if (call.path === '/data-deletion-requests/5' && call.method === 'PATCH') return { body: { ...REQUEST, status: 'DONE' } }
  return undefined
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('DataDeletionRequestsView (Pedidos LGPD)', () => {
  it('lista os pedidos e envia os filtros ao servidor', async () => {
    const { calls } = mockFetch(handler)
    const { wrapper } = await mountView(DataDeletionRequestsView)

    expect(wrapper.get('h1').text()).toBe('Pedidos LGPD')
    const row = wrapper.get('[data-testid="lgpd-5"]').text()
    expect(row).toContain('Ana Aluna')
    expect(row).toContain('Grupo Capoeira Um')
    expect(row).toContain('Pendente')
    expect(wrapper.get('[data-testid="manual-note"]').text()).toContain('nada é apagado')

    await wrapper.get('[data-testid="filter-status"]').setValue('DONE')
    await wrapper.get('[data-testid="filter-organization"]').setValue('3')
    await wrapper.get('[data-testid="filter-from"]').setValue('2026-10-01')
    await wrapper.get('[data-testid="lgpd-filters"]').trigger('submit')
    await flushPromises()
    const last = calls.filter((c) => c.path === '/data-deletion-requests').pop() as Call
    expect(last.query.get('status')).toBe('DONE')
    expect(last.query.get('organizationId')).toBe('3')
    expect(last.query.get('from')).toBe('2026-10-01')
  })

  it('tratar: Concluído com nota faz PATCH; Rejeitado sem nota é barrado no cliente', async () => {
    const { calls } = mockFetch(handler)
    const { wrapper } = await mountView(DataDeletionRequestsView)

    await wrapper.get('[data-testid="lgpd-5"] [data-action="handle"]').trigger('click')
    await wrapper.get('#lgpd-new-status').setValue('REJECTED')
    await wrapper.get('form[class*="space-y-4"]').trigger('submit')
    await flushPromises()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('justificativa')

    await wrapper.get('#lgpd-new-status').setValue('DONE')
    await wrapper.get('#lgpd-note').setValue('Anonimizado manualmente.')
    await wrapper.get('form[class*="space-y-4"]').trigger('submit')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH') as Call
    expect(patch.path).toBe('/data-deletion-requests/5')
    expect(patch.body).toEqual({ status: 'DONE', note: 'Anonimizado manualmente.' })
  })

  it('PLATFORM sem super admin só consulta: sem botão Tratar', async () => {
    mockFetch(handler)
    const { wrapper } = await mountView(DataDeletionRequestsView, makeUser({ id: 2, isSuperAdmin: false }))
    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="handle"]').exists()).toBe(false)
  })
})
