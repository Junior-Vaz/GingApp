import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_KEY } from '@/stores/auth'
import TeamView from '@/views/TeamView.vue'
import { flushPromises, makeUser, mockFetch, mountView, type Call, type MockReply } from './helpers'

const PASSWORD = 'SenhaMuitoSegura#2026'

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
    ...overrides,
  }
}

const other = member({
  id: 2,
  name: 'Ana Suporte',
  email: 'ana@gingapp.com.br',
  phone: '11999990000',
  isSuperAdmin: false,
  tokenValidAfter: '2026-10-05T15:30:00.000Z',
})
const inactive = member({ id: 3, name: 'Bia Inativa', email: 'bia@gingapp.com.br', status: 'INACTIVE', isSuperAdmin: false })
const team = [member(), other, inactive]

function listReply(items: unknown[], total = items.length): MockReply {
  return { body: items, headers: { 'X-Total-Count': String(total) } }
}

const row = (wrapper: VueWrapper, id: number) => wrapper.get(`[data-testid="member-${id}"]`)
const action = (wrapper: VueWrapper, id: number, name: string) => row(wrapper, id).find(`[data-action="${name}"]`)
const byText = (wrapper: VueWrapper, selector: string, text: string) =>
  wrapper.findAll(selector).find((el) => el.text().includes(text))!
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

describe('TeamView — leitura', () => {
  it('lista a equipe com badges, datas e "sessões revogadas em"', async () => {
    const { calls } = mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView)

    expect(calls[0].path).toBe('/platform-team')
    expect(calls[0].query.get('limit')).toBe('20')
    expect(calls[0].query.has('status')).toBe(false)

    const owner = row(wrapper, 1).text()
    expect(owner).toContain('Owner GingApp')
    expect(owner).toContain('super admin')
    expect(owner).toContain('você')
    expect(owner).toContain('Ativo')
    expect(owner).toContain('01/09/2026')

    const ana = row(wrapper, 2).text()
    expect(ana).not.toContain('super admin')
    expect(ana).toContain('11999990000')
    expect(ana).toContain('05/10/2026, 12:30') // 15:30Z em America/Sao_Paulo

    expect(row(wrapper, 3).text()).toContain('Inativo')
    expect(wrapper.text()).not.toContain('Em construção')
    expect(wrapper.text()).not.toMatch(/2fa|dois fatores/i)
  })

  it('estados: carregando, vazio e erro (mensagem do backend)', async () => {
    mockFetch(() => new Promise(() => {}))
    const loading = await mountView(TeamView)
    expect(loading.wrapper.text()).toContain('Carregando…')
    loading.wrapper.unmount()

    mockFetch(() => listReply([]))
    const empty = await mountView(TeamView)
    expect(empty.wrapper.text()).toContain('Nenhum usuário na equipe.')
    empty.wrapper.unmount()

    mockFetch(() => ({ status: 403, body: { message: 'Acesso restrito à equipe da plataforma GingApp.' } }))
    const failed = await mountView(TeamView)
    expect(failed.wrapper.get('[role="alert"]').text()).toBe('Acesso restrito à equipe da plataforma GingApp.')
  })

  it('filtro de status e paginação vão ao servidor', async () => {
    const { calls } = mockFetch(() => listReply(team, 45))
    const { wrapper } = await mountView(TeamView)

    await wrapper.get('select').setValue('ACTIVE')
    await flushPromises()
    expect(calls[1].query.get('status')).toBe('ACTIVE')
    expect(calls[1].query.get('offset')).toBe('0')

    await wrapper.get('[data-testid="page-next"]').trigger('click')
    await flushPromises()
    expect(calls[2].query.get('offset')).toBe('20')
    expect(calls[2].query.get('status')).toBe('ACTIVE')
    expect(wrapper.get('[data-testid="page-range"]').text()).toBe('21–40 de 45')
  })

  it('busca por nome/e-mail é debounced', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView)
    await wrapper.get('input[type="search"]').setValue('ana')
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(calls[1].query.get('q')).toBe('ana')
  })
})

