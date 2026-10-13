import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganizationDetailView from '@/views/OrganizationDetailView.vue'
import { loginAs, makeRouter, makeUser, mockFetch, type Call, type MockReply } from './helpers'
import type { AuthUser } from '@/stores/auth'

const baseOrg = {
  id: 9,
  name: 'Capoeira Nova',
  slug: 'capoeira-nova',
  type: 'GROUP',
  status: 'ACTIVE',
  document: '12345678901',
  email: 'contato@nova.com.br',
  phone: '11999990000',
}

const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

async function mountDetail(
  handler: (call: Call) => MockReply | undefined,
  user: AuthUser = makeUser(),
): Promise<{ wrapper: VueWrapper; calls: Call[] }> {
  const { pinia } = loginAs(user)
  const router = makeRouter()
  await router.push('/organizations/9')
  await router.isReady()
  const { calls } = mockFetch((call) => handler(call) ?? { body: [] })
  const wrapper = mount(OrganizationDetailView, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, calls }
}

const orgReply = (overrides: Record<string, unknown> = {}) => ({ body: { ...baseOrg, mestres: [], ...overrides } })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('OrganizationDetailView — assinaturas filtradas no servidor', () => {
  it('pede GET /subscriptions?organizationId=9 (nunca a lista inteira) e usa a primeira (mais recente)', async () => {
    const sub = (id: number, status: string) => ({
      id,
      organizationId: 9,
      planId: 1,
      status,
      currentPeriodEnd: null,
      canceledAt: null,
      plan: { id: 1, name: 'Plano Unico', code: 'UNICO', priceCents: 1000, maxStudents: 5, isActive: true },
    })
    const { wrapper, calls } = await mountDetail((call) => {
      if (call.path === '/organizations/9') return orgReply()
      if (call.path === '/subscriptions') return { body: [sub(7, 'ACTIVE'), sub(3, 'CANCELED')] }
      return undefined
    })
    const subscriptionCalls = calls.filter((c) => c.path === '/subscriptions')
    expect(subscriptionCalls).toHaveLength(1)
    expect(subscriptionCalls[0].query.get('organizationId')).toBe('9')
    expect(wrapper.text()).toContain('Plano Unico')
    expect(wrapper.text()).toContain('Ativa')
  })
})

