import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { takeFlash, setFlash } from '@/utils/flash'
import type { EffectiveStatus } from '@/utils/sponsors'
import SponsorCampaignsView from '@/views/SponsorCampaignsView.vue'
import { flushPromises, makeUser, mockFetch, type Call, type MockReply } from './helpers'
import { campaign, listReply, mountAt, nonSuper, sponsor } from './sponsors-fixtures'

const mount = (user = makeUser()) => mountAt(SponsorCampaignsView, '/sponsors/campaigns', user)
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const row = (w: VueWrapper, id: number) => w.get(`[data-testid="campaign-${id}"]`)
const action = (w: VueWrapper, id: number, name: string) => row(w, id).find(`[data-action="${name}"]`)

const draft = campaign({ id: 1, title: 'Rascunho A', status: 'DRAFT', effectiveStatus: 'DRAFT' })
const live = campaign({
  id: 2,
  title: 'No ar B',
  status: 'ACTIVE',
  effectiveStatus: 'ACTIVE_NOW',
  approvedByUserId: 1,
  approvedAt: '2026-10-02T15:30:00.000Z',
  approvedBy: { id: 1, name: 'Owner GingApp' },
})
const scheduled = campaign({ id: 3, title: 'Agendada C', status: 'ACTIVE', effectiveStatus: 'SCHEDULED', states: [] })
const paused = campaign({ id: 4, title: 'Pausada D', status: 'PAUSED', effectiveStatus: 'PAUSED', approvedByUserId: 9, approvedAt: '2026-10-03T12:00:00.000Z' })
const ended = campaign({ id: 5, title: 'Encerrada E', status: 'ACTIVE', effectiveStatus: 'ENDED' })
const all = [draft, live, scheduled, paused, ended]

function handler(items = all, total = items.length) {
  return (call: Call): MockReply | undefined => {
    if (call.path === '/platform-sponsors') return listReply([sponsor(), sponsor({ id: 2, name: 'Outra Marca' })])
    if (call.path === '/platform-sponsor-campaigns' && call.method === 'GET') return listReply(items, total)
    if (call.method === 'DELETE') return { status: 204 }
    if (call.method === 'POST') return { body: campaign() }
    return undefined
  }
}

