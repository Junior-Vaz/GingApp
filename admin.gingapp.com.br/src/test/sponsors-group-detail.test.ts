import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SponsorGroupDetailView from '@/views/SponsorGroupDetailView.vue'
import { flushPromises, makeUser, mockFetch, type Call, type MockReply } from './helpers'
import { groupCampaign, groupRow, listReply, mountAt, nonSuper, sponsor } from './sponsors-fixtures'

afterEach(() => vi.useRealTimers())

const GROUP_ID = 5
const mount = (user = makeUser()) => mountAt(SponsorGroupDetailView, `/sponsors/groups/${GROUP_ID}`, user)
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const row = (w: VueWrapper, id: number) => w.get(`[data-testid="campaign-${id}"]`)
const action = (w: VueWrapper, id: number, name: string) => row(w, id).find(`[data-action="${name}"]`)
const t = (w: VueWrapper, id: string) => w.get(`[data-testid="${id}"]`).text()

const live = groupCampaign()
const suspended = groupCampaign({
  id: 22,
  title: 'Camisa suspensa',
  status: 'PAUSED',
  effectiveStatus: 'PAUSED',
  platformSuspended: true,
  platformSuspendReason: 'Texto enganoso',
  platformSuspendedAt: '2026-11-02T13:00:00.000Z',
  platformSuspendedBy: { id: 9, name: 'Ana Suporte' },
})
const draft = groupCampaign({ id: 23, title: 'Rascunho do Mestre', status: 'DRAFT', effectiveStatus: 'DRAFT', approvedAt: null, approvedByUserId: null, approvedBy: null, imageRef: null })
const ended = groupCampaign({ id: 24, title: 'Encerrada', effectiveStatus: 'ENDED' })
const scheduled = groupCampaign({ id: 25, title: 'Agendada', effectiveStatus: 'SCHEDULED' })

interface Setup {
  groups?: unknown[]
  sponsors?: unknown[]
  campaigns?: unknown[]
}

function handler(setup: Setup = {}) {
  const groups = setup.groups ?? [groupRow()]
  const sponsors = setup.sponsors ?? [sponsor({ id: 11, name: 'Loja do Axé' }), sponsor({ id: 12, name: 'Casa do Berimbau', logo: '/api/uploads/123e4567-e89b-12d3-a456-426614174111.webp' })]
  const campaigns = setup.campaigns ?? [live, suspended, draft]
  return (call: Call): MockReply | undefined => {
    if (call.method === 'GET' && call.path === '/platform-sponsor-groups') return listReply(groups)
    if (call.method === 'GET' && call.path === '/platform-sponsors') return listReply(sponsors)
    if (call.method === 'GET' && call.path === '/platform-sponsor-campaigns') return listReply(campaigns)
    if (call.method === 'POST') return { status: 200, body: {} }
    return undefined
  }
}

const lists = (calls: Call[], path: string) => calls.filter((c) => c.method === 'GET' && c.path === path)

