import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { takeFlash } from '@/utils/flash'
import OrganizationDetailView from '@/views/OrganizationDetailView.vue'
import OrganizationsView from '@/views/OrganizationsView.vue'
import { flushPromises, loginAs, makeRouter, makeUser, mockFetch, mountView, type Call, type MockReply } from './helpers'

const PASSWORD = 'MestreSeguro#2026'
const NOTICE = 'Grupo criado — informe ao MESTRE a senha inicial por canal seguro.'

const orgs = [
  { id: 2, name: 'Grupo Dois', slug: 'grupo-dois', type: 'GROUP', status: 'ACTIVE' },
  { id: 1, name: 'Grupo Ginga Brasil', slug: 'ginga-brasil', type: 'GROUP', status: 'INACTIVE' },
]
const createdOrg = { id: 9, name: 'Capoeira Nova', slug: 'capoeira-nova', type: 'GROUP', status: 'ACTIVE' }
const createdReply = {
  status: 201,
  body: { ...createdOrg, mestre: { id: 70, name: 'Mestre Novo', email: 'mestre@novo.com.br' } },
}

const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const buttonByText = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text().includes(text))!

async function openModal(wrapper: VueWrapper) {
  await buttonByText(wrapper, '+ Novo grupo').trigger('click')
}

async function fill(wrapper: VueWrapper, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    '#org-name': 'Capoeira Nova',
    '#org-slug': '',
    '#org-document': '',
    '#org-phone': '',
    '#org-email': '',
    '#mestre-name': 'Mestre Novo',
    '#mestre-email': 'mestre@novo.com.br',
    '#mestre-password': PASSWORD,
    '#mestre-password-confirm': PASSWORD,
    ...overrides,
  }
  for (const [selector, value] of Object.entries(values)) await wrapper.get(selector).setValue(value)
}

const submit = async (wrapper: VueWrapper) => {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('OrganizationsView — lista e permissão do botão', () => {
  it('lista as organizações (GET /organizations) com status', async () => {
    const { calls } = mockFetch(() => ({ body: orgs }))
    const { wrapper } = await mountView(OrganizationsView)
    expect(calls[0].path).toBe('/organizations')
    expect(wrapper.get('[data-testid="org-2"]').text()).toContain('Grupo Dois')
    expect(wrapper.get('[data-testid="org-1"]').text()).toContain('INACTIVE')
  })

  it('super admin ativo vê "+ Novo grupo" e não vê o aviso de somente leitura', async () => {
    mockFetch(() => ({ body: orgs }))
    const { wrapper } = await mountView(OrganizationsView)
    expect(wrapper.find('[data-testid="new-group"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(false)
  })

  it('PLATFORM que não é super admin NÃO vê o botão e recebe o aviso', async () => {
    mockFetch(() => ({ body: orgs }))
    const { wrapper } = await mountView(OrganizationsView, makeUser({ id: 2, isSuperAdmin: false }))
    expect(wrapper.find('[data-testid="new-group"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="readonly-note"]').text()).toContain('Somente super admins')
    expect(wrapper.findAll('button').some((b) => b.text().includes('Novo grupo'))).toBe(false)
  })

  it('MEMBER com isSuperAdmin=true NÃO vê o botão (só PLATFORM conta)', async () => {
    mockFetch(() => ({ body: orgs }))
    const { wrapper } = await mountView(OrganizationsView, makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true }))
    expect(wrapper.find('[data-testid="new-group"]').exists()).toBe(false)
  })

  it('erro ao listar mostra a mensagem do backend', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'Acesso restrito à equipe da plataforma GingApp.' } }))
    const { wrapper } = await mountView(OrganizationsView)
    expect(wrapper.get('[role="alert"]').text()).toBe('Acesso restrito à equipe da plataforma GingApp.')
  })
})