describe('SponsorCampaignsView — lista e chips', () => {
  it('mostra os 5 status efetivos com rótulo ESCRITO (não só cor)', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    const chip = (id: number) => row(wrapper, id).get('[data-testid="status-chip"]')
    expect(chip(1).text()).toBe('Rascunho')
    expect(chip(2).text()).toBe('No ar agora')
    expect(chip(3).text()).toBe('Agendada')
    expect(chip(4).text()).toBe('Pausada')
    expect(chip(5).text()).toBe('Encerrada')
    const status: EffectiveStatus[] = ['DRAFT', 'ACTIVE_NOW', 'SCHEDULED', 'PAUSED', 'ENDED']
    status.forEach((s, i) => expect(chip(i + 1).attributes('data-status')).toBe(s))
    // cada chip tem uma combinação de cores diferente
    expect(new Set([1, 2, 3, 4, 5].map((id) => chip(id).classes().join(' '))).size).toBe(5)

    expect(calls.find((c) => c.path === '/platform-sponsor-campaigns')!.query.get('limit')).toBe('20')
  })

  it('mostra patrocinador, categoria, vigência, UFs ("Brasil todo" quando vazio) e peso', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const first = row(wrapper, 1).text()
    expect(first).toContain('Casa do Berimbau')
    expect(first).toContain('Instrumentos')
    expect(first).toContain('GO, SP')
    expect(first).toContain('01/10/2026')
    expect(row(wrapper, 3).text()).toContain('Brasil todo')
  })

  it('"aprovada por <usuário> em <data>" quando há aprovação; com só o id, mostra o id', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(row(wrapper, 2).get('[data-testid="approval"]').text()).toBe('Aprovada por Owner GingApp em 02/10/2026, 12:30')
    expect(row(wrapper, 4).get('[data-testid="approval"]').text()).toContain('usuário #9')
    expect(row(wrapper, 1).find('[data-testid="approval"]').exists()).toBe(false)
  })

  it('filtros: situação, patrocinador e busca (debounced) vão na consulta e voltam à página 1', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    const lists = () => calls.filter((c) => c.path === '/platform-sponsor-campaigns')

    // opções de situação: as 5 + "Todas"
    const options = wrapper.get('[data-testid="filter-effective"]').findAll('option').map((o) => o.text())
    expect(options).toEqual(['Todas', 'No ar agora', 'Agendada', 'Rascunho', 'Pausada', 'Encerrada'])
    // patrocinadores vindos da API
    expect(wrapper.get('[data-testid="filter-sponsor"]').findAll('option').map((o) => o.text())).toEqual(['Todos', 'Casa do Berimbau', 'Outra Marca'])

    await wrapper.get('[data-testid="filter-effective"]').setValue('ACTIVE_NOW')
    await flushPromises()
    expect(lists()[1].query.get('effective')).toBe('ACTIVE_NOW')

    await wrapper.get('[data-testid="filter-sponsor"]').setValue('2')
    await flushPromises()
    expect(lists()[2].query.get('sponsorId')).toBe('2')
    expect(lists()[2].query.get('effective')).toBe('ACTIVE_NOW')

    await wrapper.get('[data-testid="filter-q"]').setValue('berimbau')
    expect(lists()).toHaveLength(3) // debounce
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(lists()[3].query.get('q')).toBe('berimbau')
    expect(lists()[3].query.get('offset')).toBe('0')

    await wrapper.get('[data-testid="filter-clear"]').trigger('click')
    await flushPromises()
    const last = lists()[lists().length - 1]
    expect(last.query.has('effective') || last.query.has('sponsorId') || last.query.has('q')).toBe(false)
  })

  it('paginação como o resto do admin (X-Total-Count)', async () => {
    const { calls } = mockFetch(handler(all, 45))
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="page-range"]').text()).toBe('1–20 de 45')
    await wrapper.get('[data-testid="page-next"]').trigger('click')
    await flushPromises()
    expect(calls.filter((c) => c.path === '/platform-sponsor-campaigns')[1].query.get('offset')).toBe('20')
  })

  it('lista vazia, vazia com filtro, carregando e erro', async () => {
    mockFetch(handler([]))
    const empty = await mount()
    expect(empty.wrapper.get('[data-testid="empty"]').text()).toContain('Nenhuma campanha criada ainda')
    await empty.wrapper.get('[data-testid="filter-effective"]').setValue('ENDED')
    await flushPromises()
    expect(empty.wrapper.get('[data-testid="empty"]').text()).toContain('com esses filtros')

    let release: (r: MockReply) => void = () => undefined
    mockFetch((call) => (call.path === '/platform-sponsor-campaigns' ? new Promise<MockReply>((resolve) => (release = resolve)) : listReply([])))
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="loading"]').text()).toContain('Carregando')
    release({ status: 500, body: { message: 'Banco indisponível.' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="list-error"]').text()).toContain('Banco indisponível.')
  })

  it('exibe a mensagem avisada pelo formulário (flash) uma única vez', async () => {
    setFlash('Campanha "X" criada como rascunho.')
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(wrapper.get('[data-testid="notice"]').text()).toContain('criada como rascunho')
    expect(takeFlash()).toBe('')
  })
})