describe('SponsorGroupDetailView — leitura', () => {
  it('carrega grupo, patrocinadores e campanhas do GRUPO (scope=GROUP + organizationId) e mostra o resumo', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()

    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(['GET /platform-sponsor-campaigns', 'GET /platform-sponsor-groups', 'GET /platform-sponsors'])
    for (const path of ['/platform-sponsors', '/platform-sponsor-campaigns']) {
      const q = lists(calls, path)[0].query
      expect(q.get('scope')).toBe('GROUP')
      expect(q.get('organizationId')).toBe('5')
    }

    expect(t(wrapper, 'group-title')).toBe('Capoeira Raízes')
    expect(t(wrapper, 'sum-sponsors')).toBe('2')
    expect(t(wrapper, 'sum-campaigns')).toBe('3')
    expect(t(wrapper, 'sum-active')).toBe('1')
    expect(t(wrapper, 'sum-terms')).toBe('20/10/2026, 10:00')
    expect(wrapper.find('[data-testid="blocked-chip"]').exists()).toBe(false)
  })

  it('campanha: título, texto, patrocinador, categoria, vigência, status, imagem, URL de destino e quem ativou', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const r = row(wrapper, 21)
    expect(r.get('[data-testid="campaign-title"]').text()).toBe('Abadá com desconto')
    expect(r.get('[data-testid="campaign-text"]').text()).toBe('Vestuário para a sua roda.')
    expect(r.text()).toContain('Loja do Axé')
    expect(r.text()).toContain('Vestuário')
    expect(r.text()).toContain('01/10/2026')
    expect(r.get('[data-testid="status-chip"]').text()).toBe('No ar agora')
    expect(r.get('[data-testid="campaign-image"]').attributes('src')).toContain('/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp')
    const url = r.get('[data-testid="campaign-url"]')
    expect(url.text()).toBe('https://www.lojadoaxe.com.br/abada')
    expect(url.attributes('href')).toBe('https://www.lojadoaxe.com.br/abada')
    expect(url.attributes('rel')).toContain('noopener')
    expect(url.attributes('target')).toBe('_blank')
    expect(r.get('[data-testid="approval"]').text()).toBe('Ativada por Mestre Bimba em 02/10/2026, 12:30')
    // rascunho: sem aprovação e sem imagem
    expect(row(wrapper, 23).find('[data-testid="approval"]').exists()).toBe(false)
    expect(row(wrapper, 23).find('[data-testid="campaign-image"]').exists()).toBe(false)
  })

  it('NUNCA mostra contato, documento, observações, preço nem nota de cobrança do Mestre (mesmo que a resposta traga)', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const html = wrapper.html()
    const text = wrapper.text()
    for (const secret of ['ana@casadoberimbau.com.br', '62999990000', '12.345.678/0001-90', 'Fecha por trimestre', 'Ana Comercial', 'SEGREDO-COBRANCA', '999,99', '99999', 'billingNote', 'priceCents']) {
      expect(html, secret).not.toContain(secret)
      expect(text, secret).not.toContain(secret)
    }
    expect(wrapper.text()).toContain('privados do Mestre')
  })

  it('patrocinadores do grupo: só nome e logo (iniciais quando não há logo)', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="sponsor-11"]').text()).toContain('Loja do Axé')
    expect(wrapper.get('[data-testid="sponsor-11"]').text()).toContain('LO')
    expect(wrapper.get('[data-testid="sponsor-12"] img').attributes('alt')).toBe('Logo de Casa do Berimbau')
  })

  it('chips de status para os 5 efetivos, rótulo escrito', async () => {
    mockFetch(handler({ campaigns: [live, draft, ended, scheduled, suspended] }))
    const { wrapper } = await mount()
    const chip = (id: number) => row(wrapper, id).get('[data-testid="status-chip"]')
    expect(chip(21).text()).toBe('No ar agora')
    expect(chip(23).text()).toBe('Rascunho')
    expect(chip(24).text()).toBe('Encerrada')
    expect(chip(25).text()).toBe('Agendada')
    expect(chip(22).text()).toBe('Pausada')
  })

  it('campanha SUSPENSA: selo, motivo, quem e quando; a não suspensa não tem selo', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const r = row(wrapper, 22)
    expect(r.get('[data-testid="suspended-badge"]').text()).toBe('Suspensa pela plataforma')
    expect(r.get('[data-testid="suspension-who"]').text()).toBe('Suspensa pela plataforma por Ana Suporte em 02/11/2026, 10:00')
    expect(r.get('[data-testid="suspension-reason"]').text()).toBe('Motivo: Texto enganoso')
    expect(row(wrapper, 21).find('[data-testid="suspended-badge"]').exists()).toBe(false)
  })

  it('suspensa SEM quem/quando na resposta: mostra só o que veio (sem inventar)', async () => {
    mockFetch(handler({ campaigns: [groupCampaign({ id: 30, platformSuspended: true, platformSuspendReason: 'Denúncia' })] }))
    const { wrapper } = await mount()
    expect(t(wrapper, 'suspension-who')).toBe('Suspensa pela plataforma')
    expect(t(wrapper, 'suspension-reason')).toBe('Motivo: Denúncia')
  })

  it('"Relatório" reaproveita a tela existente e leva o grupo para o "voltar"', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(action(wrapper, 21, 'report').attributes('href')).toBe('/sponsors/campaigns/21/report?group=5')
  })

  it('grupo bloqueado: chip, motivo, quem e quando (nomes de campo do contrato), botão vira "Liberar grupo"', async () => {
    mockFetch(handler({ groups: [groupRow({ blocked: true, sponsorsBlockedAt: '2026-11-03T14:00:00.000Z', sponsorsBlockedReason: 'Denúncias de anúncio impróprio', blockedBy: { id: 1, name: 'Owner GingApp' } })] }))
    const { wrapper } = await mount()
    expect(t(wrapper, 'blocked-chip')).toBe('Bloqueado')
    expect(t(wrapper, 'block-who')).toBe('Bloqueado pela plataforma por Owner GingApp em 03/11/2026, 11:00')
    expect(t(wrapper, 'block-reason')).toBe('Motivo: Denúncias de anúncio impróprio')
    expect(wrapper.find('[data-action="block"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="unblock"]').exists()).toBe(true)
  })

  it('bloqueado SEM detalhes na resposta (formato mínimo do contrato): mostra só "Bloqueado pela plataforma"', async () => {
    mockFetch(handler({ groups: [groupRow({ blocked: true })] }))
    const { wrapper } = await mount()
    expect(t(wrapper, 'block-who')).toBe('Bloqueado pela plataforma')
    expect(wrapper.find('[data-testid="block-reason"]').exists()).toBe(false)
  })
})

