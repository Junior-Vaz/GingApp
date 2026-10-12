import { describe, expect, it } from 'vitest'
import AuditView from '@/views/AuditView.vue'
import { flushPromises, mockFetch, mountView } from './helpers'

const norm = (text: string) => text.replace(/\s+/g, ' ').trim()

const LOG = {
  id: 7,
  createdAt: '2026-10-09T15:00:00.000Z',
  action: 'UNIT_CREATE',
  entity: 'unit',
  entityId: '12',
  organizationId: 3,
  organizationName: 'Grupo Capoeira Um',
  userId: 9,
  userName: 'Mestre Bimba',
  userEmail: 'mestre@grupo.com',
  ip: '10.0.0.1',
  meta: { name: 'Filial Centro' },
}

function handler(call: { path: string }) {
  if (call.path === '/organizations') return { body: [{ id: 3, name: 'Grupo Capoeira Um' }], headers: { 'X-Total-Count': '1' } }
  if (call.path === '/audit-logs') return { body: [LOG], headers: { 'X-Total-Count': '30' } }
  return undefined
}

describe('AuditView', () => {
  it('lista os registros com a ação em português, pagina e envia os filtros ao servidor', async () => {
    const { calls } = mockFetch(handler)
    const { wrapper } = await mountView(AuditView)

    expect(wrapper.get('h1').text()).toBe('Auditoria')
    const row = norm(wrapper.get('[data-testid="audit-7"]').text())
    expect(row).toContain('Unidade criada')
    expect(row).toContain('Grupo Capoeira Um')
    expect(row).toContain('Mestre Bimba')
    expect(row).toContain('10.0.0.1')
    expect(row).toContain('Filial Centro')
    expect(norm(wrapper.get('[data-testid="page-range"]').text())).toBe('1–25 de 30')

    await wrapper.get('[data-testid="filter-action"]').setValue('UNIT_CREATE')
    await wrapper.get('[data-testid="filter-organization"]').setValue('3')
    await wrapper.get('[data-testid="filter-from"]').setValue('2026-10-01')
    await wrapper.get('[data-testid="audit-filters"]').trigger('submit')
    await flushPromises()

    const last = calls.filter((c) => c.path === '/audit-logs').at(-1)!
    expect(last.query.get('action')).toBe('UNIT_CREATE')
    expect(last.query.get('organizationId')).toBe('3')
    expect(last.query.get('from')).toBe('2026-10-01')
    expect(last.query.get('offset')).toBe('0')

    await wrapper.get('[data-testid="page-next"]').trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.path === '/audit-logs').at(-1)!.query.get('offset')).toBe('25')
  })

  it('mostra mensagem de erro quando a API falha', async () => {
    mockFetch((call) => (call.path === '/audit-logs' ? { status: 500, body: { message: 'boom' } } : { body: [] }))
    const { wrapper } = await mountView(AuditView)
    expect(wrapper.get('[role="alert"]').text()).not.toBe('')
  })
})
