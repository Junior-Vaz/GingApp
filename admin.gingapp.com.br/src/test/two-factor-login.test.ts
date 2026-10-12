import { describe, expect, it } from 'vitest'
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/stores/auth'
import LoginView from '@/views/LoginView.vue'
import { flushPromises, makeUser, mockFetch, mountView, type Call } from './helpers'

const CHALLENGE = 'challenge-abc'
const SESSION = { accessToken: 'jwt-final', user: makeUser() }

function handler(verify: (call: Call) => { status?: number; body?: unknown }) {
  return (call: Call) => {
    if (call.path === '/auth/capabilities') return { body: { passwordResetByEmail: false } }
    if (call.path === '/auth/platform-login') return { body: { twoFactorRequired: true, challengeToken: CHALLENGE } }
    if (call.path === '/auth/2fa/verify') return verify(call)
    return undefined
  }
}

async function firstStep() {
  const mounted = await mountView(LoginView)
  localStorage.clear() // mountView cria sessão de teste; o login parte sem sessão
  await mounted.wrapper.get('#email').setValue('equipe@gingapp.com.br')
  await mounted.wrapper.get('#password').setValue('SenhaSegura#2026')
  await mounted.wrapper.get('[data-testid="login-form"]').trigger('submit')
  await flushPromises()
  return mounted
}

const verify = async (wrapper: Awaited<ReturnType<typeof firstStep>>['wrapper'], value: string) => {
  await wrapper.get('#two-factor-code').setValue(value)
  await wrapper.get('[data-testid="two-factor-form"]').trigger('submit')
  await flushPromises()
}

describe('LoginView — 2º passo (2FA)', () => {
  it('mostra o segundo passo sem guardar sessão e conclui com o código do autenticador', async () => {
    const { calls } = mockFetch(handler(() => ({ body: SESSION })))
    const { wrapper, router } = await firstStep()

    expect(wrapper.find('[data-testid="two-factor-form"]').exists()).toBe(true)
    expect(wrapper.find('#password').exists()).toBe(false)
    expect(wrapper.text()).toContain('Verificar')
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(wrapper.html()).not.toContain(CHALLENGE)

    await verify(wrapper, '123 456')
    const post = calls.find((c) => c.path === '/auth/2fa/verify')!
    expect(post.method).toBe('POST')
    expect(post.body).toEqual({ challengeToken: CHALLENGE, code: '123456' })
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-final')
    expect(localStorage.getItem(AUTH_USER_KEY)).not.toBeNull()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('usa o código de recuperação quando escolhido', async () => {
    const { calls } = mockFetch(handler(() => ({ body: SESSION })))
    const { wrapper } = await firstStep()
    await wrapper.get('[data-testid="toggle-recovery"]').trigger('click')
    await verify(wrapper, 'abcde-12345')
    expect(calls.find((c) => c.path === '/auth/2fa/verify')!.body).toEqual({
      challengeToken: CHALLENGE,
      recoveryCode: 'abcde-12345',
    })
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('jwt-final')
  })

  it('código incorreto (400): mostra a mensagem, continua no 2º passo e não cria sessão', async () => {
    mockFetch(handler(() => ({ status: 400, body: { message: 'Código incorreto.' } })))
    const { wrapper } = await firstStep()
    await verify(wrapper, '000000')
    expect(wrapper.get('[role="alert"]').text()).toBe('Código incorreto.')
    expect(wrapper.find('[data-testid="two-factor-form"]').exists()).toBe(true)
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })

  it('desafio expirado (400): volta ao passo 1 com a mensagem; "Voltar" também retorna ao passo 1', async () => {
    mockFetch(handler(() => ({ status: 400, body: { message: 'O desafio expirou. Entre novamente.' } })))
    const { wrapper } = await firstStep()
    await verify(wrapper, '123456')
    expect(wrapper.find('[data-testid="login-form"]').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toBe('O desafio expirou. Entre novamente.')

    await wrapper.get('#password').setValue('SenhaSegura#2026')
    await wrapper.get('[data-testid="login-form"]').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-testid="two-factor-back"]').trigger('click')
    expect(wrapper.find('[data-testid="login-form"]').exists()).toBe(true)
  })

  it('formato inválido não chama a API', async () => {
    const { calls } = mockFetch(handler(() => ({ body: SESSION })))
    const { wrapper } = await firstStep()
    await verify(wrapper, '12')
    expect(wrapper.get('[role="alert"]').text()).toContain('6 dígitos')
    expect(calls.some((c) => c.path === '/auth/2fa/verify')).toBe(false)
  })
})
