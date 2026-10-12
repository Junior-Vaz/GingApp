import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import realRouter from '@/router'
import ForgotPasswordView from '@/views/ForgotPasswordView.vue'
import LoginView from '@/views/LoginView.vue'
import ResetPasswordView from '@/views/ResetPasswordView.vue'
import { flushPromises, loginAs, mockFetch } from './helpers'

const NEUTRAL = 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.'
const STRONG = 'NovaSenhaForte#9xy'

function publicRouter() {
  const stub = { template: '<div />' }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: stub },
      { path: '/esqueci-senha', name: 'forgot-password', component: stub },
      { path: '/redefinir-senha', name: 'reset-password', component: stub },
    ],
  })
}

async function mountPublic(component: object, url = '/login') {
  setActivePinia(createPinia())
  const router = publicRouter()
  await router.push(url)
  await router.isReady()
  const wrapper = mount(component, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('admin: esqueci minha senha', () => {
  it('após enviar mostra SEMPRE a mensagem neutra e chama o endpoint público', async () => {
    const { calls } = mockFetch((call) =>
      call.method === 'POST' && call.path === '/auth/forgot-password' ? { status: 202, body: { message: 'qualquer' } } : undefined,
    )
    const { wrapper } = await mountPublic(ForgotPasswordView, '/esqueci-senha')
    await wrapper.get('#forgot-email').setValue('equipe@gingapp.com.br')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/forgot-password')?.body).toEqual({ email: 'equipe@gingapp.com.br' })
    expect(wrapper.get('[data-testid="forgot-neutral"]').text()).toBe(NEUTRAL)
    expect(wrapper.find('form').exists()).toBe(false)
  })
})

describe('admin: redefinir senha', () => {
  it('envia token + nova senha, tira o token da URL e mostra sucesso com link para o login', async () => {
    const { calls } = mockFetch((call) =>
      call.method === 'POST' && call.path === '/auth/reset-password' ? { body: { message: 'ok' } } : undefined,
    )
    const { wrapper, router } = await mountPublic(ResetPasswordView, '/redefinir-senha?token=abc123')
    expect(router.currentRoute.value.query.token).toBeUndefined() // removido da URL

    await wrapper.get('#reset-new-password').setValue(STRONG)
    await wrapper.get('#reset-confirm-password').setValue(STRONG)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/reset-password')?.body).toEqual({ token: 'abc123', newPassword: STRONG })
    expect(wrapper.find('[data-testid="reset-success"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="reset-login-link"]').attributes('href')).toBe('/login')
  })

  it('400 do backend mostra a mensagem dele; sem token mostra erro amigável', async () => {
    mockFetch((call) =>
      call.path === '/auth/reset-password' ? { status: 400, body: { message: 'Link inválido ou expirado.' } } : undefined,
    )
    const { wrapper } = await mountPublic(ResetPasswordView, '/redefinir-senha?token=velho')
    await wrapper.get('#reset-new-password').setValue(STRONG)
    await wrapper.get('#reset-confirm-password').setValue(STRONG)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="reset-error"]').text()).toBe('Link inválido ou expirado.')
    expect(wrapper.find('[data-testid="reset-success"]').exists()).toBe(false)

    const semToken = await mountPublic(ResetPasswordView, '/redefinir-senha')
    expect(semToken.wrapper.find('[data-testid="reset-missing"]').exists()).toBe(true)
    expect(semToken.wrapper.find('form').exists()).toBe(false)
  })
})

describe('admin: link "Esqueci minha senha" no login', () => {
  async function loginWith(capabilities: { status?: number; body?: unknown }) {
    mockFetch((call) => (call.path === '/auth/capabilities' ? capabilities : undefined))
    return mountPublic(LoginView)
  }

  it('oculto quando a capacidade está desligada ou a chamada falha; visível quando ligada', async () => {
    expect((await loginWith({ body: { passwordResetByEmail: false } })).wrapper.find('[data-testid="forgot-link"]').exists()).toBe(false)
    expect((await loginWith({ status: 500, body: { message: 'x' } })).wrapper.find('[data-testid="forgot-link"]').exists()).toBe(false)

    const on = await loginWith({ body: { passwordResetByEmail: true } })
    expect(on.wrapper.get('[data-testid="forgot-link"]').attributes('href')).toBe('/esqueci-senha')
  })
})

describe('admin: rotas públicas de recuperação', () => {
  it('abrem com ou sem sessão, sem redirecionar para o login nem para o dashboard', async () => {
    mockFetch(() => undefined)
    setActivePinia(createPinia()) // sem sessão
    await realRouter.push('/esqueci-senha')
    expect(realRouter.currentRoute.value.path).toBe('/esqueci-senha')

    loginAs() // com sessão: continua podendo abrir as duas
    await realRouter.push('/redefinir-senha')
    expect(realRouter.currentRoute.value.path).toBe('/redefinir-senha')
    await realRouter.push('/esqueci-senha')
    expect(realRouter.currentRoute.value.path).toBe('/esqueci-senha')
  })
})