describe('TeamView — permissões', () => {
  it('PLATFORM não-super vê só a lista: sem botões de ação nem "Novo usuário"', async () => {
    mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView, makeUser({ id: 2, isSuperAdmin: false }))

    expect(wrapper.get('[data-testid="readonly-note"]').text()).toContain('Somente super admins')
    expect(wrapper.findAll('button').map((b) => b.text())).not.toContain('+ Novo usuário')
    for (const label of ['Editar', 'Desativar', 'Reativar', 'Revogar sessões', 'Redefinir senha']) {
      expect(wrapper.findAll('button').some((b) => b.text() === label)).toBe(false)
    }
    expect(wrapper.findAll('th')).toHaveLength(6) // sem coluna de ações
  })

  it('sem super admin no login (conta fora da página listada) ou userType MEMBER: sem botões de ação', async () => {
    mockFetch(() => listReply(team))
    const a = await mountView(TeamView, makeUser({ id: 99, isSuperAdmin: false }))
    expect(a.wrapper.find('[data-action]').exists()).toBe(false)
    expect(a.wrapper.findAll('button').some((b) => b.text().includes('Novo usuário'))).toBe(false)
    a.wrapper.unmount()

    const b = await mountView(TeamView, makeUser({ id: 98, userType: 'MEMBER', isSuperAdmin: true }))
    expect(b.wrapper.find('[data-action]').exists()).toBe(false)
    expect(b.wrapper.findAll('button').some((x) => x.text().includes('Novo usuário'))).toBe(false)
  })

  it('super admin cuja própria conta aparece rebaixada/inativa na lista perde os botões', async () => {
    mockFetch(() => listReply([member({ id: 1, isSuperAdmin: false }), other]))
    const { wrapper } = await mountView(TeamView, makeUser({ id: 1, isSuperAdmin: true }))
    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(true)
    expect(wrapper.find('[data-action]').exists()).toBe(false)

    mockFetch(() => listReply([member({ id: 1, status: 'INACTIVE' }), other]))
    const second = await mountView(TeamView, makeUser({ id: 1, isSuperAdmin: true }))
    expect(second.wrapper.find('[data-action]').exists()).toBe(false)
  })

  it('super admin: a própria linha não tem Desativar/Reativar; as demais têm', async () => {
    mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView)

    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(false)
    // própria linha: editar, revogar e redefinir senha continuam; status não
    expect(action(wrapper, 1, 'edit').exists()).toBe(true)
    expect(action(wrapper, 1, 'revoke').exists()).toBe(true)
    expect(action(wrapper, 1, 'password').exists()).toBe(true)
    expect(action(wrapper, 1, 'toggle-status').exists()).toBe(false)
    // outras
    expect(action(wrapper, 2, 'toggle-status').text()).toBe('Desativar')
    expect(action(wrapper, 3, 'toggle-status').text()).toBe('Reativar')
  })

  it('editar a própria conta: checkbox de super admin desabilitado e PATCH sem isSuperAdmin/status', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PATCH' ? { body: member() } : listReply(team)))
    const { wrapper } = await mountView(TeamView)

    await action(wrapper, 1, 'edit').trigger('click')
    const checkbox = wrapper.get('[role="dialog"] input[type="checkbox"]')
    expect(checkbox.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').text()).toContain('não pode alterar o seu próprio perfil de super admin')

    await wrapper.get('#edit-name').setValue('Owner Renomeado')
    await wrapper.get('#edit-phone').setValue('11911112222')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const patch = calls.find((c) => c.method === 'PATCH') as Call
    expect(patch.path).toBe('/platform-team/1')
    expect(patch.body).toEqual({ name: 'Owner Renomeado', phone: '11911112222' })
  })

  it('editar outro usuário: envia só o que mudou; telefone vazio vira null; promove a super admin', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PATCH' ? { body: other } : listReply(team)))
    const { wrapper } = await mountView(TeamView)

    await action(wrapper, 2, 'edit').trigger('click')
    expect((wrapper.get('#edit-phone').element as HTMLInputElement).value).toBe('11999990000')
    await wrapper.get('#edit-phone').setValue('')
    await wrapper.get('[role="dialog"] input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect((calls.find((c) => c.method === 'PATCH') as Call).body).toEqual({ phone: null, isSuperAdmin: true })
  })

  it('editar sem mudar nada não chama a API', async () => {
    const { calls } = mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView)
    await action(wrapper, 2, 'edit').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(0)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('TeamView — criar', () => {
  async function fillCreate(wrapper: VueWrapper, overrides: Partial<Record<string, string>> = {}) {
    const values = {
      name: 'Carlos Novo',
      email: 'carlos@gingapp.com.br',
      phone: '',
      password: PASSWORD,
      confirm: PASSWORD,
      ...overrides,
    }
    await wrapper.get('#team-name').setValue(values.name)
    await wrapper.get('#team-email').setValue(values.email)
    await wrapper.get('#team-phone').setValue(values.phone)
    await wrapper.get('#team-password').setValue(values.password)
    await wrapper.get('#team-password-confirm').setValue(values.confirm)
  }

  it('valida nome, e-mail, senha mínima de 12 (política SSOT) e confirmação (sem chamar a API)', async () => {
    const { calls } = mockFetch(() => listReply(team))
    const { wrapper } = await mountView(TeamView)
    await byText(wrapper, 'button', '+ Novo usuário').trigger('click')

    await fillCreate(wrapper, { name: 'C' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('nome')

    await fillCreate(wrapper, { email: 'sem-arroba' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('e-mail válido')

    await fillCreate(wrapper, { password: 'curta123', confirm: 'curta123' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('mínimo 12 caracteres')

    // 10 e 11 caracteres (antes aceitos) agora são recusados; Dev@12345 também.
    for (const weak of ['abcdefghij', 'abcdefghijk']) {
      await fillCreate(wrapper, { password: weak, confirm: weak })
      await wrapper.get('form').trigger('submit')
      expect(wrapper.get('[role="alert"]').text()).toContain('mínimo 12 caracteres')
    }
    await fillCreate(wrapper, { password: 'Dev@12345', confirm: 'Dev@12345' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('mínimo 12 caracteres')
    await fillCreate(wrapper, { password: 'xx-DEV@12345-xx', confirm: 'xx-DEV@12345-xx' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('senha padrão')

    await fillCreate(wrapper, { confirm: PASSWORD + 'x' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('confirmação da senha não confere')

    await fillCreate(wrapper, { password: 'a'.repeat(73), confirm: 'a'.repeat(73) })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('no máximo 72')

    expect(nonGet(calls)).toHaveLength(0)
  })

  it('cria o usuário: POST sem passwordConfirm, fecha o modal e a senha não fica na tela nem no formulário', async () => {
    let created = false
    const { calls } = mockFetch((call) => {
      if (call.method === 'POST') {
        created = true
        return { status: 201, body: member({ id: 9, name: 'Carlos Novo', email: 'carlos@gingapp.com.br', isSuperAdmin: false }) }
      }
      return listReply(created ? [...team, member({ id: 9, name: 'Carlos Novo', email: 'carlos@gingapp.com.br', isSuperAdmin: false })] : team)
    })
    const { wrapper } = await mountView(TeamView)
    await byText(wrapper, 'button', '+ Novo usuário').trigger('click')
    await fillCreate(wrapper, { phone: ' 11988887777 ' })
    await wrapper.get('[role="dialog"] input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.path).toBe('/platform-team')
    expect(post.body).toEqual({
      name: 'Carlos Novo',
      email: 'carlos@gingapp.com.br',
      phone: '11988887777',
      password: PASSWORD,
      isSuperAdmin: true,
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(PASSWORD)
    expect(wrapper.get('[role="status"]').text()).toContain('carlos@gingapp.com.br criado')
    expect(row(wrapper, 9).text()).toContain('Carlos Novo')

    // reabrir o modal: campos de senha vazios
    await byText(wrapper, 'button', '+ Novo usuário').trigger('click')
    expect((wrapper.get('#team-password').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#team-password-confirm').element as HTMLInputElement).value).toBe('')
  })

  it('409 de e-mail duplicado mostra a mensagem do backend e mantém o modal', async () => {
    mockFetch((call) =>
      call.method === 'POST'
        ? { status: 409, body: { message: 'Já existe um usuário com este e-mail.' } }
        : listReply(team),
    )
    const { wrapper } = await mountView(TeamView)
    await byText(wrapper, 'button', '+ Novo usuário').trigger('click')
    await fillCreate(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Já existe um usuário com este e-mail.')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })
})

describe('TeamView — ações na linha', () => {
  it('desativar: confirma antes; cancelar não chama; confirmar faz PATCH {status: INACTIVE}', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PATCH' ? { body: other } : listReply(team)))
    const { wrapper } = await mountView(TeamView)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await action(wrapper, 2, 'toggle-status').trigger('click')
    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(nonGet(calls)).toHaveLength(0)

    confirmSpy.mockReturnValue(true)
    await action(wrapper, 2, 'toggle-status').trigger('click')
    await flushPromises()
    const patch = calls.find((c) => c.method === 'PATCH') as Call
    expect(patch.path).toBe('/platform-team/2')
    expect(patch.body).toEqual({ status: 'INACTIVE' })
    expect(wrapper.get('[role="status"]').text()).toContain('ana@gingapp.com.br desativado')
  })

  it('reativar envia {status: ACTIVE}', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PATCH' ? { body: inactive } : listReply(team)))
    const { wrapper } = await mountView(TeamView)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await action(wrapper, 3, 'toggle-status').trigger('click')
    await flushPromises()
    expect((calls.find((c) => c.method === 'PATCH') as Call).body).toEqual({ status: 'ACTIVE' })
  })

  it('409 "último super admin ativo" ao desativar/rebaixar é exibido com a mensagem clara do backend', async () => {
    const message = 'A plataforma precisa manter ao menos um super admin ativo.'
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const superOther = member({ id: 5, name: 'Outro Super', email: 'super2@gingapp.com.br' })
    mockFetch((call) => (call.method === 'PATCH' ? { status: 409, body: { message } } : listReply([member(), superOther])))
    const fresh = await mountView(TeamView, makeUser({ id: 1 }))
    await action(fresh.wrapper, 5, 'toggle-status').trigger('click')
    await flushPromises()
    expect(fresh.wrapper.get('[role="alert"]').text()).toBe(message)

    // mesmo 409 vindo do modal de edição (rebaixar)
    await action(fresh.wrapper, 5, 'edit').trigger('click')
    await fresh.wrapper.get('[role="dialog"] input[type="checkbox"]').setValue(false)
    await fresh.wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(fresh.wrapper.get('[role="dialog"] [role="alert"]').text()).toBe(message)
  })

  it('revogar sessões de outro usuário: confirma, POST sem corpo e aviso', async () => {
    const { calls } = mockFetch((call) => (call.method === 'POST' ? { body: other } : listReply(team)))
    const { wrapper, store } = await mountView(TeamView)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await action(wrapper, 2, 'revoke').trigger('click')
    await flushPromises()
    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.path).toBe('/platform-team/2/revoke-sessions')
    expect(post.body).toBeUndefined()
    expect(confirmSpy.mock.calls[0][0]).toContain('ana@gingapp.com.br')
    expect(wrapper.get('[role="status"]').text()).toContain('Sessões de ana@gingapp.com.br revogadas')
    expect(store.isAuthenticated).toBe(true)
  })

  it('revogar as PRÓPRIAS sessões desconecta e vai para o login', async () => {
    const { calls } = mockFetch((call) => (call.method === 'POST' ? { body: member() } : listReply(team)))
    const { wrapper, router, store } = await mountView(TeamView)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await action(wrapper, 1, 'revoke').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.method === 'POST')?.path).toBe('/platform-team/1/revoke-sessions')
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redefinir senha: valida mínimo/confirmação, envia só {password} e não deixa a senha na tela', async () => {
    const { calls } = mockFetch((call) => (call.method === 'POST' ? { body: other } : listReply(team)))
    const { wrapper } = await mountView(TeamView)
    await action(wrapper, 2, 'password').trigger('click')

    await wrapper.get('#reset-password').setValue('curta')
    await wrapper.get('#reset-password-confirm').setValue('curta')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('mínimo 12 caracteres')

    await wrapper.get('#reset-password').setValue('Dev@12345')
    await wrapper.get('#reset-password-confirm').setValue('Dev@12345')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('mínimo 12 caracteres')
    await wrapper.get('#reset-password').setValue('xx-DEV@12345-xx')
    await wrapper.get('#reset-password-confirm').setValue('xx-DEV@12345-xx')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('senha padrão')

    await wrapper.get('#reset-password').setValue(PASSWORD)
    await wrapper.get('#reset-password-confirm').setValue('diferente-aaaa')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('confirmação da senha não confere')
    expect(nonGet(calls)).toHaveLength(0)

    await wrapper.get('#reset-password-confirm').setValue(PASSWORD)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const post = calls.find((c) => c.method === 'POST') as Call
    expect(post.path).toBe('/platform-team/2/reset-password')
    expect(post.body).toEqual({ password: PASSWORD })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(PASSWORD)
    expect(wrapper.get('[role="status"]').text()).toContain('Senha de ana@gingapp.com.br redefinida')
  })

  it('redefinir a PRÓPRIA senha encerra a sessão local', async () => {
    mockFetch((call) => (call.method === 'POST' ? { body: member() } : listReply(team)))
    const { wrapper, router, store } = await mountView(TeamView)
    await action(wrapper, 1, 'password').trigger('click')
    await wrapper.get('#reset-password').setValue(PASSWORD)
    await wrapper.get('#reset-password-confirm').setValue(PASSWORD)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(store.isAuthenticated).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('erro do backend ao redefinir senha (array) aparece no modal', async () => {
    mockFetch((call) =>
      call.method === 'POST'
        ? { status: 400, body: { message: ['password deve ter no mínimo 10 caracteres'] } }
        : listReply(team),
    )
    const { wrapper } = await mountView(TeamView)
    await action(wrapper, 2, 'password').trigger('click')
    await wrapper.get('#reset-password').setValue(PASSWORD)
    await wrapper.get('#reset-password-confirm').setValue(PASSWORD)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('password deve ter no mínimo 10 caracteres')
  })
})