describe('SponsorGroupDetailView — estados', () => {
  it('vazios: sem patrocinadores e sem campanhas; vazio com filtro tem outro texto', async () => {
    mockFetch(handler({ sponsors: [], campaigns: [] }))
    const { wrapper } = await mount()
    expect(t(wrapper, 'sponsors-empty')).toContain('ainda não cadastrou patrocinadores')
    expect(t(wrapper, 'campaigns-empty')).toContain('ainda não criou campanhas')
    await wrapper.get('[data-testid="filter-effective"]').setValue('ENDED')
    await flushPromises()
    expect(t(wrapper, 'campaigns-empty')).toContain('com esses filtros')
  })

  it('grupo que não está na lista: aviso, sem botões de bloqueio, título provisório', async () => {
    mockFetch(handler({ groups: [groupRow({ organizationId: 99 })], sponsors: [], campaigns: [] }))
    const { wrapper } = await mount()
    expect(t(wrapper, 'group-not-found')).toContain('não aparece entre os que têm patrocínio local')
    expect(t(wrapper, 'group-title')).toBe('Grupo #5')
    expect(wrapper.find('[data-action="block"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="unblock"]').exists()).toBe(false)
  })

  it('carregando: mostra "Carregando…" enquanto as listas não voltam', async () => {
    const releases: Array<(r: MockReply) => void> = []
    mockFetch((call) => (call.method === 'GET' ? new Promise<MockReply>((resolve) => releases.push(resolve)) : undefined))
    const { wrapper } = await mount()
    expect(t(wrapper, 'group-loading')).toContain('Carregando')
    expect(t(wrapper, 'sponsors-loading')).toContain('Carregando')
    expect(t(wrapper, 'campaigns-loading')).toContain('Carregando')
    releases.forEach((r) => r(listReply([])))
    await flushPromises()
    expect(wrapper.find('[data-testid="campaigns-loading"]').exists()).toBe(false)
  })

  it('erros por seção com "Tentar de novo" que recarrega só a seção', async () => {
    let fail = true
    const { calls } = mockFetch((call) => {
      if (fail && call.method === 'GET' && call.path !== '/platform-sponsors') return { status: 500, body: { message: 'Banco indisponível.' } }
      if (call.method === 'GET' && call.path === '/platform-sponsors') return { status: 404, body: { message: 'Not Found' } }
      return handler()(call)
    })
    const { wrapper } = await mount()
    expect(t(wrapper, 'group-error')).toContain('Banco indisponível.')
    expect(t(wrapper, 'campaigns-error')).toContain('Banco indisponível.')
    expect(t(wrapper, 'sponsors-error')).toContain('não existe mais') // 404 em inglês do Nest -> texto claro

    fail = false
    const before = calls.length
    await wrapper.get('[data-testid="campaigns-retry"]').trigger('click')
    await flushPromises()
    expect(calls.length).toBe(before + 1)
    expect(wrapper.find('[data-testid="campaigns-error"]').exists()).toBe(false)
    expect(row(wrapper, 21).text()).toContain('Abadá com desconto')
    await wrapper.get('[data-testid="group-retry"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'group-title')).toBe('Capoeira Raízes')
  })

  it('filtros: situação e busca (debounced) vão na consulta com scope=GROUP; limpar remove-os', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    const camp = () => lists(calls, '/platform-sponsor-campaigns')

    expect(wrapper.get('[data-testid="filter-effective"]').findAll('option').map((o) => o.text())).toEqual(['Todas', 'No ar agora', 'Agendada', 'Rascunho', 'Pausada', 'Encerrada'])
    await wrapper.get('[data-testid="filter-effective"]').setValue('ACTIVE_NOW')
    await flushPromises()
    expect(camp()[1].query.get('effective')).toBe('ACTIVE_NOW')
    expect(camp()[1].query.get('scope')).toBe('GROUP')
    expect(camp()[1].query.get('organizationId')).toBe('5')

    await wrapper.get('[data-testid="filter-q"]').setValue('abadá')
    expect(camp()).toHaveLength(2) // debounce
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(camp()[2].query.get('q')).toBe('abadá')
    expect(camp()[2].query.get('effective')).toBe('ACTIVE_NOW')

    await wrapper.get('[data-testid="filter-clear"]').trigger('click')
    await flushPromises()
    const last = camp()[camp().length - 1]
    expect(last.query.has('q') || last.query.has('effective')).toBe(false)
    expect(last.query.get('scope')).toBe('GROUP')
  })
})

