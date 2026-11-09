import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuditView from '@/views/AuditView.vue'
import GroupApplicationsView from '@/views/GroupApplicationsView.vue'
import { application, approved, approveResult, rejected, skipped, unverified } from './group-applications-fixtures'
import { flushPromises, makeUser, mockFetch, mountView, type Call, type MockReply } from './helpers'
import { listReply } from './sponsors-fixtures'

const SENTINEL_PASSWORD = 'SenhaSecreta#123'
const nonSuper = () => makeUser({ id: 2, name: 'Ana Suporte', isSuperAdmin: false })
const memberSuper = () => makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true })

const has = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).exists()
const t = (w: VueWrapper, id: string) => w.get(`[data-testid="${id}"]`).text()
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const norm = (text: string) => text.replace(/\s+/g, ' ').trim()
const listCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/platform-group-applications')

interface Overrides {
  /** Itens por status (padrão: 1 pendente, 1 aprovado, 1 não aprovado). */
  byStatus?: Partial<Record<string, unknown[]>>
  pendingCount?: MockReply
  list?: MockReply
  approve?: (call: Call) => MockReply | undefined
  reject?: (call: Call) => MockReply | undefined
}

function handler(over: Overrides = {}) {
  const data: Record<string, unknown[]> = {
    PENDING: [application()],
    APPROVED: [approved()],
    REJECTED: [rejected()],
    UNVERIFIED: [],
    EXPIRED: [],
    ...over.byStatus,
  }
  return (call: Call): MockReply | undefined => {
    if (call.method === 'POST' && /\/approve$/.test(call.path)) return over.approve?.(call) ?? { status: 201, body: approveResult() }
    if (call.method === 'POST' && /\/reject$/.test(call.path)) return over.reject?.(call) ?? { status: 200, body: rejected({ id: 5 }) }
    if (call.path === '/platform-group-applications/pending-count') return over.pendingCount ?? { body: { count: data.PENDING!.length } }
    if (call.path === '/platform-group-applications') return over.list ?? listReply(data[call.query.get('status') ?? 'PENDING'] ?? [])
    return undefined
  }
}

// Desmonta tudo no fim de cada teste: o contador agora tem timer e listener de visibilidade (stopPolling no unmount).
const mountedWrappers: VueWrapper[] = []

async function mountApplications(over: Overrides = {}, user = makeUser()) {
  const { calls } = mockFetch(handler(over))
  const mounted = await mountView(GroupApplicationsView, user)
  mountedWrappers.push(mounted.wrapper)
  return { ...mounted, calls }
}

async function click(wrapper: VueWrapper, css: string) {
  await wrapper.get(css).trigger('click')
  await flushPromises()
}

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop()!.unmount()
  vi.unstubAllGlobals()
})

describe('GroupApplicationsView — lista', () => {
  it('abre em Pendentes (status=PENDING na query) e mostra data, grupo, cidade/UF, solicitante, cargo e status', async () => {
    const { wrapper, calls } = await mountApplications()
    expect(wrapper.get('h1').text()).toBe('Pedidos de adesão')
    expect(wrapper.findAll('[role="tab"]').map((b) => norm(b.text()))).toEqual(['Pendentes(1)', 'Aguardando e-mail', 'Aprovados', 'Não aprovados', 'Expirados'])
    expect(wrapper.get('[data-testid="tab-PENDING"]').attributes('aria-selected')).toBe('true')
    expect(Object.fromEntries(listCalls(calls)[0].query)).toEqual({ status: 'PENDING', limit: '20', offset: '0' })

    const row = norm(t(wrapper, 'application-5'))
    expect(row).toContain('Núcleo Raízes do Cerrado')
    expect(row).toContain('Goiânia/GO')
    expect(row).toContain('Carlos Contramestre')
    expect(row).toContain('carlos@nucleo.com.br')
    expect(row).toContain('Contramestre')
    expect(row).toContain('Pendente')
    expect(row).toMatch(/0?[67]\/11\/2026/)
  })

  it('abas trocam o filtro de status no servidor e a lista', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="tab-APPROVED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('APPROVED')
    expect(has(wrapper, 'application-6')).toBe(true)
    expect(has(wrapper, 'application-5')).toBe(false)
    expect(norm(t(wrapper, 'application-6'))).toContain('Aprovado')

    await click(wrapper, '[data-testid="tab-REJECTED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('REJECTED')
    expect(norm(t(wrapper, 'application-7'))).toContain('Não aprovado')

    await click(wrapper, '[data-testid="tab-EXPIRED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('EXPIRED')
    expect(t(wrapper, 'empty')).toBe('Nenhum pedido expirado.')
  })

  it('busca (com atraso) vai em ?q= e volta ao início; paginação usa offset', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { wrapper, calls } = await mountApplications({ list: listReply([application()], 45) })
      await click(wrapper, '[data-testid="page-next"]')
      expect(listCalls(calls).at(-1)!.query.get('offset')).toBe('20')

      await wrapper.get('[data-testid="filter-q"]').setValue('  cerrado ')
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()
      const last = listCalls(calls).at(-1)!
      expect(last.query.get('q')).toBe('cerrado')
      expect(last.query.get('offset')).toBe('0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('erro ao carregar: aviso e "Tentar de novo"', async () => {
    const { wrapper, calls } = await mountApplications({ list: { status: 500, body: { message: 'boom' } } })
    expect(t(wrapper, 'list-error')).toContain('boom')
    const before = listCalls(calls).length
    await click(wrapper, '[data-testid="retry"]')
    expect(listCalls(calls).length).toBe(before + 1)
  })

  it('lista vazia de pendentes tem texto próprio', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [] } })
    expect(t(wrapper, 'empty')).toContain('Nenhum pedido pendente')
  })
})

