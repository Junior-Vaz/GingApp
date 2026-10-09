import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/stores/auth'
import { api } from '@/utils/api'
import { takeFlash } from '@/utils/flash'
import { changePasswordProblem, passwordProblem } from '@/utils/password'
import OrganizationDetailView from '@/views/OrganizationDetailView.vue'
import { flushPromises, loginAs, makeRouter, makeUser, mockFetch, type Call, type MockReply } from './helpers'

const NEW_PASSWORD = 'NovaSenhaMestre#26'
const CURRENT = 'SenhaAtual#2024'
const MESTRE_NOTICE = 'Senha redefinida — informe ao MESTRE por canal seguro; as sessões dele foram encerradas.'
const SELF_NOTICE = 'Senha alterada. Você continua conectado.'

const org = { id: 9, name: 'Capoeira Nova', slug: 'capoeira-nova', type: 'GROUP', status: 'ACTIVE' }
const mestres = [
  { id: 70, name: 'Mestre Ativo', email: 'ativo@novo.com.br', status: 'ACTIVE' },
  { id: 71, name: 'Mestre Inativo', email: 'inativo@novo.com.br', status: 'INACTIVE' },
]

type DetailOverrides = { orgReply?: MockReply; resetReply?: MockReply | Promise<MockReply> }

/** Monta o detalhe do grupo 9 com o usuário PLATFORM informado; `calls` registra tudo. */
async function mountDetail(user = makeUser(), overrides: DetailOverrides = {}) {
  const { pinia, store } = loginAs(user)
  const router = makeRouter()
  await router.push('/organizations/9')
  await router.isReady()
  const { calls } = mockFetch(async (call) => {
    if (call.method === 'GET' && call.path === '/organizations/9') {
      return overrides.orgReply ?? { body: { ...org, mestres } }
    }
    if (call.method === 'POST' && call.path.endsWith('/reset-password')) {
      return (await overrides.resetReply) ?? { status: 204 }
    }
    if (call.method === 'GET') return { body: [] }
    return undefined
  })
  const wrapper = mount(OrganizationDetailView, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, calls, store, router }
}

const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const resetButton = (wrapper: VueWrapper, mestreId: number) =>
  wrapper.get(`[data-testid="mestre-${mestreId}"] [data-action="reset-password"]`)
const input = (wrapper: VueWrapper, selector: string) => wrapper.get(selector).element as HTMLInputElement

async function openReset(wrapper: VueWrapper, mestreId = 70) {
  await resetButton(wrapper, mestreId).trigger('click')
}
async function fillReset(wrapper: VueWrapper, password = NEW_PASSWORD, confirm = password) {
  await wrapper.get('#reset-mestre-password').setValue(password)
  await wrapper.get('#reset-mestre-password-confirm').setValue(confirm)
}
async function submitForm(wrapper: VueWrapper) {
  await wrapper.get('[role="dialog"] form').trigger('submit')
  await flushPromises()
}

describe('regras de senha do cliente (espelham o backend)', () => {
  it('12 caracteres mínimo, 72 BYTES máximo, sem Dev@12345, confirmação igual', () => {
    expect(passwordProblem('a'.repeat(11), 'a'.repeat(11))).toContain('mínimo 12')
    expect(passwordProblem('a'.repeat(12), 'a'.repeat(12))).toBeNull()
    expect(passwordProblem('a'.repeat(72), 'a'.repeat(72))).toBeNull()
    expect(passwordProblem('a'.repeat(73), 'a'.repeat(73))).toContain('máximo 72')
    expect(passwordProblem('ç'.repeat(36), 'ç'.repeat(36))).toBeNull() // 72 bytes
    expect(passwordProblem('ç'.repeat(37), 'ç'.repeat(37))).toContain('máximo 72') // 74 bytes
    expect(passwordProblem('xxxDEV@12345xxxxx', 'xxxDEV@12345xxxxx')).toContain('padrão de desenvolvimento')
    expect(passwordProblem(NEW_PASSWORD, NEW_PASSWORD + 'x')).toContain('confirmação da senha não confere')
    expect(passwordProblem(' '.repeat(12), ' '.repeat(12))).toBeNull() // não apara espaços
  })

  it('troca da própria senha: atual obrigatória e nova diferente da atual', () => {
    expect(changePasswordProblem('', NEW_PASSWORD, NEW_PASSWORD)).toContain('senha atual')
    expect(changePasswordProblem(NEW_PASSWORD, NEW_PASSWORD, NEW_PASSWORD)).toContain('diferente da atual')
    expect(changePasswordProblem(CURRENT, NEW_PASSWORD, NEW_PASSWORD)).toBeNull()
  })
})