describe('SponsorGroupDetailView — suspender campanha (qualquer PLATFORM)', () => {
  it('só campanhas NÃO suspensas têm "Suspender"; as suspensas têm "Levantar suspensão"', async () => {
    mockFetch(handler())
    const { wrapper } = await mount(nonSuper())
    expect(action(wrapper, 21, 'suspend').exists()).toBe(true)
    expect(action(wrapper, 21, 'unsuspend').exists()).toBe(false)
    expect(action(wrapper, 22, 'suspend').exists()).toBe(false)
    expect(action(wrapper, 22, 'unsuspend').exists()).toBe(true)
  })

  it('PLATFORM comum suspende: motivo obrigatório (botão travado), contador, POST /suspend {reason}, recarrega e avisa', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount(nonSuper())
    await action(wrapper, 21, 'suspend').trigger('click')

    const dialog = wrapper.get('[data-testid="confirm-dialog"]')
    expect(dialog.text()).toContain('Abadá com desconto')
    expect(dialog.text()).toContain('Só um super admin pode levantar')
    const ok = () => wrapper.get('[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reason-counter')).toBe('0/300')
    expect(ok().attributes('disabled')).toBeDefined()
    expect(nonGet(calls)).toHaveLength(0)

    const input = wrapper.get('[data-testid="reason-input"]')
    expect(input.attributes('maxlength')).toBe('300')
    expect(input.attributes('required')).toBeDefined()
    await input.setValue('ab')
    expect(t(wrapper, 'reason-counter')).toBe('2/300')
    expect(t(wrapper, 'reason-error')).toBe('O motivo deve ter pelo menos 3 caracteres.')
    expect(ok().attributes('disabled')).toBeDefined()

    await input.setValue('    ')
    expect(t(wrapper, 'reason-error')).toBe('Informe o motivo.')
    expect(ok().attributes('disabled')).toBeDefined()

    await input.setValue('  Texto enganoso no anúncio  ')
    expect(wrapper.find('[data-testid="reason-error"]').exists()).toBe(false)
    expect(ok().attributes('disabled')).toBeUndefined()
    const getsBefore = calls.filter((c) => c.method === 'GET').length

    await ok().trigger('click')
    await flushPromises()
    const post = nonGet(calls)[0]
    expect(post.method).toBe('POST')
    expect(post.path).toBe('/platform-sponsor-campaigns/21/suspend')
    expect(post.body).toEqual({ reason: 'Texto enganoso no anúncio' })
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(t(wrapper, 'notice')).toContain('suspensa')
    expect(calls.filter((c) => c.method === 'GET').length).toBe(getsBefore + 3) // grupo, patrocinadores e campanhas recarregados
  })

  it('cancelar não chama a API', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    await action(wrapper, 21, 'suspend').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('algum motivo')
    await wrapper.get('[data-cancel]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('reabrir o diálogo começa com o motivo em branco', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    await action(wrapper, 21, 'suspend').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('motivo antigo')
    await wrapper.get('[data-cancel]').trigger('click')
    await action(wrapper, 21, 'suspend').trigger('click')
    expect((wrapper.get('[data-testid="reason-input"]').element as HTMLTextAreaElement).value).toBe('')
    expect(t(wrapper, 'reason-counter')).toBe('0/300')
  })

  it.each([
    [403, { message: 'Forbidden resource' }, 'não tem permissão'],
    [404, { message: 'Not Found' }, 'não existe mais'],
    [400, { message: ['reason deve ter entre 3 e 300 caracteres.'] }, 'reason deve ter entre 3 e 300 caracteres.'],
    [409, { message: 'A campanha já está suspensa.' }, 'A campanha já está suspensa.'],
  ])('erro %i do servidor: mensagem clara no diálogo, que continua aberto com o motivo preservado', async (status, body, expected) => {
    mockFetch((call) => (call.method === 'POST' ? { status, body } : handler()(call)))
    const { wrapper } = await mount()
    await action(wrapper, 21, 'suspend').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('Motivo válido')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'confirm-error')).toContain(expected)
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="reason-input"]').element as HTMLTextAreaElement).value).toBe('Motivo válido')
  })
})