describe('GroupApplicationsView — detalhe', () => {
  it('abre em diálogo com todos os campos, sem nenhuma senha', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    const dialog = wrapper.get('[data-testid="application-detail"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(t(wrapper, 'detail-applicant')).toBe('Carlos Contramestre')
    expect(t(wrapper, 'detail-email')).toBe('carlos@nucleo.com.br')
    expect(t(wrapper, 'detail-phone')).toBe('(62) 99999-0000')
    expect(t(wrapper, 'detail-role')).toContain('Contramestre')
    expect(norm(t(wrapper, 'detail-city'))).toBe('Goiânia / GO')
    expect(t(wrapper, 'detail-students')).toBe('40')
    expect(t(wrapper, 'detail-message')).toContain('12 anos de roda de rua')
    expect(dialog.text().toLowerCase()).not.toContain('senha')
    await click(wrapper, '[data-testid="detail-close"]')
    expect(has(wrapper, 'application-detail')).toBe(false)
  })

  it('aprovado: mostra decisão, quem decidiu, grupo criado e nota interna', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="tab-APPROVED"]')
    await click(wrapper, '[data-testid="application-6"] [data-action="open"]')
    expect(t(wrapper, 'detail-decided-by')).toBe('Owner')
    expect(norm(t(wrapper, 'detail-organization'))).toBe('Grupo Aprovado (grupo-aprovado)')
    expect(t(wrapper, 'detail-note')).toContain('Conferido pelo Instagram.')
    expect(has(wrapper, 'detail-approve')).toBe(false) // já decidido: sem botões de decisão
  })

  it('não aprovado: mostra o motivo que foi ao solicitante', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="tab-REJECTED"]')
    await click(wrapper, '[data-testid="application-7"] [data-action="open"]')
    expect(t(wrapper, 'detail-reason')).toContain('Não encontramos informações do grupo.')
  })
})

describe('GroupApplicationsView — travas por papel', () => {
  it('super admin PLATFORM: botões Aprovar/Não aprovar na linha e no detalhe; sem aviso de somente leitura', async () => {
    const { wrapper } = await mountApplications()
    expect(has(wrapper, 'read-only-banner')).toBe(false)
    expect(wrapper.find('[data-testid="application-5"] [data-action="approve"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="application-5"] [data-action="reject"]').exists()).toBe(true)
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(has(wrapper, 'detail-approve')).toBe(true)
    expect(has(wrapper, 'detail-reject')).toBe(true)
  })

  it.each([
    ['PLATFORM comum (não super)', nonSuper],
    ['MEMBER com isSuperAdmin=true (só PLATFORM conta)', memberSuper],
  ])('%s: lê tudo, mas SEM botões de decisão e SEM chamada que não seja GET', async (_name, user) => {
    const { wrapper, calls } = await mountApplications({}, user())
    expect(has(wrapper, 'read-only-banner')).toBe(true)
    expect(wrapper.find('[data-testid="application-5"] [data-action="open"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="approve"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="reject"]').exists()).toBe(false)

    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(has(wrapper, 'detail-approve')).toBe(false)
    expect(has(wrapper, 'detail-reject')).toBe(false)
    expect(has(wrapper, 'detail-read-only')).toBe(true)
    expect(has(wrapper, 'detail-close')).toBe(true)
    await click(wrapper, '[data-testid="detail-close"]')

    for (const tab of ['APPROVED', 'REJECTED', 'EXPIRED', 'PENDING']) await click(wrapper, `[data-testid="tab-${tab}"]`)
    expect(nonGet(calls)).toHaveLength(0)
    // sem confirm-dialog de decisão em lugar nenhum
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
  })
})

