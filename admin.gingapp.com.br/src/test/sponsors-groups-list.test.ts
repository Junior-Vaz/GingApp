import { describe, expect, it } from 'vitest'
import SponsorsTabs from '@/components/sponsors/SponsorsTabs.vue'
import router, { routes } from '@/router'
import SponsorGroupsView from '@/views/SponsorGroupsView.vue'
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises, loginAs, makeUser, mockFetch, type MockReply } from './helpers'
import { groupRow, listReply, mountAt, nonSuper } from './sponsors-fixtures'

const mount = (user = makeUser()) => mountAt(SponsorGroupsView, '/sponsors/groups', user)
const row = (w: VueWrapper, id: number) => w.get(`[data-testid="group-${id}"]`)

const g1 = groupRow()
const g2 = groupRow({ organizationId: 6, name: 'Ginga Mundo', sponsors: 1, campaigns: 1, activeNow: 0, blocked: true, termsAcceptedAt: null })
const g3 = groupRow({ organizationId: 7, name: 'Berimbau de Ouro', sponsors: 0, campaigns: 12, activeNow: 3 })

describe('SponsorGroupsView — lista de grupos com patrocínio local', () => {
  it('pede GET /platform-sponsor-groups e mostra nome, contagens, campanhas no ar e data do aceite do termo', async () => {
    const { calls } = mockFetch(() => listReply([g1, g2, g3]))
    const { wrapper } = await mount()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /platform-sponsor-groups'])

    const first = row(wrapper, 5)
    expect(first.text()).toContain('Capoeira Raízes')
    expect(first.get('[data-testid="count-sponsors"]').text()).toBe('2')
    expect(first.get('[data-testid="count-campaigns"]').text()).toBe('3')
    expect(first.get('[data-testid="count-active"]').text()).toBe('1')
    expect(first.get('[data-testid="terms"]').text()).toBe('20/10/2026, 10:00')
    expect(first.get('[data-action="open"]').attributes('href')).toBe('/sponsors/groups/5')
    expect(row(wrapper, 7).get('[data-testid="count-campaigns"]').text()).toBe('12')
  })

  it('indicador de BLOQUEADO com texto escrito (não só cor) e "Ainda não aceito" sem termo', async () => {
    mockFetch(() => listReply([g1, g2]))
    const { wrapper } = await mount()
    expect(row(wrapper, 5).find('[data-testid="blocked-chip"]').exists()).toBe(false)
    expect(row(wrapper, 6).get('[data-testid="blocked-chip"]').text()).toBe('Bloqueado')
    expect(row(wrapper, 6).get('[data-testid="terms"]').text()).toBe('Ainda não aceito')
    expect(wrapper.get('[data-testid="blocked-summary"]').text()).toContain('1 grupo está bloqueado')
  })

  it('sem grupos bloqueados, o resumo de bloqueio não aparece; com vários, usa o plural', async () => {
    mockFetch(() => listReply([g1, g3]))
    const none = await mount()
    expect(none.wrapper.find('[data-testid="blocked-summary"]').exists()).toBe(false)

    mockFetch(() => listReply([g2, groupRow({ organizationId: 8, name: 'Z', blocked: true })]))
    const two = await mount()
    expect(two.wrapper.get('[data-testid="blocked-summary"]').text()).toContain('2 grupos estão bloqueados')
  })

  it('busca por nome (sem acento nem caixa) filtra no navegador, sem nova ida à rede', async () => {
    const { calls } = mockFetch(() => listReply([g1, g2, g3]))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="group-search"]').setValue('RAIZES')
    expect(wrapper.findAll('tbody tr[data-testid^="group-"]').map((tr) => tr.attributes('data-testid'))).toEqual(['group-5'])
    await wrapper.get('[data-testid="group-search"]').setValue('ouro')
    expect(wrapper.findAll('tbody tr[data-testid^="group-"]').map((tr) => tr.attributes('data-testid'))).toEqual(['group-7'])
    await wrapper.get('[data-testid="group-search"]').setValue('inexistente')
    expect(wrapper.get('[data-testid="empty"]').text()).toContain('Nenhum grupo encontrado para essa busca')
    expect(calls).toHaveLength(1)
  })

  it('lista vazia, carregando e erro (com "Tentar de novo")', async () => {
    mockFetch(() => listReply([]))
    const empty = await mount()
    expect(empty.wrapper.get('[data-testid="empty"]').text()).toContain('Nenhum grupo cadastrou patrocinadores')

    let release: (r: MockReply) => void = () => undefined
    let attempt = 0
    mockFetch((): Promise<MockReply> | MockReply => {
      attempt += 1
      if (attempt === 1) return new Promise<MockReply>((resolve) => (release = resolve))
      return listReply([g1])
    })
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="loading"]').text()).toContain('Carregando')
    release({ status: 500, body: { message: 'Banco indisponível.' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="list-error"]').text()).toContain('Banco indisponível.')

    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="list-error"]').exists()).toBe(false)
    expect(row(wrapper, 5).text()).toContain('Capoeira Raízes')
  })

  it('erro 403 do servidor vira mensagem clara em português', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'Forbidden resource' } }))
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="list-error"]').text()).toContain('não tem permissão')
  })

  it('PLATFORM comum também vê a lista (só abrir é leitura)', async () => {
    mockFetch(() => listReply([g1]))
    const { wrapper } = await mount(nonSuper())
    expect(row(wrapper, 5).text()).toContain('Capoeira Raízes')
  })
})