describe('OrganizationDetailView — carga via GET /organizations/:id e MESTREs', () => {
  it('carrega o grupo por GET /organizations/9 (não pela lista) e mostra nome e slug', async () => {
    const { wrapper, calls } = await mountDetail()
    expect(calls.some((c) => c.method === 'GET' && c.path === '/organizations/9')).toBe(true)
    expect(calls.some((c) => c.method === 'GET' && c.path === '/organizations')).toBe(false)
    expect(wrapper.text()).toContain('Capoeira Nova')
    expect(wrapper.text()).toContain('capoeira-nova')
  })

  it('lista os MESTREs com nome, e-mail e status (inclui inativos)', async () => {
    const { wrapper } = await mountDetail()
    const ativo = wrapper.get('[data-testid="mestre-70"]').text()
    expect(ativo).toContain('Mestre Ativo')
    expect(ativo).toContain('ativo@novo.com.br')
    expect(ativo).toContain('Ativo')
    const inativo = wrapper.get('[data-testid="mestre-71"]').text()
    expect(inativo).toContain('Mestre Inativo')
    expect(inativo).toContain('Inativo')
  })

  it('sem MESTREs: mensagem vazia', async () => {
    const { wrapper } = await mountDetail(makeUser(), { orgReply: { body: { ...org, mestres: [] } } })
    expect(wrapper.text()).toContain('Nenhum MESTRE vinculado')
  })

  it('erro ao abrir o grupo (404 do backend): mostra a mensagem', async () => {
    const { wrapper } = await mountDetail(makeUser(), {
      orgReply: { status: 404, body: { message: 'Organização não encontrada.' } },
    })
    expect(wrapper.text()).toContain('Organização não encontrada.')
    expect(wrapper.find('[data-testid="mestres"]').exists()).toBe(false)
  })
})

describe('OrganizationDetailView — quem vê "Redefinir senha"', () => {
  it('super admin PLATFORM: botão habilitado para ACTIVE e DESABILITADO para INACTIVE', async () => {
    const { wrapper } = await mountDetail()
    expect(resetButton(wrapper, 70).attributes('disabled')).toBeUndefined()
    expect(resetButton(wrapper, 71).attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="reset-readonly-note"]').exists()).toBe(false)
  })

  it('clicar no botão do MESTRE inativo não abre modal', async () => {
    const { wrapper } = await mountDetail()
    await resetButton(wrapper, 71).trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('PLATFORM que NÃO é super admin: sem botão de reset e com aviso (a lista de MESTREs continua visível)', async () => {
    const { wrapper } = await mountDetail(makeUser({ id: 2, isSuperAdmin: false }))
    expect(wrapper.find('[data-action="reset-password"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Redefinir senha'))).toBe(false)
    expect(wrapper.get('[data-testid="reset-readonly-note"]').text()).toContain('Somente super admins')
    expect(wrapper.get('[data-testid="mestre-70"]').text()).toContain('Mestre Ativo')
  })

  it('MEMBER com isSuperAdmin=true NÃO vê o botão (só PLATFORM conta)', async () => {
    const { wrapper } = await mountDetail(makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true }))
    expect(wrapper.find('[data-action="reset-password"]').exists()).toBe(false)
  })
})