describe('SponsorCampaignsView — ações por perfil', () => {
  it('super admin: "Ativar" habilitado só nos rascunhos; Pausar (ativas) e Retomar (pausadas)', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(wrapper.find('[data-testid="readonly-note"]').exists()).toBe(false)
    expect(action(wrapper, 1, 'activate').exists()).toBe(true)
    expect(action(wrapper, 1, 'activate').attributes('disabled')).toBeUndefined()
    for (const id of [2, 3, 4, 5]) expect(action(wrapper, id, 'activate').exists()).toBe(false)
    expect(action(wrapper, 2, 'pause').exists()).toBe(true)
    expect(action(wrapper, 3, 'pause').exists()).toBe(true)
    expect(action(wrapper, 4, 'resume').exists()).toBe(true)
    expect(action(wrapper, 1, 'pause').exists()).toBe(false)
    expect(action(wrapper, 1, 'report').attributes('href')).toBe('/sponsors/campaigns/1/report')
    expect(action(wrapper, 1, 'edit').attributes('href')).toBe('/sponsors/campaigns/1/edit')
  })

  it('PLATFORM comum: "Ativar" DESABILITADO com explicação; pausar/retomar/editar/excluir seguem disponíveis', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount(nonSuper())
    const activate = action(wrapper, 1, 'activate')
    expect(activate.attributes('disabled')).toBeDefined()
    expect(activate.attributes('title')).toContain('super admin')
    expect(wrapper.get('[data-testid="readonly-note"]').text()).toContain('Somente super admins')
    await activate.trigger('click') // botão desabilitado não abre diálogo
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(action(wrapper, 2, 'pause').exists()).toBe(true)
    expect(action(wrapper, 4, 'resume').exists()).toBe(true)
    expect(action(wrapper, 1, 'delete').exists()).toBe(true)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('usuário MEMBER com isSuperAdmin=true também NÃO ativa (só PLATFORM conta)', async () => {
    mockFetch(handler())
    const { wrapper } = await mount(makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true }))
    expect(action(wrapper, 1, 'activate').attributes('disabled')).toBeDefined()
  })

  it('ativar: confirmação mostra o que vai ao ar e que fica aprovada por você; só então chama POST /activate', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount(makeUser({ name: 'Edgard Super' }))
    await action(wrapper, 1, 'activate').trigger('click')

    const dialog = wrapper.get('[data-testid="confirm-dialog"]')
    expect(dialog.text()).toContain('Rascunho A')
    expect(dialog.text()).toContain('Casa do Berimbau')
    expect(dialog.get('[data-testid="activate-url"]').text()).toBe('https://www.casadoberimbau.com.br/oferta')
    expect(dialog.get('[data-testid="preview-badge"]').text()).toBe('Patrocinado')
    expect(dialog.get('[data-testid="activate-approval-note"]').text()).toContain('aprovada por Edgard Super')
    expect(nonGet(calls)).toHaveLength(0)

    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    const post = nonGet(calls)[0]
    expect(post.method).toBe('POST')
    expect(post.path).toBe('/platform-sponsor-campaigns/1/activate')
    expect(post.body).toBeUndefined()
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="notice"]').text()).toContain('aprovada por você')
    expect(calls.filter((c) => c.path === '/platform-sponsor-campaigns' && c.method === 'GET')).toHaveLength(2)
  })

  it('ativar com erro do servidor (campanha incompleta / 403): mensagem no diálogo, que continua aberto', async () => {
    mockFetch((call) =>
      call.method === 'POST' ? { status: 400, body: { message: ['Campanha incompleta: falta a imagem.'] } } : handler()(call),
    )
    const { wrapper } = await mount()
    await action(wrapper, 1, 'activate').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="confirm-error"]').text()).toBe('Campanha incompleta: falta a imagem.')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
  })

  it('cancelar a ativação não chama a API', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    await action(wrapper, 1, 'activate').trigger('click')
    await wrapper.get('[data-cancel]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('pausar e retomar chamam o endpoint certo e avisam', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount(nonSuper()) // não precisa ser super admin
    await action(wrapper, 2, 'pause').trigger('click')
    await flushPromises()
    expect(nonGet(calls).map((c) => c.path)).toEqual(['/platform-sponsor-campaigns/2/pause'])
    expect(wrapper.get('[data-testid="notice"]').text()).toContain('pausada')
    await action(wrapper, 4, 'resume').trigger('click')
    await flushPromises()
    expect(nonGet(calls).map((c) => c.path)).toEqual(['/platform-sponsor-campaigns/2/pause', '/platform-sponsor-campaigns/4/resume'])
    expect(wrapper.get('[data-testid="notice"]').text()).toContain('retomada')
  })

  it('excluir pede confirmação; campanha no ar avisa que sai do app; DELETE só depois do OK', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    await action(wrapper, 2, 'delete').trigger('click')
    expect(wrapper.get('[data-testid="delete-live-warning"]').text()).toContain('no ar agora')
    expect(wrapper.get('[data-testid="confirm-dialog"]').text()).toContain('impressões e cliques')
    expect(nonGet(calls)).toHaveLength(0)
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)[0].method).toBe('DELETE')
    expect(nonGet(calls)[0].path).toBe('/platform-sponsor-campaigns/2')
    expect(wrapper.get('[data-testid="notice"]').text()).toContain('excluída')

    await action(wrapper, 1, 'delete').trigger('click')
    expect(wrapper.find('[data-testid="delete-live-warning"]').exists()).toBe(false) // rascunho: sem o aviso
  })
})