describe('aba "Dos grupos" (SponsorsTabs) e rotas', () => {
  const tabs = (path: string) => {
    mockFetch(() => listReply([]))
    return mountAt(SponsorsTabs, path)
  }

  it('mostra as 3 abas e marca "Dos grupos" na lista e em rotas filhas do grupo', async () => {
    for (const path of ['/sponsors/groups', '/sponsors/groups/5']) {
      const { wrapper } = await tabs(path)
      expect(wrapper.findAll('a').map((a) => a.text())).toEqual(['Patrocinadores', 'Campanhas', 'Dos grupos'])
      expect(wrapper.get('[data-testid="tab-groups"]').attributes('aria-current')).toBe('page')
      expect(wrapper.get('[data-testid="tab-sponsors"]').attributes('aria-current')).toBeUndefined()
      expect(wrapper.get('[data-testid="tab-campaigns"]').attributes('aria-current')).toBeUndefined()
      expect(wrapper.get('[data-testid="tab-groups"]').attributes('href')).toBe('/sponsors/groups')
    }
  })

  it('as outras abas continuam marcadas como antes', async () => {
    const sponsors = await tabs('/sponsors')
    expect(sponsors.wrapper.get('[data-testid="tab-sponsors"]').attributes('aria-current')).toBe('page')
    expect(sponsors.wrapper.get('[data-testid="tab-groups"]').attributes('aria-current')).toBeUndefined()
    const campaigns = await tabs('/sponsors/campaigns/3/report')
    expect(campaigns.wrapper.get('[data-testid="tab-campaigns"]').attributes('aria-current')).toBe('page')
  })

  it('rotas do grupo: só plataforma, sem item de menu próprio, id numérico', async () => {
    const byName = (name: string) => routes.find((r) => r.name === name)
    expect(byName('sponsor-groups')?.path).toBe('/sponsors/groups')
    expect(byName('sponsor-group-detail')?.path).toContain('/sponsors/groups/:organizationId')
    for (const name of ['sponsor-groups', 'sponsor-group-detail']) {
      expect(byName(name)?.meta).toMatchObject({ requiresAuth: true, platformOnly: true })
      expect(byName(name)?.meta?.navLabel).toBeUndefined()
    }
  })

  it('o guard barra quem não é da plataforma e deixa PLATFORM entrar na lista e no grupo', async () => {
    loginAs(makeUser({ userType: 'MEMBER' }))
    await router.push('/sponsors/groups')
    expect(router.currentRoute.value.name).toBe('dashboard')
    await router.push('/sponsors/groups/5')
    expect(router.currentRoute.value.name).toBe('dashboard')

    loginAs(makeUser({ userType: 'PLATFORM' }))
    await router.push('/sponsors/groups')
    expect(router.currentRoute.value.name).toBe('sponsor-groups')
    await router.push('/sponsors/groups/5')
    expect(router.currentRoute.value.name).toBe('sponsor-group-detail')
    await router.push('/sponsors/groups/abc')
    expect(router.currentRoute.value.name).not.toBe('sponsor-group-detail')
  })
})