describe('GroupApplicationsView — aprovar', () => {
  it('abre o diálogo com o aviso; sem slug nem nota o corpo é {}; sucesso recarrega a lista e o contador', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    expect(t(wrapper, 'approve-group')).toBe('Núcleo Raízes do Cerrado')
    expect(t(wrapper, 'approve-warning')).toContain('cria o grupo e a conta de administrador')
    expect(t(wrapper, 'approve-warning')).toContain('avisa por e-mail')
    expect(nonGet(calls)).toHaveLength(0) // abrir não decide nada

    const listsBefore = listCalls(calls).length
    const countsBefore = calls.filter((c) => c.path.endsWith('/pending-count')).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].method).toBe('POST')
    expect(posts[0].path).toBe('/platform-group-applications/5/approve')
    expect(posts[0].body).toEqual({})
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(t(wrapper, 'notice')).toContain('Núcleo Raízes do Cerrado')
    expect(t(wrapper, 'notice')).toContain('nucleo-raizes-do-cerrado')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
    expect(calls.filter((c) => c.path.endsWith('/pending-count')).length).toBe(countsBefore + 1)
  })

  it('slug e nota interna válidos vão no corpo, aparados', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue(' raizes-do-cerrado ')
    await wrapper.get('[data-testid="approve-note"]').setValue(' conferido ')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(nonGet(calls)[0].body).toEqual({ slug: 'raizes-do-cerrado', internalNote: 'conferido' })
  })

  it('slug inválido ou nota longa demais: erro no campo e NENHUMA chamada', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue('Slug Ruim')
    await wrapper.get('[data-testid="approve-note"]').setValue('x'.repeat(501))
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'approve-slug-error')).toContain('2 a 60 caracteres')
    expect(t(wrapper, 'approve-note-error')).toContain('No máximo 500')
    expect(wrapper.get('[data-testid="approve-slug"]').attributes('aria-invalid')).toBe('true')
    expect(nonGet(calls)).toHaveLength(0)
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
  })

  it('Cancelar fecha sem chamar nada', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-cancel]')
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('aprovar a partir do detalhe fecha o detalhe e abre o diálogo de aprovação', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    await click(wrapper, '[data-testid="detail-approve"]')
    expect(has(wrapper, 'application-detail')).toBe(false)
    expect(has(wrapper, 'approve-group')).toBe(true)
  })

  it.each([
    ['NOT_PENDING', 409, { statusCode: 409, code: 'NOT_PENDING', message: 'Pedido não está pendente.' }, /já foi decidido/],
    ['EMAIL_TAKEN', 409, { statusCode: 409, code: 'EMAIL_TAKEN', message: 'E-mail já cadastrado.' }, /e-mail do solicitante já virou uma conta/],
    ['slug em uso', 409, { statusCode: 409, code: 'SLUG_TAKEN', message: 'Slug já em uso.' }, /endereço \(slug\) já está em uso/],
    ['403', 403, { statusCode: 403, message: 'Forbidden resource' }, /Só o super admin/],
    ['404', 404, { statusCode: 404, message: 'Not Found' }, /não existe mais/],
  ])('erro %s: mensagem em português no diálogo, que continua aberto', async (_name, status, body, text) => {
    const { wrapper, calls } = await mountApplications({ approve: () => ({ status, body }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    const message = t(wrapper, 'confirm-error')
    expect(message).toMatch(text)
    expect(message).not.toMatch(/NOT_PENDING|EMAIL_TAKEN|SLUG_TAKEN|Forbidden|Not Found/)
    expect(nonGet(calls)).toHaveLength(1)
  })

  it('409/404 recarregam a lista e o contador (lista estava desatualizada)', async () => {
    const { wrapper, calls } = await mountApplications({ approve: () => ({ status: 409, body: { statusCode: 409, code: 'NOT_PENDING', message: 'x' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    const listsBefore = listCalls(calls).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
  })

  it('400 do servidor no slug vira erro no campo', async () => {
    const { wrapper } = await mountApplications({
      approve: () => ({ status: 400, body: { statusCode: 400, message: ['slug must match /^[a-z0-9]+$/ regex'] } }),
    })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue('ok-slug')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'approve-slug-error')).toContain('slug must match')
  })
})

describe('GroupApplicationsView — não aprovar', () => {
  it('motivo obrigatório: vazio e curto demais não chamam a API; mostra o aviso de que o motivo vai ao solicitante', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    expect(t(wrapper, 'reject-warning')).toContain('mostrado ao solicitante')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('Informe o motivo')
    await wrapper.get('[data-testid="reject-reason"]').setValue('ab')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('mínimo 3')
    await wrapper.get('[data-testid="reject-reason"]').setValue('x'.repeat(301))
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('No máximo 300')
    expect(nonGet(calls)).toHaveLength(0)
    expect(t(wrapper, 'reject-reason-counter')).toBe('301/300')
  })

  it('motivo válido: POST /reject com { reason } (nota só se preenchida); sucesso recarrega lista e contador', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('  Não encontramos o grupo.  ')
    const listsBefore = listCalls(calls).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/platform-group-applications/5/reject')
    expect(posts[0].body).toEqual({ reason: 'Não encontramos o grupo.' })
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(t(wrapper, 'notice')).toContain('não aprovado')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
  })

  it('nota interna vai junto quando preenchida', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await wrapper.get('[data-testid="reject-note"]').setValue(' suspeita de duplicata ')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(nonGet(calls)[0].body).toEqual({ reason: 'Dados insuficientes', internalNote: 'suspeita de duplicata' })
  })

  it('409 NOT_PENDING em português; diálogo continua aberto', async () => {
    const { wrapper } = await mountApplications({ reject: () => ({ status: 409, body: { statusCode: 409, code: 'NOT_PENDING', message: 'x' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'confirm-error')).toMatch(/já foi decidido/)
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
  })

  it('403 em português', async () => {
    const { wrapper } = await mountApplications({ reject: () => ({ status: 403, body: { statusCode: 403, message: 'Forbidden resource' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'confirm-error')).toBe('Só o super admin pode aprovar ou não aprovar pedidos.')
  })
})

const VERIFIED_LABEL = 'E-mail confirmado'
const SKIPPED_LABEL = 'E-mail não confirmado (envio desligado)'
const WAITING_LABEL = 'Aguardando confirmação'
const BLOCKED_HINT = 'Disponível depois que o solicitante confirmar o e-mail.'
const row = (w: VueWrapper, id: number) => w.get(`[data-testid="application-${id}"]`)
const badge = (w: VueWrapper, id: number) => row(w, id).get('[data-testid="email-verification"]')

describe('GroupApplicationsView — aba "Aguardando e-mail" (UNVERIFIED)', () => {
  it('a aba existe logo depois de Pendentes, filtra por status=UNVERIFIED e o pedido não aparece em Pendentes', async () => {
    const { wrapper, calls } = await mountApplications({ byStatus: { UNVERIFIED: [unverified()] } })
    expect(has(wrapper, 'application-8')).toBe(false) // Pendentes: só o confirmado
    expect(wrapper.findAll('[role="tab"]').map((b) => b.attributes('data-testid'))).toEqual([
      'tab-PENDING',
      'tab-UNVERIFIED',
      'tab-APPROVED',
      'tab-REJECTED',
      'tab-EXPIRED',
    ])

    await click(wrapper, '[data-testid="tab-UNVERIFIED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('UNVERIFIED')
    expect(wrapper.get('[data-testid="tab-UNVERIFIED"]').attributes('aria-selected')).toBe('true')
    expect(has(wrapper, 'application-5')).toBe(false)
    const text = norm(t(wrapper, 'application-8'))
    expect(text).toContain('Grupo Sem Confirmar')
    expect(text).toContain('Aguardando e-mail') // chip da situação
    expect(badge(wrapper, 8).text()).toBe(WAITING_LABEL)
    // O contador do menu/aba Pendentes não conta os não confirmados (o servidor já exclui): continua (1).
    expect(t(wrapper, 'tab-pending-count')).toBe('(1)')
    expect(wrapper.get('[data-testid="tab-UNVERIFIED"]').text()).toBe('Aguardando e-mail')
  })

  it('aba vazia tem texto próprio; setas do teclado percorrem as 5 abas', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="tab-UNVERIFIED"]')
    expect(t(wrapper, 'empty')).toBe('Nenhum pedido aguardando a confirmação do e-mail.')

    await wrapper.get('[data-testid="applications-tabs"]').trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(wrapper.get('[data-testid="tab-PENDING"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="applications-tabs"]').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.get('[data-testid="applications-tabs"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.get('[data-testid="tab-APPROVED"]').attributes('aria-selected')).toBe('true')
  })
})

describe('GroupApplicationsView — selo de verificação do e-mail', () => {
  it('tabela: confirmado (verde), envio desligado (aviso, âmbar) e aguardando (informativo)', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [application(), skipped()], UNVERIFIED: [unverified()] } })
    expect(badge(wrapper, 5).text()).toBe(VERIFIED_LABEL)
    expect(badge(wrapper, 5).classes()).toContain('chip-success')
    expect(badge(wrapper, 9).text()).toBe(SKIPPED_LABEL)
    expect(badge(wrapper, 9).classes()).toContain('chip-warning')
    expect(badge(wrapper, 9).attributes('data-verification')).toBe('SKIPPED')

    await click(wrapper, '[data-testid="tab-UNVERIFIED"]')
    expect(badge(wrapper, 8).text()).toBe(WAITING_LABEL)
    expect(badge(wrapper, 8).classes()).toContain('chip-info')
  })

  it('detalhe: selo ao lado do e-mail; "em <data>" só para confirmado', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [application(), skipped()] } })
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    const dialog = wrapper.get('[data-testid="application-detail"]')
    expect(dialog.get('[data-testid="email-verification"]').text()).toBe(VERIFIED_LABEL)
    expect(norm(t(wrapper, 'detail-email-verified-at'))).toMatch(/^em 0?[78]\/11\/2026/)
    await click(wrapper, '[data-testid="detail-close"]')

    await click(wrapper, '[data-testid="application-9"] [data-action="open"]')
    expect(wrapper.get('[data-testid="application-detail"] [data-testid="email-verification"]').text()).toBe(SKIPPED_LABEL)
    expect(has(wrapper, 'detail-email-verified-at')).toBe(false)
  })

  it('resposta de servidor antigo (sem os campos novos) não quebra: sem selo e Instagram "não informado"', async () => {
    const { emailVerification, emailVerifiedAt, instagram, ...legacy } = application()
    void emailVerification, void emailVerifiedAt, void instagram
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [legacy] } })
    expect(row(wrapper, 5).find('[data-testid="email-verification"]').exists()).toBe(false)
    expect(row(wrapper, 5).get('[data-testid="instagram-empty"]').text()).toBe('não informado')
    expect(row(wrapper, 5).find('[data-action="approve"]').exists()).toBe(true)
  })
})