describe('OrganizationDetailView — redefinir a senha do MESTRE', () => {
  it('validação no cliente: curta, longa em bytes, Dev@12345, confirmação diferente — sem chamar a API', async () => {
    const { wrapper, calls } = await mountDetail()
    await openReset(wrapper)
    const alert = () => wrapper.get('[role="dialog"] [role="alert"]').text()

    await fillReset(wrapper, 'Abcdef#1234')
    await submitForm(wrapper)
    expect(alert()).toContain('mínimo 12')

    await fillReset(wrapper, 'ç'.repeat(37))
    await submitForm(wrapper)
    expect(alert()).toContain('máximo 72')

    await fillReset(wrapper, 'Dev@12345Dev@12345')
    await submitForm(wrapper)
    expect(alert()).toContain('padrão de desenvolvimento')

    await fillReset(wrapper, NEW_PASSWORD, NEW_PASSWORD + 'x')
    await submitForm(wrapper)
    expect(alert()).toContain('confirmação da senha não confere')

    expect(nonGet(calls)).toHaveLength(0)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('sucesso: POST no caminho certo com só {newPassword}, fecha, avisa e NÃO deixa a senha na tela/formulário', async () => {
    takeFlash()
    const { wrapper, calls } = await mountDetail()
    await openReset(wrapper)
    await fillReset(wrapper)
    await submitForm(wrapper)

    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ method: 'POST', path: '/organizations/9/members/70/reset-password' })
    expect(posts[0].body).toEqual({ newPassword: NEW_PASSWORD })
    expect(posts[0].headers.Authorization).toBe('Bearer test-token')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toBe(MESTRE_NOTICE)
    expect(wrapper.html()).not.toContain(NEW_PASSWORD)

    // reabrir: campos vazios (a senha não ficou no formulário)
    await openReset(wrapper)
    expect(input(wrapper, '#reset-mestre-password').value).toBe('')
    expect(input(wrapper, '#reset-mestre-password-confirm').value).toBe('')
  })

  it.each([
    [404, { message: 'Mestre não encontrado neste grupo.' }, 'Mestre não encontrado neste grupo.'],
    [403, { message: 'Apenas super admins ativos da plataforma podem executar esta operação.' }, 'Apenas super admins ativos da plataforma podem executar esta operação.'],
    [
      400,
      { message: ['newPassword deve ter no mínimo 12 caracteres.', 'newPassword não pode ser a senha padrão de desenvolvimento.'] },
      'newPassword deve ter no mínimo 12 caracteres. newPassword não pode ser a senha padrão de desenvolvimento.',
    ],
    [429, { message: 'ThrottlerException: Too Many Requests' }, 'Muitas tentativas. Aguarde um minuto e tente novamente.'],
  ])('erro %i: mostra a mensagem, mantém o modal, limpa as senhas e não avisa sucesso', async (status, body, expected) => {
    takeFlash()
    const { wrapper } = await mountDetail(makeUser(), { resetReply: { status, body } })
    await openReset(wrapper)
    await fillReset(wrapper)
    await submitForm(wrapper)

    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe(expected)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(input(wrapper, '#reset-mestre-password').value).toBe('')
    expect(input(wrapper, '#reset-mestre-password-confirm').value).toBe('')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('botão desabilitado durante o envio (sem duplo POST)', async () => {
    let release: (value: MockReply) => void = () => {}
    const pending = new Promise<MockReply>((resolve) => (release = resolve))
    const { wrapper, calls } = await mountDetail(makeUser(), { resetReply: pending })
    await openReset(wrapper)
    await fillReset(wrapper)
    await wrapper.get('[role="dialog"] form').trigger('submit')
    await flushPromises()
    const button = wrapper.get('[role="dialog"] form button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.get('[role="dialog"] form').trigger('submit') // segundo Enter
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(1)
    release({ status: 204 })
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('cancelar limpa os campos', async () => {
    const { wrapper } = await mountDetail()
    await openReset(wrapper)
    await fillReset(wrapper)
    await wrapper.get('[role="dialog"] form button[type="button"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await openReset(wrapper)
    expect(input(wrapper, '#reset-mestre-password').value).toBe('')
  })
})

describe('Alterar a PRÓPRIA senha (PLATFORM) — menu do usuário', () => {
  async function mountLayout(user = makeUser(), reply: MockReply | ((call: Call) => MockReply) = { body: { accessToken: 'novo-token' } }) {
    const { pinia, store } = loginAs(user)
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const { calls } = mockFetch((call) => {
      if (call.method === 'POST' && call.path === '/auth/change-password') return typeof reply === 'function' ? reply(call) : reply
      return undefined
    })
    const wrapper = mount(SidebarLayout, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await flushPromises()
    return { wrapper, calls, store, router }
  }
  const openOwn = async (wrapper: VueWrapper) => wrapper.get('[data-testid="change-password"]').trigger('click')
  async function fillOwn(wrapper: VueWrapper, current = CURRENT, next = NEW_PASSWORD, confirm = next) {
    await wrapper.get('#own-current-password').setValue(current)
    await wrapper.get('#own-new-password').setValue(next)
    await wrapper.get('#own-confirm-password').setValue(confirm)
  }

  it('qualquer usuário PLATFORM (inclusive não super admin) vê o item no menu', async () => {
    for (const user of [makeUser(), makeUser({ id: 2, isSuperAdmin: false })]) {
      const { wrapper } = await mountLayout(user)
      expect(wrapper.get('[data-testid="change-password"]').text()).toBe('Alterar senha')
    }
  })

  it('sucesso: POST {currentPassword,newPassword}, guarda o NOVO token, mantém usuário e sessão, limpa a tela', async () => {
    const { wrapper, calls, store, router } = await mountLayout()
    const userBefore = localStorage.getItem(AUTH_USER_KEY)
    await openOwn(wrapper)
    await fillOwn(wrapper)
    await wrapper.get('[role="dialog"] form').trigger('submit')
    await flushPromises()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/change-password' })
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
    expect(calls[0].body).toEqual({ currentPassword: CURRENT, newPassword: NEW_PASSWORD }) // sem confirmação
    expect(store.token).toBe('novo-token')
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('novo-token')
    expect(localStorage.getItem(AUTH_USER_KEY)).toBe(userBefore)
    expect(store.isAuthenticated).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/') // não foi para o login
    expect(wrapper.get('[role="status"]').text()).toBe(SELF_NOTICE)
    expect(wrapper.html()).not.toContain(NEW_PASSWORD)
    expect(wrapper.html()).not.toContain(CURRENT)
    expect(wrapper.find('#own-new-password').exists()).toBe(false)

    // fechar e reabrir: campos vazios; chamadas seguintes já usam o token novo
    await wrapper.get('[role="dialog"] button').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await openOwn(wrapper)
    expect(input(wrapper, '#own-current-password').value).toBe('')
    expect(input(wrapper, '#own-new-password').value).toBe('')
    const next = mockFetch(() => ({ body: [] }))
    await api.get('/organizations')
    expect(next.calls[0].headers.Authorization).toBe('Bearer novo-token')
  })

  it('400 "Senha atual incorreta.": mostra a mensagem, NÃO desloga, mantém o token e o modal; limpa as senhas', async () => {
    const { wrapper, store, router } = await mountLayout(makeUser(), { status: 400, body: { message: 'Senha atual incorreta.' } })
    await openOwn(wrapper)
    await fillOwn(wrapper, 'errada-errada-1')
    await wrapper.get('[role="dialog"] form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe('Senha atual incorreta.')
    expect(store.token).toBe('test-token')
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('test-token')
    expect(localStorage.getItem(AUTH_USER_KEY)).not.toBeNull()
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(input(wrapper, '#own-new-password').value).toBe('')
  })

  it('400 de política com message ARRAY junta; 429 vira texto amigável; 409 mostra a do backend', async () => {
    const replies: MockReply[] = [
      { status: 400, body: { message: ['newPassword deve ter no mínimo 12 caracteres.', 'outra regra'] } },
      { status: 429, body: { message: 'ThrottlerException' } },
      { status: 409, body: { message: 'A senha foi alterada em outra sessão. Tente novamente.' } },
    ]
    const expected = [
      'newPassword deve ter no mínimo 12 caracteres. outra regra',
      'Muitas tentativas. Aguarde um minuto e tente novamente.',
      'A senha foi alterada em outra sessão. Tente novamente.',
    ]
    let n = 0
    const { wrapper, store } = await mountLayout(makeUser(), () => replies[n++]!)
    await openOwn(wrapper)
    for (const message of expected) {
      await fillOwn(wrapper)
      await wrapper.get('[role="dialog"] form').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe(message)
    }
    expect(store.token).toBe('test-token')
  })

  it('validação no cliente (sem chamar a API): confirmação diferente, igual à atual, curta, Dev@12345', async () => {
    const { wrapper, calls } = await mountLayout()
    await openOwn(wrapper)
    const alert = () => wrapper.get('[role="dialog"] [role="alert"]').text()
    const attempt = async (...args: [string, string, string]) => {
      await fillOwn(wrapper, ...args)
      await wrapper.get('[role="dialog"] form').trigger('submit')
      await flushPromises()
    }
    await attempt(CURRENT, NEW_PASSWORD, NEW_PASSWORD + 'x')
    expect(alert()).toContain('confirmação da senha não confere')
    await attempt(CURRENT, CURRENT, CURRENT)
    expect(alert()).toContain('diferente da atual')
    await attempt(CURRENT, 'curta', 'curta')
    expect(alert()).toContain('mínimo 12')
    await attempt(CURRENT, 'Dev@12345Dev@', 'Dev@12345Dev@')
    expect(alert()).toContain('padrão de desenvolvimento')
    await attempt('', NEW_PASSWORD, NEW_PASSWORD)
    expect(alert()).toContain('senha atual')
    expect(calls).toHaveLength(0)
  })

  it('401 de verdade (sessão inválida) desloga', async () => {
    window.history.pushState({}, '', '/login') // evita a navegação não implementada do jsdom
    const { wrapper } = await mountLayout(makeUser(), { status: 401, body: { message: 'Unauthorized' } })
    await openOwn(wrapper)
    await fillOwn(wrapper)
    await wrapper.get('[role="dialog"] form').trigger('submit')
    await flushPromises()
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull()
  })

  it('200 sem accessToken: não finge sucesso (sessão encerrada, erro mostrado)', async () => {
    const { wrapper, store } = await mountLayout(makeUser(), { body: {} })
    await openOwn(wrapper)
    await fillOwn(wrapper)
    await wrapper.get('[role="dialog"] form').trigger('submit')
    await flushPromises()
    expect(store.token).toBeNull()
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('Entre novamente')
  })
})

describe('401 obsoleto (token trocado durante a chamada)', () => {
  it('um 401 de requisição feita com o token ANTIGO não derruba a sessão que já tem o token novo', async () => {
    window.history.pushState({}, '', '/dashboard')
    localStorage.setItem(AUTH_TOKEN_KEY, 'tok')
    localStorage.setItem(AUTH_USER_KEY, '{}')
    mockFetch(() => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'novo-token') // a troca de senha termina com esta chamada em voo
      return { status: 401, body: { message: 'Unauthorized' } }
    })
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('novo-token')
    expect(localStorage.getItem(AUTH_USER_KEY)).toBe('{}')
    expect(window.location.pathname).toBe('/dashboard')
  })
})
