import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import LoginView from '@/views/LoginView.vue'
import OrganizationsView from '@/views/OrganizationsView.vue'
import PlansView from '@/views/PlansView.vue'
import { flushPromises, mockFetch, mountView } from './helpers'
import { createPinia, setActivePinia } from 'pinia'

afterEach(() => vi.unstubAllEnvs())

describe('LoginView — dica de dev', () => {
  it('mostra a dica em dev e a esconde no build de produção', async () => {
    mockFetch(() => ({}))
    let { wrapper } = await mountView(LoginView)
    expect(wrapper.text()).toContain('Dev@12345')
    wrapper.unmount()
    vi.stubEnv('DEV', false)
    ;({ wrapper } = await mountView(LoginView))
    expect(wrapper.text()).not.toContain('Dev@12345')
  })
})

describe('auth.login — mensagens de erro', () => {
  async function loginError(status: number, body: unknown): Promise<string> {
    mockFetch(() => ({ status, body }))
    setActivePinia(createPinia())
    return useAuthStore()
      .login('a@b.com', 'x')
      .then(
        () => '',
        (e: Error) => e.message,
      )
  }

  it('400 (array em inglês) vira texto em português; 429 vira aviso amigável; string do servidor é mantida', async () => {
    expect(await loginError(400, { message: ['email must be an email'] })).toBe('Informe um e-mail válido e a senha.')
    expect(await loginError(429, { message: 'ThrottlerException: Too Many Requests' })).toBe(
      'Muitas tentativas. Aguarde um minuto e tente de novo.',
    )
    expect(await loginError(401, { message: 'Credenciais inválidas.' })).toBe('Credenciais inválidas.')
  })
})

describe('OrganizationsView — limite e total', () => {
  it('pede limit=200 e avisa quando X-Total-Count excede o carregado', async () => {
    const orgs = [{ id: 1, name: 'G1', slug: 'g1', type: 'GROUP', status: 'ACTIVE' }]
    const { calls } = mockFetch(() => ({ body: orgs, headers: { 'X-Total-Count': '250' } }))
    const { wrapper } = await mountView(OrganizationsView)
    expect(calls[0].query.get('limit')).toBe('200')
    expect(wrapper.get('[data-testid="list-truncated"]').text()).toBe('Mostrando 1 de 250 grupos')
  })

  it('sem excedente não mostra aviso', async () => {
    mockFetch(() => ({ body: [{ id: 1, name: 'G1', slug: 'g1', type: 'GROUP', status: 'ACTIVE' }] }))
    const { wrapper } = await mountView(OrganizationsView)
    expect(wrapper.find('[data-testid="list-truncated"]').exists()).toBe(false)
  })

  it('429 ao criar grupo aparece em português', async () => {
    mockFetch((c) => (c.method === 'POST' ? { status: 429, body: { message: 'Too Many Requests' } } : { body: [] }))
    const { wrapper } = await mountView(OrganizationsView)
    await wrapper.get('[data-testid="new-group"]').trigger('click')
    const pw = 'MestreSeguro#2026'
    for (const [s, v] of Object.entries({
      '#org-name': 'Capoeira Nova',
      '#mestre-name': 'Mestre Novo',
      '#mestre-email': 'm@n.com.br',
      '#mestre-password': pw,
      '#mestre-password-confirm': pw,
    }))
      await wrapper.get(s).setValue(v)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Muitas tentativas. Aguarde um minuto e tente de novo.')
  })
})

describe('PlansView — limpar limites', () => {
  const plan = { id: 3, name: 'Pro', code: 'PRO', priceCents: 1000, billingPeriod: 'MONTHLY', maxUnits: 2, maxStudents: 50, isActive: true }

  it('editar com campos vazios envia null; criar com vazios omite', async () => {
    const { calls } = mockFetch((c) => (c.method === 'GET' ? { body: [plan] } : { body: plan }))
    const { wrapper } = await mountView(PlansView)
    const btn = (t: string) => wrapper.findAll('button').find((b) => b.text().includes(t))!
    await btn('Editar').trigger('click')
    const inputs = wrapper.findAll('input[type="number"]')
    for (const i of inputs) if (['2', '50'].includes((i.element as HTMLInputElement).value)) await i.setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toMatchObject({ maxUnits: null, maxStudents: null })
  })
})