describe('GroupApplicationsView — Aprovar bloqueado para UNVERIFIED e erro 409 EMAIL_NOT_VERIFIED', () => {
  async function mountUnverified(user = makeUser()) {
    const mounted = await mountApplications({ byStatus: { UNVERIFIED: [unverified()] } }, user)
    await click(mounted.wrapper, '[data-testid="tab-UNVERIFIED"]')
    return mounted
  }

  it('na tabela: Aprovar desabilitado com a dica; clicar não abre diálogo nem chama a API; sem "Não aprovar"', async () => {
    const { wrapper, calls } = await mountUnverified()
    const approve = row(wrapper, 8).get('[data-action="approve"]')
    expect(approve.attributes('disabled')).toBeDefined()
    expect(approve.attributes('aria-disabled')).toBe('true')
    expect(approve.attributes('title')).toBe(BLOCKED_HINT)
    expect(approve.attributes('aria-label')).toContain('indisponível até o solicitante confirmar o e-mail')
    expect(row(wrapper, 8).find('[data-action="reject"]').exists()).toBe(false)

    await approve.trigger('click')
    await flushPromises()
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('no detalhe: Aprovar desabilitado, dica visível e ligada ao botão por aria-describedby', async () => {
    const { wrapper, calls } = await mountUnverified()
    await click(wrapper, '[data-testid="application-8"] [data-action="open"]')
    const approve = wrapper.get('[data-testid="detail-approve"]')
    expect(approve.attributes('disabled')).toBeDefined()
    expect(t(wrapper, 'detail-approve-blocked')).toBe(BLOCKED_HINT)
    expect(approve.attributes('aria-describedby')).toBe(wrapper.get('[data-testid="detail-approve-blocked"]').attributes('id'))
    expect(has(wrapper, 'detail-reject')).toBe(false)
    expect(has(wrapper, 'detail-decision')).toBe(false) // ainda sem decisão: nada de "Decidido em —"

    await approve.trigger('click')
    await flushPromises()
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(has(wrapper, 'application-detail')).toBe(true)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('PLATFORM comum (não super): nenhum botão de decisão no pedido não confirmado', async () => {
    const { wrapper, calls } = await mountUnverified(nonSuper())
    expect(row(wrapper, 8).find('[data-action="approve"]').exists()).toBe(false)
    await click(wrapper, '[data-testid="application-8"] [data-action="open"]')
    expect(has(wrapper, 'detail-approve')).toBe(false)
    expect(has(wrapper, 'detail-approve-blocked')).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('409 EMAIL_NOT_VERIFIED (corrida: o servidor ainda o vê sem confirmação): mensagem em português, diálogo aberto, lista recarregada', async () => {
    const { wrapper, calls } = await mountApplications({
      approve: () => ({ status: 409, body: { statusCode: 409, code: 'EMAIL_NOT_VERIFIED', message: 'EMAIL_NOT_VERIFIED' } }),
    })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    const listsBefore = listCalls(calls).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    const message = t(wrapper, 'confirm-error')
    expect(message).toMatch(/ainda não confirmou o e-mail/)
    expect(message).not.toMatch(/EMAIL_NOT_VERIFIED|NOT_PENDING|EMAIL_TAKEN/)
    expect(nonGet(calls)).toHaveLength(1)
    expect(listCalls(calls).length).toBe(listsBefore + 1)
  })
})

describe('GroupApplicationsView — Instagram', () => {
  it('tabela: link montado só do handle, em nova aba com rel="noopener noreferrer"', async () => {
    const { wrapper } = await mountApplications()
    expect(wrapper.findAll('thead th').map((th) => th.text())).toContain('Instagram')
    const link = row(wrapper, 5).get('[data-testid="instagram-link"]')
    expect(link.attributes('href')).toBe('https://www.instagram.com/nucleo.raizes/')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.text()).toBe('@nucleo.raizes')
  })

  it('vazio (null) mostra "não informado", sem link — na tabela, no detalhe e no diálogo de aprovar', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [application({ instagram: null })] } })
    expect(row(wrapper, 5).find('a').exists()).toBe(false)
    expect(row(wrapper, 5).get('[data-testid="instagram-empty"]').text()).toBe('não informado')

    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(t(wrapper, 'detail-instagram')).toBe('não informado')
    await click(wrapper, '[data-testid="detail-approve"]')
    expect(norm(t(wrapper, 'approve-instagram'))).toContain('não informado')
    expect(wrapper.find('[data-testid="approve-instagram"] a').exists()).toBe(false)
  })

  const INVALID = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(document.cookie)',
    'javascript:alert(1)//x',
    '@meugrupo',
    'https://www.instagram.com/meugrupo/',
    'instagram.com/meugrupo',
    '//evil.example/x',
    'meu grupo',
    'MeuGrupo',
    'a'.repeat(31),
    '../../evil',
    'a..b',
    'meugrupo.',
    'grupo/perfil',
    'grupo?x=1',
    '"><img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    'é-acentuado',
  ]

  it.each(INVALID)('handle inválido %j NUNCA vira link (aparece só como texto, escapado), em tabela, detalhe e diálogo de aprovar', async (bad) => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [application({ instagram: bad })] } })
    const cell = row(wrapper, 5).get('[data-testid="application-instagram"]')
    expect(cell.find('a').exists()).toBe(false)
    expect(cell.get('[data-testid="instagram-text"]').text()).toBe(bad)
    expect(cell.find('img, script').exists()).toBe(false)

    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(wrapper.get('[data-testid="detail-instagram"]').find('a').exists()).toBe(false)
    await click(wrapper, '[data-testid="detail-approve"]')
    expect(wrapper.get('[data-testid="approve-instagram"]').find('a').exists()).toBe(false)

    // Em nenhum lugar da página há âncora que não seja https://www.instagram.com/<handle>/ nem href javascript:.
    expect(wrapper.findAll('a[href]').filter((a) => /^\s*javascript:/i.test(a.attributes('href') ?? ''))).toHaveLength(0)
    expect(wrapper.findAll('a[href]')).toHaveLength(0)
    expect(wrapper.html()).not.toMatch(/href="javascript/i)
  })

  it.each(['a', 'meu_grupo', 'meu.grupo', 'grupo2026', '9', 'a'.repeat(30)])('handle válido %j vira link https://www.instagram.com/<handle>/', async (handle) => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [application({ instagram: handle })] } })
    const link = row(wrapper, 5).get('[data-testid="instagram-link"]')
    expect(link.attributes('href')).toBe(`https://www.instagram.com/${handle}/`)
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.attributes('target')).toBe('_blank')
  })

  it('detalhe: link + aviso para conferir o perfil antes de aprovar (só em pedido ainda sem decisão)', async () => {
    const { wrapper } = await mountApplications({ byStatus: { UNVERIFIED: [unverified()] } })
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    const link = wrapper.get('[data-testid="detail-instagram"] a')
    expect(link.attributes('href')).toBe('https://www.instagram.com/nucleo.raizes/')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(link.attributes('target')).toBe('_blank')
    expect(t(wrapper, 'detail-check-hint')).toBe('Confira o perfil antes de aprovar: o e-mail só prova que o solicitante recebe mensagens nele.')
    await click(wrapper, '[data-testid="detail-close"]')

    await click(wrapper, '[data-testid="tab-UNVERIFIED"]')
    await click(wrapper, '[data-testid="application-8"] [data-action="open"]')
    expect(has(wrapper, 'detail-check-hint')).toBe(true) // aguardando e-mail também é pedido em aberto
    await click(wrapper, '[data-testid="detail-close"]')

    await click(wrapper, '[data-testid="tab-APPROVED"]')
    await click(wrapper, '[data-testid="application-6"] [data-action="open"]')
    expect(has(wrapper, 'detail-check-hint')).toBe(false) // já decidido: sem aviso
  })

  it('diálogo de aprovar: mostra o Instagram (link com rel) e o selo do e-mail para conferir na hora', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [skipped({ instagram: 'raizes.go' })] } })
    await click(wrapper, '[data-testid="application-9"] [data-action="approve"]')
    const block = wrapper.get('[data-testid="approve-instagram"]')
    const link = block.get('a')
    expect(link.attributes('href')).toBe('https://www.instagram.com/raizes.go/')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(block.get('[data-testid="email-verification"]').text()).toBe(SKIPPED_LABEL)
  })

  it('o corpo enviado ao aprovar nunca leva Instagram (a decisão só manda slug e nota)', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(JSON.stringify(nonGet(calls).map((c) => c.body))).not.toMatch(/instagram|nucleo\.raizes/i)
  })
})