describe('SponsorGroupDetailView — levantar suspensão (só super admin)', () => {
  it('super admin: confirma, POST /unsuspend sem corpo, recarrega e avisa que volta pausada', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    const button = action(wrapper, 22, 'unsuspend')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(t(wrapper, 'unsuspend-reason')).toBe('Motivo da suspensão: Texto enganoso')
    expect(wrapper.get('[data-testid="confirm-dialog"]').text()).toContain('pausada')
    expect(nonGet(calls)).toHaveLength(0)

    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(1)
    expect(nonGet(calls)[0].path).toBe('/platform-sponsor-campaigns/22/unsuspend')
    expect(nonGet(calls)[0].body).toBeUndefined()
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(t(wrapper, 'notice')).toContain('levantada')
  })

  it('PLATFORM comum: botão DESABILITADO com explicação; clicar não abre diálogo nem chama a API', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount(nonSuper())
    const button = action(wrapper, 22, 'unsuspend')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('super admin')
    expect(t(wrapper, 'readonly-note')).toContain('super admin')
    await button.trigger('click')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('MEMBER com isSuperAdmin=true também NÃO levanta (só PLATFORM conta)', async () => {
    mockFetch(handler())
    const { wrapper } = await mount(makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true }))
    expect(action(wrapper, 22, 'unsuspend').attributes('disabled')).toBeDefined()
  })

  it('403 do servidor (sem permissão): mensagem clara, diálogo continua aberto', async () => {
    mockFetch((call) => (call.method === 'POST' ? { status: 403, body: { message: 'Forbidden resource' } } : handler()(call)))
    const { wrapper } = await mount()
    await action(wrapper, 22, 'unsuspend').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'confirm-error')).toContain('não tem permissão')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
  })
})