describe('OrganizationDetailView — editar grupo', () => {
  const handler = (extra?: (call: Call) => MockReply | undefined) => (call: Call) => {
    const custom = extra?.(call)
    if (custom) return custom
    if (call.path === '/organizations/9') return orgReply()
    return undefined
  }

  it('super admin vê Editar e Desativar; PLATFORM comum e MEMBER com isSuperAdmin não veem', async () => {
    const admin = await mountDetail(handler())
    expect(admin.wrapper.find('[data-action="edit-org"]').exists()).toBe(true)
    expect(admin.wrapper.find('[data-action="toggle-status"]').text()).toBe('Desativar')
    admin.wrapper.unmount()

    const plain = await mountDetail(handler(), makeUser({ id: 2, isSuperAdmin: false }))
    expect(plain.wrapper.find('[data-action="edit-org"]').exists()).toBe(false)
    expect(plain.wrapper.find('[data-action="toggle-status"]').exists()).toBe(false)
    plain.wrapper.unmount()

    const member = await mountDetail(handler(), makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true }))
    expect(member.wrapper.find('[data-action="edit-org"]').exists()).toBe(false)
  })

  it('o modal abre preenchido, valida no cliente (sem chamar a API) e nunca envia o slug', async () => {
    const { wrapper, calls } = await mountDetail(handler())
    await wrapper.get('[data-action="edit-org"]').trigger('click')
    expect((wrapper.get('#edit-org-name').element as HTMLInputElement).value).toBe('Capoeira Nova')
    expect((wrapper.get('#edit-org-document').element as HTMLInputElement).value).toBe('12345678901')

    const submit = async () => {
      await wrapper.get('[data-testid="edit-form"]').trigger('submit')
      await flushPromises()
    }
    await wrapper.get('#edit-org-name').setValue('A')
    await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('nome do grupo')

    await wrapper.get('#edit-org-name').setValue('Nome Valido')
    await wrapper.get('#edit-org-document').setValue('123')
    await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('CPF')

    await wrapper.get('#edit-org-document').setValue('')
    await wrapper.get('#edit-org-email').setValue('sem-arroba')
    await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('e-mail válido')

    await wrapper.get('#edit-org-email').setValue('')
    await wrapper.get('#edit-org-phone').setValue('12')
    await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('telefone')

    expect(nonGet(calls)).toHaveLength(0)
  })

  it('salvar: PATCH /organizations/9 com os campos (vazio => null), fecha o modal e atualiza a tela', async () => {
    const { wrapper, calls } = await mountDetail(
      handler((call) =>
        call.method === 'PATCH'
          ? { body: { ...baseOrg, name: 'Nome Novo', document: null, email: 'novo@nova.com.br', phone: null } }
          : undefined,
      ),
    )
    await wrapper.get('[data-action="edit-org"]').trigger('click')
    await wrapper.get('#edit-org-name').setValue('  Nome Novo  ')
    await wrapper.get('#edit-org-document').setValue('')
    await wrapper.get('#edit-org-email').setValue(' novo@nova.com.br ')
    await wrapper.get('#edit-org-phone').setValue('')
    await wrapper.get('[data-testid="edit-form"]').trigger('submit')
    await flushPromises()

    const patch = nonGet(calls)
    expect(patch).toHaveLength(1)
    expect(patch[0].method).toBe('PATCH')
    expect(patch[0].path).toBe('/organizations/9')
    expect(patch[0].body).toEqual({ name: 'Nome Novo', document: null, email: 'novo@nova.com.br', phone: null })
    expect('slug' in (patch[0].body as object)).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('h1').text()).toBe('Nome Novo')
    expect(wrapper.get('[role="status"]').text()).toContain('atualizados')
  })

  it('erro do backend aparece no modal e o modal continua aberto', async () => {
    const { wrapper } = await mountDetail(
      handler((call) => (call.method === 'PATCH' ? { status: 400, body: { message: 'document inválido' } } : undefined)),
    )
    await wrapper.get('[data-action="edit-org"]').trigger('click')
    await wrapper.get('[data-testid="edit-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('document inválido')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })
})

describe('OrganizationDetailView — desativar / reativar', () => {
  const handler =
    (status: string, extra?: (call: Call) => MockReply | undefined) =>
    (call: Call): MockReply | undefined => {
      const custom = extra?.(call)
      if (custom) return custom
      if (call.path === '/organizations/9') return orgReply({ status })
      return undefined
    }

  it('desativar pede confirmação: cancelar NÃO chama a API', async () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    const { wrapper, calls } = await mountDetail(handler('ACTIVE'))
    await wrapper.get('[data-action="toggle-status"]').trigger('click')
    await flushPromises()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(String(confirmMock.mock.calls[0])).toContain('Nenhum dado é apagado')
    expect(nonGet(calls)).toHaveLength(0)
    expect(wrapper.get('[data-testid="org-status"]').text()).toBe('Ativo')
  })

  it('confirmar desativa: POST /organizations/9/deactivate, status Inativo e botão vira Reativar', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { wrapper, calls } = await mountDetail(
      handler('ACTIVE', (call) =>
        call.method === 'POST' && call.path === '/organizations/9/deactivate'
          ? { body: { ...baseOrg, status: 'INACTIVE' } }
          : undefined,
      ),
    )
    await wrapper.get('[data-action="toggle-status"]').trigger('click')
    await flushPromises()
    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/organizations/9/deactivate')
    expect(wrapper.get('[data-testid="org-status"]').text()).toBe('Inativo')
    expect(wrapper.get('[data-action="toggle-status"]').text()).toBe('Reativar')
    expect(wrapper.get('[role="status"]').text()).toContain('Nenhum dado foi apagado')
  })

  it('grupo inativo: confirmar reativa (POST /reactivate) e volta para Ativo', async () => {
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    const { wrapper, calls } = await mountDetail(
      handler('INACTIVE', (call) =>
        call.method === 'POST' && call.path === '/organizations/9/reactivate'
          ? { body: { ...baseOrg, status: 'ACTIVE' } }
          : undefined,
      ),
    )
    expect(wrapper.get('[data-testid="org-status"]').text()).toBe('Inativo')
    await wrapper.get('[data-action="toggle-status"]').trigger('click')
    await flushPromises()
    expect(String(confirmMock.mock.calls[0])).toContain('Reativar')
    expect(nonGet(calls)[0].path).toBe('/organizations/9/reactivate')
    expect(wrapper.get('[data-testid="org-status"]').text()).toBe('Ativo')
    expect(wrapper.get('[data-action="toggle-status"]').text()).toBe('Desativar')
  })

  it('erro do backend (403) aparece na tela e o status não muda', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { wrapper } = await mountDetail(
      handler('ACTIVE', (call) => (call.method === 'POST' ? { status: 403, body: { message: 'Apenas super admins' } } : undefined)),
    )
    await wrapper.get('[data-action="toggle-status"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Apenas super admins')
    expect(wrapper.get('[data-testid="org-status"]').text()).toBe('Ativo')
  })
})

describe('OrganizationDetailView — reativo ao :id da rota', () => {
  const org = (id: number, name: string) => ({ body: { ...baseOrg, id, name, slug: `g-${id}`, mestres: [] } })

  it('mudar route.params.id recarrega o grupo certo e descarta a resposta atrasada do id anterior', async () => {
    const { pinia } = loginAs(makeUser())
    const router = makeRouter()
    await router.push('/organizations/9')
    await router.isReady()
    let releaseNine: () => void = () => {}
    const nineGate = new Promise<void>((resolve) => (releaseNine = resolve))
    const { calls } = mockFetch(async (call) => {
      if (call.path === '/organizations/9') {
        await nineGate // resposta do grupo 9 só chega DEPOIS de o usuário ir para o 10
        return org(9, 'Grupo Nove')
      }
      if (call.path === '/organizations/10') return org(10, 'Grupo Dez')
      return { body: [] }
    })
    const wrapper = mount(OrganizationDetailView, { global: { plugins: [pinia, router] }, attachTo: document.body })
    await flushPromises()

    await router.push('/organizations/10')
    await flushPromises()
    expect(calls.some((c) => c.path === '/organizations/10')).toBe(true)
    expect(calls.find((c) => c.path === '/subscriptions' && c.query.get('organizationId') === '10')).toBeDefined()
    expect(wrapper.text()).toContain('Grupo Dez')

    releaseNine()
    await flushPromises()
    expect(wrapper.text()).toContain('Grupo Dez')
    expect(wrapper.text()).not.toContain('Grupo Nove')
    wrapper.unmount()
  })

  it('não exibe mais o placeholder de próximas fases', async () => {
    const { wrapper } = await mountDetail((call) => (call.path === '/organizations/9' ? orgReply() : undefined))
    expect(wrapper.text()).not.toContain('próximas fases')
    wrapper.unmount()
  })
})