describe('GroupApplicationsView — contador de pendentes: atualização a cada 60 s e título', () => {
  const countCalls = (calls: Call[]) => calls.filter((c) => c.path === '/platform-group-applications/pending-count')

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    // Só o setInterval é falso: promessas, fetch e flushPromises seguem reais.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    document.title = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (document as unknown as Record<string, unknown>).visibilityState
    delete (document as unknown as Record<string, unknown>).hidden
  })

  async function tick(ms: number) {
    vi.advanceTimersByTime(ms)
    await flushPromises()
  }

  it('consulta o contador ao abrir e depois a cada 60 s (nem um instante antes); o número vai para a aba e o título', async () => {
    const reply: MockReply = { body: { count: 2 } }
    const { wrapper, calls } = await mountApplications({ pendingCount: reply })
    expect(countCalls(calls)).toHaveLength(1)
    expect(t(wrapper, 'tab-pending-count')).toBe('(2)')
    expect(document.title).toBe('(2) Pedidos de adesão · Admin GingApp')

    reply.body = { count: 5 }
    await tick(59_999)
    expect(countCalls(calls)).toHaveLength(1)
    await tick(1)
    expect(countCalls(calls)).toHaveLength(2)
    expect(countCalls(calls)[1].method).toBe('GET')
    expect(t(wrapper, 'tab-pending-count')).toBe('(5)')
    expect(document.title).toBe('(5) Pedidos de adesão · Admin GingApp')

    await tick(120_000)
    expect(countCalls(calls)).toHaveLength(4)
  })

  it('zero pendentes: título e aba sem número', async () => {
    const reply: MockReply = { body: { count: 3 } }
    const { wrapper } = await mountApplications({ pendingCount: reply })
    expect(document.title).toBe('(3) Pedidos de adesão · Admin GingApp')
    reply.body = { count: 0 }
    await tick(60_000)
    expect(document.title).toBe('Pedidos de adesão · Admin GingApp')
    expect(has(wrapper, 'tab-pending-count')).toBe(false)
  })

  it('falha na atualização periódica mantém o último número bom (não zera nem quebra)', async () => {
    const reply: MockReply = { body: { count: 4 } }
    const { wrapper, calls } = await mountApplications({ pendingCount: reply })
    reply.status = 500
    reply.body = { message: 'boom' }
    await tick(60_000)
    expect(countCalls(calls)).toHaveLength(2)
    expect(t(wrapper, 'tab-pending-count')).toBe('(4)')
    expect(document.title).toBe('(4) Pedidos de adesão · Admin GingApp')
    expect(has(wrapper, 'list-error')).toBe(false)
  })

  it('aba do navegador oculta: para de consultar; ao voltar a ficar visível atualiza na hora e retoma o ritmo de 60 s', async () => {
    const reply: MockReply = { body: { count: 1 } }
    const { calls } = await mountApplications({ pendingCount: reply })
    expect(countCalls(calls)).toHaveLength(1)

    setVisibility('hidden')
    await tick(10 * 60_000)
    expect(countCalls(calls)).toHaveLength(1) // nada em segundo plano
    expect(vi.getTimerCount()).toBe(0)

    reply.body = { count: 6 }
    setVisibility('visible')
    await flushPromises()
    expect(countCalls(calls)).toHaveLength(2) // atualização imediata ao voltar
    expect(document.title).toBe('(6) Pedidos de adesão · Admin GingApp')

    await tick(59_999)
    expect(countCalls(calls)).toHaveLength(2)
    await tick(1)
    expect(countCalls(calls)).toHaveLength(3)
  })

  it('abrir a tela com a aba já oculta não arma o timer', async () => {
    setVisibility('hidden')
    const { calls } = await mountApplications()
    expect(countCalls(calls)).toHaveLength(1) // a carga inicial da tela continua
    expect(vi.getTimerCount()).toBe(0)
    await tick(5 * 60_000)
    expect(countCalls(calls)).toHaveLength(1)
  })

  it('ao desmontar: timer e listener são limpos (nenhuma consulta depois) e o título volta ao normal', async () => {
    const { wrapper, calls } = await mountApplications({ pendingCount: { body: { count: 2 } } })
    expect(vi.getTimerCount()).toBe(1)
    expect(document.title).toBe('(2) Pedidos de adesão · Admin GingApp')
    wrapper.unmount()
    mountedWrappers.length = 0
    expect(vi.getTimerCount()).toBe(0)
    expect(document.title).toBe('Pedidos de adesão · Admin GingApp')

    const before = countCalls(calls).length
    await tick(5 * 60_000)
    setVisibility('hidden')
    setVisibility('visible')
    await flushPromises()
    expect(countCalls(calls)).toHaveLength(before)
  })

  it('ao desmontar NÃO pisa no título da próxima tela (o roteador já o trocou)', async () => {
    const { wrapper } = await mountApplications({ pendingCount: { body: { count: 2 } } })
    document.title = 'Financeiro · Admin GingApp'
    wrapper.unmount()
    mountedWrappers.length = 0
    expect(document.title).toBe('Financeiro · Admin GingApp')
  })

  it('decidir um pedido atualiza o contador na hora (sem esperar os 60 s) e o título', async () => {
    const reply: MockReply = { body: { count: 2 } }
    const { wrapper } = await mountApplications({ pendingCount: reply })
    reply.body = { count: 1 }
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'tab-pending-count')).toBe('(1)')
    expect(document.title).toBe('(1) Pedidos de adesão · Admin GingApp')
  })
})