describe('OrganizationsView — validação no cliente (sem chamar a API)', () => {
  it('nome, slug, nome/e-mail do MESTRE, senha 12..72 bytes e confirmação', async () => {
    const { calls } = mockFetch(() => ({ body: orgs }))
    const { wrapper } = await mountView(OrganizationsView)
    await openModal(wrapper)

    const alert = () => wrapper.get('[role="dialog"] [role="alert"]').text()

    await fill(wrapper, { '#org-name': 'A' })
    await submit(wrapper)
    expect(alert()).toContain('nome do grupo')

    await fill(wrapper, { '#org-slug': 'Slug Inválido' })
    await submit(wrapper)
    expect(alert()).toContain('slug')

    await fill(wrapper, { '#org-slug': 'grupo--x' })
    await submit(wrapper)
    expect(alert()).toContain('slug')

    await fill(wrapper, { '#mestre-name': 'M' })
    await submit(wrapper)
    expect(alert()).toContain('nome do MESTRE')

    await fill(wrapper, { '#mestre-email': 'sem-arroba' })
    await submit(wrapper)
    expect(alert()).toContain('e-mail válido')

    const eleven = 'Abcdef#1234'
    await fill(wrapper, { '#mestre-password': eleven, '#mestre-password-confirm': eleven })
    await submit(wrapper)
    expect(alert()).toContain('mínimo 12')

    await fill(wrapper, { '#mestre-password-confirm': PASSWORD + 'x' })
    await submit(wrapper)
    expect(alert()).toContain('confirmação da senha não confere')

    const long = 'ç'.repeat(37) // 37 caracteres, 74 bytes UTF-8
    await fill(wrapper, { '#mestre-password': long, '#mestre-password-confirm': long })
    await submit(wrapper)
    expect(alert()).toContain('no máximo 72')

    expect(nonGet(calls)).toHaveLength(0)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('exatamente 12 e exatamente 72 bytes passam na validação do cliente', async () => {
    for (const password of ['Abcdefgh#123', 'ç'.repeat(36)]) {
      const { calls } = mockFetch((call) => (call.method === 'POST' ? createdReply : { body: orgs }))
      const { wrapper } = await mountView(OrganizationsView)
      await openModal(wrapper)
      await fill(wrapper, { '#mestre-password': password, '#mestre-password-confirm': password })
      await submit(wrapper)
      expect(nonGet(calls)).toHaveLength(1)
      takeFlash()
    }
  })
})

describe('OrganizationsView — criar grupo', () => {
  it('POST /organizations com o corpo certo, sem passwordConfirm; limpa a senha; navega e deixa o aviso', async () => {
    takeFlash()
    const { calls } = mockFetch((call) => (call.method === 'POST' ? createdReply : { body: orgs }))
    const { wrapper, router } = await mountView(OrganizationsView)
    await openModal(wrapper)
    await fill(wrapper, {
      '#org-name': '  Capoeira Nova  ',
      '#org-slug': ' capoeira-nova ',
      '#org-document': ' 12.345.678/0001-95 ',
      '#org-phone': ' +55 11 91234-5678 ',
      '#org-email': ' contato@novo.com.br ',
      '#mestre-name': ' Mestre Novo ',
      '#mestre-email': ' mestre@novo.com.br ',
    })
    await submit(wrapper)

    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.path).toBe('/organizations')
    expect(post.body).toEqual({
      name: 'Capoeira Nova',
      slug: 'capoeira-nova',
      document: '12.345.678/0001-95',
      phone: '+55 11 91234-5678',
      email: 'contato@novo.com.br',
      mestre: { name: 'Mestre Novo', email: 'mestre@novo.com.br', password: PASSWORD },
    })
    expect(JSON.stringify(post.body)).not.toContain('passwordConfirm')

    expect(router.currentRoute.value.fullPath).toBe('/organizations/9')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(PASSWORD)
    expect(takeFlash()).toBe(NOTICE)
    expect(takeFlash()).toBe('') // uso único
  })

  it('campos opcionais em branco não vão no corpo', async () => {
    const { calls } = mockFetch((call) => (call.method === 'POST' ? createdReply : { body: orgs }))
    const { wrapper } = await mountView(OrganizationsView)
    await openModal(wrapper)
    await fill(wrapper)
    await submit(wrapper)
    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.body).toEqual({
      name: 'Capoeira Nova',
      mestre: { name: 'Mestre Novo', email: 'mestre@novo.com.br', password: PASSWORD },
    })
    takeFlash()
  })

  it('reabrir o modal depois de criar/cancelar: formulário e senhas vazios', async () => {
    mockFetch((call) => (call.method === 'POST' ? createdReply : { body: orgs }))
    const { wrapper } = await mountView(OrganizationsView)
    await openModal(wrapper)
    await fill(wrapper)
    await buttonByText(wrapper, 'Cancelar').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    await openModal(wrapper)
    for (const sel of ['#org-name', '#mestre-name', '#mestre-email', '#mestre-password', '#mestre-password-confirm']) {
      expect((wrapper.get(sel).element as HTMLInputElement).value).toBe('')
    }
  })

  it.each([
    [409, { message: 'Já existe um usuário com este e-mail. Use outro e-mail para o MESTRE.' }],
    [409, { message: 'O slug "capoeira-nova" já está em uso por outro grupo.' }],
    [403, { message: 'Apenas super admins ativos da plataforma podem executar esta operação.' }],
    [400, { message: ['mestre.password deve ter no mínimo 12 caracteres.', 'slug inválido'] }],
    [503, { message: 'A matriz de permissões (RolePermission) não está carregada; rode o bootstrap/seed antes de criar grupos.' }],
  ])('erro %i do backend: mostra a mensagem, mantém o modal e os dados, limpa as senhas, não navega', async (status, errorBody) => {
    takeFlash()
    mockFetch((call) => (call.method === 'POST' ? { status, body: errorBody } : { body: orgs }))
    const { wrapper, router } = await mountView(OrganizationsView)
    await openModal(wrapper)
    await fill(wrapper)
    await submit(wrapper)

    const expected = Array.isArray(errorBody.message) ? errorBody.message.join(' ') : errorBody.message
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe(expected)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect((wrapper.get('#org-name').element as HTMLInputElement).value).toBe('Capoeira Nova')
    expect((wrapper.get('#mestre-email').element as HTMLInputElement).value).toBe('mestre@novo.com.br')
    expect((wrapper.get('#mestre-password').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#mestre-password-confirm').element as HTMLInputElement).value).toBe('')
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(takeFlash()).toBe('')
  })

  it('o botão "Criar grupo" fica desabilitado durante o envio (sem duplo POST)', async () => {
    let release: (value: MockReply) => void = () => {}
    const { calls } = mockFetch((call) =>
      call.method === 'POST' ? new Promise((resolve) => (release = resolve)) : { body: orgs },
    )
    const { wrapper } = await mountView(OrganizationsView)
    await openModal(wrapper)
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const button = wrapper.get('form button[type="submit"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('Criando…')
    await wrapper.get('form').trigger('submit') // segundo clique/Enter
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(1)
    release(createdReply)
    await flushPromises()
    takeFlash()
  })
})

describe('OrganizationDetailView — aviso de grupo criado', () => {
  async function mountDetail() {
    const { pinia } = loginAs(makeUser())
    const router = makeRouter()
    await router.push('/organizations/9')
    await router.isReady()
    mockFetch((call) => {
      if (call.path === '/organizations/9') return { body: { ...createdOrg, mestres: [] } }
      return { body: [] }
    })
    const wrapper = mount(OrganizationDetailView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  it('mostra o aviso deixado pela criação, uma única vez', async () => {
    takeFlash()
    const { setFlash } = await import('@/utils/flash')
    setFlash(NOTICE)
    const first = await mountDetail()
    expect(first.get('[role="status"]').text()).toBe(NOTICE)
    expect(first.text()).toContain('Capoeira Nova')
    first.unmount()

    const second = await mountDetail()
    expect(second.find('[role="status"]').exists()).toBe(false)
  })
})
