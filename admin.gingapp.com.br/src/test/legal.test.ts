import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import LoginView from '@/views/LoginView.vue'
import LegalView from '@/views/LegalView.vue'
import { AUTH_USER_KEY } from '@/stores/auth'
import { flushPromises, loginAs, makeRouter, makeUser, mockFetch } from './helpers'

// E10: aceite bloqueante dos termos, páginas públicas e troca de senha obrigatória (mustChangePassword).
const DOC = {
  type: 'terms',
  title: 'Termos de Uso do GingApp',
  version: '2026-10-11.1',
  updatedAt: '2026-10-11',
  notice: 'MODELO — revisar com assessoria jurídica antes de publicar.',
  sections: [{ heading: '1. Aceitação', paragraphs: ['Texto da seção um.'] }],
}

async function mountLayout(userOverrides: Record<string, unknown>) {
  const { pinia, store } = loginAs(makeUser(userOverrides))
  const router = makeRouter()
  await router.push('/dashboard')
  await router.isReady()
  const wrapper = mount(SidebarLayout, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, store }
}

describe('admin: aceite dos termos', () => {
  it('aceite pendente bloqueia até marcar e aceitar; envia a versão vigente e libera', async () => {
    const { calls } = mockFetch((call) => {
      if (call.path === '/legal') return { body: { version: '2026-10-11.1' } }
      if (call.path === '/legal/terms' || call.path === '/legal/privacy') return { body: DOC }
      if (call.method === 'POST' && call.path === '/auth/accept-terms') return { body: { termsAcceptanceRequired: false } }
      return undefined
    })
    const { wrapper, store } = await mountLayout({ termsAcceptanceRequired: true })
    expect(wrapper.find('[data-testid="terms-gate"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('MODELO — revisar com assessoria jurídica')
    const accept = wrapper.get('[data-testid="terms-accept"]')
    expect((accept.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-testid="terms-agree"]').setValue(true)
    expect((accept.element as HTMLButtonElement).disabled).toBe(false)
    await accept.trigger('click')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/accept-terms')?.body).toEqual({ version: '2026-10-11.1' })
    expect(wrapper.find('[data-testid="terms-gate"]').exists()).toBe(false)
    expect(store.user?.termsAcceptanceRequired).toBe(false)
    expect(JSON.parse(localStorage.getItem(AUTH_USER_KEY) ?? '{}').termsAcceptanceRequired).toBe(false)
  })

  it('aceite em dia: sem tela bloqueante; erro do servidor mantém o bloqueio', async () => {
    mockFetch(() => undefined)
    const ok = await mountLayout({ termsAcceptanceRequired: false })
    expect(ok.wrapper.find('[data-testid="terms-gate"]').exists()).toBe(false)
    ok.wrapper.unmount()

    mockFetch((call) => {
      if (call.path === '/legal') return { body: { version: '2026-10-11.1' } }
      if (call.method === 'POST') return { status: 409, body: { message: 'Os termos foram atualizados.' } }
      return { body: DOC }
    })
    const { wrapper, store } = await mountLayout({ termsAcceptanceRequired: true })
    await wrapper.get('[data-testid="terms-agree"]').setValue(true)
    await wrapper.get('[data-testid="terms-accept"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="terms-gate"]').exists()).toBe(true)
    expect(store.user?.termsAcceptanceRequired).toBe(true)
  })
})

describe('admin: troca de senha obrigatória (mustChangePassword)', () => {
  it('com a flag, o admin mostra só a troca (sem Cancelar nem telas) e trocar a senha limpa a flag', async () => {
    const { calls } = mockFetch((call) => {
      if (call.method === 'POST' && call.path === '/auth/change-password') return { body: { accessToken: 'novo' } }
      return undefined
    })
    const { wrapper, store } = await mountLayout({ mustChangePassword: true })
    expect(wrapper.find('[data-testid="must-change-password"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="forced-notice"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Cancelar')
    expect(calls).toHaveLength(0) // nenhuma chamada de dados com a flag ligada

    await wrapper.get('#own-current-password').setValue('Provisoria#2026ab')
    await wrapper.get('#own-new-password').setValue('NovaSenhaForte#9xy')
    await wrapper.get('#own-confirm-password').setValue('NovaSenhaForte#9xy')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/change-password')?.body).toMatchObject({ currentPassword: 'Provisoria#2026ab' })
    expect(store.user?.mustChangePassword).toBe(false)
    expect(wrapper.find('[data-testid="must-change-password"]').exists()).toBe(false)
    expect(store.token).toBe('novo')
  })
})

describe('admin: páginas públicas', () => {
  it('/termos mostra o aviso de MODELO e o texto da API; o login traz os links', async () => {
    mockFetch((call) => (call.path === '/legal/terms' ? { body: DOC } : undefined))
    const { pinia } = loginAs()
    const router = makeRouter()
    await router.push('/')
    const view = mount(LegalView, { props: { type: 'terms' }, global: { plugins: [pinia, router] } })
    await flushPromises()
    expect(view.text()).toContain('Termos de Uso do GingApp')
    expect(view.get('[data-testid="legal-notice"]').text()).toMatch(/MODELO — revisar com assessoria jurídica/)
    expect(view.text()).toContain('Texto da seção um.')

    const login = mount(LoginView, { global: { plugins: [pinia, router] } })
    const hrefs = login.findAll('[data-testid="legal-links"] a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/termos', '/privacidade'])
  })
})