describe('SponsorGroupDetailView — bloquear / liberar grupo (só super admin)', () => {
  it('super admin bloqueia: motivo obrigatório, POST /block {reason}, recarrega e avisa', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    const button = wrapper.get('[data-action="block"]')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')

    expect(wrapper.get('[data-testid="confirm-dialog"]').text()).toContain('Capoeira Raízes')
    expect(wrapper.get('[data-testid="confirm-ok"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="reason-input"]').setValue('x')
    expect(t(wrapper, 'reason-error')).toContain('pelo menos 3')
    expect(wrapper.get('[data-testid="confirm-ok"]').attributes('disabled')).toBeDefined()
    expect(nonGet(calls)).toHaveLength(0)

    await wrapper.get('[data-testid="reason-input"]').setValue('Várias denúncias')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(1)
    expect(nonGet(calls)[0].path).toBe('/platform-sponsor-groups/5/block')
    expect(nonGet(calls)[0].body).toEqual({ reason: 'Várias denúncias' })
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(t(wrapper, 'notice')).toContain('bloqueado')
  })

  it('depois de bloquear, a tela mostra o novo estado vindo do servidor (recarrega a lista de grupos)', async () => {
    let blocked = false
    mockFetch((call) => {
      if (call.method === 'POST') {
        blocked = true
        return { status: 204 }
      }
      if (call.method === 'GET' && call.path === '/platform-sponsor-groups') return listReply([groupRow({ blocked, blockedReason: blocked ? 'Várias denúncias' : null })])
      return handler()(call)
    })
    const { wrapper } = await mount()
    await wrapper.get('[data-action="block"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('Várias denúncias')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'blocked-chip')).toBe('Bloqueado')
    expect(t(wrapper, 'block-reason')).toBe('Motivo: Várias denúncias')
    expect(wrapper.find('[data-action="unblock"]').exists()).toBe(true)
  })

  it('PLATFORM comum: "Bloquear grupo" e "Liberar grupo" DESABILITADOS com explicação, sem API', async () => {
    const { calls } = mockFetch(handler())
    const normal = await mount(nonSuper())
    const block = normal.wrapper.get('[data-action="block"]')
    expect(block.attributes('disabled')).toBeDefined()
    expect(block.attributes('title')).toContain('super admin')
    await block.trigger('click')
    expect(normal.wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)

    mockFetch(handler({ groups: [groupRow({ blocked: true })] }))
    const blockedView = await mount(nonSuper())
    const unblock = blockedView.wrapper.get('[data-action="unblock"]')
    expect(unblock.attributes('disabled')).toBeDefined()
    expect(unblock.attributes('title')).toContain('super admin')
    await unblock.trigger('click')
    expect(blockedView.wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('super admin libera: confirmação mostra o motivo do bloqueio; POST /unblock sem corpo', async () => {
    const { calls } = mockFetch(handler({ groups: [groupRow({ blocked: true, blockedReason: 'Várias denúncias' })] }))
    const { wrapper } = await mount()
    await wrapper.get('[data-action="unblock"]').trigger('click')
    expect(t(wrapper, 'unblock-reason')).toBe('Motivo do bloqueio: Várias denúncias')
    expect(nonGet(calls)).toHaveLength(0)
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)[0].path).toBe('/platform-sponsor-groups/5/unblock')
    expect(nonGet(calls)[0].body).toBeUndefined()
    expect(t(wrapper, 'notice')).toContain('liberado')
  })

  it.each([
    [403, { message: 'Somente super admin pode bloquear grupos.' }, 'Somente super admin pode bloquear grupos.'],
    [404, { message: 'Not Found' }, 'não existe mais'],
    [400, { message: ['reason deve ser uma string.'] }, 'reason deve ser uma string.'],
  ])('erro %i ao bloquear: mensagem clara, diálogo aberto', async (status, body, expected) => {
    mockFetch((call) => (call.method === 'POST' ? { status, body } : handler()(call)))
    const { wrapper } = await mount()
    await wrapper.get('[data-action="block"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('Motivo válido')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(t(wrapper, 'confirm-error')).toContain(expected)
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
  })
})