describe('senha nunca aparece', () => {
  it('mesmo que o servidor vazasse um campo de senha, a tela não o exibe; os corpos enviados nunca levam senha', async () => {
    // Simula uma resposta com campo indevido (o contrato garante que não vem): a tela só renderiza campos conhecidos.
    const withSentinel = { ...application({ message: 'texto normal' }), passwordHash: SENTINEL_PASSWORD, password: SENTINEL_PASSWORD }
    const { wrapper, calls } = await mountApplications({ byStatus: { PENDING: [withSentinel] } })
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(wrapper.html()).not.toContain(SENTINEL_PASSWORD)
    expect(wrapper.html().toLowerCase()).not.toContain('passwordhash')
    expect(wrapper.html().toLowerCase()).not.toContain('type="password"')
    await click(wrapper, '[data-testid="detail-approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(JSON.stringify(nonGet(calls).map((c) => c.body))).not.toMatch(/pass/i)
  })
})

describe('AuditView — rótulos das ações novas', () => {
  it('mostra "Pedido de adesão aprovado/não aprovado" e as ações PLATFORM_FINANCE_* em português', async () => {
    const log = (id: number, action: string, entity: string) => ({
      id,
      createdAt: '2026-11-08T15:00:00.000Z',
      action,
      entity,
      entityId: '5',
      organizationId: null,
      organizationName: null,
      userId: 1,
      userName: 'Owner',
      userEmail: 'owner@gingapp.com.br',
      ip: '10.0.0.1',
      meta: { status: 'APPROVED' },
    })
    mockFetch((call) => {
      if (call.path === '/organizations') return { body: [], headers: { 'X-Total-Count': '0' } }
      if (call.path === '/audit-logs') {
        return listReply([
          log(1, 'GROUP_APPLICATION_APPROVE', 'group_application'),
          log(2, 'GROUP_APPLICATION_REJECT', 'group_application'),
          log(3, 'PLATFORM_FINANCE_MONTH_PUBLISH', 'platform_ledger_month'),
        ])
      }
      return undefined
    })
    const { wrapper } = await mountView(AuditView)
    expect(norm(t(wrapper, 'audit-1'))).toContain('Pedido de adesão aprovado')
    expect(norm(t(wrapper, 'audit-2'))).toContain('Pedido de adesão não aprovado')
    expect(norm(t(wrapper, 'audit-3'))).toContain('Mês da transparência publicado')
    expect(norm(t(wrapper, 'audit-1'))).not.toContain('GROUP_APPLICATION_APPROVE')
    const options = wrapper.findAll('[data-testid="filter-action"] option').map((o) => o.text())
    expect(options).toContain('Pedido de adesão aprovado')
    expect(options).toContain('Pedido de adesão não aprovado')
  })
})
