import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import OrganizationDetailView from '@/views/OrganizationDetailView.vue'
import TeamView from '@/views/TeamView.vue'
import { flushPromises, loginAs, makeRouter, makeUser, mockFetch, mountView, type Call } from './helpers'

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Owner GingApp',
    email: 'owner@gingapp.com.br',
    phone: null,
    status: 'ACTIVE',
    isSuperAdmin: true,
    createdAt: '2026-09-01T12:00:00.000Z',
    tokenValidAfter: null,
    twoFactorEnabled: true,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Redefinir 2FA — equipe', () => {
  const team = [
    member(),
    member({ id: 2, name: 'Ana', email: 'ana@gingapp.com.br', isSuperAdmin: false }),
    member({ id: 3, name: 'Bia', email: 'bia@gingapp.com.br', isSuperAdmin: false, twoFactorEnabled: false }),
  ]
  const btn = (wrapper: { find: (s: string) => { exists(): boolean; trigger(e: string): Promise<void> } }, id: number) =>
    wrapper.find(`[data-testid="member-${id}"] [data-action="reset-2fa"]`)

  it('só aparece para OUTRO usuário com 2FA ativo; confirmar chama POST /auth/2fa/reset/:id', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { calls } = mockFetch((call: Call) =>
      call.method === 'POST' ? { body: { twoFactorEnabled: false } } : { body: team, headers: { 'X-Total-Count': '3' } },
    )
    const { wrapper } = await mountView(TeamView)

    expect(btn(wrapper, 1).exists()).toBe(false) // si mesmo: usa "desativar"
    expect(btn(wrapper, 3).exists()).toBe(false) // sem 2FA ativo
    await btn(wrapper, 2).trigger('click')
    await flushPromises()

    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.path).toBe('/auth/2fa/reset/2')
    expect(wrapper.get('[role="status"]').text()).toContain('2FA de ana@gingapp.com.br redefinido')
  })

  it('cancelar a confirmação não chama a API; erro do servidor aparece na tela', async () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    const { calls } = mockFetch((call: Call) =>
      call.method === 'POST'
        ? { status: 400, body: { message: 'A verificação em duas etapas não está ativa para este usuário.' } }
        : { body: team, headers: { 'X-Total-Count': '3' } },
    )
    const { wrapper } = await mountView(TeamView)

    await btn(wrapper, 2).trigger('click')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    confirmMock.mockReturnValue(true)
    await btn(wrapper, 2).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('não está ativa')
  })
})

describe('Redefinir 2FA — detalhe do grupo', () => {
  it('super admin vê o botão no MESTRE com 2FA ativo e a chamada vai ao id do usuário', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { pinia } = loginAs(makeUser())
    const router = makeRouter()
    await router.push('/organizations/9')
    await router.isReady()
    const org = {
      id: 9,
      name: 'Capoeira Nova',
      slug: 'capoeira-nova',
      type: 'GROUP',
      status: 'ACTIVE',
      mestres: [
        { id: 41, name: 'Mestre A', email: 'a@nova.com', status: 'ACTIVE', twoFactorEnabled: true },
        { id: 42, name: 'Mestre B', email: 'b@nova.com', status: 'ACTIVE', twoFactorEnabled: false },
      ],
    }
    const { calls } = mockFetch((call: Call) => {
      if (call.path === '/organizations/9') return { body: org }
      if (call.method === 'POST') return { body: { twoFactorEnabled: false } }
      return { body: [] }
    })
    const wrapper = mount(OrganizationDetailView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('[data-testid="mestre-42"] [data-action="reset-2fa"]').exists()).toBe(false)
    await wrapper.get('[data-testid="mestre-41"] [data-action="reset-2fa"]').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.method === 'POST')?.path).toBe('/auth/2fa/reset/41')
  })
})
